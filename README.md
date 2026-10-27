# wander — prototype

Real-time collaborative trip planner. React 19 + Vite + Tailwind v4 + Yjs. **Skeleton**: every screen from the Figma file works end-to-end but is unpolished.

```bash
npm install
npm run dev        # web on :5173 and the sync relay on :1234
npm test           # budget/settle math (matches the Figma budget frames)
npm run build
```

Open `http://localhost:5173/t/pch-roadtrip` in two tabs (each tab = its own mock user) and vote, drag, and move your mouse.
On a phone on the same Wi-Fi use `http://<your-lan-ip>:5173`.

## Backend (live collaboration)
One small Node service, `server/relay.mjs`, does everything — no accounts, no database server:
- **Live sync:** relays each trip's Yjs document over WebSockets (`/sync/<trip-id>`), plus presence and cursors.
- **Persistence:** each trip is saved to `DATA_DIR` (default `./data`) a moment after every change and reloaded on the next join, so trips survive restarts and deploys (mount a volume at `DATA_DIR`).
- **Same-origin hosting:** serves the built web app (`dist/`) and falls back to `index.html`, so invite links like `/t/<trip-id>` just work.
- **Identity:** no logins — a display name kept in browser state is announced through Yjs awareness.
- `GET /health` → `{ ok, rooms, connections }`. Env: `PORT`, `HOST`, `DATA_DIR`, `STATIC_DIR`, `ALLOWED_ORIGINS`, `MAX_ROOMS`.

```bash
npm run build && npm start      # app + sync on http://localhost:1234
npm test                        # includes a two-client sync + restart-persistence test
```

**Deploy** (one container, see `Dockerfile`): `fly.toml` (Fly.io, with a volume) or `render.yaml` (Render blueprint). Open the deployed URL, create a trip, hit *invite* and send the link — anyone with it joins live. No client config is needed in production; for a split deployment set `VITE_SYNC_URL=wss://your-sync-host/sync` at build time.

Prototype limits: anyone with a trip link can edit it (that's the invite model), there's no rate limiting, and state is one JSON-ish file per trip on one machine — fine for demos and a few dozen concurrent users, not for scale.

## How it works
- **No database.** Each trip is a Yjs document, relayed and saved to disk by `server/relay.mjs`. Tabs in the same browser also sync via BroadcastChannel, so a down relay degrades gracefully.
- **Presence & cursors:** Yjs awareness → avatars in the top bar, live cursors on the canvas.
- **Mock auth:** a name prompt; identity lives in `sessionStorage` (per tab).
- **Votes:** key `widget|option|sessionId` → one vote per option per user, no write conflicts.
- **Simulated AI / deal scraper:** `src/features/ai/generate.ts` waits 2.5–5s and returns hardcoded data (`src/collab/greece.ts`).

See `docs/FIGMA_WORKFLOW.md` and `figma.map.json` for the Figma → code process.
