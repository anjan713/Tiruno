const DEFAULT_URL = "http://localhost:3002";

const $ = (id) => document.getElementById(id);

let tab = null;
let tirunoUrl = DEFAULT_URL;

async function getTirunoUrl() {
  const { tirunoUrl: saved } = await chrome.storage.sync.get("tirunoUrl");
  return (saved || DEFAULT_URL).replace(/\/$/, "");
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "status " + (kind || "");
}

// --- Offline queue ---------------------------------------------------------
// The extension works whether or not Tiruno is running. If a bookmark can't be
// delivered, it's stored locally and flushed later by the background worker.

async function getQueue() {
  const { queue = [] } = await chrome.storage.local.get("queue");
  return Array.isArray(queue) ? queue : [];
}

async function enqueueBookmark(item) {
  const queue = await getQueue();
  if (!queue.some((q) => q.url === item.url)) queue.push(item);
  await chrome.storage.local.set({ queue });
  chrome.runtime.sendMessage({ type: "badge" });
}

// Ask the background worker to deliver any queued bookmarks now.
function flushQueue() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "flush" }, (res) =>
        resolve(res || { sent: 0, left: 0 })
      );
    } catch {
      resolve({ sent: 0, left: 0 });
    }
  });
}

async function renderQueueHint() {
  const el = $("queueHint");
  if (!el) return;
  const n = (await getQueue()).length;
  el.textContent = n
    ? `${n} bookmark${n > 1 ? "s" : ""} queued — will sync when Tiruno is live.`
    : "";
}

// Scraper injected into the Canvas tab to read course names from the dashboard / nav.
function scrapeCanvasCourses() {
  const names = new Set();
  const sels = [
    ".ic-DashboardCard__header-title",
    ".ic-DashboardCard__link",
    'a[href*="/courses/"]',
  ];
  document.querySelectorAll(sels.join(",")).forEach((el) => {
    const t = (el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, " ");
    if (t && t.length > 2 && t.length < 90) names.add(t);
  });
  return Array.from(names)
    .slice(0, 12)
    .map((name, i) => ({ id: "c" + i, name }));
}

async function init() {
  tirunoUrl = await getTirunoUrl();
  $("tirunoUrl").value = tirunoUrl;
  $("openApp").href = tirunoUrl + "/articles";

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("pageTitle").textContent = tab?.title || "Untitled";
  $("pageUrl").textContent = tab?.url || "";

  // Real Canvas (*.instructure.com) OR the local mock Canvas page used for testing.
  const isCanvas = /instructure\.com/.test(tab?.url || "");
  const isMockCanvas = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/mock-canvas/.test(tab?.url || "");
  if (tab?.url && (isCanvas || isMockCanvas)) {
    $("canvasSection").style.display = "block";
  }

  // Tiruno may have come back online since we queued bookmarks — try to deliver
  // them now, then reflect whatever's still pending.
  const { sent } = await flushQueue();
  if (sent > 0) setStatus($("status"), `✓ Synced ${sent} queued bookmark${sent > 1 ? "s" : ""}.`, "ok");
  await renderQueueHint();
}

$("tirunoUrl").addEventListener("change", async (e) => {
  tirunoUrl = e.target.value.trim().replace(/\/$/, "") || DEFAULT_URL;
  await chrome.storage.sync.set({ tirunoUrl });
  $("openApp").href = tirunoUrl + "/articles";
});

$("bookmarkBtn").addEventListener("click", async () => {
  if (!tab?.url) return;
  setStatus($("status"), "Sending to Tiru…", "info");
  $("bookmarkBtn").disabled = true;
  const item = { url: tab.url, title: tab.title, at: Date.now() };
  try {
    const res = await fetch(tirunoUrl + "/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.url, title: item.title }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setStatus($("status"), "✓ Saved — Tiru is summarising it.", "ok");
    } else {
      // Server reachable but rejected (e.g. transient) — queue for retry.
      await enqueueBookmark(item);
      setStatus($("status"), "Saved offline — Tiruno will sync it when it's live.", "info");
    }
  } catch {
    // App unreachable — the whole point of the offline queue.
    await enqueueBookmark(item);
    setStatus($("status"), "Tiruno isn't running — saved offline, will sync automatically.", "info");
  } finally {
    $("bookmarkBtn").disabled = false;
    await renderQueueHint();
  }
});

$("canvasBtn").addEventListener("click", async () => {
  setStatus($("canvasStatus"), "Reading courses…", "info");
  try {
    const [{ result: courses }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeCanvasCourses,
    });
    if (!courses || !courses.length) {
      setStatus($("canvasStatus"), "No courses found on this page. Open your Canvas dashboard.", "err");
      return;
    }
    const res = await fetch(tirunoUrl + "/api/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courses }),
    });
    const data = await res.json();
    setStatus($("canvasStatus"), `✓ Synced ${data.count ?? courses.length} courses to Tiruno.`, "ok");
  } catch {
    setStatus($("canvasStatus"), "Sync failed (check Tiruno URL).", "err");
  }
});

init();
