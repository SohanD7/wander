# ZeroSettle iMessage group → Wander pilot

The Node relay now accepts `POST /webhooks/zerosettle`, independently of the existing Twilio adapters. The receiver follows the [full ZeroSettle API reference](https://portal.zerosettle.io/docs.md), especially sections 13 and 19. For destination votes and link capture, only inbound plain text with event `message.received`, direction `in`, status `received`, the one configured `chat_id`, and an allowlisted tester handle reaches the shared `executePilotMessage` handler. It accepts `I vote for <existing destination option>`, case-insensitively; both Lisbon and Porto work in the pilot. Unknown or ambiguous options are rejected without creating anything. Outbound events, reactions, typing, system events, media, direct chats and unauthorized groups cannot cast votes. Link sharing is also supported. Outbound acknowledgments are off by default and require `ZEROSETTLE_ACKNOWLEDGMENTS=1`; there are no tapback, typing or AI calls. See the link-card milestone below. The separate opt-in `ZEROSETTLE_POLLS=1` enables explicit Wanda native-poll commands and signed `poll.voted` mirroring; see the native poll section at the end.

## Credentials and environment

The Node-only loader in `server/zerosettle-env.mjs` automatically reads these root files, in this order, without printing their contents:

1. `.env.zerosettle.local` — private webhook configuration and one-time signing secret.
2. `.env.zeroSettke` — the filename originally supplied in the request, if present.
3. `.env.zeroSettle` — the actual existing API-key file.

Existing process environment takes precedence. Only `ZEROSETTLE_*` names are loaded. All private `.env*` files are ignored by git and Docker (`.env.example` remains versionable). Never import this loader from frontend code or name a credential `VITE_*`. For hosted deployment, supply the same variables through the hosting secret manager; credentials are deliberately excluded from the Docker image.

Keep the existing `ZEROSETTLE_API_KEY` in its private file. The API key is used by the operator helper and, only when explicitly enabled, the acknowledgment sender. Signature validation uses the separate `ZEROSETTLE_WEBHOOK_SECRET` returned by registration.

Set the following server settings. Example handles below are fictional; the actual tester allowlist is saved only in the ignored private configuration.

```bash
export ZEROSETTLE_ENABLED=1
export ZEROSETTLE_CHAT_ID='iMessage;+;chatYOUR_GROUP_ID'
export ZEROSETTLE_TESTER_HANDLES='+12025550101,+12025550102'
export ZEROSETTLE_TRIP_ID='pilot-lisbon-demo'
export ZEROSETTLE_WEBHOOK_URL='https://YOUR-PUBLIC-HOST/webhooks/zerosettle'
```

A nonempty group and tester list are mandatory. Copy the chat ID exactly from the provider; do not use the group name. Phone handles use E.164; email handles are matched case-insensitively. Each normalized handle hashes to one stable, delimiter-safe `zs-…` Yjs voter ID. The receipt key is `zerosettle.message.received.<message.id>`, so replay identity includes the provider/event and the provider's numeric ID. Receipts and votes are saved in the existing trip document before returning 200, then arrive on the board through its normal WebSocket. There is no second database or counting path. Positive safe numeric IDs and decimal-string IDs up to signed 64-bit are accepted; unsafe JSON numeric IDs are rejected rather than rounded. Signed synthetic provider tests (`test:true`, ID 0) are acknowledged without voting.

## Find the pilot group without sending anything

```bash
node scripts/zerosettle.mjs line
node scripts/zerosettle.mjs groups
node scripts/zerosettle.mjs inbound
```

These commands load the existing API key and send it only to `https://portal.zerosettle.io` in an Authorization header, not a command-line argument. The status helper outputs selected safe fields only. `inbound` shows metadata only from the configured testers, not message text. The first page covers 100 messages from ID 0; use the provider console/history for older or larger inboxes.

Create the iMessage group from a tester's phone with both testers and the ZeroSettle line, then send a setup text. It should appear under `groups`; read its `chat_id`. The setup text itself does not vote. A group has to reach the ZeroSettle line before the API can report it. Everyone should agree to participate in this pilot.

## Public HTTPS webhook registration

From the repository root, start an HTTPS tunnel in a separate terminal. Either of the following installed tools works:

```bash
cloudflared tunnel --url http://127.0.0.1:1241
# Or: ngrok http 1241
```

Use its public HTTPS hostname in `ZEROSETTLE_WEBHOOK_URL`, with `/webhooks/zerosettle` appended. The registration helper enforces that path. No API token needs to be copied into the shell or a curl command:

```bash
export ZEROSETTLE_WEBHOOK_URL='https://YOUR-TUNNEL-HOST/webhooks/zerosettle'
node scripts/zerosettle.mjs register
```

This performs exactly:

```text
PUT https://portal.zerosettle.io/api/imessage/webhook
Authorization: Bearer <server ZEROSETTLE_API_KEY>
Content-Type: application/json

{"url":"https://YOUR-TUNNEL-HOST/webhooks/zerosettle","typing_events":false,"optout_events":false,"instant_typing":false}
```

The helper captures the returned `secret` directly into `.env.zerosettle.local` with permissions 0600. It never prints the secret or raw response. **Registering again rotates the secret**, even for the same URL. Restart the relay after registration. If an older secret was exported in your shell, `unset ZEROSETTLE_WEBHOOK_SECRET` before restarting so the saved value can load. Do not run curl without capturing/redacting the registration response: the secret is shown only once.

The line group must be **managed by API**, not the hosted AI agent; otherwise inbound texts are answered by that agent and do not reach the webhook. The helper can switch it explicitly:

```bash
# If the account has several line groups, set ZEROSETTLE_LINE_ID to the intended line ID first.
node scripts/zerosettle.mjs managed-by-api
```

This uses `PUT /api/imessage/agent {"managed_by":"api"}` (with a line selector when configured). It changes who receives inbound messages but sends no messages. For multiple line groups, select the intended line rather than changing an unrelated group's routing. The webhook registration is account-wide: one callback receives all line events, and Wander filters them to the configured group.

## Run the isolated live board

With the group/tester/trip variables set above and the secret saved by registration:

```bash
unset PILOT_ZEROSETTLE_PLANNING_SAMPLES PILOT_ZEROSETTLE_LIST_SAMPLES PILOT_ZEROSETTLE_POLL_SAMPLES PILOT_ZEROSETTLE_LINK_SAMPLES PILOT_TWILIO_SAMPLES PILOT_ZEROSETTLE_SAMPLES
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
export LOCAL_TEST_MESSAGES=0
export PILOT_PORT=1241
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
npm run build
node server/pilot-demo.mjs
```

The runner seeds only an unseeded pilot document. Reuse `PILOT_DATA_DIR` on every restart so the same trip and receipts survive. Open `http://127.0.0.1:1241/t/pilot-lisbon-demo`, enter a name and continue as guest. Each tester sends **I vote for Lisbon** in the configured group (or **I vote for Porto** to choose Porto). The count should change **0 → 1 → 2** without refreshing. A later distinct message from one of those testers still counts once per option. A repeated provider delivery is a no-op.

Check the last provider delivery with:

```bash
node scripts/zerosettle.mjs line
```

The helper reports HTTP status, event and attempts, without printing keys or the provider's raw error message. An invalid signature returns 401, an unauthorized group/tester returns 403, and unsupported events are acknowledged with 200 and an `ignored` reason. Authorized plain-text records with valid provider timestamps can instead be saved as bounded comment-correlation candidates; they create no card or acknowledgment by themselves. A missing adapter configuration is 404 when disabled; enabled incomplete configuration fails startup. Persistence failure remains a retryable 503 from the shared handler.

## Verification and reproduction

```bash
npm test
npm run build
node scripts/verify-zerosettle-pilot.mjs
```

The browser verifier uses **fictional** credentials/events and an isolated temporary data directory on port 1244. It opens the board in Chromium, posts two signed tester events, checks 0 → 1 → 2 with no navigation, restarts the actual relay process with the same data directory, and replays both events. It also checks invalid signatures and a reconnect through the normal WebSocket. Screenshot: `/tmp/wander-zerosettle-pilot-verified.png`. It stops its relay and deletes its temporary data at the end. It never calls ZeroSettle or sends an iMessage. Requires Playwright Chromium (`npx playwright install chromium` if missing).

The integration tests additionally prove disk replay protection before reconnecting a browser client, concurrent replay no-ops, raw whitespace-sensitive signatures, stale/future/bad signatures, unknown testers, unauthorized/direct groups, outbound/system/media events, email handles, safe ID handling, and server-only environment loading. Existing loopback and Twilio tests remain.

## Hosting and operations

Use one Node relay with HTTPS/WebSocket proxying and persistent `DATA_DIR`; the default Docker command is `node server/relay.mjs`, which does not seed the demo. Seed or transfer the isolated pilot `.ydoc` into that persistent directory while relays are stopped before routing real events. Keep `LOCAL_TEST_MESSAGES=0` on a public/tunneled relay. Supply credentials through server secrets, never through frontend build variables. A temporary data volume loses replay receipts when the machine is replaced.

The signature verifier follows the documented HMAC-SHA256 of `<timestamp>.<raw body bytes>`, constant-time comparison, and ±300-second tolerance. Keep the server clock synchronized. The webhook response waits only for the small existing Yjs transaction/disk save, with no upstream API calls on the response path, so normal processing is well within the provider's ten-second deadline. ZeroSettle retries non-2xx deliveries after 1, 5 and 20 seconds; check provider history for recovery after a prolonged outage.

To rotate the API key, replace `ZEROSETTLE_API_KEY` in the ignored key file or host secret manager and revoke old tokens in the provider console; restart processes. To rotate the signing secret, re-register with the helper, then restart the relay. No tokens, secrets, inbound message bodies or signatures are logged by the adapter. This integration does not remove Twilio code, commit changes, deploy, or send test messages automatically.


## Link-card milestone

An authorized tester can share HTTP/HTTPS links with a comment in the same configured group. Each unique URL in one message creates one existing **note** widget in `widgets`, with the supplied URL, accompanying text and the configured display name (or normalized sender handle) as attribution. Clear bare domains such as `bomb.com` and `github.com/username` are accepted and prefixed with `https://`. The server-only `linkify-it` parser excludes email addresses, fuzzy IP/decimal numbers, unrecognized domain suffixes and unsupported schemes; explicit HTTP/HTTPS URLs retain their supplied spelling. No DNS or page requests are made. The original message and URL also remain on the card's `source` metadata. Query parameters and supplied URL spelling are retained; surrounding sentence punctuation is excluded. A repeated URL within the same message produces one card. A new provider message sharing that URL can create a new card. Nothing fetches, resolves or scrapes the supplied page. The existing note card shows editable text; this milestone does not create a rich preview or a dedicated clickable link widget.

A supported vote and a link can coexist. Write the vote as its own line (or directly followed by a URL), for example:

```text
i vote for Porto https://example.com/stay
Nice place near the river
```

The vote, note cards, inbound receipt and initial acknowledgment state are saved in one Yjs transaction. An invalid/ambiguous destination in a mixed vote/link message rejects that transaction without partial cards. The original case-insensitive standalone Lisbon/Porto votes remain unchanged. Arbitrary prose votes, multiple vote lines, attachments and scraped listing details are outside this milestone.

### Private display names and existing data

Add a JSON mapping to the **ignored** `.env.zerosettle.local` (use each tester's normalized E.164 phone or lowercase email):

```dotenv
ZEROSETTLE_TESTER_NAMES='{"+12025550101":"Alice","+12025550102":"Bob"}'
```

Restart only the relay with the same persistent directory after changing this setting. Names must be nonempty, at most 80 characters and contain no control characters; invalid configuration fails startup without echoing values. Unmapped testers use their normalized handle. The real private file currently maps the tester ending in 9953 to Sohan; no names were invented for the other testers.

The server publishes only allowlisted tester profiles, keyed by the **existing hashed sender ID**, to the trip's members map. New cards store the name as attribution. Existing source-attributed cards resolve their `source.senderId` through members when rendered, so a name change also works for already-persisted cards without rewriting their text, IDs or coordinates. Legacy notes without source metadata keep their original author. Vote buttons show voter names in their hover titles. Counts and vote/replay keys do not change. The phone-to-name configuration remains server-only; names and fallback handles are intentionally visible on the shared board.

### Split comments: evidence and bounded correlation

Read-only inspection of authorized provider history found three separate comment records followed by URL-only records from the same sender **5.142, 5.368 and 5.410 seconds later**. Each pair had consecutive provider IDs, different GUIDs, and no attachments, caption field or reply reference. The current reference describes captions in `message.text` for media and attachment metadata separately; its outbound link-preview section's single-record behavior did not describe these observed inbound pairs. Wander does not fetch attachments or page previews to recover text.

For new signed authorized text events, correlation requires all of the following:

- Same configured group and stable sender ID; the link's numeric provider ID is exactly the comment ID plus one.
- Valid `ts_ms` on both records; the link follows the comment by 0–6,000 milliseconds.
- URL-only link text, with no own comment; the preceding comment has at least ten characters and multiple words. Pure vote lines, control commands and short chatter are excluded.
- Both fragments are received within the 60-second retention period. Pending state is capped at 128 fragments per trip, pruned on new processing, and saved in the existing Yjs document with receipts. These bounds also apply across restart.

Either webhook arrival order works. A link saves immediately; a late matching comment patches only untouched cards whose text is still exactly their URL. User edits, deletion and coordinates are preserved. A comment can be consumed once. The URL event's provider ID remains the card/ack replay key; the comment keeps its own provider-ID receipt and is never acknowledged separately. A separate supported vote line in the comment still casts its vote. Replays do not re-run correlation or create another acknowledgment.

**Limitation:** there is no provider grouping reference for these pairs. Adjacency and timing are a conservative heuristic, not proof of shared intent. An unrelated multiword comment immediately followed by a link under those exact conditions can still be associated. Intervening provider IDs, longer delays, short comments, or a restart/outage exceeding retention deliberately leave the URL card unpaired; edit its note manually. There is no automatic historical backfill. Sending the comment and URL together is preferred when the provider preserves one record.

To inspect a fresh user-sent test without exposing content or credentials:

```bash
node scripts/diagnose-zerosettle-links.mjs
```

This reads the configured group's first 500 history records and prints only IDs, hashed sender tags, field names, timing, text/comment lengths and attachment counts. It prints no bodies, URLs, signatures, secrets or tokens and sends no messages. History is evidence of the provider's stored message objects; a fresh live test should confirm how current webhook delivery behaves.

### Compact placement

Incoming notes and the board's normal Add action share the same grid/placement helper. New cards fill the first free space in three board columns using occupied rectangles and a 24px minimum gap. Explicit resized dimensions are respected; natural-height cards use conservative per-type footprints. Each relay transaction immediately reserves the new position, so concurrent incoming messages see earlier additions. Existing cards, including manually positioned cards and the old vertical column, are never moved. Scroll anchoring is disabled on the canvas scroller, and ingress performs no navigation or viewport movement. Concurrent human drags can still change occupancy after placement; this is not a locked layout engine.

### Acknowledgment setting and delivery guarantees

`ZEROSETTLE_ACKNOWLEDGMENTS=0` (or unset) is the safe default: cards save but no message is sent. Messages saved with acknowledgments disabled are permanently marked `disabled`; enabling later does **not** acknowledge that backlog. To enable real sends for new link shares:

```bash
export ZEROSETTLE_ACKNOWLEDGMENTS=1
```

Keep the existing server-only `ZEROSETTLE_API_KEY`, signing secret, pilot `chat_id`, tester list and isolated trip settings. Restart the relay after changing the flag. The sender can target only the originating configured group; it never sends to a tester's 1:1 address. Vote-only messages stay silent. One short acknowledgment, **Saved to your trip board.**, covers all cards from the same inbound message. Outbound `message.sent` / `message.failed` webhooks are ignored before link detection, so they cannot loop.

`pilotAcknowledgments` in the trip document records `pending → sending → sent | failed | uncertain`. The pending item is saved atomically with the card/receipt. Before an outbound call, a synchronous claim changes it to `sending` and saves it to disk. Concurrent deliveries and later replays cannot claim it again. A saved pending item that was never claimed is resumed after restart. A `sending` item loaded after restart becomes `uncertain` and is never resent automatically. Known HTTP 4xx refusals become `failed` (408 is uncertain); network errors, timeouts, 5xx responses and malformed/unconfirmed success responses become `uncertain`. Completion state is saved; if that save fails, the persisted sending claim still prevents a repeat after restart. A deleted card is never recreated by replaying its source event.

**Provider limitation:** the current ZeroSettle reference documents `Idempotency-Key` for buying/releasing lines and ten-minute duplicate suppression for videos, but **not for ordinary text sends**. It specifically warns that repeating a text send after a timeout may send it again and says to inspect message history first. Wander therefore makes **at most one automatic send attempt per inbound link message**, without inventing an unsupported idempotency header. An uncertain attempt may already have sent or may have sent nothing; a crash immediately after persisting a claim can also lose an acknowledgment. Exactly-once card creation is supported across retries/restarts, but exactly-once delivered acknowledgments cannot be guaranteed. `sent` means ZeroSettle accepted the message, not confirmed group delivery. Do not blindly resend uncertain items. Inspect the ZeroSettle console/history before any manual action. Terminal failed/uncertain states do not prevent the saved card from remaining usable.

Inspect persisted state locally, without printing credentials or message bodies:

```bash
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
node scripts/inspect-pilot-acks.mjs
```

As with the existing prototype, these guarantees assume a single relay instance, retained writable storage and trusted board editors. The Yjs board has no production access-control layer. Do not run two relays against the same data directory. Deleting/resetting the data or receipts loses replay protection.

### Automated acceptance test (no real outbound traffic)

```bash
npm test
npm run build
node scripts/verify-zerosettle-links.mjs
```

This isolated Chromium test uses sample credentials and an injected mock sender on port 1246. It checks a real rendered note card with URL, comment and named attribution, a mixed Porto vote, a second bare-domain card correlated with its comment across a process restart, two mocked acknowledgments to the sample group, compact non-overlapping rendered placement, a steady viewport, zero browser navigations, and no duplicate card/send after replay. Screenshot: `/tmp/wander-zerosettle-links-verified.png`. The test cleans up its relay and temporary data. Nothing is sent to the real pilot group.

For a manual local-only rehearsal, terminal 1:

```bash
export PILOT_PORT=1246
export PILOT_DATA_DIR="$(mktemp -d /tmp/wander-links-demo.XXXXXX)"
export PILOT_ZEROSETTLE_LINK_SAMPLES=1
export LOCAL_TEST_MESSAGES=0
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
node server/pilot-demo.mjs
```

Open `http://127.0.0.1:1246/t/pilot-lisbon-demo`, enter a guest name and leave the board open. In terminal 2:

```bash
node scripts/send-zerosettle-link-sample.mjs
node scripts/send-zerosettle-link-sample.mjs  # same ID: no new card or mock send
```

Terminal 1 logs exactly one `SAMPLE_ZEROSETTLE_ACK` with fictional group information. Stop/restart terminal 1's runner with its exported directory retained and repeat the second command to check disk replay protection. A different sample message can contain a mixed vote and link:

```bash
node scripts/send-zerosettle-link-sample.mjs 'i vote for Porto https://example.com/porto' 72002
```

The sample sender uses a fictional secret; accidentally pointing it at the real pilot port fails signature validation rather than sending a real acknowledgment.

### Real group acceptance test (explicit opt-in)

The current live relay must be restarted to load this code. Stop that identified Wander process first; do not start a second relay against its directory. Keep the existing HTTPS tunnel/webhook registration from earlier sections. In the real pilot terminal:

```bash
unset PILOT_ZEROSETTLE_PLANNING_SAMPLES PILOT_ZEROSETTLE_LIST_SAMPLES PILOT_ZEROSETTLE_POLL_SAMPLES PILOT_ZEROSETTLE_LINK_SAMPLES PILOT_ZEROSETTLE_SAMPLES PILOT_TWILIO_SAMPLES
export ZEROSETTLE_ENABLED=1
export ZEROSETTLE_ACKNOWLEDGMENTS=1
export PILOT_PORT=1241
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
export LOCAL_TEST_MESSAGES=0
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
npm run build
node server/pilot-demo.mjs
```

The ignored `.env.zerosettle.local` already holds the explicit group, tester and trip settings; keep them. Open `http://127.0.0.1:1241/t/pilot-lisbon-demo`. Have one authorized tester share `Nice place near the river https://example.com/stay` **in that configured pilot group**. One note should appear without refreshing and one group acknowledgment should arrive. The webhook returns promptly after saving; the separate outbound send can normally take 2–5 seconds and up to about 75, with a 90-second client timeout. Duplicate provider deliveries are covered by the automated signed-event tests; sending another iMessage creates a **new** provider ID and is not a replay test.

After the test, unset the acknowledgment flag (or set it to `0`) and restart the relay to pause future sends. No real acknowledgment test has been run automatically as part of preparing this feature.

### Concise manual polish checks (operator sends the messages)

After review, build and restart **only** the existing relay using the same `PILOT_DATA_DIR` and private settings; preserve the tunnel. Do not reset or reseed the data. Keep the acknowledgment flag at the operator's explicitly chosen value. Open the existing board and leave it at its current scroll position.

1. Check an old source-attributed card and hover over a destination vote button: configured names should resolve without changing counts or moving cards.
2. In the configured pilot group, send `Nice spot near the river https://example.com/stay`. Check one live note containing the comment and named attribution, placed near existing content without overlap. With acknowledgments explicitly enabled, expect one short group acknowledgment.
3. Send `Another place to try bomb.com` and `i vote for Porto github.com/username` (put any extra comment on another line). Check HTTPS normalization and that the mixed message also preserves Porto voting. Two testers sending links close together should get different free slots.
4. Send an ordinary sentence containing an email address or `3.14`: it must create no card or acknowledgment. If followed immediately by an unrelated URL, wait over six seconds to avoid satisfying the documented split-message heuristic.
5. Restart only the relay with the same directory. Existing cards, names, counts and coordinates should remain. Use the signed sample verifier for an actual duplicate-delivery test; sending the text again from iMessage produces a new provider ID.
6. If a fresh comment is still missing, run the structural diagnostic above after sending one new comment-and-URL message. Compare ID adjacency and timing; do not paste raw provider payloads or credentials into logs.

All automated regression and browser tests use fictional credentials and mocked sends. Preparing this polish does not restart the live relay or send real group messages. A fresh real group test remains an operator step.


## Wanda native iMessage polls (explicit opt-in)

Send this command in the configured iMessage group. Both literal `@Wanda` and the observed native-mention plain-text form `Wanda` are accepted as leading addresses. Matching is case-insensitive; parsing is mechanical, with no AI call:

```text
@Wanda poll Where should we go? | Lisbon | Porto
```

Question and options are trimmed and split on `|`. This command requires a nonempty question, up to 300 Unicode characters, and 2–12 nonempty options of at most 150 characters each, different ignoring case. Pipes cannot be escaped inside a question/option. These limits follow the current [ZeroSettle Polls reference](https://portal.zerosettle.io/docs.md) (the provider permits an omitted question, but this command syntax requires one). An invalid command creates no card or destination vote; it schedules one short usage explanation to the originating group. The poll command is intercepted before ordinary destination votes, link recognition and comment correlation, including when its options contain URLs.

### Configuration

Keep all existing private key, signing secret, group, tester, display-name and trip settings. Add this **server-only** setting when ready to activate after review:

```bash
export ZEROSETTLE_POLLS=1
```

It defaults to disabled and is independent of `ZEROSETTLE_ACKNOWLEDGMENTS`. The latter continues to control link acknowledgments only; the poll setting enables native sends and usage/failure explanations in response to explicit poll commands. An enabled feature requires the existing `ZEROSETTLE_API_KEY`. No additional credentials or webhook subscription are needed: the already-registered webhook receives `poll.voted`. Do not re-register merely to enable polls, since that rotates the signing secret.

Fallback board links default to the public HTTPS origin of `ZEROSETTLE_WEBHOOK_URL`. Optionally set a stable public **origin**, without a path, query or fragment:

```bash
export ZEROSETTLE_BOARD_BASE_URL='https://YOUR-PUBLIC-HOST'
```

Loopback/LAN/IP/`.local` addresses and non-HTTPS URLs are excluded from group replies. With no usable origin, a failure reply says the poll is saved on the Wander board without offering a broken phone link. The normal local board URL stays `http://127.0.0.1:1241/t/pilot-lisbon-demo` for the operator's Mac.

### Canvas and native vote semantics

The command saves an ordinary `vote` widget using the existing compact placement helper, with the original question/options and stable canvas option IDs. It saves its inbound command receipt, immutable original poll definition and pending send job in the same Yjs transaction, then flushes to the existing persistent directory before returning 200. The board receives this update through its normal WebSocket; no reload/navigation is triggered. `meta.destinationPollId` stays unchanged: `I vote for Lisbon` / `I vote for Porto` still target the isolated destination poll, not the newly created native poll.

A confirmed send stores its provider message ID, GUID (when supplied) and provider-option-ID → canvas-option-ID mapping. The native request is exactly `POST /api/imessage/send` with `{chat_id, poll: {question, options}}`; no `text` field is mixed into it. The canvas displays pending/sending, accepted, failed/unavailable or unconfirmed status. Accepted means the line accepted the send, not confirmed delivery to every phone.

A signed `poll.voted` event must be inbound/received, `kind: poll_vote`, in the configured group, from an allowlisted normalized handle, and target a known provider poll ID/GUID. It requires a positive provider message ID, valid millisecond timestamp and a full `vote.option_ids` array. Unknown options never modify a card. The adapter ignores aggregate `poll.voters`/counts for counting: those could include unauthorized group members. It applies only the authenticated event actor's full selection using the same stable hashed tester ID and member display name as the existing pilot.

Native polls are **multi-select**. Selecting two options adds that participant to both; changing a selection removes their old mirrored selections and applies the new complete set; `[]` removes them from every mapped option. A per-poll/per-participant timestamp and numeric message-ID tiebreaker prevents stale deliveries from overwriting a newer state. Receipts are keyed by `zerosettle.poll.voted.<message.id>`; command receipts retain `zerosettle.message.received.<message.id>`. Replays never increment counts twice.

Canvas edits remain enabled. Text, position, dimensions, additional local options and votes cast by browser sessions remain usable; iMessage updates do not restore removed cards/options or overwrite their labels. Stable option IDs allow native votes to continue mapping after a canvas label edit. Structural edits/options added in Messages are outside this milestone; unrecognized provider option IDs are ignored rather than applied to another option.

**One-way mirroring:** the current provider reference documents sending polls, reading results and receiving `poll.voted`, but no API to cast/change/remove a participant's native vote or edit a sent poll. Wander does not invent one. Canvas votes, option edits and question edits stay local to the board; they are not sent back into the native poll. Browser guest identities are independent of phone identities, so a tester who also votes through a guest session can appear as an additional canvas voter.

### Failures, ordering and persistent delivery state

`pilotNativePolls` stores the command-to-canvas/provider mapping. `pilotPollDeliveries` stores durable native-poll and text-reply jobs. Both reuse the existing trip document and atomic disk save. The poll and link-acknowledgment queues share the same delivery-claim implementation and uncertainty policy:

- Pending work that has never been claimed resumes on restart when polls are enabled.
- A job is changed to `sending` and saved **before** its one outbound attempt. A failed claim save causes no network send.
- Confirmed responses become `sent`; definitive 4xx refusals (except 408) become `failed`. Network errors, 5xx, timeouts and malformed/unconfirmed responses become `uncertain`.
- A saved `sending` claim loaded after restart becomes `uncertain`. Neither failed nor uncertain jobs are automatically resent. A new iMessage command is a new provider message and creates a new poll, so do not use it to retry an uncertain delivery blindly.
- A definitive native-send failure schedules at most one durable text explanation. For `409 poll_unsupported`, it says the line cannot send native polls yet, with the usable public board-poll link when configured. Other failures say the native poll could not be sent. The canvas poll remains usable. Reply failures/uncertainty are also persisted and never retried automatically.

The current reference documents no idempotency key for poll/text sends. A crash immediately after a claim can lose a native send; a timeout may mean it was sent. This is **at most one automatic attempt**, not a guarantee of exactly one delivered native poll/reply. No code claims a native poll was sent after a refusal or uncertain result. Outbound `message.sent` / `message.failed` webhooks remain ignored to prevent loops; displayed accepted status reflects the send response, not later per-phone delivery.

If a successful send response lacks its option identifiers, the worker makes one read-only `GET /api/imessage/messages/{id}/poll` lookup, never another POST. If that lookup also fails, it retains the known accepted ID with unconfirmed mapping status; a later authorized signed vote with a matching target and valid full poll snapshot can recover the mapping. If the send response is lost before any provider ID is known, automatic association cannot safely guess which poll it was: inspect provider history before operator reconciliation. The code does not associate an unknown poll merely because its question/options look similar.

Votes racing an in-flight send response are persisted temporarily, then applied when the exact provider mapping becomes known. This buffer is capped at 128 entries, retained for up to ten minutes, and pruned on new events/mapping completion. Normal per-participant versions still prevent out-of-order buffered updates. Unknown polls without an in-flight send or known accepted ID record no canvas changes. These guarantees assume one relay and retained writable data, as with the existing pilot.

Inspect saved status without printing credentials, inbound text, option text or participant handles:

```bash
PILOT_DATA_DIR=./data/zerosettle-pilot node scripts/inspect-pilot-polls.mjs
```

### Automated verification (no real native sends)

```bash
npm test
npm run build
npm run lint
node scripts/verify-zerosettle-polls.mjs
node scripts/verify-zerosettle-links.mjs
```

The poll Chromium verifier starts an isolated temporary relay on port 1248 with `PILOT_ZEROSETTLE_POLL_SAMPLES=1`. That mode overrides credentials/configuration with fictional values and injects a mocked provider transport. The open browser shows one canvas poll, two participants with selections `[2,1]`, then `[1,1]` after a change and `[0,1]` after a removal; it also checks a browser vote/edit, stale events, invalid signature, zero navigation and replay after a real relay-process restart. It expects exactly one mocked native send. Screenshot: `/tmp/wander-zerosettle-polls-verified.png`. This proves the relay/canvas integration, not Apple's native rendering or real-phone webhook behavior.

Regression tests cover provider parsing boundaries, duplicate commands, changed/removed/multi-select votes, stable identities, signature/group/tester restrictions, unknown polls/options, mapping races, pending/unconfirmed restart recovery, persistence failures, unsupported-line fallback, failed/uncertain sends/replies and existing link/destination behavior.

### Live acceptance, triggered by the operator

1. Confirm testers have **iOS 26 or later** and native Messages poll support. The provider says older iOS versions display “Sent a poll” and cannot vote. Real-phone support on the current ZeroSettle line has **not** been verified by automated tests. The line may require a provider update (`409 poll_unsupported`), and attachment/poll sends may be refused until recipients have replied (`403 attachment_before_reply`).
2. After review, stop only the identified pilot relay. Keep the existing tunnel and reuse the existing data directory/private settings. Start the updated relay:

```bash
unset PILOT_ZEROSETTLE_PLANNING_SAMPLES PILOT_ZEROSETTLE_LIST_SAMPLES PILOT_ZEROSETTLE_POLL_SAMPLES PILOT_ZEROSETTLE_LINK_SAMPLES PILOT_ZEROSETTLE_SAMPLES PILOT_TWILIO_SAMPLES
unset ZEROSETTLE_WEBHOOK_SECRET
export ZEROSETTLE_ENABLED=1
export ZEROSETTLE_POLLS=1
export ZEROSETTLE_ACKNOWLEDGMENTS=1
export PILOT_PORT=1241
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
export LOCAL_TEST_MESSAGES=0
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
npm run build
node server/pilot-demo.mjs
```

3. Open the existing board locally and refresh once to load the updated UI, then leave it open. Check the registered webhook/tunnel as in earlier sections (`node scripts/zerosettle.mjs line`); a matching working tunnel needs no registration change.
4. In the **configured pilot group**, an authorized tester sends `@Wanda poll Where should we go? | Lisbon | Porto`. Expect one matching live canvas poll and one native poll. ZeroSettle sends the question as a **separate text** because iOS does not draw a question on the poll itself. That extra question message is expected, counts toward provider limits, and can fail independently while the poll still stands. Wander does not send an additional success acknowledgment.
5. Have two authorized testers select Lisbon in the native poll. Check the new canvas poll reaches two Lisbon votes without refresh; the original destination poll should not change. Have one tester also select Porto: both selections must count. Have them deselect Lisbon, then remove all selections: the matching counts must fall correctly. Hover vote counts to see configured names.
6. Test a malformed command once (for example `@Wanda poll Question | Only one option`): expect one short usage explanation, no canvas poll and no destination vote. Confirm ordinary `I vote for Porto` and a link share still work independently.
7. If native send fails, inspect the canvas delivery label and local status helper. On an unsupported line, expect an explicit explanation and board link where configured. Do not treat this fallback as a passed native-phone acceptance test. Do not blindly resend on `uncertain`.
8. Restart only the relay with the same directory and flags; mapping, selections and delivery records should survive. Use the signed automated verifier for true replay tests. A second identical iMessage from a person is a new provider ID and legitimately creates another poll.

No real command, native poll, usage reply or fallback message was sent during preparation. The live relay and private poll-enable setting are unchanged until the operator chooses to activate this milestone.


## Wanda checklist actions (explicit opt-in)

These commands edit Wander's existing **checklist/list widget**, not a native Messages checklist. They are deterministic, case-insensitive and make no AI calls:

```text
@Wanda list Packing | Passport | Charger | Sunscreen
@Wanda add to Packing | Water bottle | Sunglasses
@Wanda done Packing | Passport
@Wanda undo Packing | Passport
```

### Addressing and validation

Current authorized provider history contains both leading `Wanda poll…` and `@Wanda poll…` records, with no mention/attributed-text fields. The adapter accepts that observed native-style **bare `Wanda` prefix**, as well as literal `@Wanda`. The shared address helper also accepts both forms for polls. Only an exact leading name followed by whitespace qualifies; `Wander`, another person's mention, or an address in the middle of a sentence does not qualify. The provider's plain text does not prove whether a user tapped a native mention or typed the name, so both are treated alike. Other mention encodings are not guessed. Send literal `@Wanda` if a future provider/device renders a mention differently.

List titles and item text are trimmed; lookup also collapses internal whitespace and ignores case. Content remains plain text: URLs and vote/poll-looking item text are not fetched, executed, saved as separate notes or dispatched to another command handler. Recognized malformed/disabled list commands are intercepted before destination votes, poll commands, link extraction and comment correlation.

The pilot limits are **80 Unicode characters per title**, **200 per item**, **1–20 items per create/add command**, **100 items per list when adding through chat**, and **4,000 characters per entire command**, consistent with the provider's documented text-send limit. Fields are single-line; use pipes as separators. Completion/undo takes exactly one item. Empty fields, repeated items in a single request and exceeded limits produce a short explanation and one relevant next step; no partial mutation occurs on those errors. Pipe characters cannot be escaped inside a title/item. Browser editing retains its existing behavior; if a manually edited list already exceeds the chat limit, reduce it on the board before adding through chat.

### Matching and responses

- Create replies `Created Packing with 3 items.` A case-insensitively matching existing title creates nothing and asks the tester to choose a different name.
- Add keeps all original item IDs, text, checks, widget position and dimensions. It appends only missing items. Already-present items are explicitly reported; large duplicate summaries name the first three and count the rest. An all-duplicate request makes no change.
- Done sets `checks["<listId>|<itemId>"] = true`; undo sets it false. These are **set operations**, not toggles. Repeating completion leaves it complete and replies that it is already complete. Undo behaves symmetrically.
- Multiple matching list titles or item labels prompt clarification/renaming on the board, with no item/completion change. Missing lists and missing items are explained separately, with one relevant next step. No fuzzy or AI matching chooses between them. For example, a missing item replies “I couldn’t find ‘SPF 50’ in Packing. To add it:” followed by `@Wanda add to Packing | SPF 50` on a new line. A missing list replies “I couldn’t find a list called Packing. Check the list name.” Generic unrelated examples are not appended.

A new list records its creator's stable hashed sender ID and display name in `source`, and the card resolves current names through shared members. Mutating actions add the same stable identity and name to the normal trip activity feed. Existing private `ZEROSETTLE_TESTER_NAMES` and normalized-handle fallback rules apply. Replies are brief group text messages, one durable reply job per provider command, including validation/ambiguity replies; they are not native checklist UI.

### Shared state, legacy lists and concurrency

The normal `widgets` map retains each checklist's ID, title, coordinates, dimensions, source and original `items` import snapshot. Existing seeded/persisted lists already have persistent item IDs; these are retained, as are their existing `checks` keys. For older data missing IDs, migration assigns deterministic `legacy_<index>` IDs once (avoiding collisions), saves them in the same document, and reuses them on restart. An existing check with an identifiable ID is preserved; no completion is guessed for malformed historical rows whose ID was absent/ambiguous.

To keep a chat append from replacing a browser edit's entire widget array, the updated browser and relay share granular Yjs structures: `checklistItems` holds each item by `<listId>|<itemId>`, `checklistOrder:<listId>` is a shared Y.Array of IDs, and `checklistModels` marks migrated lists. Both use `checklistItems(doc, widget)` to resolve live items rather than reading the old import snapshot. Completion remains in the existing `checks` map. This is still the same trip document, WebSocket and disk persistence, not a second store.

Independent item edits, browser additions/removals, chat additions and completion updates merge without replacing unrelated items or widget positions/titles. Changes to the **same** item text or checkbox still follow Yjs last-writer-wins semantics; chat commands run in relay arrival order. Simultaneous independent additions of the same text can legitimately leave two separately identified items; a later name-based command then asks for clarification. There is no automatic guessing or duplicate deletion across concurrent users.

Migration runs when persisted rooms load and when an imported/new checklist is first edited. Snapshot replacement and normal widget deletion clear the granular state too, so old items do not reappear. **Refresh open board tabs once after activating this update**: older frontend code writes the import array and does not understand the granular model. New lists use the shared compact placement helper, which reads current item counts. Adding rows preserves widget coordinates; a growing list can eventually need manual resize/repositioning, as with normal canvas editing.

### Configuration and reply guarantees

The new server-only feature flag defaults to off:

```bash
export ZEROSETTLE_LISTS=1
```

Keep the existing API key, signing secret, trip/group allowlist, testers, display names, `ZEROSETTLE_POLLS` and `ZEROSETTLE_ACKNOWLEDGMENTS` settings. Enabling lists explicitly authorizes their command replies and requires the existing API key. It is independent of the link acknowledgment flag; disabling link acknowledgments does not disable list replies. No additional registration or credentials are needed. Native poll and destination-vote behavior is preserved.

The mutation, `pilotMessageReceipts["zerosettle.message.received.<message.id>"]`, named activity entry and `pilotListDeliveries` pending reply are saved in one transaction, then flushed before returning success. The reply worker uses the existing shared delivery queue and text transport. Before sending, it persists `pending → sending`; confirmed acceptance becomes `sent`, definitive 4xx (except 408) becomes `failed`, and timeout/network/5xx/unconfirmed outcomes become `uncertain`. Pending unclaimed jobs resume on restart. A loaded sending claim becomes uncertain and is **never** automatically resent. A failed claim save sends nothing. Failed/uncertain replies leave the completed board mutation intact.

Replaying the same provider event creates no new list/item/activity and sends no additional reply. It does not reapply a historical done after a later undo, overwrite later browser edits, or recreate a deleted list. A new human message is a new provider ID: it gets its own result/reply, but duplicate list titles/items and already-complete/incomplete checks remain logically idempotent.

The provider does not document text-send idempotency. This remains **at most one automatic attempt per reply**, not exactly-once delivery: a crash after the saved claim may lose a reply, while a timeout may already have sent it. No automatic retry is safe in that uncertain case. Signed webhook retries continue to save receipts before returning success; storage failure returns retryable 503. All existing signature/group/tester restrictions and outbound-event loop prevention apply.

Inspect only local status metadata (no credentials, commands, replies or tester handles):

```bash
PILOT_DATA_DIR=./data/zerosettle-pilot node scripts/inspect-pilot-lists.mjs
```

### Local automated acceptance (mock replies only)

```bash
npm test
npm run build
npm run lint
node scripts/verify-zerosettle-lists.mjs
node scripts/verify-zerosettle-polls.mjs
node scripts/verify-zerosettle-links.mjs
```

The list browser verifier uses temporary data and a sample-only relay on port **1250**, with `PILOT_ZEROSETTLE_LIST_SAMPLES=1` and a mocked provider transport. It creates a rendered list from the bare-name/native-style address, adds items, completes and undoes them, makes real browser title/item/addition edits, then sends a chat command using those new names. It verifies seven final items, one checklist, no URL note capture, named attribution, one mocked reply per command and no extra replies/mutations after process restart and replay, all without navigating or refreshing. Screenshot: `/tmp/wander-zerosettle-lists-verified.png`. This is automated relay/canvas verification, not a real-phone send test.

Regression tests cover parsing/limits, ambiguity, missing/existing matches, old persisted lists and IDs, authorization/signatures/outbound events, replay after restart, delivery failures, pending/in-flight replies, browser edits followed by chat, and concurrent disconnected Yjs replicas.

### Concise live-phone test (operator triggers messages)

After review, restart only the pilot relay with the same directory/private settings and add `ZEROSETTLE_LISTS=1`. Preserve the working tunnel, polls and acknowledgment flags. Ensure all sample modes are unset:

```bash
unset PILOT_ZEROSETTLE_PLANNING_SAMPLES PILOT_ZEROSETTLE_LIST_SAMPLES PILOT_ZEROSETTLE_POLL_SAMPLES PILOT_ZEROSETTLE_LINK_SAMPLES PILOT_ZEROSETTLE_SAMPLES PILOT_TWILIO_SAMPLES
unset ZEROSETTLE_WEBHOOK_SECRET
export ZEROSETTLE_ENABLED=1
export ZEROSETTLE_LISTS=1
export ZEROSETTLE_POLLS=1
export ZEROSETTLE_ACKNOWLEDGMENTS=1
export PILOT_PORT=1241
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
export LOCAL_TEST_MESSAGES=0
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
npm run build
node server/pilot-demo.mjs
```

1. Open `http://127.0.0.1:1241/t/pilot-lisbon-demo`, refresh once for the updated checklist model, then leave it open. Choose a unique title if Packing already exists.
2. An authorized tester sends the four example commands at the start of this section, one at a time, in the configured group. Expect one named list with three items, then five; Passport becomes checked, then unchecked, without refresh. Each command gets one short group reply.
3. Use the native Messages mention for Wanda on one command and literal `@Wanda` on another. If the device/provider no longer flattens the mention to leading `Wanda`, use the literal form and collect structural diagnostics before adding another encoding.
4. On the board, rename Packing to Travel kit and Charger to USB-C charger. Send `@Wanda done Travel kit | USB-C charger`. It must update the existing item, retaining other checks and the list position.
5. Send `@Wanda add to Travel kit | USB-C charger | https://example.com/map`. Expect one addition and an already-present explanation; the URL remains a plain checklist item, with no new note card.
6. Repeat completion as a **new** message: expect “already complete,” without toggling. Test a missing item, a duplicate create title and duplicate item labels to confirm specific explanations/clarification with no unwanted changes.
7. Restart only the relay with the same directory/settings and confirm data survives. Use the automated signed verifier for actual webhook replay testing; re-sending an iMessage manually is a new provider event and should receive its own reply.

Preparing this milestone leaves the real private list flag off/unset and does not restart the live pilot, register webhooks, send real replies, commit or deploy. Real-phone checklist verification remains an operator step.


## Personal budget preferences and saved places (separate opt-ins)

These features use the same configured trip, normalized tester identities/display names, raw-body signature verification and group/tester allowlists. Both accept literal `@Wanda` and the observed leading native-mention text `Wanda`, case-insensitively. Parsing is mechanical, with no AI. Recognized commands are intercepted even when disabled, so a place-command URL cannot also create a link-note card.

### Flags and service settings

Keep the existing private settings. Flags default to disabled in source configuration; preparing these changes does not alter the running pilot:

```dotenv
ZEROSETTLE_BUDGETS=1
ZEROSETTLE_PLACES=1
ZEROSETTLE_GEOCODER_ENABLED=1
ZEROSETTLE_GEOCODER_URL=https://photon.komoot.io/api
ZEROSETTLE_GEOCODER_INTERVAL_MS=1100
ZEROSETTLE_GEOCODER_DAILY_LIMIT=50
ZEROSETTLE_GEOCODER_USER_AGENT="WanderPilot/1.0 (small trip pilot)"
```

Budgets and places have independent flags. Geocoding is a separate opt-in: places still save unresolved map links and coordinate confirmations without it. Existing `ZEROSETTLE_ACKNOWLEDGMENTS` continues to control ordinary link acknowledgments; enabling either new feature enables its own command replies. The existing server-only ZeroSettle API key is sufficient; no new credentials are required. Settings can go in the ignored `.env.zerosettle.local` or server environment, never `VITE_*`. No registration change is needed while the registered HTTPS callback still works.

**Free geocoder:** [Photon's public demo policy](https://github.com/komoot/photon#demo-server) permits reasonable project usage, may throttle/ban extensive use, and provides no availability guarantee. Its [API reference](https://github.com/komoot/photon/blob/master/docs/api-v1.md) defines forward search and GeoJSON results. Wander uses user-triggered server lookups only: one serial worker, at least one second between network requests (default 1.1s), at most 50/day by default (configurable 1–100), and at most 20 active pending submissions. No autocomplete, periodic search, scraping or bulk place collection is implemented. Only one pilot relay should use this cache/rate budget. For larger use, select a suitable hosted/self-hosted Photon-compatible endpoint through the server setting.

Queries are sent to that external service when geocoding is enabled, so do not submit confidential addresses. The endpoint is operator-configured HTTPS, without credentials/query/fragment; inbound URLs never determine the fetch destination. Requests identify Wander, disallow redirects, time out after five seconds and read at most 64 KiB. Search returns at most three validated candidates. Results (including no-match results) are cached in the persistent trip document for seven days, capped at 200 query keys. Endpoint changes use separate cache keys. Rate/day counters persist across restart, and failed attempts count toward the cap. Requests interrupted by restart may safely repeat the **read-only lookup**; failed lookups are not automatically hammered/retried. A fresh explicit name command can retry an unresolved request.

Photon results use OpenStreetMap data. Candidate replies and the saved-place card display [© OpenStreetMap contributors / ODbL attribution](https://www.openstreetmap.org/copyright). Attribution must remain visible when reusing/exporting these results. No geocoder API token is sent to the browser or mixed with the ZeroSettle bearer token.

### Budget commands and meaning

```text
@Wanda budget USD 600 per person
@Wanda budget summary
@Wanda budget clear
```

A submission sets that tester's **personal total-trip preference**, replacing their previous amount/currency. Explicit currency and `per person` are required; per-day values, symbols without codes, commas, negative amounts, scientific notation and excess decimal digits are rejected with one relevant example. Zero is a known submitted preference, distinct from unknown. Clear removes only the authenticated sender's preference. Summary returns the sender’s current amount plus a count of other missing responses, for example “Your budget is USD 750.50 per person. Waiting on 2 others.” It avoids phone-number lists; it does not infer that this roster is the entire iMessage group.

Supported codes follow [SIX's ISO 4217 minor-unit list](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml): USD, EUR, GBP, CAD, AUD, NZD, CHF, CNY and INR have two decimals; JPY/KRW have zero; KWD/BHD/OMR have three. Amounts are parsed from digit strings using integer arithmetic and stored as safe integer minor units. No floating-point multiplication/rounding, FX conversion or currency replacement occurs. Currency code casing is normalized to uppercase; the submitted currency is retained. The maximum is 999,999,999 major units plus that currency's fractional precision.

The dedicated **Personal budgets** view renders `budgetPreferences` and `pilotRoster` directly inside a `budget` widget with `purpose: preferences`. It shows each configured tester’s name, amount/currency or “Waiting for a response”. Ranges appear only for currencies with distinct submitted amounts; a single amount is not repeated as a range. `pilotRoster` contains configured testers only; browser guests are not silently added. `budgetPreferences` is keyed by the same stable `zs-…` sender ID used for votes. It is separate from `meta.budget`, expenses, settlement and legacy spending widgets, which remain untouched. The normal spending widget/full budget page still means agreed budget and actual expenses, not personal preferences.

Expand **Edit preferences** to use the preference card's browser form edits the same Yjs entries as chat. This prototype's trusted board editors can select any pilot tester; chat can set/clear only its authenticated sender. Independent testers' edits merge; simultaneous edits to the same tester are one atomic currency/amount record with normal Yjs conflict resolution. A later summary sees browser changes. Repeated submissions update the existing preference/card rather than adding cards. New personal-budget cards default to 360×336px; saved-place cards to 360×456px. Old pilot defaults (600/620px tall with no explicit width or user-resize marker) compact on load without moving cards. Custom dimensions and marked user resizes are preserved. Older untagged cards are repaired only when saved pilot-command receipts prove their feature, never by guessing from ledger amounts. Legacy spending cards are explicitly titled **Expenses**. Open tabs must refresh once after the rebuilt UI is activated; subsequent budget/place updates are live, without refreshing.

### Places, pending choices and confirmations

```text
@Wanda place Pike Place Market, Seattle
@Wanda place https://www.google.com/maps/search/?api=1&query=47.609,-122.342
@Wanda place https://maps.app.goo.gl/YOUR_SHARED_LINK
@Wanda places
@Wanda remove place Pike Place Market, Seattle
```

Typed place names are limited to 200 characters; place commands to 2,500, and map URLs to 2,000. A typed submission is saved immediately as a pending request and looked up outside the webhook response path. A reply contains up to three concise choices:

```text
Which place did you mean?
1. Pike Place Market — Seattle
2. Matt’s in the Market — Seattle
3. Pike Place Fish Market — Seattle
Reply to this message with 1, 2, 3.
```

These are examples, not guaranteed search results. In Messages, **reply directly to Wanda’s actual choices message** with its number. Alternatively, send `@Wanda choose 1` when you have exactly one active lookup in this group. Several active lookups require a direct reply; Wanda never guesses. Ordinary unthreaded numbers are conversation and do not confirm places. Internal pending IDs, raw coordinates, full result addresses and repeated command examples are omitted from choice replies and the normal card view.

The [ZeroSettle reply reference](https://portal.zerosettle.io/docs.md) documents inbound `message.reply_to: {id, guid, text}`. Wander matches only `id`/`guid` against the **persisted successful outbound choice delivery**, then resolves its saved request; quoted text is not trusted. Sender/group ownership and 30-minute expiry are checked again before saving. A different tester cannot select your result. Outbound IDs/GUIDs and pending requests survive restart. If a send is uncertain and no reply target was saved, the singleton `@Wanda choose 1` fallback still works; no automatic send retry occurs. Even one result requires explicit selection. Expiry is not extended by webhook retries. No-match/provider failures retain a pending record and a specific status. There is no pin until valid coordinates are confirmed. Active pending records are capped at 20; history at 200, pruning terminal entries first. Older ID-based confirmation commands remain backward compatible for already-issued messages, but new replies do not expose them.

Confirmation saves a stable `sp_…` place ID and explicit latitude/longitude. The collection is capped at 100 places. Same-source OSM result IDs deduplicate confirmed pins; distinct OSM objects with similar names remain distinct. Exact repeat URLs deduplicate by normalized URL. Repeating an active name request reuses the request instead of spawning another lookup; a fresh name request after confirmation uses the cache and asks again, allowing a different candidate, while confirming the same result creates no duplicate pin. Browser label changes are retained on duplicate saves. Successful selection replies briefly: “Added Pike Place Market to the map.”

### Map URL reliability and unresolved links

The parser accepts HTTPS links on exact Google Maps hosts/paths: `google.com/maps`, `www.google.com/maps`, `maps.google.com`, `maps.app.goo.gl`, and `goo.gl/maps/`. Credentials, custom ports, unrelated/lookalike hosts and unsupported schemes are rejected. **No redirects are followed and no submitted URL is fetched.** Short links remain unresolved links.

Coordinates are extracted only from the documented [Maps URLs search format](https://developers.google.com/maps/documentation/urls/get-started): `/maps/search/?api=1&query=latitude,longitude`, with no overriding `query_place_id`. Latitude must be within −90…90, longitude −180…180, both finite. Viewport `@lat,lon` camera centers, directions, opaque paths and place IDs are not treated as reliable pin coordinates. Coordinate-bearing URLs also require requester confirmation before saving a pin.

Other accepted map links save as labeled **location unknown** records with a usable **Open saved map link**, not guessed pins. To add a pin, submit the place name and city with `@Wanda place …` and select the result. The advanced legacy `@Wanda locate place <saved ID> | latitude,longitude` command still works, preserving a saved link’s URL/browser label after explicit selection; it is no longer promoted in normal replies.

### Split map-link delivery

Read-only sanitized provider history confirmed a native-mention map command in one inbound text record and its URL in another **5.6 seconds later**, with an outbound Wanda reply between their numeric IDs. The URL was in `message.text`; there was no media attachment or `reply_to`. Explicit `@Wanda place` without a URL now saves a bounded request and asks “Please reply to this message with the map link.” It cannot become an ordinary comment/note.

A following URL-only Google Maps event is associated with that request only for the same authorized sender/group, increasing provider IDs, provider timestamps at most **6 seconds apart**, and adjacent **observed inbound messages from that sender**. This reuses the existing correlation window/retention helpers; unlike ordinary prose/link correlation, explicit map commands allow intervening provider IDs occupied by outbound replies. Other inbound conversation from that sender blocks heuristic pairing. A direct `reply_to` targeting the missing-link command or Wanda’s saved reply also works within the retention period. Both webhook arrival orders work, including a relay restart between events. Fragments/sequence records are durable, capped at 128 and retained for **60 seconds**; a fragment is consumed once. Provider message IDs remain replay keys.

A standalone URL-only Google Maps message is held for up to **60 seconds** to allow the command to arrive first or late. If no command pairs, it follows the ordinary link-note/acknowledgment path once, retaining a bounded split comment where available. Inline comment+URL shares and unrelated URLs still save immediately. A paired attachment creates a saved-place record/confirmation, never a separate note. Missing-link and completed-save replies belong to distinct inbound messages; each has its own saved send claim.

This is deliberately bounded correlation, not perfect reconstruction: missing/incorrect timestamps, delayed deliveries beyond a minute, or unrelated messages arriving after an already accepted pair can defeat the heuristic. If a link is not associated, resend the **complete** `@Wanda place <URL>` command, or directly reply with the link within a minute. No URL is fetched and no redirect is followed.

`@Wanda places` lists current labels and confirmed/unknown status without a long ID list. Removal accepts an exact ID, case-insensitive whitespace-normalized label, or the original submitted name until a browser editor renames the label. Multiple matching removal labels require choosing a stable saved ID; nothing is removed on an ambiguous name. The browser supports label edits and removal using the same shared maps, so subsequent chat commands see those edits.

### Rendering, shared storage and persistence

The collection reuses the existing `map` widget in `purpose: saved-places` mode, with one summary card per trip. Confirmed points use Wander's existing keyless Google iframe renderer with explicit coordinates; supplied URLs are never embedded as trusted iframe sources. Google branding/attribution remains within that frame. The card displays saved labels, named attribution, location status and Google Maps location links; unresolved records offer the validated original link. Existing persisted labels and coordinates use these same maps, without re-submission. Pending lookups, selection waiting and unavailable/no-match lookups have explicit visible states. The map shows a loading indicator, timeout/error text when observable, and a permanent named preview/fallback status above the iframe, since cross-origin iframe load events cannot prove Google rendered a usable map. Browser label edits use `savedPlaceLabels`, confirmed coordinates use `placeLocations`, and membership/source uses `savedPlaces`; independent edits do not replace a whole collection array. A concurrent location update cannot recreate membership deleted by the browser. Legacy free-text maps remain unchanged.

No paid map dependency or new key was added. The legacy keyless iframe is best-effort and **live map rendering has not been verified by the mocked browser check**. If Google/browser policies block that frame, saved links/coordinates still work. The supported official [Maps Embed API](https://developers.google.com/maps/documentation/embed/get-started) currently requires a Google Cloud Maps Embed API key even though usage is listed as free; that migration is not configured here, and no secret is injected into a frontend URL. A separate JavaScript multi-pin map SDK is not installed: the card selects one confirmed pin at a time and keeps the full saved collection visible.

Budget/place mutations, provider-ID replay receipts and pending reply jobs are saved atomically in the existing Yjs document and flushed before success. Typed-place work adds `pendingPlaces` and `pilotPlaceLookups` records before background lookup. Final candidates/results and the one final reply job are persisted together. All cards and updates arrive through the ordinary board WebSocket with no refresh/navigation; normal compact placement is used for new cards, and existing positions stay put. Separate metadata fields preserve unrelated browser edits. Conflicting edits to the same label/preference use normal Yjs semantics. A deliberate trip wipe clears these feature maps and work; ordinary legacy data is not reset or migrated into guessed values.

`pilotBudgetDeliveries` and `pilotPlaceDeliveries` reuse the current saved-claim text delivery implementation: pending unclaimed replies resume, a claim is saved before sending, and loaded sending jobs become uncertain. Failed/uncertain sends are **never automatically repeated**. Provider retries return saved outcomes, not repeated preferences/pins/replies, even after restart or subsequent browser edits/removal. This remains at most one automatic send attempt, not guaranteed exactly-once delivery; a timeout may already have sent, and a crash immediately after the claim can lose a reply. Only read-only geocoding can safely resume/repeat after an interrupted request.

Inspect local status without printing credentials, amounts, labels, raw commands, URLs or handles:

```bash
PILOT_DATA_DIR=./data/zerosettle-pilot node scripts/inspect-pilot-planning.mjs
```

### Automated verification and exact commands

```bash
npm test
npm run build
npm run lint
node scripts/verify-zerosettle-planning.mjs
node scripts/verify-zerosettle-polls.mjs
node scripts/verify-zerosettle-lists.mjs
node scripts/verify-zerosettle-links.mjs
```

The planning browser check uses port **1252**, an isolated temporary directory and `PILOT_ZEROSETTLE_PLANNING_SAMPLES=1`. ZeroSettle replies, Photon responses and the external map frame are mocked; no real outbound messages or place queries are sent. It begins with actual persisted pilot cards/preferences/coordinates, then asserts **visible** participant names, currency amounts, waiting responses, labels and mocked iframe content plus its exact coordinate source. It checks budget update/clear, browser edits read by chat, compact default dimensions, real resize-handle preservation across restart, short reply-bound choices/owner checks, unresolved usable links, split map events across restart, explicit external-map failure fallback, and no extra cards/replies after replay. Zero browser navigations occur during chat updates. Screenshots: `/tmp/wander-zerosettle-planning-visible.png` (mock map content) and `/tmp/wander-zerosettle-planning-verified.png` (visible fallback). Native phone delivery, geocoder accuracy/availability and real iframe rendering remain unverified.

Regression coverage also includes exact monetary precision, invalid inputs, sender-only clear, currency ranges, unknown roster members, lookup caps/cache/response bounds, ambiguity, confirmation expiry, duplicate links/pins, invalid coordinates/URLs, provider failures, authorization/signatures, persistence failure, interrupted reads/sends, legacy budget/map records and concurrent Yjs edits. Existing poll/list/link verifiers remain separate regressions.

### Live phone test after review

Keep the existing private settings and persistent directory. After reviewing these changes, stop only the identified pilot relay, preserve a working tunnel, and start with:

```bash
unset PILOT_ZEROSETTLE_PLANNING_SAMPLES PILOT_ZEROSETTLE_LIST_SAMPLES PILOT_ZEROSETTLE_POLL_SAMPLES PILOT_ZEROSETTLE_LINK_SAMPLES PILOT_ZEROSETTLE_SAMPLES PILOT_TWILIO_SAMPLES
unset ZEROSETTLE_WEBHOOK_SECRET
export ZEROSETTLE_ENABLED=1
export ZEROSETTLE_BUDGETS=1
export ZEROSETTLE_PLACES=1
export ZEROSETTLE_GEOCODER_ENABLED=1
export ZEROSETTLE_GEOCODER_URL=https://photon.komoot.io/api
export ZEROSETTLE_LISTS=1
export ZEROSETTLE_POLLS=1
export ZEROSETTLE_ACKNOWLEDGMENTS=1
export PILOT_PORT=1241
export PILOT_DATA_DIR="$PWD/data/zerosettle-pilot"
export LOCAL_TEST_MESSAGES=0
export TWILIO_SMS_ENABLED=0
export TWILIO_CONVERSATIONS_ENABLED=0
npm run build
node server/pilot-demo.mjs
```

1. Check the tunnel/registered callback with `node scripts/zerosettle.mjs line`. Open `http://127.0.0.1:1241/t/pilot-lisbon-demo` and refresh once for the new UI, then leave it open.
2. Tester A sends `@Wanda budget USD 750.50 per person`. Check **Personal budgets** on the canvas: their configured name and `USD 750.50` must be visible, with other pilot testers waiting. Expect a short own-budget reply. Send an updated amount and check the same row changes live. Have another tester submit a different currency; no conversion or misleading cross-currency range should appear.
3. Expand **Edit preferences**, change an amount in the browser, then send `@Wanda budget summary`; the reply must reflect that value. `@Wanda budget clear` clears only its sender and visibly returns their row to waiting. Expense/agreed-budget totals must remain unchanged. Resize a card, restart only the relay later, and check the custom dimensions survive.
4. Send `@Wanda place Pike Place Market, Seattle`. Check the visible lookup/pending state and short numbered choices. Have a different tester directly reply `1`: it must refuse. The requester directly replies `1` to Wanda’s choices, or sends `@Wanda choose 1` for their only active lookup. Expect “Added … to the map.” and a visible label, named attribution and selected pin/usable Open location link without refresh.
5. Start two different lookups from the same tester. `@Wanda choose 1` must request a direct reply. Reply to the intended choices with its number; check the correct result. An ordinary unthreaded `1` must not select anything. Try selecting an expired request after 30 minutes: it must refuse.
6. Send `@Wanda place <shared Google Maps URL>` from Messages, allowing iMessage to split it. Expect one saved map link or pending selection and **no extra note**. A short/opaque URL must be labeled location unknown and open correctly. If the command arrives without a URL, directly reply with the link within a minute, or resend the full command. Test the documented coordinate-search URL and select it too.
7. Confirm real Google map tiles/pin load on your browser/network. If blocked, the visible fallback and Open location link must remain useful. Edit/remove a saved label and check `@Wanda places` sees the browser edit. Repeating exact links/results should not duplicate them. Keep an old location on the board through a relay restart to verify it still renders.
8. Restart only the relay with the same directory/flags. Preferences, saved locations/links, pending choices and send/replay state must survive. Use the automated verifier for true provider-event replays; a new human text has a new provider message ID.
9. Recheck a native poll, list action, standalone Lisbon/Porto vote and ordinary link share. These existing flows should retain their behavior. Real phone reply threading, actual Photon result relevance and external Google map rendering remain manual acceptance checks.

Preparing these features does not change live flags, restart/register the real pilot, send group messages, commit or deploy. The real-phone steps are intentionally left for the operator.

## Hosted group trips and verified claims

In hosted mode, an authorized member can send `@Wanda start a trip Summer Vacation` or the native mention followed by the same words. The first title wins. Each provider account, line and group has one active trip. Another start command or `@Wanda board` returns its invitation. Redelivery of the same event does not send a second reply. Signed private and outbound events are ignored. The HTTPS invitation carries a separate 256-bit keyed token in its URL fragment. Keep the complete link when sharing. Browsers submit the fragment to the onboarding API in a header.

Wander reads the [ZeroSettle group list](https://portal.zerosettle.io/docs.md) with the server API key. A live read returned two group objects, each with an array of other participants. The active line reported API management. Single-line payloads omit the line ID; multi-line payloads are matched on their exact line ID, which is also attached to sends. Provider membership controls chat access. Only E.164 phone members are shown in the claim picker. Email handles can participate in chat but cannot claim a phone session. Provider absence or failure denies access or returns a retryable failure. Set the rollout list to individual chat IDs; use a literal `*` only when all groups on this account should qualify.

An invitation reveals the trip title and masked phone choices, including claimed status/name. Select your number to receive a six-digit **private** text. Returning members can select a claimed number on another device. Codes expire after five minutes or five wrong attempts. A resend after 60 seconds invalidates the previous challenge. Hourly limits are five requests per number/trip, eight per browser and forty per trip. Only a confirmed API acceptance enables verification. Failed and uncertain sends require a fresh request. Group sends use `chat_id`; verification sends use a server-resolved `to`. The consumer's phone and provider may still block or delay delivery.

The code digest is keyed and bound to the challenge. The server checks the requesting browser, participant, current membership and trip. Consuming a code, establishing the claim and creating the session share a transaction. The HttpOnly, Secure, SameSite=Lax session cookie expires in 30 days. Logout revokes it. The verified identity is the same ID used by previous chat actions. Members can change from their masked fallback name to their display name without moving their votes or budgets. An active verifier can request another code to recover after sleep or interrupted delivery.

The hosted service serves a protected canvas at `/t/<uuid>`. HTTP actions use the verified session's identity. The checked WebSocket at `/live/<uuid>` streams canvas fields selected by the server. Browser edits are validated HTTP operations against the same underlying Yjs room. Manual creation and verified group invitations open the same Trip Space editor. New boards start empty. Use the toolbar to add widgets, edit fields inline, and drag or resize cards on desktop. Phones stack cards and retain inline editing. Group canvases include Copy invite. Manual canvases belong to their creating browser session. Untouched demo destination polls are removed when loaded. Edited polls and polls with votes are preserved. The protected view does not expose the raw Yjs sync endpoint, pilot receipts, provider membership, verification records or credentials. The legacy demo UI remains available with the local relay. Do not publicly expose the legacy relay or a filesystem snapshot as a route on the hosted service.

### Prepare the existing free Render service

The existing Render service deploys `main` from `SohanD7/wander`. In **Settings → Build & Deploy**, check the auto-deploy setting and copy the public HTTPS origin from the service header. Plan the history import before merging if that branch auto-deploys. Check the deployed commit in Render Events before cutover.

Use the repository root as the Docker context, `./Dockerfile`, and one Free web instance. Leave the Docker Command override and pre-deploy command empty. The image uses Node 22, installs dependencies with `npm ci`, builds with `npm run build`, installs production dependencies in the runtime stage, and starts `node server/relay.mjs`. Render supplies `PORT`; the health check path is `/health`. Configure secrets in service Environment. On an existing service, check each setting even if the blueprint lists it with `sync: false`.

1. Keep the existing Render Docker web service on **Free**. Use the existing linked Neon PostgreSQL project and database for this checkout. For a new installation, select the **Free** plan. Choose **Connect**, select the database and owner role, turn **connection pooling off**, and copy the direct TLS connection string into Render's secret `DATABASE_URL`. The writer uses session-level locking. Render Free has ephemeral local storage and its free Postgres expires after 30 days. The database here is external. See [Render Free](https://render.com/docs/free) and [Neon Free](https://neon.com/docs/introduction/plans).
2. Set `WANDER_GROUP_TRIPS=1`, `WANDER_PUBLIC_ORIGIN=https://YOUR-EXISTING-SERVICE.onrender.com`, `ZEROSETTLE_ACCOUNT_SCOPE` to a stable label for this API account, and `ZEROSETTLE_ALLOWED_GROUPS` to the exact test group ID(s). Render's blueprint generates `WANDER_CLAIM_KEY`; if configuring manually, store at least 32 random bytes from a password manager. Preserve this key and the account scope between deploys. Changing the key invalidates invitations, challenges and sessions. Keep the current private `ZEROSETTLE_TESTER_NAMES` JSON in Render if you use it.
3. Set `ZEROSETTLE_ENABLED=1`, server-only `ZEROSETTLE_API_KEY` and `ZEROSETTLE_WEBHOOK_SECRET`. Enable the existing `ZEROSETTLE_POLLS`, `ZEROSETTLE_LISTS`, `ZEROSETTLE_BUDGETS`, `ZEROSETTLE_PLACES`, `ZEROSETTLE_GEOCODER_ENABLED` and `ZEROSETTLE_ACKNOWLEDGMENTS` flags as desired. The prepared blueprint enables them. Keep credentials out of Vite variables. No Twilio, public filesystem volume, paid service or public legacy sync endpoint is needed.
4. Schema creation runs automatically from `server/hosted/schema.sql`. To prepare it manually before deployment, set `DATABASE_URL` privately and run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/hosted/schema.sql`. Schema creation is additive. The server persists mappings, membership, challenge digests, sessions and invite-reply receipts in SQL, and the private Yjs update with its existing jobs and receipts in a bytea column. A unique constraint enforces the active-group mapping. A single database writer serializes pilot mutations, so use one service instance. A replacement instance requests handoff and takes the database lock before loading rooms. This pilot uses synchronous snapshot commits; latency and capacity on your hosted database still need measurement.
5. After review, deploy the existing service with the updated Dockerfile and blueprint. Confirm `curl -fsSL "$WANDER_PUBLIC_ORIGIN/health"` returns an OK database check. Keep the old local backup. Register the webhook from the local repository **only at cutover**:

```bash
export ZEROSETTLE_WEBHOOK_URL="$WANDER_PUBLIC_ORIGIN/webhooks/zerosettle"
node scripts/zerosettle.mjs register
node scripts/zerosettle.mjs line
```

Registration rotates the signing secret and stores it in the ignored local settings. Transfer that new value privately into Render's `ZEROSETTLE_WEBHOOK_SECRET` setting and restart the service. Confirm the reported callback matches. Provider retries are safe because mutations and outbound send claims are committed first. A Render cold start may delay the first action. Restart recovers pending work; previously claimed sends with unknown outcomes are never repeated automatically. Send a fresh `@Wanda board` if the invitation reply was lost.

### Verify the linked Neon database

This checkout declares PostgreSQL in `neon.ts`. The CLI stores its branch link in ignored `.neon` and pulls the connection strings into ignored `.env.local` (or an existing `.env`). The Node relay and legacy importer prefer `DATABASE_URL_UNPOOLED`. Their session advisory lock and `LISTEN` require a direct connection. Existing Render configurations with a direct `DATABASE_URL` still work. Injected environment settings take precedence over the local files. Keep both URLs server-side.

From the repository root, after `neon deploy`, run:

```bash
npm run build
node scripts/verify-neon-postgres.mjs
```

This starts the built app on loopback with mocked ZeroSettle traffic, saves a trip and link card into a uniquely named schema on the linked database, restarts the relay, verifies replay, and removes that schema. Run before the hosted writer starts, because this check respects the app's single-writer lock. The regular hosted startup applies the additive schema to the application's own schema automatically. Neon deployment provisions the database; the Render app and webhook cutover are separate steps.

### Retain the local pilot or import it before cutover

The default local pilot still uses its original trip ID and `data/zerosettle-pilot`. Hosted mode starts separate trips unless you explicitly import. Before import, stop the local writer gracefully, preserve its private settings, and back up its entire data directory. Use a private location outside the repository. Keep both backups even after testing the import. For example:

```bash
umask 077
mkdir -p "$HOME/wander-private-backups"
tar -czf "$HOME/wander-private-backups/pilot-$(date +%Y%m%d-%H%M%S).tgz" data/zerosettle-pilot
```

With the hosted writer stopped and the matching private API account/group configured, run the import **before creating the hosted trip for that group**. Supply the same private `DATABASE_URL` and `ZEROSETTLE_ACCOUNT_SCOPE` that Render will use. The script loads the existing `ZEROSETTLE_CHAT_ID` and `ZEROSETTLE_TRIP_ID` from local private settings. For a group whose provider payload includes a stable line ID use that ID in place of `single`.

```bash
PILOT_DATA_DIR=./data/zerosettle-pilot ZEROSETTLE_IMPORT_LINE=single node scripts/import-group-pilot.mjs
```

Import keeps the source file intact. The destination receives its own UUID, the historical canvas and receipts, and the original sender IDs. The import refuses to overwrite an existing hosted mapping. Old queued sends are marked uncertain. Current membership is fetched before the imported canvas opens. Send `@Wanda board` to obtain its new invitation; the old local URL still belongs to the local pilot. For a database backup use `pg_dump --format=custom --file="$HOME/wander-private-backups/groups.dump" "$DATABASE_URL"` with private filesystem permissions. Restore into an empty database with `pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$HOME/wander-private-backups/groups.dump"` and reuse the same claim key/scope.

Keep the pre-cutover private settings with the backup. The active private config is `.env.zerosettle.local`; this checkout uses `.env.zeroSettle` for the API key. From the repository root on this Mac, after stopping the local writer and before registering the hosted callback:

```zsh
umask 077
backup_dir="$HOME/wander-private-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 -p "$backup_dir"
tar -czf "$backup_dir/pilot.tgz" data/zerosettle-pilot .env.zerosettle.local .env.zeroSettle
tar -tzf "$backup_dir/pilot.tgz" >/dev/null
```

For an exact snapshot cutover, pause group commands and canvas edits until the hosted writer takes over. Leave the tunnel available for rollback. The backup contains credentials and participant history; keep it in private storage outside the repository. On zsh, `read -rs 'DATABASE_URL?Direct Neon URL: '` followed by `export DATABASE_URL` accepts a pasted connection string without echoing it. The shared database scope must exactly match the Render setting.

#### Last checks before registering

- Render Events shows the reviewed hosted commit on the linked branch. The container reports healthy with one writer. `curl -fsS "$WANDER_PUBLIC_ORIGIN/health"` returns `{"ok":true}`. The hosted root in a private window asks for a group invitation.
- The allowlist contains the intended chat IDs and the persistent claim key is saved privately. The original signing secret can bootstrap the hosted service before registration.
- History has either been imported successfully or deliberately skipped. The local backup, prior callback URL and private settings are available for rollback.
- Run `node scripts/zerosettle.mjs line` against the previous callback before changing `ZEROSETTLE_WEBHOOK_URL`. Expect `webhookMatchesConfiguredUrl: true`. Keep both the Render Environment screen and the local private settings ready for signing-secret rotation.
- After the single registration call above, privately copy the newly saved signing secret to Render, save and deploy the setting, and recheck health. Confirm `webhookMatchesConfiguredUrl` and `hasWebhookSecret` are true with the hosted URL exported. The user can then send `@Wanda board` in an imported group or `@Wanda start a trip Summer Vacation` for a new group. Verify that event's delivery succeeded before testing private claiming.

To roll back to the local pilot, suspend the hosted writer, preserve the hosted database and settings, start the previous local relay with its original persistent directory and a working HTTPS tunnel, then register that tunnel using the cutover commands with its origin. Restart the local relay with the newly saved signing secret. The two copies diverge after cutover; restoring the previous local board does not merge later hosted edits. For a hosted code rollback, use a revision that supports the protected schema and group mode. Do not serve private group data through the legacy public room protocol.

### Acceptance and real-phone checks

```bash
npm ci
npm test
npm run build
npm run lint
node scripts/verify-hosted-trips.mjs
```

The hosted verifier creates and cleans up two mocked groups, temporary on-disk PostgreSQL-compatible storage and an isolated server on loopback port 1257. To exercise the production pg driver with installed PostgreSQL server binaries, run `WANDER_TEST_PG_BIN="$(pg_config --bindir)" node scripts/verify-hosted-trips.mjs`. This creates a disposable native database restricted to a private Unix socket. It also starts the production relay entry point, checks replacement-writer handoff, imports a legacy snapshot twice, and verifies that its earlier vote survives under the claimed name. Neither command needs real provider credentials.

1. In each of two allowed iMessage groups, send `@Wanda start a trip Summer Vacation` with different desired names. Repeat it and send `@Wanda board`. Check each group's invitation stays stable and differs from the other group's.
2. From a phone on cellular, open the **full** invitation. Check the title, masked choices and claimed badges. Select your number. Verify a code arrives only in your private conversation. Try a wrong code, resend after one minute, verify the newest six digits, enter your display name and open the canvas.
3. Vote by chat before claiming and check that it now shows your display name. With the board open, share a link, create a poll and checklist, submit a budget, and confirm a place. Confirm live amounts and labels, a map or its usable external link, and isolation from the other group. Have another tester check a checklist item in the browser while you add one in chat.
4. Return in the same browser. Verify it opens the same trip. Use a second device to select the claimed number and verify again. Log out and check that directly reopening the canvas requires the group invitation. Try the other group's canvas without its own session.
5. Let Render sleep or restart it. Repeat `@Wanda board` and check the same link, earlier cards, claims and active sessions. Verify real private delivery, poll behavior, map availability, mobile keyboard/autofill and cold-start latency on your own devices. Automated tests use mocked outbound delivery.

### Natural-language requests in hosted groups

Wanda recognizes a limited set of addressed requests using deterministic parsing. Use literal `@Wanda` or the native mention text `Wanda`. Exact commands retain precedence. The hosted interpreter is enabled by default. Set `ZEROSETTLE_NATURAL_LANGUAGE=0` to disable it while keeping the exact commands. Natural-language polls and checklists still require `ZEROSETTLE_POLLS=1` and `ZEROSETTLE_LISTS=1`, respectively.

Send these individually with the group's canvas open.

```text
@Wanda can we vote on hiking or going to the museum?
@Wanda make a poll: Where should we eat? Tacos or pizza
@Wanda make a packing list with chargers and rain jackets
@Wanda add sunscreen to our packing list
@Wanda check off sunscreen on the packing list
@Wanda send the trip link again
```

- A poll with choices and no supplied question uses “What should we do?” To test a clarification, send `@Wanda make a poll: Where should we eat?` and reply directly to Wanda with `Tacos or pizza`.
- If a checklist is missing, Wanda asks whether to create it with the named items. Reply directly with `yes` or `no`. Newly created items start unchecked. When more than one list or item can be identified, Wanda asks for a numbered choice. If lists look identical, give them distinct names on the canvas and retry.
- When reply metadata is unavailable, use `@Wanda answer Tacos or pizza`, `@Wanda answer yes`, or `@Wanda answer 2` while you have exactly one open question in that group. Questions expire after 15 minutes. With several open questions, reply directly to the intended one.
- Check that a different member's answer, a reply from another group, and a plain unthreaded `yes` leave the checklist unchanged. After a relay restart, reply directly to a question sent before the restart and check that the change appears once.
- Direct replies depend on ZeroSettle returning the sent message ID or GUID and including the target in the inbound `reply_to`. When a send outcome is uncertain, Wanda does not send the question again automatically. The existing native poll delivery and device limitations still apply.
