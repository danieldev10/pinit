import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ResolveError, USER_AGENT, UserInputError, requestHeaders, resolveMedia } from "./pinterest.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "..", "public");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const ticketTtlMs = 10 * 60 * 1000;
const downloadTickets = new Map();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && requestUrl.pathname === "/api/resolve") {
      await handleResolve(req, res);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/api/download/")) {
      await handleTicketDownload(req, res, requestUrl);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/download") {
      await handleUrlDownload(req, res, requestUrl);
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res, requestUrl);
      return;
    }

    sendText(res, 405, "Method not allowed");
  } catch (error) {
    sendPublicError(res, error);
  }
});

server.listen(port, host, () => {
  console.log(`Pinit is running on ${host}:${port}`);
});

setInterval(pruneExpiredTickets, 60_000).unref();

async function handleResolve(req, res) {
  const body = await readJson(req);
  const result = await resolveMedia(body.url);
  const token = createDownloadTicket(result);

  sendJson(res, 200, {
    ok: true,
    mediaType: result.mediaType,
    filename: result.filename,
    downloadUrl: `/api/download/${token}`
  });
}

async function handleTicketDownload(req, res, requestUrl) {
  const token = decodeURIComponent(requestUrl.pathname.replace("/api/download/", ""));
  const ticket = downloadTickets.get(token);

  if (!ticket || ticket.expiresAt < Date.now()) {
    downloadTickets.delete(token);
    throw new ResolveError("That download link expired. Paste the pin again.", 404);
  }

  await streamDownload(req, res, ticket.result);
}

async function handleUrlDownload(req, res, requestUrl) {
  const url = requestUrl.searchParams.get("url");
  const result = await resolveMedia(url);
  await streamDownload(req, res, result);
}

function createDownloadTicket(result) {
  pruneExpiredTickets();

  const token = randomUUID();
  downloadTickets.set(token, {
    result,
    expiresAt: Date.now() + ticketTtlMs
  });

  return token;
}

function pruneExpiredTickets() {
  const now = Date.now();
  for (const [token, ticket] of downloadTickets.entries()) {
    if (ticket.expiresAt < now) {
      downloadTickets.delete(token);
    }
  }
}

async function streamDownload(req, res, result) {
  if (result.mediaType === "mp4") {
    await streamMp4Proxy(req, res, result);
    return;
  }

  await streamHlsAsMp4(res, result);
}

async function streamMp4Proxy(req, res, result) {
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  const upstream = await fetch(result.mediaUrl, {
    headers: requestHeaders(result.pageUrl),
    signal: abortController.signal
  });

  if (!upstream.ok || !upstream.body) {
    throw new ResolveError(`The video file returned HTTP ${upstream.status}.`, 502);
  }

  const headers = downloadHeaders(result.filename);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers["content-length"] = contentLength;
  }

  res.writeHead(200, headers);
  Readable.fromWeb(upstream.body).pipe(res);
}

function streamHlsAsMp4(res, result) {
  return new Promise((resolvePromise, rejectPromise) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-headers",
        `User-Agent: ${USER_AGENT}\r\nReferer: ${result.pageUrl}\r\n`,
        "-i",
        result.mediaUrl,
        "-c",
        "copy",
        "-sn",
        "-dn",
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1"
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderr = "";
    let sentHeaders = false;
    let finished = false;

    const finishWithError = (message) => {
      if (finished) return;
      finished = true;

      if (!sentHeaders) {
        rejectPromise(new ResolveError(message, 502));
        return;
      }

      res.destroy(new Error(message));
      rejectPromise(new ResolveError(message, 502));
    };

    const ensureHeaders = () => {
      if (sentHeaders) return;
      sentHeaders = true;
      res.writeHead(200, downloadHeaders(result.filename));
    };

    ffmpeg.stdout.on("data", (chunk) => {
      ensureHeaders();
      if (!res.write(chunk)) {
        ffmpeg.stdout.pause();
      }
    });

    res.on("drain", () => ffmpeg.stdout.resume());
    res.on("close", () => {
      if (!finished) {
        ffmpeg.kill("SIGTERM");
      }
    });

    ffmpeg.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });

    ffmpeg.on("error", (error) => {
      finishWithError(error.code === "ENOENT" ? "ffmpeg is not installed or not in PATH." : error.message);
    });

    ffmpeg.on("close", (code) => {
      if (finished) return;
      finished = true;

      if (code === 0) {
        if (!sentHeaders) {
          rejectPromise(new ResolveError("ffmpeg finished without producing a video.", 502));
          return;
        }

        res.end();
        resolvePromise();
        return;
      }

      const message = stderr.trim() || `ffmpeg exited with code ${code}.`;
      if (!sentHeaders) {
        rejectPromise(new ResolveError(message, 502));
      } else {
        res.destroy(new Error(message));
        rejectPromise(new ResolveError(message, 502));
      }
    });
  });
}

function downloadHeaders(filename) {
  const safeName = filename.replace(/["\\]/g, "");

  return {
    "content-type": "video/mp4",
    "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(
      safeName
    )}`,
    "cache-control": "no-store"
  };
}

async function readJson(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) {
      throw new UserInputError("That request is too large.");
    }
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new UserInputError("The request body was not valid JSON.");
  }
}

async function serveStatic(req, res, requestUrl) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decodedPath = decodeURIComponent(pathname);
  const filePath = normalize(join(publicDir, decodedPath));

  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    sendText(res, 404, "Not found");
    return;
  }

  if (!fileStats.isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
    "content-length": fileStats.size,
    "cache-control": "no-store"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(message);
}

function sendPublicError(res, error) {
  const status = error.status || 500;
  const message =
    error instanceof UserInputError || error instanceof ResolveError
      ? error.message
      : "Something went wrong while preparing the download.";

  if (status >= 500 && !(error instanceof ResolveError)) {
    console.error(error);
  }

  if (res.headersSent) {
    res.destroy(error);
    return;
  }

  sendJson(res, status, {
    ok: false,
    error: message
  });
}
