// SPDX-License-Identifier: AGPL-3.0-or-later
const maxBodyChars = 8_000_000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.source !== "netflix-subtitle-mvp-content") return false;
  if (message.type !== "fetch-timed-text-url") return false;

  fetchTimedText(message.url, message.meta || {})
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        url: String(message.url || ""),
        error: String(error && error.message ? error.message : error),
        meta: Object.assign({ kind: "timed-text-fetch" }, message.meta || {}),
        capturedAt: Date.now()
      });
    });

  return true;
});

async function fetchTimedText(url, meta) {
  if (!/^https:\/\/[^/]+\.nflxvideo\.net\//i.test(String(url || ""))) {
    throw new Error("Refusing non-Netflix timed text URL");
  }

  const responseMeta = Object.assign({ kind: "timed-text-fetch" }, meta || {});
  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store"
  });
  const contentType = response.headers.get("content-type") || "";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8").decode(bytes);

  return {
    url: String(url),
    contentType,
    status: response.status,
    body: text.slice(0, maxBodyChars),
    fullLength: text.length,
    byteLength: bytes.byteLength,
    truncated: text.length > maxBodyChars,
    meta: responseMeta,
    capturedAt: Date.now()
  };
}
