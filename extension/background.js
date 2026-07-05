// Tiruno Companion — background service worker.
//
// The extension is independent of the Tiruno app: bookmarks are captured even
// when the app is offline. Anything that couldn't be delivered lives in an
// offline queue (chrome.storage.local "queue"). This worker flushes that queue
// on install, on browser startup, and every few minutes — so as soon as Tiruno
// is live again, queued bookmarks are delivered without the user doing anything.

const DEFAULT_URL = "http://localhost:3002";
const FLUSH_ALARM = "tiruno-flush";

async function getTirunoUrl() {
  const { tirunoUrl } = await chrome.storage.sync.get("tirunoUrl");
  return (tirunoUrl || DEFAULT_URL).replace(/\/$/, "");
}

async function getQueue() {
  const { queue = [] } = await chrome.storage.local.get("queue");
  return Array.isArray(queue) ? queue : [];
}

// Try to deliver every queued bookmark. Items that fail stay in the queue.
// Returns { sent, left } so callers (popup) can show progress.
async function flushQueue() {
  const queue = await getQueue();
  if (!queue.length) return { sent: 0, left: 0 };

  const base = await getTirunoUrl();
  const remaining = [];
  let sent = 0;

  for (const item of queue) {
    try {
      const res = await fetch(base + "/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, title: item.title }),
      });
      if (res.ok) {
        sent += 1;
        continue;
      }
      remaining.push(item); // server reachable but rejected — keep for retry
    } catch {
      remaining.push(item); // app unreachable — keep queued
    }
  }

  await chrome.storage.local.set({ queue: remaining });
  await updateBadge(remaining.length);
  return { sent, left: remaining.length };
}

// Surface the pending count on the toolbar icon so it's visible at a glance.
async function updateBadge(count) {
  const n = typeof count === "number" ? count : (await getQueue()).length;
  try {
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#FF7A1A" });
  } catch {
    /* action API not ready */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  flushQueue();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  flushQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushQueue();
});

// Popup asks us to flush (e.g. right after it opens / after a new bookmark).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "flush") {
    flushQueue().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (msg && msg.type === "badge") {
    updateBadge();
    sendResponse({ ok: true });
  }
  return false;
});
