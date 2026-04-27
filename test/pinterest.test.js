import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBestCandidate,
  extractMediaCandidates,
  normalizeInputUrl,
  resolveMedia
} from "../src/pinterest.js";

test("normalizes URLs without protocols", () => {
  const url = normalizeInputUrl("www.pinterest.com/pin/855683997992821418/");
  assert.equal(url.href, "https://www.pinterest.com/pin/855683997992821418/");
});

test("extracts escaped Pinterest HLS URLs", () => {
  const html =
    '{"video":{"url":"https:\\/\\/v1.pinimg.com\\/videos\\/iht\\/hls\\/07\\/a5\\/66\\/07a5667324417aa7c0b0f668367f4237.m3u8"}}';
  const candidates = extractMediaCandidates(html, "https://www.pinterest.com/pin/855683997992821418/");

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].url.href,
    "https://v1.pinimg.com/videos/iht/hls/07/a5/66/07a5667324417aa7c0b0f668367f4237.m3u8"
  );
  assert.equal(candidates[0].type, "hls");
});

test("prefers HLS over progressive MP4 candidates", () => {
  const html = [
    "https://v1.pinimg.com/videos/mc/720p/example.mp4",
    "https://v1.pinimg.com/videos/iht/hls/example.m3u8"
  ].join(" ");
  const candidate = chooseBestCandidate(
    extractMediaCandidates(html, "https://www.pinterest.com/pin/855683997992821418/")
  );

  assert.equal(candidate.type, "hls");
});

test("accepts a direct pinimg m3u8 URL", async () => {
  const result = await resolveMedia(
    "https://v1.pinimg.com/videos/iht/hls/07/a5/66/07a5667324417aa7c0b0f668367f4237.m3u8"
  );

  assert.equal(result.mediaType, "hls");
  assert.equal(
    result.mediaUrl,
    "https://v1.pinimg.com/videos/iht/hls/07/a5/66/07a5667324417aa7c0b0f668367f4237.m3u8"
  );
});

test("shows the extension hint when a page has no media candidate", async () => {
  const fetchImpl = async () =>
    new Response("<html><body>No video here</body></html>", {
      status: 200,
      headers: {
        "content-type": "text/html"
      }
    });

  await assert.rejects(
    resolveMedia("https://pin.it/621fulpNF", { fetchImpl }),
    (error) => {
      assert.match(error.message, /Chrome extension/);
      return true;
    }
  );
});
