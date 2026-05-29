// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  if (window.__NETFLIX_SUBTITLE_MVP_CONTENT__) return;
  window.__NETFLIX_SUBTITLE_MVP_CONTENT__ = true;

  const state = {
    enabled: true,
    segments: [],
    activeUrl: null,
    activeLang: "unknown",
    activeText: "",
    lastCapture: null,
    candidates: [],
    candidateBodies: [],
    subtitleTrackHints: [],
    manifestDebug: [],
    parsedJsonHints: [],
    textTracks: [],
    timedTextUrls: [],
    timedTextFetches: [],
    targetLang: "",
    targetLangMode: "auto",
    videoKey: "",
    debugStatus: "waiting",
    lastRendered: {
      status: "",
      text: "",
      mode: ""
    },
    activeTrackKey: "",
    activeTrackScore: -1
  };
  const fetchedTimedTextUrls = new Set();
  const subtitleCache = new Map();

  function injectPageHook() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/page-hook.js");
    script.onload = () => script.remove();
    (document.documentElement || document.head).appendChild(script);
  }

  function ensureOverlay() {
    let overlay = document.getElementById("netflix-subtitle-mvp-overlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "netflix-subtitle-mvp-overlay";
    overlay.innerHTML = [
      '<div class="nsm-text"></div>'
    ].join("");
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function getVideo() {
    return document.querySelector("video");
  }

  function getCurrentVideoKey() {
    const watchMatch = window.location.pathname.match(/\/watch\/(\d+)/i);
    if (watchMatch) return `watch:${watchMatch[1]}`;

    const video = getVideo();
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      return `duration:${Math.round(video.duration)}`;
    }

    return window.location.pathname || "unknown";
  }

  function clearVideoScopedState(nextVideoKey) {
    state.videoKey = nextVideoKey;
    state.segments = [];
    state.activeUrl = null;
    state.activeLang = "unknown";
    state.activeText = "";
    state.lastCapture = null;
    state.candidates = [];
    state.candidateBodies = [];
    state.subtitleTrackHints = [];
    state.manifestDebug = [];
    state.parsedJsonHints = [];
    state.textTracks = [];
    state.timedTextUrls = [];
    state.timedTextFetches = [];
    state.debugStatus = "video changed: cache cleared";
    state.activeTrackKey = "";
    state.activeTrackScore = -1;
    state.lastRendered = {
      status: "",
      text: "",
      mode: ""
    };
    fetchedTimedTextUrls.clear();
    subtitleCache.clear();
  }

  function syncVideoKey() {
    const nextVideoKey = getCurrentVideoKey();
    if (!nextVideoKey) return;
    if (!state.videoKey) {
      state.videoKey = nextVideoKey;
      return;
    }
    if (state.videoKey !== nextVideoKey) {
      clearVideoScopedState(nextVideoKey);
    }
  }

  function findActiveSegment(time) {
    let active = null;
    for (const segment of state.segments) {
      if (time < segment.start || time > segment.end) continue;
      if (!active || segment.start > active.start || (segment.start === active.start && segment.end < active.end)) {
        active = segment;
      }
    }
    return active;
  }

  function findNearestSegment(time) {
    let previous = null;
    let next = null;
    for (const segment of state.segments) {
      if (segment.end < time && (!previous || segment.end > previous.end)) previous = segment;
      if (segment.start > time && (!next || segment.start < next.start)) next = segment;
    }
    return { previous, next };
  }

  function readRenderedNetflixSubtitle() {
    const candidates = [
      '[data-uia="player-timedtext"]',
      '[data-uia*="timedtext"]',
      '[data-uia*="subtitle"]',
      '.player-timedtext',
      '[class*="player-timedtext"]',
      '[class*="timedtext"]'
    ];

    for (const selector of candidates) {
      const nodes = Array.from(document.querySelectorAll(selector))
        .filter((node) => !node.closest("#netflix-subtitle-mvp-overlay"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        });

      const values = nodes
        .map((node) => node.innerText || node.textContent || "")
        .map((value) => value.trim())
        .filter(Boolean);

      const uniqueValues = [];
      for (const value of values) {
        if (uniqueValues.includes(value)) continue;
        if (uniqueValues.some((existing) => existing.includes(value))) continue;
        uniqueValues.push(value);
      }

      const text = uniqueValues.join("\n").trim();

      if (text) return text;
    }

    return "";
  }

  function readSubtitleMenuLabels() {
    const selectors = [
      '[role="menuitemradio"]',
      '[role="menuitem"]',
      '[data-uia*="subtitle"]',
      '[data-uia*="audio"]',
      '[data-uia*="track"]'
    ];
    const labels = [];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (node.closest("#netflix-subtitle-mvp-overlay")) continue;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;

        const text = (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ");
        if (!text || text.length > 120) continue;
        if (!labels.includes(text)) labels.push(text);
      }
    }

    return labels.slice(0, 40);
  }

  function render() {
    const overlay = ensureOverlay();
    syncVideoKey();
    const video = getVideo();
    const text = overlay.querySelector(".nsm-text");

    if (!state.enabled) {
      overlay.hidden = true;
      return;
    }

    overlay.hidden = false;

    if (!video) {
      text.textContent = "";
      return;
    }

    const active = findActiveSegment(video.currentTime);
    const shouldUseRenderedFallback = !state.targetLang && !active;
    const renderedSubtitle = shouldUseRenderedFallback ? readRenderedNetflixSubtitle() : "";
    const mode = active ? "captured" : renderedSubtitle ? "rendered" : "waiting";
    const nextText = active ? active.text : renderedSubtitle;

    overlay.dataset.mode = mode;

    if (state.lastRendered.text !== nextText) {
      text.textContent = nextText;
      state.lastRendered.text = nextText;
    }

    state.lastRendered.mode = mode;
  }

  function mergeSegments(nextSegments, url) {
    const nextLang = nextSegments[0] && nextSegments[0].lang ? nextSegments[0].lang : state.activeLang;
    if (state.activeLang !== nextLang) {
      state.segments = [];
    }
    state.activeUrl = url;

    const byKey = new Map();
    for (const segment of state.segments.concat(nextSegments)) {
      const key = `${segment.lang}:${segment.start}:${segment.end}:${segment.text}`;
      byKey.set(key, segment);
    }
    state.segments = Array.from(byKey.values()).sort((a, b) => a.start - b.start);
  }

  function replaceSegments(nextSegments, url) {
    const nextLang = nextSegments[0] && nextSegments[0].lang ? nextSegments[0].lang : state.activeLang;
    state.activeLang = nextLang || "unknown";
    state.activeUrl = url;
    state.segments = nextSegments.slice().sort((a, b) => a.start - b.start);
  }

  function extractSubtitleTrackHints(body, url) {
    if (!/licensedmanifest|timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(String(url || ""))) {
      return [];
    }

    const text = String(body || "");
    const hints = [];

    function pushHint(type, value, path) {
      const normalized = String(value || "").slice(0, 500);
      if (!normalized) return;
      const key = `${type}:${path || ""}:${normalized}`;
      if (hints.some((item) => `${item.type}:${item.path || ""}:${item.value}` === key)) return;
      hints.push({
        type,
        sourceUrl: url,
        path: path || "",
        value: normalized
      });
    }

    const urlMatches = text.match(/https?:\\?\/\\?\/[^"'\\\s]+?(?:timedtext|dfxp|ttml|webvtt|vtt|subtitle|caption)[^"'\\\s]*/gi) || [];
    for (const raw of urlMatches.slice(0, 20)) {
      pushHint("url", raw.replace(/\\\//g, "/"), "");
    }

    const languageMatches = text.match(/"language"\s*:\s*"[^"]+"|"languageDescription"\s*:\s*"[^"]+"|"displayName"\s*:\s*"[^"]+"|"lang"\s*:\s*"[^"]+"/gi) || [];
    for (const raw of languageMatches.slice(0, 40)) {
      pushHint("language", raw, "");
    }

    try {
      const json = parseJsonLoose(text);
      const interestingKey = /timed|text|subtitle|caption|download|language|locale|profile|isforced|forced|narrative/i;
      const visited = new WeakSet();

      function walk(value, path, depth) {
        if (hints.length >= 120 || depth > 12) return;
        if (value == null) return;

        if (typeof value === "string") {
          if (/timedtext|dfxp|ttml|webvtt|vtt|subtitle|caption/i.test(value)) {
            pushHint("value", value, path);
          }
          return;
        }

        if (typeof value !== "object") return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
          const pathLower = path.toLowerCase();
          if (/timed|text|subtitle|caption|download/.test(pathLower)) {
            pushHint("array", `length=${value.length}`, path);
          }
          value.slice(0, 30).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
          return;
        }

        for (const [key, child] of Object.entries(value)) {
          const childPath = path ? `${path}.${key}` : key;
          if (interestingKey.test(key)) {
            if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
              pushHint("field", `${key}=${child}`, childPath);
            } else if (Array.isArray(child)) {
              pushHint("array", `${key}.length=${child.length}`, childPath);
            } else if (child && typeof child === "object") {
              pushHint("object", `${key} keys=${Object.keys(child).slice(0, 12).join(",")}`, childPath);
            }
          }
          walk(child, childPath, depth + 1);
        }
      }

      walk(json, "$", 0);
    } catch (_error) {
      // Not JSON, string heuristics above are enough for this pass.
    }

    return hints;
  }

  function parseJsonLoose(text) {
    const raw = String(text || "").trim();
    const candidates = [
      raw,
      raw.replace(/^\)\]\}',?\s*/, ""),
      raw.replace(/^while\s*\(\s*1\s*\)\s*;?\s*/i, "")
    ];

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        // Try the next wrapper shape.
      }
    }

    const objectStart = raw.indexOf("{");
    const arrayStart = raw.indexOf("[");
    const start =
      objectStart === -1 ? arrayStart :
      arrayStart === -1 ? objectStart :
      Math.min(objectStart, arrayStart);

    if (start >= 0) return JSON.parse(raw.slice(start));
    return JSON.parse(raw);
  }

  function parseConcatenatedJsonValues(text, limit) {
    const raw = String(text || "").trim();
    const values = [];
    let index = 0;

    while (index < raw.length && values.length < limit) {
      while (/\s/.test(raw[index] || "")) index++;
      if (index >= raw.length) break;

      const startChar = raw[index];
      if (startChar !== "{" && startChar !== "[") break;

      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;

      for (let i = index; i < raw.length; i++) {
        const char = raw[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === "\"") {
            inString = false;
          }
          continue;
        }

        if (char === "\"") inString = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }

      if (end === -1) break;
      const chunk = raw.slice(index, end);
      try {
        values.push(JSON.parse(chunk));
      } catch (_error) {
        values.push({ __parseError: true, sample: chunk.slice(0, 300) });
      }
      index = end;
    }

    return values;
  }

  function inspectManifestJson(body, url) {
    if (!/licensedmanifest/i.test(String(url || ""))) return [];

    const rows = [];
    const text = String(body || "");

    function push(value) {
      if (rows.length < 80) rows.push(String(value).slice(0, 700));
    }

    try {
      let roots;
      try {
        roots = [parseJsonLoose(text)];
      } catch (_error) {
        roots = parseConcatenatedJsonValues(text, 20);
      }

      push(`parse=ok roots=${roots.length}`);

      const keyCounts = new Map();
      const interestingPaths = [];
      const visited = new WeakSet();
      const interesting = /timed|text|subtitle|caption|track|download|language|locale|profile|url|href|cdn/i;

      function walk(value, path, depth) {
        if (depth > 14 || value == null) return;

        if (typeof value === "string") {
          if (interesting.test(path) || /timed|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(value)) {
            interestingPaths.push(`${path}=${value.slice(0, 160)}`);
          }
          return;
        }

        if (typeof value !== "object") return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
          if (interesting.test(path)) {
            interestingPaths.push(`${path}=array(${value.length})`);
          }
          value.slice(0, 25).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
          return;
        }

        for (const [key, child] of Object.entries(value)) {
          keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
          const childPath = path ? `${path}.${key}` : key;
          if (interesting.test(key)) {
            if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
              interestingPaths.push(`${childPath}=${String(child).slice(0, 160)}`);
            } else if (Array.isArray(child)) {
              interestingPaths.push(`${childPath}=array(${child.length})`);
            } else if (child && typeof child === "object") {
              interestingPaths.push(`${childPath}=object(${Object.keys(child).slice(0, 12).join(",")})`);
            }
          }
          walk(child, childPath, depth + 1);
        }
      }

      roots.forEach((root, rootIndex) => {
        const topKeys = root && typeof root === "object" ? Object.keys(root).slice(0, 40) : [];
        push(`root[${rootIndex}] topKeys=${topKeys.join(",")}`);
        walk(root, `$[${rootIndex}]`, 0);
      });

      const keySummary = Array.from(keyCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");
      push(`keyCounts=${keySummary}`);

      for (const item of interestingPaths.slice(0, 60)) {
        push(item);
      }
    } catch (error) {
      push(`parse=error ${String(error && error.message ? error.message : error)}`);
      push(`sample=${text.slice(0, 700)}`);
    }

    return rows;
  }

  function inferLangFromTimedTextPath(path) {
    const track = state.textTracks.find((item) => {
      if (!item.path) return false;
      const prefix = item.path.replace(/\.(texttrackinfo|ttTrackFields|track|oldtrack)$/, "");
      return prefix && path && path.startsWith(prefix);
    });
    return track && track.bcp47 ? track.bcp47 : "unknown";
  }

  function getAvailableLanguages() {
    const langs = [];
    for (const item of state.textTracks.concat(state.timedTextUrls)) {
      const lang = item.bcp47 || item.lang || "";
      if (lang && !langs.includes(lang)) langs.push(lang);
    }
    return langs.sort();
  }

  function getItemLang(item) {
    if (!item) return "";
    if (item.bcp47 || item.lang) return item.bcp47 || item.lang;
    const matchedTrack = state.textTracks.find((track) => {
      if (!track.downloadableId || !item.downloadableId) return false;
      return String(track.downloadableId) === String(item.downloadableId);
    });
    return matchedTrack ? matchedTrack.bcp47 || "" : "";
  }

  function sameLanguage(left, right) {
    if (!left || !right) return false;
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    return a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
  }

  function normalizeLang(value) {
    return String(value || "").toLowerCase();
  }

  function getCurrentTrackLang(textTracks) {
    const tracks = Array.isArray(textTracks) ? textTracks : [];
    const current = tracks.find((track) => {
      if (!track.bcp47) return false;
      if (/oldtrack/i.test(track.path || "")) return false;
      return /\.track$|\.texttrackinfo$|\.ttTrackFields$/i.test(track.path || "");
    });
    return current ? current.bcp47 : "";
  }

  function scoreTimedTextUrl(item) {
    const text = `${item.profile || ""} ${item.path || ""} ${item.rawTrackType || ""} ${item.trackType || ""} ${item.type || ""} ${item.displayName || ""}`;
    let score = 0;
    if (item.manifestTrack) score -= 100;
    if (/forced|narrative/i.test(text)) score += 100;
    if (/closed.?caption|cc\b/i.test(text)) score += 50;
    if (/subtitle/i.test(text)) score -= 20;
    if (/imsc1\.1/i.test(text)) score += 0;
    else if (/dfxp/i.test(text)) score += 10;
    else if (/simplesdh/i.test(text)) score += 20;
    else score += 30;
    return score;
  }

  function isForcedTimedTextUrl(item) {
    if (item.isForcedNarrative === true || item.isForced === true) return true;
    const text = `${item.rawTrackType || ""} ${item.trackType || ""} ${item.type || ""} ${item.displayName || ""}`;
    return /forced|narrative/i.test(text);
  }

  function getTimedTextTrackKey(item) {
    if (item.trackIndex !== undefined && item.trackIndex !== "") return `idx:${item.trackIndex}`;
    if (item.downloadableId) return `dlid:${item.downloadableId}`;
    const path = String(item.path || "").replace(/\.ttDownloadables\..*$/i, "");
    return `path:${path || item.url || ""}`;
  }

  function getSubtitleCacheKey(lang, item) {
    return `${state.videoKey || getCurrentVideoKey()}:${normalizeLang(lang)}:${getTimedTextTrackKey(item)}`;
  }

  function restoreCachedSubtitle(lang) {
    if (!lang) return false;
    syncVideoKey();
    let best = null;
    for (const entry of subtitleCache.values()) {
      if (entry.videoKey !== state.videoKey) continue;
      if (!sameLanguage(entry.lang, lang)) continue;
      if (!best || entry.score > best.score || (entry.score === best.score && entry.cachedAt > best.cachedAt)) {
        best = entry;
      }
    }
    if (!best) return false;
    replaceSegments(best.segments, best.url);
    state.activeLang = best.lang;
    state.activeTrackKey = best.trackKey;
    state.activeTrackScore = best.score;
    state.lastCapture = best.cachedAt;
    state.debugStatus = `cache: restored ${best.lang} ${best.trackKey}`;
    return true;
  }

  function rememberSubtitleCache(lang, item, segments, url, score) {
    if (!lang || !segments.length) return;
    syncVideoKey();
    const trackKey = getTimedTextTrackKey(item);
    subtitleCache.set(getSubtitleCacheKey(lang, item), {
      videoKey: state.videoKey,
      lang,
      trackKey,
      segments: segments.slice(),
      url,
      score,
      cachedAt: Date.now()
    });
  }

  function chooseOneUrlPerTrack(items) {
    const byTrack = new Map();
    for (const item of items) {
      const key = getTimedTextTrackKey(item);
      const list = byTrack.get(key) || [];
      list.push(item);
      byTrack.set(key, list);
    }

    return Array.from(byTrack.values())
      .map((group) => group.sort((a, b) => scoreTimedTextUrl(a) - scoreTimedTextUrl(b))[0])
      .sort((a, b) => scoreTimedTextUrl(a) - scoreTimedTextUrl(b));
  }

  function getBestTimedTextUrls(lang, limit) {
    return getTimedTextUrls(lang, limit, false);
  }

  function getTimedTextUrls(lang, limit, allowUnboundFallback) {
    const usableUrls = state.timedTextUrls
      .filter((item) => /^https?:\/\//i.test(item.url || ""))
      .filter((item) => /ttDownloadables|timedtexttracks|downloadable|subtitle|caption|dfxp|ttml|webvtt|vtt|imsc/i.test(item.path || ""))
      .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
      .sort((a, b) => scoreTimedTextUrl(a) - scoreTimedTextUrl(b));
    const matching = usableUrls.filter((item) => !lang || sameLanguage(getItemLang(item), lang));
    const manifestMatching = matching.filter((item) => item.manifestTrack);
    const sourceMatching = manifestMatching.length ? manifestMatching : matching;
    const nonForcedMatching = sourceMatching.filter((item) => !isForcedTimedTextUrl(item));
    const selected = nonForcedMatching.length || !allowUnboundFallback ? nonForcedMatching : usableUrls.filter((item) => !isForcedTimedTextUrl(item));
    return chooseOneUrlPerTrack(selected).slice(0, limit).map((item) => {
      if (!nonForcedMatching.length && lang && allowUnboundFallback) {
        return Object.assign({}, item, { bcp47: lang, fallbackLang: true });
      }
      return item;
    });
  }

  function fetchTimedTextItem(item, reason) {
    if (!item || !item.url) return;
    const lang = item.fallbackLang ? item.bcp47 : getItemLang(item);
    const meta = {
      kind: "timed-text-fetch",
      reason: reason || "",
      path: item.path || "",
      bcp47: lang,
      trackId: item.trackId || "",
      downloadableId: item.downloadableId || "",
      profile: item.profile || "",
      trackIndex: item.trackIndex || "",
      manifestTrack: Boolean(item.manifestTrack),
      isForcedNarrative: item.isForcedNarrative ?? "",
      rawTrackType: item.rawTrackType || "",
      trackType: item.trackType || ""
    };

    chrome.runtime.sendMessage(
      {
        source: "netflix-subtitle-mvp-content",
        type: "fetch-timed-text-url",
        url: item.url,
        meta
      },
      (response) => {
        if (chrome.runtime.lastError) {
          handleTimedTextResponse({
            url: item.url,
            error: chrome.runtime.lastError.message,
            meta
          });
          return;
        }
        handleTimedTextResponse(response || {
          url: item.url,
          error: "empty extension response",
          meta
        });
      }
    );
  }

  function beginTargetTrackProbe(lang) {
    state.segments = [];
    state.activeLang = lang || "unknown";
    state.activeTrackKey = "";
    state.activeTrackScore = -1;
  }

  function autoFetchTimedText(lang) {
    if (!lang) {
      state.debugStatus = "auto: no target language";
      return;
    }
    if (restoreCachedSubtitle(lang)) return;
    const items = getTimedTextUrls(lang, 12, false).filter((candidate) => !fetchedTimedTextUrls.has(candidate.url));
    if (!items.length) {
      const matchingCount = getBestTimedTextUrls(lang, 10).length;
      const forcedCount = state.timedTextUrls.filter((item) => sameLanguage(getItemLang(item), lang) && isForcedTimedTextUrl(item)).length;
      state.debugStatus = `auto: no full URL for ${lang}; matching=${matchingCount}; forced=${forcedCount}; total=${state.timedTextUrls.length}`;
      return;
    }
    state.debugStatus = `auto: fetching ${lang} x${items.length}${items.some((item) => item.fallbackLang) ? " fallback" : ""}`;
    for (const item of items) {
      fetchedTimedTextUrls.add(item.url);
      fetchTimedTextItem(item, "auto-track");
    }
  }

  function fetchBestTimedTextForLang(lang, reason) {
    if (!lang) {
      state.debugStatus = "manual: no target language";
      return false;
    }
    if (restoreCachedSubtitle(lang)) return true;
    const items = getTimedTextUrls(lang, 16, false);
    if (!items.length) {
      const forcedCount = state.timedTextUrls.filter((item) => sameLanguage(getItemLang(item), lang) && isForcedTimedTextUrl(item)).length;
      state.debugStatus = `manual: no full URL for ${lang}; forced=${forcedCount}; total=${state.timedTextUrls.length}`;
      return false;
    }
    state.debugStatus = `manual: fetching ${lang} x${items.length}${items.some((item) => item.fallbackLang) ? " fallback" : ""}`;
    beginTargetTrackProbe(lang);
    for (const item of items) {
      fetchedTimedTextUrls.add(item.url);
      fetchTimedTextItem(item, reason || "manual-lang");
    }
    return true;
  }

  function handleTimedTextResponse(payload) {
    const responseMeta = payload.meta || {};
    const isExplicitTimedTextFetch = responseMeta.kind === "timed-text-fetch";
    const looksLikeTimedTextUrl = /ttDownloadables|timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt|imsc|nflxvideo\.net/i.test(
      `${payload.url || ""} ${responseMeta.path || ""}`
    );
    if (!isExplicitTimedTextFetch && !looksLikeTimedTextUrl) return;

    if (!payload.body) {
      state.timedTextFetches.unshift({
        url: payload.url || "",
        error: payload.error || "empty body",
        status: payload.status || null,
        contentType: payload.contentType || "",
        byteLength: payload.byteLength || 0,
        fullLength: payload.fullLength || 0,
        meta: responseMeta,
        sample: ""
      });
      state.timedTextFetches = state.timedTextFetches.slice(0, 20);
      console.debug("[Subtitle MVP] captured timed text metadata", payload);
      return;
    }

    const parser = window.NetflixSubtitleMvpParser;
    const meta = responseMeta;
    const segments = parser.parseSubtitle(payload.body, {
      url: payload.url,
      lang: meta.bcp47 || meta.lang || inferLangFromTimedTextPath(meta.path || "")
    });
    state.lastCapture = Date.now();

    if (segments.length) {
      const parsedLang = segments[0].lang || "unknown";
      const targetLang = state.targetLang || "";
      if (targetLang && parsedLang !== "unknown" && !sameLanguage(parsedLang, targetLang)) {
        state.timedTextFetches.unshift({
          url: payload.url || "",
          status: payload.status || null,
          contentType: payload.contentType || "",
          byteLength: payload.byteLength || 0,
          fullLength: payload.fullLength || payload.body.length,
          parsedSegments: segments.length,
          meta: Object.assign({}, meta, { rejectedLang: parsedLang }),
          sample: payload.body.slice(0, 200)
        });
        state.timedTextFetches = state.timedTextFetches.slice(0, 20);
        state.debugStatus = `ignored ${parsedLang} while target is ${targetLang}`;
        return;
      }
      const video = getVideo();
      const time = video ? video.currentTime : 0;
      const hasCurrentSegment = segments.some((segment) => time >= segment.start && time <= segment.end);
      const score = (hasCurrentSegment ? 1_000_000 : 0) + segments.length;
      const shouldReplaceTargetTrack = Boolean(targetLang);
      if (shouldReplaceTargetTrack) {
        if (score >= state.activeTrackScore) {
          state.activeTrackKey = getTimedTextTrackKey(meta);
          state.activeTrackScore = score;
          replaceSegments(segments, payload.url || "inline");
          rememberSubtitleCache(parsedLang, meta, segments, payload.url || "inline", score);
        }
      } else {
        state.activeLang = parsedLang;
        mergeSegments(segments, payload.url || "inline");
        rememberSubtitleCache(parsedLang, meta, segments, payload.url || "inline", score);
      }
      state.timedTextFetches.unshift({
        url: payload.url || "",
        status: payload.status || null,
        contentType: payload.contentType || "",
        byteLength: payload.byteLength || 0,
        fullLength: payload.fullLength || payload.body.length,
        parsedSegments: segments.length,
        meta,
        sample: payload.body.slice(0, 200)
      });
      state.timedTextFetches = state.timedTextFetches.slice(0, 20);
      console.info("[Subtitle MVP] parsed timed text", {
        url: payload.url,
        meta,
        count: segments.length,
        first: segments[0]
      });
    } else {
      state.timedTextFetches.unshift({
        url: payload.url || "",
        status: payload.status || null,
        contentType: payload.contentType || "",
        byteLength: payload.byteLength || 0,
        fullLength: payload.fullLength || payload.body.length,
        parsedSegments: 0,
        meta,
        sample: payload.body.slice(0, 300)
      });
      state.timedTextFetches = state.timedTextFetches.slice(0, 20);
      console.info("[Subtitle MVP] captured but could not parse timed text", {
        url: payload.url,
        contentType: payload.contentType,
        status: payload.status,
        byteLength: payload.byteLength,
        fullLength: payload.fullLength,
        meta,
        sample: payload.body.slice(0, 200)
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "netflix-subtitle-mvp") return;
    syncVideoKey();

    const payload = event.data.payload || {};
    if (event.data.type === "candidate-resource") {
      if (!payload.url) return;
      const existing = state.candidates.find((item) => item.url === payload.url);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        state.candidates.unshift(payload);
        state.candidates = state.candidates.slice(0, 20);
      }
      console.debug("[Subtitle MVP] candidate resource", payload);
      return;
    }

    if (event.data.type === "candidate-body") {
      const bodyRecord = {
        url: payload.url,
        status: payload.status || null,
        method: payload.method || payload.replayMethod || "",
        hasBody: Boolean(payload.hasBody || payload.replayHadBody),
        contentType: payload.contentType || "",
        error: payload.error || "",
        sample: payload.body ? payload.body.slice(0, 500) : "",
        length: payload.fullLength || (payload.body ? payload.body.length : 0),
        truncated: Boolean(payload.truncated),
        capturedAt: payload.capturedAt || Date.now()
      };
      state.candidateBodies.unshift(bodyRecord);
      state.candidateBodies = state.candidateBodies
        .sort((a, b) => {
          const score = (item) => {
            if (/licensedmanifest/i.test(item.url || "")) return 0;
            if (/timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(item.url || "")) return 1;
            if (/metadata/i.test(item.url || "")) return 2;
            if (/event\//i.test(item.url || "")) return 4;
            return 3;
          };
          return score(a) - score(b);
        })
        .slice(0, 12);

      const hints = extractSubtitleTrackHints(payload.body, payload.url);
      if (hints.length) {
        state.subtitleTrackHints = hints.concat(state.subtitleTrackHints).slice(0, 50);
      }

      const manifestRows = inspectManifestJson(payload.body, payload.url);
      if (manifestRows.length) {
        state.manifestDebug = manifestRows;
      }

      console.info("[Subtitle MVP] candidate body", {
        url: payload.url,
        status: payload.status,
        contentType: payload.contentType,
        length: bodyRecord.length,
        hints: hints.slice(0, 5),
        sample: bodyRecord.sample
      });
      return;
    }

    if (event.data.type === "parsed-json-hints") {
      const hints = Array.isArray(payload.hints) ? payload.hints : [];
      if (hints.length) {
        state.parsedJsonHints = hints.concat(state.parsedJsonHints).slice(0, 80);
        console.info("[Subtitle MVP] parsed JSON hints", hints.slice(0, 10));
      }
      const textTracks = Array.isArray(payload.textTracks) ? payload.textTracks : [];
      if (textTracks.length) {
        const byKey = new Map();
        for (const track of textTracks.concat(state.textTracks)) {
          const key = `${track.bcp47 || ""}:${track.trackId || ""}:${track.downloadableId || ""}:${track.profile || ""}`;
          byKey.set(key, track);
        }
        state.textTracks = Array.from(byKey.values()).slice(0, 80);
        console.info("[Subtitle MVP] text track candidates", state.textTracks);
      }
      const timedTextUrls = Array.isArray(payload.timedTextUrls) ? payload.timedTextUrls : [];
      if (timedTextUrls.length) {
        const byUrl = new Map();
        for (const item of state.timedTextUrls.concat(timedTextUrls)) {
          const existing = byUrl.get(item.url);
          if (!existing || item.manifestTrack || !existing.manifestTrack) {
            byUrl.set(item.url, item);
          }
        }
        state.timedTextUrls = Array.from(byUrl.values()).slice(0, 500);
        console.info("[Subtitle MVP] timed text URL candidates", state.timedTextUrls);
      }
      const currentLang = getCurrentTrackLang(textTracks);
      if (currentLang && state.targetLangMode === "auto") {
        state.targetLang = currentLang;
      }
      autoFetchTimedText(state.targetLang || currentLang);
      return;
    }

    if (event.data.type !== "timed-text-response") return;
    handleTimedTextResponse(payload);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "netflix-subtitle-mvp-popup") return;
    syncVideoKey();

    if (message.type === "get-state") {
      const video = getVideo();
      sendResponse({
        enabled: state.enabled,
        segmentCount: state.segments.length,
        videoTime: video ? video.currentTime : null,
        hasVideo: Boolean(video),
        lastCapture: state.lastCapture,
        candidates: state.candidates.slice(0, 8).map((item) => ({
          url: item.url,
          contentType: item.contentType || "",
          status: item.status || null,
          method: item.method || "",
          hasBody: Boolean(item.hasBody),
          initiatorType: item.initiatorType || "",
          fromPerformance: Boolean(item.fromPerformance)
        })),
        candidateBodies: state.candidateBodies.slice(0, 8),
        subtitleTrackHints: state.subtitleTrackHints.slice(0, 12),
        manifestDebug: state.manifestDebug.slice(0, 30),
        parsedJsonHints: state.parsedJsonHints.slice(0, 30),
        textTracks: state.textTracks.slice(0, 30),
        timedTextUrls: state.timedTextUrls.slice(0, 80),
        timedTextFetches: state.timedTextFetches.slice(0, 12),
        availableLanguages: getAvailableLanguages(),
        targetLang: state.targetLang,
        debugStatus: state.debugStatus,
        matchingTimedTextUrlCount: getBestTimedTextUrls(state.targetLang, 20).length,
        timedTextUrlCount: state.timedTextUrls.length,
        cacheCount: subtitleCache.size,
        subtitleMenuLabels: readSubtitleMenuLabels()
      });
    }

    if (message.type === "fetch-candidates") {
      const candidateUrls = state.candidates
        .map((item) => item.url)
        .filter(Boolean)
        .filter((url, index, list) => list.indexOf(url) === index)
        .sort((a, b) => {
          const score = (url) => {
            if (/licensedmanifest/i.test(url)) return 0;
            if (/timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(url)) return 1;
            if (/metadata/i.test(url)) return 2;
            if (/event\//i.test(url)) return 4;
            return 3;
          };
          return score(a) - score(b);
        });

      const manifestUrls = candidateUrls.filter((url) => /licensedmanifest/i.test(url));
      const urls = (manifestUrls.length ? manifestUrls : candidateUrls)
        .filter((url) => !/\/event\/|playercore|assets\.nflxext\.com/i.test(url))
        .slice(0, 4);

      for (const url of urls) {
        window.postMessage(
          {
            source: "netflix-subtitle-mvp",
            type: "fetch-candidate-url",
            url
          },
          window.location.origin
        );
      }

      sendResponse({ requested: urls.length, urls });
    }

    if (message.type === "fetch-timed-text") {
      const targetLang = state.targetLang || "";
      const urls = getTimedTextUrls(targetLang, targetLang ? 16 : 8, false);
      if (targetLang && urls.length) beginTargetTrackProbe(targetLang);

      for (const item of urls) {
        fetchedTimedTextUrls.add(item.url);
        fetchTimedTextItem(item, "manual");
      }

      sendResponse({ requested: urls.length, urls });
    }

    if (message.type === "set-target-lang") {
      state.targetLang = String(message.lang || "");
      state.targetLangMode = state.targetLang ? "manual" : "auto";
      fetchBestTimedTextForLang(state.targetLang, "manual-lang");
      sendResponse({ targetLang: state.targetLang });
    }

    if (message.type === "toggle") {
      state.enabled = Boolean(message.enabled);
      render();
      sendResponse({ enabled: state.enabled });
    }
  });

  injectPageHook();
  ensureOverlay();
  setInterval(render, 100);
})();
