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
  try {
    const res = await fetch(tirunoUrl + "/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title }),
    });
    const data = await res.json();
    if (data.ok) setStatus($("status"), "✓ Saved — Tiru is summarising it.", "ok");
    else setStatus($("status"), data.error || "Could not save.", "err");
  } catch {
    setStatus($("status"), "Couldn't reach Tiruno at " + tirunoUrl, "err");
  } finally {
    $("bookmarkBtn").disabled = false;
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
