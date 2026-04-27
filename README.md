# Pinit

A small local website and Chrome extension that turn Pinterest videos into MP4 downloads.

## Run it

```bash
npm run dev
```

Open `http://localhost:3000`, paste a public Pinterest pin URL, and press **Download MP4**.

## Chrome extension

For saved or private Pinterest pages, install the unpacked extension from the `extension/` folder. The extension runs inside your logged-in Pinterest tab, detects the `pinimg.com` video URL, and sends it to the Pinit server. It does not ask for your Pinterest cookie.

## How it works

The server fetches public Pinterest pages or direct `pinimg.com` media URLs, extracts a `.m3u8` or `.mp4` media URL, and streams the video back to the browser as an MP4 file. HLS videos are remuxed through `ffmpeg`, so `ffmpeg` needs to be installed and available in your terminal.

Use it only for media you own or have permission to download.
