# Tiruno Companion (Chrome extension)

Required for **Canvas sync** and for **bookmarking articles** into Tiruno.

## What it does
- **Bookmark to Tiruno** — saves the current page's URL/title to `POST /api/articles`. Tiru then
  summarises it and reads it aloud in the app's **My Articles** section.
- **Sync Canvas courses** — on a `*.instructure.com` page it scrapes your course list and relays it
  to `POST /api/canvas` (the extension is the bridge to your authenticated Canvas session).

## Load it (unpacked)
1. Make sure the Tiruno dev server is running (`npm run dev`, e.g. http://localhost:3002).
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the extension. Open its popup and set **Tiruno URL** to your dev URL (default `http://localhost:3002`).

## Use
- On any article page → **＋ Bookmark to Tiruno** → open **My Articles** in the app; the card flips
  from *Summarising…* to *Ready*, then **Tiru explains** it (voice).
- On your **Canvas dashboard** → **⟳ Sync Canvas courses**.

> Dev note: the API sends permissive CORS headers so the extension can call it from any origin.
> For production, restrict `Access-Control-Allow-Origin` to the extension id.
