# Twilio Conversations Group MMS pilot

The adapter is `POST /webhooks/twilio/conversations`. It uses Twilio's official Node SDK to validate `X-Twilio-Signature` against every form parameter and the **configured external URL**, before reading or mutating any trip. Host and forwarded headers do not determine the signing URL. The callback accepts `application/x-www-form-urlencoded`; JSON and duplicate form fields are rejected.

Only signed `onMessageAdded` events in `TWILIO_CONVERSATION_TRIPS` are handled. `ConversationSid` selects the trip; `ParticipantSid` becomes the existing Yjs vote's voter ID; `MessageSid` is the existing per-trip `pilotMessageReceipts` key. Messages by `TWILIO_WANDER_AUTHOR` or the optional `TWILIO_WANDER_PARTICIPANT_SID` are ignored. Events without a ParticipantSid, unmapped conversations, other event types, and ordinary chat return 200 with an `ignored` reason. Invalid signatures return 403 before opening a room. Signed commands still require an existing seeded trip and its `meta.destinationPollId` with exactly one Lisbon option.

`I vote for Lisbon` invokes the same handler as the loopback pilot, saves a vote and receipt together, and sends **no chat reply**. Exact replay is a no-op across relay restarts. A new MessageSid from the same participant still counts once per option. The existing board updates through its Yjs WebSocket connection.

Only an explicit `board` command (case-insensitive) requests a board link. `TWILIO_BOARD_REPLIES=dry-run` is the default and makes no network call; the webhook response contains the proposed reply. `live` sends through the Conversations Messages REST API with the configured Wander author. A saved receipt prevents repeated send attempts for the same board event. This is deliberately at most one attempt: a crash or outbound failure after the receipt is saved can lose that reply; send a **new** `board` command to request another. Vote replay protection does not depend on replies.

## Automated local verification

From the repo root:

```bash
npm run build
node scripts/verify-twilio-pilot.mjs
npm test
```

Requires Playwright Chromium (`npx playwright install chromium` if missing). The verifier starts an isolated loopback relay on **1242**, uses only fictional account/token/SID values, opens the board in Chromium, and checks **0 → 1 → 2** for two distinct participants. It replays both events, restarts the actual relay process using the same temporary data directory, waits for the same page to reconnect, and replays both again. Count stays **2**, no page navigation occurs, and invalid signatures return 403 without adding a vote. It also checks a dry-run `board` reply. Screenshot: `/tmp/wander-twilio-pilot-verified.png`. The verifier stops its relay and removes its temporary data on completion. Set `PILOT_PORT` to choose another free port.

## Manual signed samples with an open board

Terminal 1 (the sample shortcut explicitly uses fictional credentials and never sends outbound replies):

```bash
export PILOT_PORT=1241
export PILOT_DATA_DIR="$(mktemp -d /tmp/wander-twilio-demo.XXXXXX)"
export PILOT_TWILIO_SAMPLES=1
npm run build && node server/pilot-demo.mjs
```

Open <http://127.0.0.1:1241/t/pilot-lisbon-demo>, enter a name and continue as guest. Leave this board open. Terminal 2:

```bash
node scripts/send-twilio-sample.mjs alice   # signed; Lisbon becomes 1
node scripts/send-twilio-sample.mjs bob     # signed; Lisbon becomes 2
node scripts/send-twilio-sample.mjs alice   # duplicate:true, count:2
node scripts/send-twilio-sample.mjs bob     # duplicate:true, count:2
node scripts/send-twilio-sample.mjs invalid # 403; board stays 2
node scripts/send-twilio-sample.mjs board   # dry-run board link; no outbound call
```

For a restart, Ctrl-C in terminal 1, then run `node server/pilot-demo.mjs` again in **that same terminal**, retaining the exported data directory. Leave the browser open and repeat the Alice/Bob commands in terminal 2. Both return `duplicate:true,count:2`. The runner seeds only an empty trip, so restart does not reset the poll or votes. These samples sign all payload parameters with Twilio's official SDK; `invalid` deliberately sends a bad signature.

The original loopback demo remains available with `npm run build && node server/pilot-demo.mjs` from a terminal without these exports. Its `/local/test-message` JSON contract is unchanged. Default demo runs get a fresh temporary directory; `PILOT_DATA_DIR` opts into reuse.

## Environment for a later live Group MMS test

No real credentials or Twilio resources are created by this implementation. Replace the fictional credentials/SIDs and example hostname below with your account, Conversation, and HTTPS tunnel values in a private terminal. These variables are read on startup, not from Vite's client environment. Do not set `PILOT_TWILIO_SAMPLES=1` for the live test.

```bash
unset PILOT_TWILIO_SAMPLES
export PILOT_PORT=1241
export PILOT_DATA_DIR="$(mktemp -d /tmp/wander-twilio-live.XXXXXX)"
export LOCAL_TEST_MESSAGES=0
export TWILIO_CONVERSATIONS_ENABLED=1
export TWILIO_ACCOUNT_SID=AC11111111111111111111111111111111
export TWILIO_AUTH_TOKEN=wander-sample-auth-token-not-a-real-secret
export TWILIO_CONVERSATIONS_WEBHOOK_URL=https://YOUR-TUNNEL.example/webhooks/twilio/conversations
export TWILIO_CONVERSATION_TRIPS='{"CH22222222222222222222222222222222":"pilot-lisbon-demo"}'
export TWILIO_WANDER_AUTHOR=wander
export TWILIO_WANDER_PARTICIPANT_SID=MB99999999999999999999999999999999
export WANDER_BOARD_BASE_URL=https://YOUR-TUNNEL.example
export TWILIO_BOARD_REPLIES=dry-run
npm run build && node server/pilot-demo.mjs
```

Forward your HTTPS tunnel to `http://127.0.0.1:1241`. Configure the Conversation-scoped webhook (or service post-event webhook) to **POST** to the exact `TWILIO_CONVERSATIONS_WEBHOOK_URL`, filtering for `onMessageAdded`. Preserve any configured query string exactly. The unsigned local test ingress is disabled in this setup.

Use an existing Group MMS Conversation with two phone participants and a Wander Chat participant represented by an MMS-capable Twilio projected address. Set `TWILIO_WANDER_AUTHOR` to that Chat participant's identity and `TWILIO_WANDER_PARTICIPANT_SID` to its actual participant SID; for a standalone projected-address participant, use the projected phone number as the author. Map its actual CH SID to the pilot trip. Open the board and have each phone participant send `I vote for Lisbon`; the board should show 2 without a refresh. Vote commands generate no adapter reply. To test an actual link reply, restart with `TWILIO_BOARD_REPLIES=live` and send a **new** `board` message. Group MMS routing and number/participant provisioning remain Twilio configuration, not this adapter's responsibility.

References: [Twilio signature validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [Conversations webhook fields and configuration](https://www.twilio.com/docs/conversations-classic/conversations-webhooks), [Group MMS setup and projected addresses](https://www.twilio.com/docs/conversations-classic/group-texting), [Conversations Messages REST API](https://www.twilio.com/docs/conversations-classic/api/conversation-message-resource).
