// SPDX-License-Identifier: AGPL-3.0-or-later
(function (root) {
  function parseTimeToSeconds(value, options) {
    if (!value) return null;
    const raw = String(value).trim().replace(",", ".");
    const tickRate = options && options.tickRate ? options.tickRate : 1;
    const frameRate = options && options.frameRate ? options.frameRate : 30;

    const clock = raw.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
    if (clock) {
      const hours = Number(clock[1] || 0);
      const minutes = Number(clock[2] || 0);
      const seconds = Number(clock[3] || 0);
      const fraction = clock[4] ? Number(`0.${clock[4]}`) : 0;
      return hours * 3600 + minutes * 60 + seconds + fraction;
    }

    const unit = raw.match(/^([\d.]+)(h|m|ms|s|t|f)$/i);
    if (unit) {
      const amount = Number(unit[1]);
      const type = unit[2].toLowerCase();
      if (type === "h") return amount * 3600;
      if (type === "m") return amount * 60;
      if (type === "ms") return amount / 1000;
      if (type === "t") return amount / tickRate;
      if (type === "f") return amount / frameRate;
      return amount;
    }

    return null;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/<(?:(?:[\w-]+):)?br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function parseVtt(input, lang) {
    const blocks = String(input || "")
      .replace(/^\uFEFF/, "")
      .split(/\n\s*\n/g);

    const segments = [];
    for (const block of blocks) {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timeLineIndex === -1) continue;

      const match = lines[timeLineIndex].match(/([^\s]+)\s+-->\s+([^\s]+)/);
      if (!match) continue;

      const start = parseTimeToSeconds(match[1]);
      const end = parseTimeToSeconds(match[2]);
      const text = cleanText(lines.slice(timeLineIndex + 1).join("\n"));
      if (start == null || end == null || !text) continue;
      segments.push({ start, end, text, lang, source: "captured" });
    }
    return segments;
  }

  function parseTtml(input, lang) {
    const xml = String(input || "");
    const segments = [];
    const rootAttrs = (xml.match(/<tt\b([^>]*)>/i) || [])[1] || "";
    const documentLang = (rootAttrs.match(/\b(?:xml:)?lang="([^"]+)"/i) || [])[1] || lang;
    const tickRate = Number((rootAttrs.match(/\btickRate="([^"]+)"/i) || [])[1]) || 1;
    const frameRate = Number((rootAttrs.match(/\bframeRate="([^"]+)"/i) || [])[1]) || 30;
    const timing = { tickRate, frameRate };
    const pTag = /<(?:(?:[\w-]+):)?p\b([^>]*)>([\s\S]*?)<\/(?:(?:[\w-]+):)?p>/gi;
    let match;

    while ((match = pTag.exec(xml))) {
      const attrs = match[1];
      const begin = (attrs.match(/\bbegin="([^"]+)"/i) || [])[1];
      const endAttr = (attrs.match(/\bend="([^"]+)"/i) || [])[1];
      const dur = (attrs.match(/\bdur="([^"]+)"/i) || [])[1];
      const start = parseTimeToSeconds(begin, timing);
      let end = parseTimeToSeconds(endAttr, timing);
      if (end == null && start != null && dur) {
        const duration = parseTimeToSeconds(dur, timing);
        end = duration == null ? null : start + duration;
      }

      const text = cleanText(match[2]);
      if (start == null || end == null || !text) continue;
      segments.push({ start, end, text, lang: documentLang, source: "captured" });
    }

    return segments;
  }

  function detectLangFromUrl(url) {
    const text = String(url || "");
    const match =
      text.match(/[?&](?:lang|language|locale)=([^&]+)/i) ||
      text.match(/[?&]tlang=([^&]+)/i) ||
      text.match(/\/([a-z]{2}(?:-[A-Z]{2})?)\//);
    return match ? decodeURIComponent(match[1]) : "unknown";
  }

  function parseSubtitle(input, meta) {
    const body = String(input || "");
    const lang = meta && meta.lang ? meta.lang : detectLangFromUrl(meta && meta.url);
    if (/WEBVTT/i.test(body) || /\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->/i.test(body)) {
      return parseVtt(body, lang);
    }
    if (/<tt\b|<timedtext\b|<p\b/i.test(body)) {
      return parseTtml(body, lang);
    }
    return [];
  }

  root.NetflixSubtitleMvpParser = {
    parseSubtitle,
    parseTimeToSeconds,
    parseVtt,
    parseTtml
  };

  if (typeof module !== "undefined") {
    module.exports = root.NetflixSubtitleMvpParser;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
