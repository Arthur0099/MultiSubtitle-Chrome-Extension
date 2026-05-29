// SPDX-License-Identifier: AGPL-3.0-or-later
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isNetflixTab(tab) {
  return /^https?:\/\/([^/]+\.)?netflix\.com\//i.test(tab?.url || "");
}

async function injectContent(tab) {
  if (!tab || !tab.id) throw new Error("No active tab");
  if (!isNetflixTab(tab)) {
    throw new Error("Open a Netflix playback tab first.");
  }

  await chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["src/overlay.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/subtitle-parser.js"]
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["src/content.js"]
  });
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab || !tab.id) throw new Error("No active tab");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!/Receiving end does not exist/i.test(String(error.message || error))) {
      throw error;
    }
    await injectContent(tab);
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function formatTime(seconds) {
  return typeof seconds === "number" ? `${seconds.toFixed(1)}s` : "-";
}

function formatCapture(value) {
  return value ? new Date(value).toLocaleTimeString() : "none";
}

function renderCandidates(candidates) {
  const list = document.getElementById("candidates");
  list.textContent = "";

  for (const item of candidates || []) {
    const li = document.createElement("li");
    const marker = item.fromPerformance ? "perf" : "net";
    const method = item.method ? `${item.method}${item.hasBody ? "+body" : ""}` : "";
    li.textContent = `[${marker}] ${method} ${item.status || ""} ${item.contentType || ""} ${item.url}`;
    list.appendChild(li);
  }

  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = "none";
    list.appendChild(li);
  }
}

function renderList(id, values, formatter) {
  const list = document.getElementById(id);
  list.textContent = "";

  for (const item of values || []) {
    const li = document.createElement("li");
    li.textContent = formatter(item);
    list.appendChild(li);
  }

  if (!list.children.length) {
    const li = document.createElement("li");
    li.textContent = "none";
    list.appendChild(li);
  }
}

function renderTargetLanguages(languages, selected) {
  const select = document.getElementById("target-lang");
  const current = selected || select.value || "";
  select.textContent = "";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Auto";
  select.appendChild(auto);

  for (const lang of languages || []) {
    const option = document.createElement("option");
    option.value = lang;
    option.textContent = lang;
    select.appendChild(option);
  }

  select.value = Array.from(select.options).some((option) => option.value === current) ? current : "";
}

