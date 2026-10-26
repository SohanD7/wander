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

## How it works
- **No database.** Each trip is a Yjs document. `server/relay.mjs` holds docs in memory and relays them (restart = reset). Tabs in the same browser also sync via BroadcastChannel, so a down relay degrades gracefully.
- **Presence & cursors:** Yjs awareness → avatars in the top bar, live cursors on the canvas.
- **Mock auth:** a name prompt; identity lives in `sessionStorage` (per tab).
- **Votes:** key `widget|option|sessionId` → one vote per option per user, no write conflicts.
- **Simulated AI / deal scraper:** `src/features/ai/generate.ts` waits 2.5–5s and returns hardcoded data (`src/collab/greece.ts`).
- Deploying: host `dist/` statically and the relay anywhere with WebSockets; set `VITE_SYNC_URL=wss://…`.

See `docs/FIGMA_WORKFLOW.md` and `figma.map.json` for the Figma → code process.
