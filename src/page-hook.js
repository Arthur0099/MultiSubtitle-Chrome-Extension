// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  const MARKER = "__NETFLIX_SUBTITLE_MVP_HOOKED__";
  if (window[MARKER]) return;
  window[MARKER] = true;

  const timedTextPattern = /timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt|RequestTimedTextUrl|request-timed-text/i;
  const manifestPattern = /manifest|metadata|playapi|cadmium|licensedManifest|movies/i;
  const interestingPattern = new RegExp(`${timedTextPattern.source}|${manifestPattern.source}`, "i");
  const maxBodyChars = 8_000_000;
  const maxRequestBodyChars = 250_000;
  const requestMetaByUrl = new Map();

  function shouldCapture(url, contentType) {
    return timedTextPattern.test(String(url)) || timedTextPattern.test(String(contentType || ""));
  }

  function shouldReport(url, contentType) {
    return interestingPattern.test(String(url)) || interestingPattern.test(String(contentType || ""));
  }

  function headersToObject(headers) {
    const result = {};
    try {
      if (!headers) return result;
      new Headers(headers).forEach((value, key) => {
        result[key] = value;
      });
    } catch (_error) {
      // Headers are best-effort debug data.
    }
    return result;
  }

  function bodyToDebugString(body) {
    if (body == null) return "";
    if (typeof body === "string") return body.slice(0, maxRequestBodyChars);
    if (body instanceof URLSearchParams) return body.toString().slice(0, maxRequestBodyChars);
    if (body instanceof Blob) return `[Blob size=${body.size} type=${body.type}]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer byteLength=${body.byteLength}]`;
    if (ArrayBuffer.isView(body)) return `[TypedArray byteLength=${body.byteLength}]`;
    return `[${Object.prototype.toString.call(body)}]`;
  }

  function rememberRequest(url, meta) {
    if (!url || !shouldReport(url, "")) return;
    requestMetaByUrl.set(String(url), {
      method: meta.method || "GET",
      headers: headersToObject(meta.headers),
      body: bodyToDebugString(meta.body),
      hasBody: meta.body != null,
      capturedAt: Date.now()
    });
  }

  function emit(type, payload) {
    window.postMessage(
      {
        source: "netflix-subtitle-mvp",
        type,
        payload
      },
      window.location.origin
    );
  }

  function hasInterestingJsonShape(value, depth) {
    if (depth > 8 || value == null) return false;
    if (typeof value === "string") return /timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(value);
    if (typeof value !== "object") return false;

    if (Array.isArray(value)) {
      return value.slice(0, 20).some((item) => hasInterestingJsonShape(item, depth + 1));
    }

    for (const [key, child] of Object.entries(value)) {
      if (/timed|subtitle|caption|track|download|language|locale|profile|text/i.test(key)) return true;
      if (hasInterestingJsonShape(child, depth + 1)) return true;
    }
    return false;
  }

  function summarizeJsonShape(value) {
    const rows = [];
    const visited = new WeakSet();

    function push(row) {
      if (rows.length < 80) rows.push(String(row).slice(0, 500));
    }

    function walk(node, path, depth) {
      if (rows.length >= 80 || depth > 10 || node == null) return;
      if (typeof node === "string") {
        if (/timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(node)) {
          push(`${path}=${node.slice(0, 180)}`);
        }
        return;
      }
      if (typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        if (/timed|subtitle|caption|track|download|language|locale|profile|text/i.test(path)) {
          push(`${path}=array(${node.length})`);
        }
        node.slice(0, 20).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        return;
      }

      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (/timed|subtitle|caption|track|download|language|locale|profile|text/i.test(key)) {
          if (child && typeof child === "object") {
            push(`${childPath}=${Array.isArray(child) ? `array(${child.length})` : `object(${Object.keys(child).slice(0, 12).join(",")})`}`);
          } else {
            push(`${childPath}=${String(child).slice(0, 180)}`);
          }
        }
        walk(child, childPath, depth + 1);
      }
    }

    walk(value, "$", 0);
    return rows;
  }

  function collectTimedTextUrlCandidates(value) {
    const urls = [];
    const visited = new WeakSet();

    function withTrackContext(context, node, path) {
      if (!node || typeof node !== "object" || Array.isArray(node)) return context;
      const next = Object.assign({}, context);
      const trackIndex = String(path || "").match(/timedtexttracks\[(\d+)\]/i);
      if (trackIndex) next.trackIndex = trackIndex[1];
      if (node.bcp47 || node.language || node.locale) next.bcp47 = node.bcp47 || node.language || node.locale;
      if (node.trackId) next.trackId = node.trackId;
      if (node.downloadableId || node.dlid) next.downloadableId = node.downloadableId || node.dlid;
      if (node.profile) next.profile = node.profile;
      if (node.rawTrackType) next.rawTrackType = node.rawTrackType;
      if (node.trackType) next.trackType = node.trackType;
      if (node.type && /subtitle|caption|forced|narrative|text/i.test(String(node.type))) next.type = node.type;
      if (node.isNoneTrack != null) next.isNoneTrack = node.isNoneTrack;
      if (node.displayName) next.displayName = node.displayName;
      if (!next.profile) {
        const profile = String(path || "").match(/ttDownloadables\.([^.\[]+)/i);
        if (profile) next.profile = profile[1];
      }
      return next;
    }

    function push(path, raw, context) {
      const value = String(raw || "");
      if (!value) return;
      if (!/^https?:\/\//i.test(value)) return;
      if (!/ttDownloadables|timedtexttracks|downloadable|subtitle|caption|dfxp|ttml|webvtt|vtt|imsc/i.test(path)) return;
      if (urls.some((item) => item.url === value)) return;
      const profile = (String(path || "").match(/ttDownloadables\.([^.\[]+)/i) || [])[1] || context.profile || "";
      const trackIndex = (String(path || "").match(/timedtexttracks\[(\d+)\]/i) || [])[1] || context.trackIndex || "";
      urls.push(Object.assign({}, context, {
        path,
        profile,
        trackIndex,
        url: value.slice(0, 1200)
      }));
    }

    function walk(node, path, depth, context) {
      if (urls.length >= 500 || depth > 14 || node == null) return;
      if (typeof node === "string") {
        push(path, node, context || {});
        return;
      }
      if (typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);
      const nextContext = withTrackContext(context || {}, node, path);

      if (Array.isArray(node)) {
        node.slice(0, 200).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1, nextContext));
        return;
      }

      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1, nextContext);
      }
    }

    walk(value, "$", 0, {});
    return urls;
  }

  function collectManifestTimedTextUrlCandidates(value) {
    const urls = [];
    const visited = new WeakSet();

    function readTrackLang(track) {
      return track.bcp47 || track.language || track.locale || track.languageTag || "";
    }

    function readDownloadableId(track) {
      return track.downloadableId || track.dlid || track.ttDownloadableId || "";
    }

    function readUrl(raw) {
      if (typeof raw === "string") return raw;
      if (raw && typeof raw === "object") return raw.url || raw.href || "";
      return "";
    }

    function pushUrl(track, trackIndex, profile, rawUrl, path) {
      const url = String(readUrl(rawUrl) || "");
      if (!/^https?:\/\//i.test(url)) return;
      if (urls.some((item) => item.url === url)) return;
      urls.push({
        manifestTrack: true,
        path,
        trackIndex: String(trackIndex),
        bcp47: readTrackLang(track),
        trackId: track.trackId || "",
        downloadableId: readDownloadableId(track),
        profile,
        rawTrackType: track.rawTrackType || "",
        trackType: track.trackType || "",
        type: track.type || "",
        displayName: track.displayName || track.languageDescription || "",
        isForcedNarrative: track.isForcedNarrative ?? track.isForced ?? false,
        isNoneTrack: track.isNoneTrack ?? "",
        url: url.slice(0, 1200)
      });
    }

    function collectTrack(track, trackIndex, path) {
      if (!track || typeof track !== "object") return;
      const downloadables = track.ttDownloadables || track.downloadables || {};
      if (!downloadables || typeof downloadables !== "object") return;

      for (const [profile, value] of Object.entries(downloadables)) {
        const profilePath = `${path}.ttDownloadables.${profile}`;
        if (Array.isArray(value)) {
          value.forEach((entry, index) => pushUrl(track, trackIndex, profile, entry, `${profilePath}[${index}]`));
          continue;
        }
        if (!value || typeof value !== "object") {
          pushUrl(track, trackIndex, profile, value, profilePath);
          continue;
        }

        if (Array.isArray(value.urls)) {
          value.urls.forEach((entry, index) => pushUrl(track, trackIndex, profile, entry, `${profilePath}.urls[${index}].url`));
        }
        if (value.url || value.href) {
          pushUrl(track, trackIndex, profile, value, `${profilePath}.url`);
        }
      }
    }

    function walk(node, path, depth) {
      if (urls.length >= 1000 || depth > 12 || node == null) return;
      if (typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      const tracks = node.result && Array.isArray(node.result.timedtexttracks) ?
        node.result.timedtexttracks :
        Array.isArray(node.timedtexttracks) ?
          node.timedtexttracks :
          null;

      if (tracks) {
        const tracksPath = node.result && Array.isArray(node.result.timedtexttracks) ?
          `${path}.result.timedtexttracks` :
          `${path}.timedtexttracks`;
        tracks.forEach((track, index) => collectTrack(track, index, `${tracksPath}[${index}]`));
      }

      if (Array.isArray(node)) {
        node.slice(0, 200).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        return;
      }

      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }

    walk(value, "$", 0);
    return urls;
  }

  function collectTextTrackCandidates(value) {
    const tracks = [];
    const visited = new WeakSet();

    function pickTrack(raw, path) {
      if (!raw || typeof raw !== "object") return;
      const track = {
        path,
        id: raw.id || "",
        trackId: raw.trackId || "",
        bcp47: raw.bcp47 || raw.language || raw.locale || "",
        downloadableId: raw.downloadableId || raw.dlid || "",
        rank: raw.rank ?? "",
        profile: raw.profile || "",
        isImageBased: raw.isImageBased ?? "",
        rawKeys: Object.keys(raw).slice(0, 20).join(",")
      };

      if (track.trackId || track.bcp47 || track.downloadableId || /text|subtitle|caption/i.test(track.rawKeys)) {
        tracks.push(track);
      }
    }

    function walk(node, path, depth) {
      if (tracks.length >= 80 || depth > 14 || node == null) return;
      if (typeof node !== "object") return;
      if (visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        node.slice(0, 80).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        return;
      }

      if (node.texttrackinfo && typeof node.texttrackinfo === "object") {
        pickTrack(node.texttrackinfo, `${path}.texttrackinfo`);
      }
      if (node.ttTrackFields && typeof node.ttTrackFields === "object") {
        pickTrack(node.ttTrackFields, `${path}.ttTrackFields`);
      }
      if (
        (node.trackId || node.downloadableId || node.bcp47) &&
        /(^T:|text|subtitle|caption|imsc|dfxp|ttml|vtt)/i.test(
          `${node.trackId || ""} ${node.profile || ""} ${node.type || ""} ${path}`
        )
      ) {
        pickTrack(node, path);
      }

      for (const [key, child] of Object.entries(node)) {
        walk(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }

    walk(value, "$", 0);
    return tracks;
  }

  const nativeJsonParse = JSON.parse.bind(JSON);
  JSON.parse = function patchedJsonParse(text, reviver) {
    const parsed = nativeJsonParse(text, reviver);
    try {
      if (hasInterestingJsonShape(parsed, 0)) {
        const manifestTimedTextUrls = collectManifestTimedTextUrlCandidates(parsed);
        const genericTimedTextUrls = collectTimedTextUrlCandidates(parsed);
        const genericOnly = genericTimedTextUrls.filter((item) => !manifestTimedTextUrls.some((manifestItem) => manifestItem.url === item.url));
        emit("parsed-json-hints", {
          capturedAt: Date.now(),
          hints: summarizeJsonShape(parsed),
          textTracks: collectTextTrackCandidates(parsed),
          timedTextUrls: manifestTimedTextUrls.concat(genericOnly)
        });
      }
    } catch (_error) {
      // JSON.parse must behave exactly like native parse.
    }
    return parsed;
  };

  async function fetchCandidateBody(url) {
    try {
      const meta = requestMetaByUrl.get(String(url));
      const response = await fetch(url, {
        method: meta && meta.method ? meta.method : "GET",
        headers: meta && meta.headers ? meta.headers : undefined,
        body: meta && meta.hasBody && meta.body && !meta.body.startsWith("[") ? meta.body : undefined,
        credentials: "include",
        cache: "no-store"
      });
      const contentType = response.headers && response.headers.get("content-type");
      const text = await response.clone().text();

      emit("candidate-body", {
        url: String(url),
        status: response.status,
        contentType,
        body: text.slice(0, maxBodyChars),
        truncated: text.length > maxBodyChars,
        replayMethod: meta && meta.method ? meta.method : "GET",
        replayHadBody: Boolean(meta && meta.hasBody),
        capturedAt: Date.now()
      });
    } catch (error) {
      emit("candidate-body", {
        url: String(url),
        error: String(error && error.message ? error.message : error),
        capturedAt: Date.now()
      });
    }
  }

  async function fetchTimedTextBody(url, meta) {
    const responseMeta = Object.assign({ kind: "timed-text-fetch" }, meta || {});
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store"
      });
      const contentType = response.headers && response.headers.get("content-type");
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const text = new TextDecoder("utf-8").decode(bytes);

      emit("timed-text-response", {
        url: String(url),
        contentType,
        status: response.status,
        body: text.slice(0, maxBodyChars),
        fullLength: text.length,
        byteLength: bytes.byteLength,
        truncated: text.length > maxBodyChars,
        meta: responseMeta,
        capturedAt: Date.now()
      });
    } catch (error) {
      emit("timed-text-response", {
        url: String(url),
        error: String(error && error.message ? error.message : error),
        meta: responseMeta,
        capturedAt: Date.now()
      });
    }
  }

  async function inspectResponse(url, response) {
    try {
      const contentType = response.headers && response.headers.get("content-type");
      const requestMeta = requestMetaByUrl.get(String(url));
      if (shouldReport(url, contentType)) {
        emit("candidate-resource", {
          url: String(url),
          contentType,
          status: response.status,
          method: requestMeta && requestMeta.method ? requestMeta.method : "",
          hasBody: Boolean(requestMeta && requestMeta.hasBody),
          capturedAt: Date.now()
        });

        const text = await response.clone().text();
        emit("candidate-body", {
          url: String(url),
          contentType,
          status: response.status,
          method: requestMeta && requestMeta.method ? requestMeta.method : "",
          hasBody: Boolean(requestMeta && requestMeta.hasBody),
          body: text.slice(0, maxBodyChars),
          fullLength: text.length,
          truncated: text.length > maxBodyChars,
          capturedAt: Date.now()
        });

        if (!shouldCapture(url, contentType) || !text || text.length > maxBodyChars) return;

        emit("timed-text-response", {
          url: String(url),
          contentType,
          body: text,
          capturedAt: Date.now()
        });
      }
    } catch (error) {
      emit("candidate-body", {
        url: String(url),
        error: String(error && error.message ? error.message : error),
        capturedAt: Date.now()
      });
    }
  }

  if (window.fetch) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function patchedFetch(input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const method =
        (init && init.method) ||
        (typeof input !== "string" && input && input.method) ||
        "GET";
      const headers =
        (init && init.headers) ||
        (typeof input !== "string" && input && input.headers) ||
        undefined;
      const body = init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : undefined;
      rememberRequest(url || "", { method, headers, body });
      const response = await nativeFetch(input, init);
      inspectResponse(url || "", response);
      return response;
    };
  }

  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const nativeOpen = NativeXhr.prototype.open;
    const nativeSend = NativeXhr.prototype.send;

    NativeXhr.prototype.open = function patchedOpen(method, url) {
      this.__subtitleMvpMethod = method || "GET";
      this.__subtitleMvpUrl = url;
      return nativeOpen.apply(this, arguments);
    };

    NativeXhr.prototype.send = function patchedSend() {
      rememberRequest(this.__subtitleMvpUrl || "", {
        method: this.__subtitleMvpMethod || "GET",
        headers: {},
        body: arguments[0]
      });

      this.addEventListener("load", function () {
        const contentType = this.getResponseHeader && this.getResponseHeader("content-type");
        const requestMeta = requestMetaByUrl.get(String(this.__subtitleMvpUrl || ""));
        if (shouldReport(this.__subtitleMvpUrl, contentType)) {
          emit("candidate-resource", {
            url: String(this.__subtitleMvpUrl || ""),
            contentType,
            status: this.status,
            method: requestMeta && requestMeta.method ? requestMeta.method : "",
            hasBody: Boolean(requestMeta && requestMeta.hasBody),
            capturedAt: Date.now()
          });
        }

        if (!shouldCapture(this.__subtitleMvpUrl, contentType)) return;
        let responseText = "";
        try {
          responseText = this.responseText;
        } catch (_error) {
          return;
        }

        if (typeof responseText !== "string" || responseText.length > maxBodyChars) return;

        if (shouldReport(this.__subtitleMvpUrl, contentType)) {
          emit("candidate-body", {
            url: String(this.__subtitleMvpUrl || ""),
            contentType,
            status: this.status,
            method: requestMeta && requestMeta.method ? requestMeta.method : "",
            hasBody: Boolean(requestMeta && requestMeta.hasBody),
            body: responseText,
            capturedAt: Date.now()
          });
        }

        emit("timed-text-response", {
          url: String(this.__subtitleMvpUrl || ""),
          contentType,
          body: responseText,
          capturedAt: Date.now()
        });
      });
      return nativeSend.apply(this, arguments);
    };
  }

  function scanPerformanceEntries() {
    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (const entry of entries) {
        if (!shouldReport(entry.name, "")) continue;
        emit("candidate-resource", {
          url: entry.name,
          contentType: "",
          status: null,
          method: "",
          hasBody: false,
          initiatorType: entry.initiatorType,
          capturedAt: Date.now(),
          fromPerformance: true
        });
      }
    } catch (_error) {
      // Best-effort debug scan only.
    }
  }

  setTimeout(scanPerformanceEntries, 1000);
  setInterval(scanPerformanceEntries, 5000);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "netflix-subtitle-mvp") return;
    if (event.data.type !== "fetch-candidate-url") return;
    if (!event.data.url || !shouldReport(event.data.url, "")) return;
    fetchCandidateBody(event.data.url);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "netflix-subtitle-mvp") return;
    if (event.data.type !== "fetch-timed-text-url") return;
    if (!event.data.url || !/nflxvideo\.net|timedtext|subtitle|caption|dfxp|ttml|webvtt|vtt/i.test(event.data.url)) return;
    fetchTimedTextBody(event.data.url, event.data.meta);
  });
})();
