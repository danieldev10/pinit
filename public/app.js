const form = document.querySelector("#download-form");
const input = document.querySelector("#pin-url");
const button = form.querySelector("button");
const statusLine = document.querySelector("#status-line");
const statusText = document.querySelector("#status-text");
const serverPill = document.querySelector("#server-pill");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = input.value.trim();
  if (!url) {
    setStatus("error", "Paste a Pinterest pin URL first.");
    return;
  }

  setBusy(true);
  setStatus("working", "Finding the video source...");

  try {
    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ url })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not prepare the download.");
    }

    setStatus("success", `Starting ${payload.filename}...`);
    startDownload(payload.downloadUrl);
    setTimeout(() => setStatus("success", "Download started."), 1200);
  } catch (error) {
    setStatus("error", error.message);
  } finally {
    setBusy(false);
  }
});

function startDownload(downloadUrl) {
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function setBusy(isBusy) {
  button.disabled = isBusy;
  button.querySelector("span").textContent = isBusy ? "Preparing..." : "Download MP4";
  serverPill.dataset.mode = isBusy ? "working" : "ready";
  serverPill.textContent = isBusy ? "Working" : "Ready";
}

function setStatus(state, message) {
  statusLine.dataset.state = state;
  statusText.textContent = message;
}
