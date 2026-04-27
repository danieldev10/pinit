const MEDIA_URL_PATTERN = /^https?:\/\/[^/]*\.?pinimg\.com\/.+\.(m3u8|mp4)(?:[?#].*)?$/i;
const SCAN_INTERVAL_MS = 1500;
const seenUrls = new Set();

let root;
let button;
let statusText;
let targetMediaUrl = "";
let hideTimer;
let pageUrl = location.href;
let minEntryStartTime = 0;

init();

function init() {
  createButton();
  refreshState();
  scanPerformanceEntries();
  setInterval(scanPerformanceEntries, SCAN_INTERVAL_MS);
  setInterval(checkForPageChange, 700);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "PINIT_MEDIA_AVAILABLE") {
      applyState(message.state);
    }
  });
}

function createButton() {
  root = document.createElement("div");
  root.id = "pinit-extension-root";
  root.hidden = true;

  button = document.createElement("button");
  button.type = "button";
  button.className = "pinit-download-button";
  button.title = "Download this Pinterest video with Pinit";
  button.innerHTML = `
    <span class="pinit-icon" aria-hidden="true">↓</span>
    <span>Download MP4</span>
  `;

  statusText = document.createElement("div");
  statusText.className = "pinit-status";
  statusText.textContent = "Video found";

  root.append(button, statusText);
  document.documentElement.append(root);

  button.addEventListener("click", async () => {
    setStatus("Starting download...");
    button.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "PINIT_DOWNLOAD_LATEST",
        mediaUrl: targetMediaUrl
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Could not start the download.");
      }

      setStatus("Download started");
    } catch (error) {
      setStatus(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "PINIT_GET_STATE" });
    applyState(state);
  } catch {
    root.hidden = true;
  }
}

function applyState(state) {
  const target = state?.target || state?.latest;

  if (!state?.hasMedia || !target?.url) {
    targetMediaUrl = "";
    root.hidden = true;
    return;
  }

  targetMediaUrl = target.url;
  root.hidden = false;
  setStatus(target.type === "hls" ? "HLS video locked" : "MP4 video locked");
}

function scanPerformanceEntries() {
  const entries = performance.getEntriesByType("resource");

  for (const entry of entries) {
    const mediaUrl = entry.name;
    if (entry.startTime < minEntryStartTime || !MEDIA_URL_PATTERN.test(mediaUrl) || seenUrls.has(mediaUrl)) {
      continue;
    }

    seenUrls.add(mediaUrl);
    chrome.runtime.sendMessage({
      type: "PINIT_MEDIA_FOUND",
      mediaUrl
    });
  }
}

function checkForPageChange() {
  if (location.href === pageUrl) {
    return;
  }

  pageUrl = location.href;
  minEntryStartTime = performance.now();
  seenUrls.clear();
  targetMediaUrl = "";
  root.hidden = true;
  chrome.runtime.sendMessage({ type: "PINIT_PAGE_CHANGED" });
}

function setStatus(message) {
  statusText.textContent = message;
  clearTimeout(hideTimer);

  hideTimer = setTimeout(() => {
    if (targetMediaUrl) {
      statusText.textContent = "Video locked";
    }
  }, 3000);
}
