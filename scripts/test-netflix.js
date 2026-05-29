#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require("path");

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    throw new Error(
      [
        "Playwright is not installed.",
        "Run `npm install` in this project before using scripts/test-netflix.js.",
        `Original error: ${error.message}`
      ].join("\n")
    );
  }
}

const { chromium } = loadPlaywright();

const rootDir = path.resolve(__dirname, "..");
const extensionDir = rootDir;
const profileDir = process.env.NSM_PROFILE_DIR || path.join(rootDir, ".test-profile");
const targetUrl = process.argv[2] || "https://www.netflix.com/browse";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null);
  }
  if (!worker) return null;
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  return match ? match[1] : null;
}

async function dumpPageState(page) {
  return page.evaluate(() => {
    const video = document.querySelector("video");
    const overlay = document.querySelector("#netflix-subtitle-mvp-overlay");
    const status = overlay?.querySelector(".nsm-status")?.textContent || "";
    const text = overlay?.querySelector(".nsm-text")?.textContent || "";
    return {
      url: location.href,
      title: document.title,
      hasVideo: Boolean(video),
      videoTime: video ? Number(video.currentTime.toFixed(1)) : null,
      overlayStatus: status,
      overlayText: text.slice(0, 160)
    };
  });
}

async function dumpPopupState(context, extensionId) {
  if (!extensionId) return null;

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await popup.waitForTimeout(300);

  const state = await popup.evaluate(() => {
    const getText = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    const listText = (selector) => Array.from(document.querySelectorAll(`${selector} li`))
      .map((node) => node.textContent.trim())
      .filter(Boolean);

    return {
      video: getText("#video"),
      segments: getText("#segments"),
      time: getText("#time"),
      capture: getText("#capture"),
      candidates: listText("#candidates").slice(0, 8),
      hints: listText("#hints").slice(0, 12),
      bodies: listText("#bodies").slice(0, 8),
      manifestDebug: listText("#manifest-debug").slice(0, 20)
    };
  });

  await popup.close();
  return state;
}

async function clickFetchCandidates(context, extensionId) {
  if (!extensionId) return false;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await popup.click("#fetch", { timeout: 5000 }).catch(() => {});
  await popup.waitForTimeout(2000);
  await popup.close();
  return true;
}

async function main() {
  console.log("[MVP] extension:", extensionDir);
  console.log("[MVP] profile:", profileDir);
  console.log("[MVP] target:", targetUrl);

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation", "--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const extensionId = await getExtensionId(context);
  console.log("[MVP] extensionId:", extensionId || "not detected");

  const page = context.pages()[0] || await context.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (/Subtitle MVP/i.test(text)) {
      console.log(`[console:${message.type()}]`, text);
    }
  });

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  console.log("[MVP] Chrome is open. Log in or navigate to a Netflix playback page if needed.");
  console.log("[MVP] Press Ctrl+C here to stop. The test profile is kept for next run.");

  let fetchTriggeredForUrl = "";
  while (true) {
    const pageState = await dumpPageState(page).catch((error) => ({ error: error.message }));
    console.log("[page]", JSON.stringify(pageState));

    if (extensionId && pageState.hasVideo && pageState.url !== fetchTriggeredForUrl) {
      fetchTriggeredForUrl = pageState.url;
      await clickFetchCandidates(context, extensionId).catch((error) => {
        console.log("[popup] fetch failed:", error.message);
      });
    }

    const popupState = await dumpPopupState(context, extensionId).catch((error) => ({ error: error.message }));
    console.log("[popup]", JSON.stringify(popupState, null, 2));

    await wait(5000);
  }
}

main().catch((error) => {
  console.error("[MVP] failed:", error);
  process.exit(1);
});
