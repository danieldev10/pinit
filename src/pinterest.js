export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MEDIA_EXTENSIONS = new Set(["m3u8", "mp4"]);

export class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserInputError";
    this.status = 400;
  }
}

export class ResolveError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = "ResolveError";
    this.status = status;
  }
}

export function normalizeInputUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new UserInputError("Paste a Pinterest pin URL first.");
  }

  let value = rawUrl.trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UserInputError("That does not look like a valid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UserInputError("Only http and https links are supported.");
  }

  url.hash = "";
  return url;
}

export function isPinterestHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "pin.it" ||
    host.endsWith(".pin.it") ||
    host === "pinterest.com" ||
    host.endsWith(".pinterest.com")
  );
}

export function isPinimgHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "pinimg.com" || host.endsWith(".pinimg.com");
}

export function isAllowedInputHost(hostname) {
  return isPinterestHost(hostname) || isPinimgHost(hostname);
}

export function getMediaExtension(url) {
  const pathname = url.pathname.toLowerCase();
  const match = pathname.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function assertAllowedInputUrl(url) {
  if (!isAllowedInputHost(url.hostname)) {
    throw new UserInputError("Use a Pinterest, pin.it, or pinimg.com video link.");
  }
}

export function assertAllowedMediaUrl(url) {
  const extension = getMediaExtension(url);

  if (!isPinimgHost(url.hostname) || !MEDIA_EXTENSIONS.has(extension)) {
    throw new ResolveError("The video source was not a supported Pinterest media URL.");
  }
}

export async function resolveMedia(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const inputUrl = normalizeInputUrl(rawUrl);
  assertAllowedInputUrl(inputUrl);

  if (isPinimgHost(inputUrl.hostname) && MEDIA_EXTENSIONS.has(getMediaExtension(inputUrl))) {
    return mediaResult(inputUrl, inputUrl, "direct");
  }

  if (!isPinterestHost(inputUrl.hostname)) {
    throw new UserInputError("Paste the Pinterest pin page, not a non-video asset.");
  }

  const { html, finalUrl } = await fetchPinterestPage(inputUrl, fetchImpl);
  const candidates = extractMediaCandidates(html, finalUrl);
  const candidate = chooseBestCandidate(candidates);

  if (!candidate) {
    throw new ResolveError(
      "I could not find a downloadable video on that pin. Public pin links work here; for saved or private pins, use the Pinit Chrome extension on the Pinterest page."
    );
  }

  return mediaResult(candidate.url, finalUrl, "pin");
}

async function fetchPinterestPage(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url.href, {
      redirect: "follow",
      headers: requestHeaders(url.href)
    });
  } catch {
    throw new ResolveError("Pinterest could not be reached from this server.", 502);
  }

  const finalUrl = normalizeInputUrl(response.url || url.href);
  assertAllowedInputUrl(finalUrl);

  if (!response.ok) {
    throw new ResolveError(`Pinterest returned HTTP ${response.status} for that link.`, 502);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new ResolveError("That Pinterest link did not return a page I can inspect.");
  }

  const html = await response.text();
  return { html, finalUrl };
}

export function extractMediaCandidates(source, baseUrl) {
  const base = baseUrl instanceof URL ? baseUrl : new URL(baseUrl);
  const seen = new Set();
  const candidates = [];
  const variants = buildTextVariants(source);
  const mediaUrlPattern = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;

  for (const variant of variants) {
    for (const match of variant.matchAll(mediaUrlPattern)) {
      const candidate = cleanCandidateUrl(match[0], base);
      if (!candidate || seen.has(candidate.href)) {
        continue;
      }

      seen.add(candidate.href);
      candidates.push({
        url: candidate,
        type: getMediaExtension(candidate) === "m3u8" ? "hls" : "mp4",
        score: scoreCandidate(candidate)
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

export function chooseBestCandidate(candidates) {
  return [...candidates].sort((a, b) => b.score - a.score)[0] ?? null;
}

function buildTextVariants(source) {
  const variants = new Set();
  const decoded = decodeJsonish(decodeHtmlEntities(String(source)));

  variants.add(String(source));
  variants.add(decoded);
  variants.add(decoded.replace(/\\+/g, ""));

  return variants;
}

function decodeJsonish(value) {
  return value
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u003[aA]/g, ":")
    .replace(/\\u003[fF]/g, "?")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003[dD]/g, "=")
    .replace(/\\\//g, "/");
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function cleanCandidateUrl(rawUrl, baseUrl) {
  const cleaned = decodeHtmlEntities(rawUrl).replace(/[),.;\]}]+$/g, "");

  let url;
  try {
    url = new URL(cleaned, baseUrl);
  } catch {
    return null;
  }

  try {
    assertAllowedMediaUrl(url);
  } catch {
    return null;
  }

  return url;
}

function scoreCandidate(url) {
  const href = url.href.toLowerCase();
  const extension = getMediaExtension(url);
  let score = extension === "m3u8" ? 100 : 40;

  if (href.includes("/hls/")) score += 25;
  if (href.includes("1080")) score += 15;
  if (href.includes("720")) score += 10;
  if (href.includes("expmp4")) score += 5;

  return score;
}

function mediaResult(mediaUrl, pageUrl, source) {
  assertAllowedMediaUrl(mediaUrl);

  return {
    source,
    pageUrl: pageUrl.href,
    mediaUrl: mediaUrl.href,
    mediaType: getMediaExtension(mediaUrl) === "m3u8" ? "hls" : "mp4",
    filename: filenameFor(pageUrl, mediaUrl)
  };
}

function filenameFor(pageUrl, mediaUrl) {
  const pinId = pageUrl.pathname.match(/\/pin\/([^/?]+)/i)?.[1];
  const mediaId =
    mediaUrl.pathname
      .split("/")
      .filter(Boolean)
      .findLast((part) => /^[a-f0-9]{12,}$/i.test(part.replace(/\.(m3u8|mp4)$/i, ""))) ||
    Date.now().toString();
  const id = sanitizeFilename(pinId || mediaId.replace(/\.(m3u8|mp4)$/i, ""));

  return `pinit-${id}.mp4`;
}

function sanitizeFilename(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";
}

export function requestHeaders(referer = "https://www.pinterest.com/") {
  return {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    referer
  };
}
