const DEFAULT_SERVER_URL = "https://pinit-xndf.onrender.com";
const MAX_MEDIA_PER_TAB = 12;
const MEDIA_URL_PATTERN = /^https?:\/\/[^/]*\.?pinimg\.com\/.+\.(m3u8|mp4)(?:[?#].*)?$/i;
const tabMedia = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });
  await chrome.storage.sync.set({ serverUrl: normalizeServerUrl(settings.serverUrl) });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || !isMediaUrl(details.url)) {
      return;
    }

    rememberMedia(details.tabId, details.url, "network");
  },
  {
    urls: ["*://*.pinimg.com/*"],
    types: ["media", "xmlhttprequest", "other"]
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMedia.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    (changeInfo.url && isPinterestUrl(changeInfo.url)) ||
    (changeInfo.status === "loading" && tab.url && isPinterestUrl(tab.url))
  ) {
    clearTabMedia(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId ?? sender.tab?.id;

  if (message.type === "PINIT_MEDIA_FOUND" && tabId >= 0 && isMediaUrl(message.mediaUrl)) {
    rememberMedia(tabId, message.mediaUrl, "page");
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "PINIT_PAGE_CHANGED" && tabId >= 0) {
    clearTabMedia(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "PINIT_GET_STATE") {
    sendResponse(getState(tabId));
    return false;
  }

  if (message.type === "PINIT_DOWNLOAD_LATEST") {
    downloadLatest(tabId, message.mediaUrl).then(sendResponse);
    return true;
  }

  if (message.type === "PINIT_GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "PINIT_SAVE_SETTINGS") {
    saveSettings(message).then(sendResponse);
    return true;
  }

  return false;
});

function rememberMedia(tabId, mediaUrl, source) {
  const existing = getRecord(tabId);
  const item = {
    url: mediaUrl,
    source,
    type: mediaUrl.toLowerCase().includes(".m3u8") ? "hls" : "mp4",
    foundAt: Date.now()
  };
  const withoutDuplicate = existing.media.filter((mediaItem) => mediaItem.url !== mediaUrl);
  const media = [
    item,
    ...withoutDuplicate
  ].slice(0, MAX_MEDIA_PER_TAB);

  tabMedia.set(tabId, {
    target: existing.target || item,
    media
  });
  chrome.tabs.sendMessage(tabId, { type: "PINIT_MEDIA_AVAILABLE", state: getState(tabId) }).catch(() => {});
}

function getState(tabId) {
  const record = getRecord(tabId);
  const target = record.target || record.media[0] || null;

  return {
    ok: true,
    hasMedia: Boolean(target),
    target,
    latest: target,
    media: record.media
  };
}

async function downloadLatest(tabId, explicitMediaUrl) {
  const mediaUrl = explicitMediaUrl || getState(tabId).target?.url;
  if (!mediaUrl || !isMediaUrl(mediaUrl)) {
    return { ok: false, error: "Open a Pinterest video pin and let it play first." };
  }

  lockTarget(tabId, mediaUrl);

  const { serverUrl } = await getSettings();
  const downloadUrl = `${serverUrl}/api/download?url=${encodeURIComponent(mediaUrl)}`;

  return new Promise((resolve) => {
    chrome.downloads.download({ url: downloadUrl, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve({ ok: true, downloadId });
    });
  });
}

function lockTarget(tabId, mediaUrl) {
  const record = getRecord(tabId);
  const item =
    record.media.find((mediaItem) => mediaItem.url === mediaUrl) || {
      url: mediaUrl,
      source: "manual",
      type: mediaUrl.toLowerCase().includes(".m3u8") ? "hls" : "mp4",
      foundAt: Date.now()
    };

  tabMedia.set(tabId, {
    target: item,
    media: [item, ...record.media.filter((mediaItem) => mediaItem.url !== mediaUrl)].slice(0, MAX_MEDIA_PER_TAB)
  });
}

function clearTabMedia(tabId) {
  tabMedia.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: "PINIT_MEDIA_AVAILABLE", state: getState(tabId) }).catch(() => {});
}

function getRecord(tabId) {
  return tabMedia.get(tabId) || { target: null, media: [] };
}

async function getSettings() {
  const settings = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER_URL });

  return {
    ok: true,
    serverUrl: normalizeServerUrl(settings.serverUrl)
  };
}

async function saveSettings(message) {
  const serverUrl = normalizeServerUrl(message.serverUrl || DEFAULT_SERVER_URL);
  await chrome.storage.sync.set({ serverUrl });

  return { ok: true, serverUrl };
}

function normalizeServerUrl(value) {
  const raw = String(value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, "");

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_SERVER_URL;
    }

    return url.href.replace(/\/+$/, "");
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

function isMediaUrl(value) {
  return typeof value === "string" && MEDIA_URL_PATTERN.test(value);
}

function isPinterestUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "pinterest.com" || url.hostname.endsWith(".pinterest.com");
  } catch {
    return false;
  }
}