async function refresh() {
  try {
    const state = await sendToActiveTab({
      source: "netflix-subtitle-mvp-popup",
      type: "get-state"
    });
    document.getElementById("video").textContent = state.hasVideo ? "detected" : "not found";
    document.getElementById("segments").textContent = String(state.segmentCount);
    document.getElementById("time").textContent = formatTime(state.videoTime);
    document.getElementById("capture").textContent = formatCapture(state.lastCapture);
    document.getElementById("debug").textContent = state.debugStatus || "none";
    document.getElementById("url-count").textContent = `${state.matchingTimedTextUrlCount || 0} / ${state.timedTextUrlCount || 0}`;
    document.getElementById("toggle").dataset.enabled = String(state.enabled);
    renderTargetLanguages(state.availableLanguages, state.targetLang);
    renderCandidates(state.candidates);
    renderList("hints", state.subtitleTrackHints, (item) => {
      const path = item.path ? `${item.path}: ` : "";
      return `[${item.type}] ${path}${item.value}`;
    });
    renderList("bodies", state.candidateBodies, (item) => {
      if (item.error) return `${item.url} -> ERROR ${item.error}`;
      const method = item.method ? `${item.method}${item.hasBody ? "+body" : ""}` : "";
      const truncated = item.truncated ? " truncated" : "";
      return `${method} ${item.status || ""} ${item.contentType || ""} len=${item.length}${truncated} ${item.url}`;
    });
    renderList("manifest-debug", state.manifestDebug, (item) => item);
    renderList("parsed-json-hints", state.parsedJsonHints, (item) => item);
    renderList("text-tracks", state.textTracks, (track) => {
      const lang = track.bcp47 || "unknown";
      const id = track.downloadableId || "no-dlid";
      const profile = track.profile || "no-profile";
      return `${lang} dlid=${id} profile=${profile} trackId=${track.trackId || ""} path=${track.path || ""}`;
    });
    renderList("timed-text-urls", state.timedTextUrls, (item) => {
      const bits = [
        item.bcp47 || item.lang || "unknown",
        item.manifestTrack ? "manifest" : "",
        item.trackIndex ? `idx=${item.trackIndex}` : "",
        item.downloadableId ? `dlid=${item.downloadableId}` : "",
        item.profile ? `profile=${item.profile}` : "",
        item.rawTrackType ? `raw=${item.rawTrackType}` : "",
        /forced|narrative/i.test(`${item.rawTrackType || ""} ${item.trackType || ""} ${item.type || ""} ${item.displayName || ""}`) ? "forced" : ""
      ].filter(Boolean).join(" ");
      const path = item.path ? `${item.path}: ` : "";
      return `${bits} ${path}${item.url}`;
    });
    renderList("timed-text-fetches", state.timedTextFetches, (item) => {
      const meta = item.meta || {};
      const lang = meta.bcp47 || meta.lang || "unknown";
      const track = [
        meta.manifestTrack ? "manifest" : "",
        meta.trackIndex ? `idx=${meta.trackIndex}` : "",
        meta.downloadableId ? `dlid=${meta.downloadableId}` : "",
        meta.profile ? `profile=${meta.profile}` : "",
        meta.rawTrackType ? `raw=${meta.rawTrackType}` : "",
        /forced|narrative/i.test(`${meta.rawTrackType || ""} ${meta.trackType || ""}`) ? "forced" : ""
      ].filter(Boolean).join(" ");
      if (item.error) return `${lang} ERROR ${item.error} ${item.url}`;
      return `${lang} ${track} status=${item.status || ""} type=${item.contentType || ""} bytes=${item.byteLength || 0} chars=${item.fullLength || 0} segments=${item.parsedSegments || 0} sample=${item.sample || ""}`;
    });
    renderList("subtitle-menu-labels", state.subtitleMenuLabels, (item) => item);
  } catch (error) {
    document.getElementById("video").textContent = "unavailable";
    document.getElementById("segments").textContent = "0";
    document.getElementById("time").textContent = "-";
    document.getElementById("capture").textContent = String(error.message || error);
    document.getElementById("debug").textContent = "unavailable";
    document.getElementById("url-count").textContent = "0 / 0";
    renderTargetLanguages([], "");
    renderCandidates([]);
    renderList("hints", [], () => "");
    renderList("bodies", [], () => "");
    renderList("manifest-debug", [], () => "");
    renderList("parsed-json-hints", [], () => "");
    renderList("text-tracks", [], () => "");
    renderList("timed-text-urls", [], () => "");
    renderList("timed-text-fetches", [], () => "");
    renderList("subtitle-menu-labels", [], () => "");
  }
}

function setDebugVisible(visible) {
  const panel = document.getElementById("debug-panel");
  const button = document.getElementById("debug-toggle");
  panel.hidden = !visible;
  button.dataset.expanded = String(visible);
  button.textContent = visible ? "Hide" : "Details";
  try {
    localStorage.setItem("subtitleMvpDebugVisible", visible ? "1" : "0");
  } catch (_error) {
    // localStorage is best-effort for popup preferences.
  }
}

document.getElementById("toggle").addEventListener("click", async () => {
  const enabled = document.getElementById("toggle").dataset.enabled !== "true";
  await sendToActiveTab({
    source: "netflix-subtitle-mvp-popup",
    type: "toggle",
    enabled
  });
  await refresh();
});

document.getElementById("fetch").addEventListener("click", async () => {
  await sendToActiveTab({
    source: "netflix-subtitle-mvp-popup",
    type: "fetch-candidates"
  });
  setTimeout(refresh, 1500);
});

document.getElementById("fetch-timed-text").addEventListener("click", async () => {
  await sendToActiveTab({
    source: "netflix-subtitle-mvp-popup",
    type: "fetch-timed-text"
  });
  setTimeout(refresh, 1500);
});

document.getElementById("target-lang").addEventListener("change", async () => {
  await sendToActiveTab({
    source: "netflix-subtitle-mvp-popup",
    type: "set-target-lang",
    lang: document.getElementById("target-lang").value
  });
  await refresh();
});

document.getElementById("debug-toggle").addEventListener("click", () => {
  const panel = document.getElementById("debug-panel");
  setDebugVisible(panel.hidden);
});

try {
  setDebugVisible(localStorage.getItem("subtitleMvpDebugVisible") === "1");
} catch (_error) {
  setDebugVisible(false);
}

refresh();
