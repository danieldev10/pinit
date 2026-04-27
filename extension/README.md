# Pinit Chrome Extension

The extension detects Pinterest video media from your logged-in Pinterest tab and sends the discovered `pinimg.com` URL to the Pinit server.

## Install locally

1. Run the Pinit server:

   ```bash
   cd /Users/daniel/Desktop/pinit
   npm run dev
   ```

2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `/Users/daniel/Desktop/pinit/extension`.
6. Open a Pinterest video pin, let the video play, then use the floating **Download MP4** button or the extension popup.

Pinit locks onto the first video media it detects on the current pin page, so recommendation videos that load later should not replace your download target. Navigate to another pin to clear the lock and detect a new video.

The default Pinit server URL is `https://pinit-production.up.railway.app`. You can change it in the popup for local testing or another deployment.
