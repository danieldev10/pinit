const DEFAULT_SERVER_URL = "https://pinit-xndf.onrender.com";

const mediaStatus = document.querySelector("#media-status");
const downloadButton = document.querySelector("#download-button");
const settingsForm = document.querySelector("#settings-form");
const serverUrlInput = document.querySelector("#server-url");
const serverStatus = document.querySelector("#server-status");

let activeTabId = null;
let targetMediaUrl = "";

init();

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = activeTab?.id ?? null;

  const settings = await chrome.runtime.sendMessage({ type: "PINIT_GET_SETTINGS" });
  serverUrlInput.value = settings?.serverUrl || DEFAULT_SERVER_URL;

  await refreshState();
  await checkServer();
}

downloadButton.addEventListener("click", async () => {
  downloadButton.disabled = true;
  downloadButton.textContent = "Starting...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "PINIT_DOWNLOAD_LATEST",
      tabId: activeTabId,
      mediaUrl: targetMediaUrl
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not start the download.");
    }

    mediaStatus.textContent = "Download started.";
  } catch (error) {
    mediaStatus.textContent = error.message;
  } finally {
    downloadButton.innerHTML = '<span aria-hidden="true">↓</span> Download MP4';
    downloadButton.disabled = !targetMediaUrl;
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const response = await chrome.runtime.sendMessage({
    type: "PINIT_SAVE_SETTINGS",
    serverUrl: serverUrlInput.value
  });

  serverUrlInput.value = response?.serverUrl || DEFAULT_SERVER_URL;
  await checkServer();
});

async function refreshState() {
  if (!activeTabId) {
    mediaStatus.textContent = "Open a Pinterest video pin first.";
    downloadButton.disabled = true;
    return;
  }

  const state = await chrome.runtime.sendMessage({
    type: "PINIT_GET_STATE",
    tabId: activeTabId
  });

  const target = state?.target || state?.latest;

  targetMediaUrl = target?.url || "";
  downloadButton.disabled = !targetMediaUrl;
  mediaStatus.textContent = targetMediaUrl
    ? `${target.type === "hls" ? "HLS" : "MP4"} video locked for this tab.`
    : "Play a Pinterest video, then download it here.";
}

async function checkServer() {
  const serverUrl = serverUrlInput.value.replace(/\/+$/, "");

  try {
    const response = await fetch(`${serverUrl}/api/health`);
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error("Pinit did not answer correctly.");
    }

    serverStatus.dataset.state = "ok";
    serverStatus.textContent = "Pinit server is ready.";
  } catch {
    serverStatus.dataset.state = "error";
    serverStatus.textContent = "Start Pinit with npm run dev before downloading.";
  }
}
