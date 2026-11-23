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

**Hosted Wander** runs on the existing free Render service from `main` with a direct Neon PostgreSQL connection. Create a trip in an allowed iMessage group, open its invitation and verify your number to enter the shared canvas. The [hosted rollout guide](docs/ZEROSETTLE_PILOT.md#hosted-group-trips-and-verified-claims) covers server settings, history import, health checks and webhook cutover.

The local demo uses the same Dockerfile in filesystem mode. For a split local deployment, set `VITE_SYNC_URL` to its WebSocket endpoint at build time.

Local demo limits: anyone with a trip link can edit it (that's the invite model), there's no rate limiting, and state is one JSON-ish file per trip on one machine — fine for demos and a few dozen concurrent users, not for scale.

## How the local demo works
- **No database.** Each trip is a Yjs document, relayed and saved to disk by `server/relay.mjs`. Tabs in the same browser also sync via BroadcastChannel, so a down relay degrades gracefully.
- **Presence & cursors:** Yjs awareness → avatars in the top bar, live cursors on the canvas.
- **Mock auth:** a name prompt; identity lives in `sessionStorage` (per tab).
- **Votes:** key `widget|option|sessionId` → one vote per option per user, no write conflicts.
- **Simulated AI / deal scraper:** `src/features/ai/generate.ts` waits 2.5–5s and returns hardcoded data (`src/collab/greece.ts`).

See `docs/FIGMA_WORKFLOW.md` and `figma.map.json` for the Figma → code process.

## Local pilot milestone 1: message → destination vote

From the repo root, start a fresh isolated pilot (stop a previous pilot on port 1240 first):

```bash
npm run build && node server/pilot-demo.mjs
```

Open <http://127.0.0.1:1240/t/pilot-lisbon-demo>, enter a name and choose **continue as guest**. Leave the board open. Its existing destination poll starts with Lisbon and Porto at 0 votes. In a second terminal, run:

```bash
curl --fail-with-body -sS http://127.0.0.1:1240/local/test-message \
  -H 'Content-Type: application/json' \
  --data '{"messageId":"pilot-msg-001","tripId":"pilot-lisbon-demo","senderId":"pilot-chat-alice","text":"I vote for Lisbon"}'
```

The response has `duplicate:false,count:1`; Lisbon changes to **1** on the open board without refreshing. Run the identical curl command again: `duplicate:true,count:1`, and the board stays at **1**. A new message ID from the same sender also keeps one vote per option, following the existing vote schema.

For automated Chromium verification against a **fresh** pilot instance, run this instead of the curl command:

```bash
node scripts/verify-pilot.mjs
```

It signs in as a guest, observes `0 → 1 → 1`, checks the normal `/sync/wander-pilot-lisbon-demo` WebSocket and zero page navigations, and saves `/tmp/wander-pilot-verified.png`. Requires Playwright Chromium (`npx playwright install chromium` if missing). `npm test` also checks concurrent replay, restart persistence, isolation, missing Lisbon, and rejected input.

The demo binds only `127.0.0.1`, creates a fresh temporary `wander-pilot-*` data directory on every invocation, and never uses `./data` or the shipped demo trips. Ctrl-C stops it. The test endpoint is disabled by default (404); manual relay use requires both `LOCAL_TEST_MESSAGES=1` and a loopback `HOST` (`127.0.0.1` or `::1`). It accepts direct loopback JSON POSTs without an Origin header. No messaging provider or deployment is involved.

The destination poll is explicitly selected by `meta.destinationPollId` in the trip's Yjs document (set by the pilot fixture). The endpoint requires exactly one existing Lisbon option; it creates neither polls nor options. Votes use the existing `votes[widgetId|optionId|senderId] = timestamp` schema, so existing board observers and WebSocket broadcasts handle the update. Per-trip `pilotMessageReceipts[messageId]` and the vote are saved in one Yjs transaction and flushed to disk before acknowledging; exact replays are no-ops even after a relay restart. Reusing a message ID with a different sender or supported text returns 409. Only `I vote for Lisbon` is supported; unsupported commands return 422.

## Twilio Conversations Group MMS adapter

See [the Twilio pilot guide](docs/TWILIO_PILOT.md) for exact signed-sample commands, restart verification, all server environment settings, and the later live Group MMS setup. Quick automated check: `npm run build && node scripts/verify-twilio-pilot.mjs`. The adapter reuses the pilot vote/receipt handler, verifies signatures with Twilio's official SDK, stays disabled by default, and sends board links only for an explicit `board` command (outbound replies default to dry-run).

## Inbound SMS trial adapter

`POST /webhooks/twilio/sms` supports a separate Programmable Messaging trial number, reuses the shared vote/receipt handler, and returns empty TwiML for successful votes and replays. It requires a configured pilot trip, destination phone, tester allowlist, and Twilio signature. See [SMS environment and deployment steps](docs/TWILIO_SMS_PILOT.md). No outbound SMS reply is sent. Conversations remains available independently.

## ZeroSettle iMessage group pilot

`POST /webhooks/zerosettle` verifies the timestamped raw-body HMAC, restricts one group and its tester handles, and uses the shared Yjs vote/receipt handler. Server-only credential loading supports the existing private `.env.zeroSettle` key file. See [ZeroSettle setup, registration and verification](docs/ZEROSETTLE_PILOT.md). Tests: `npm test`; browser verification: `npm run build && node scripts/verify-zerosettle-pilot.mjs`. No outbound replies are generated.


ZeroSettle link sharing now saves supplied HTTP/HTTPS URLs as live attributed note cards. Optional group acknowledgments require `ZEROSETTLE_ACKNOWLEDGMENTS=1` and persist an at-most-once send claim; the default sends nothing. See the [link-card runbook](docs/ZEROSETTLE_PILOT.md#link-card-milestone) and run `node scripts/verify-zerosettle-links.mjs` for the mocked browser acceptance test.
