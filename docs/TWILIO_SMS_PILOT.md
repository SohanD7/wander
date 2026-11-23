# Inbound SMS pilot (Programmable Messaging)

`POST /webhooks/twilio/sms` is independently enabled with `TWILIO_SMS_ENABLED=1`. Conversations and the local pilot retain their existing endpoints. SMS does not use Conversations resources or send REST replies.

The URL-encoded webhook must contain `From`, `To`, `Body`, and `MessageSid`. Twilio's official SDK validates `X-Twilio-Signature` against the exact configured public URL and **all** received form fields. Request Host/forwarded headers do not determine that URL. Duplicate form fields and oversized requests are rejected. Only an exact E.164 tester phone from the nonempty allowlist, sent to the configured `To` phone, may vote.

The adapter calls `executePilotMessage` with `MessageSid` as its existing replay key, `From` unchanged as sender identity, and the single configured trip ID. Only `I vote for Lisbon` is supported. The trip must already be seeded and have `meta.destinationPollId` pointing to a poll containing one existing Lisbon option. Votes and receipts persist in the same Yjs document, so the normal board WebSocket updates without a refresh. Replays return the same success status even after a relay restart, without changing the vote.

Successful processing and duplicate delivery return HTTP 200, `Content-Type: text/xml; charset=utf-8`, with exactly `<Response/>`. There is no Message verb or outbound API call. Invalid signatures, nonallowlisted senders, and wrong destinations return 403; malformed required fields return 400; unsupported commands (including `board`) return 422. Errors never contain TwiML that sends a reply.

## Server settings

These values are examples only. Put real credentials in server secrets, never in a `VITE_*` variable. The primary Twilio Auth Token must belong to the account receiving the SMS. Set the callback URL to exactly what is entered in Twilio, including its HTTPS scheme and any query string.

```bash
export TWILIO_SMS_ENABLED=1
export TWILIO_AUTH_TOKEN=wander-sample-auth-token-not-a-real-secret
export TWILIO_SMS_WEBHOOK_URL=https://YOUR-HOST.example/webhooks/twilio/sms
export TWILIO_SMS_TRIP_ID=pilot-lisbon-demo
export TWILIO_SMS_TO=+12025550100
export TWILIO_SMS_TESTERS=+12025550101,+12025550102
```

`TWILIO_SMS_TO` is your trial Twilio number. `TWILIO_SMS_TESTERS` is a comma-separated list of your permitted testers in E.164 format. An empty or malformed allowlist fails startup. `TWILIO_ACCOUNT_SID` is not needed by the SMS route. Existing Conversations variables can remain enabled alongside these settings and use the same account Auth Token.

## First live trial test through an HTTPS tunnel

No deployment or Twilio configuration was performed by this change. To run the later test:

1. Start an HTTPS tunnel forwarding to `http://127.0.0.1:1241`. Keep its public hostname for the settings above.
2. Set those environment variables in a private terminal, replacing sample values with your account token, Twilio number, tester phones, and tunnel URL. Disable the unsigned local ingress and opt into a reusable isolated data directory:

   ```bash
   unset PILOT_TWILIO_SAMPLES
   export PILOT_PORT=1241
   export PILOT_DATA_DIR="$(mktemp -d /tmp/wander-sms-pilot.XXXXXX)"
   export LOCAL_TEST_MESSAGES=0
   npm run build && node server/pilot-demo.mjs
   ```

   This runner seeds the isolated destination poll on first start. Reusing the exported directory preserves votes and receipts on restart. The application does not automatically load `.env.example`; export values or use Node's `--env-file` with a private file.

3. In the Twilio Console, open the SMS-capable trial phone number's messaging configuration. Set **A message comes in** to **Webhook**, method **HTTP POST**, with the exact `TWILIO_SMS_WEBHOOK_URL`. Ensure its inbound handler is Programmable Messaging; remove a Conversations autocreation binding on this test number if one would route messages to Conversations instead. A separate phone number can keep the existing Conversations flow active.
4. Open `http://127.0.0.1:1241/t/pilot-lisbon-demo`, enter a name and continue as guest. From an allowlisted tester phone verified in your Twilio trial setup, text `I vote for Lisbon` to the Twilio number. Lisbon increases once; no application SMS reply is generated. A second SMS from the same phone has a new MessageSid but still counts once for that sender/option. Another tester phone counts separately.
5. Restart the runner in the same terminal to retain the data directory. Replay protection is automatically tested below with signed sample payloads; a fresh phone SMS is a new MessageSid, not a webhook replay.

## Later hosted deployment

1. Build the existing Docker image (or use the current hosting workflow) and run `server/relay.mjs` with `HOST=0.0.0.0`, the host's `PORT`, and `LOCAL_TEST_MESSAGES=0`. Configure HTTPS and WebSocket upgrades for the board.
2. Set the six SMS variables above in the hosting secret/environment settings, with the actual hosted HTTPS callback URL. Preserve Conversations configuration if needed. Keep a **single relay instance** and mount persistent storage at `DATA_DIR` (`/data` in the Dockerfile) to retain Yjs vote receipts across restarts. The current Render free configuration uses temporary storage, which does not preserve these receipts across redeploys.
3. Ensure the configured pilot trip/poll exists on that relay before sending SMS. For this isolated demo, transfer its `.ydoc` file from the runner's `PILOT_DATA_DIR` to the host's `DATA_DIR` while both relays are stopped, then start the hosted relay and open `/t/pilot-lisbon-demo`. Alternatively, configure an already seeded trip's destination poll. Starting `server/relay.mjs` alone does not seed the pilot fixture.
4. Check `/health` and the board, then set the number's inbound POST URL in Twilio to the hosted callback. Send one allowlisted test vote and check the live board. No commit or deployment has been performed here.

## Verification

```bash
npm test
npm run build
```

The SMS integration tests use fictional phones/token and signed URL-encoded samples. They check the live Yjs client receives the vote with the actual `From` key, empty TwiML on both success and replay, replay after relay restart, invalid/tampered signatures, rejected nonallowlisted senders and destinations, and no changes to the document on rejection. Existing Conversations and loopback tests also run.

References: [Twilio SMS trial setup](https://www.twilio.com/docs/usage/trials/try-out-sms), [Twilio incoming-message webhook parameters](https://www.twilio.com/docs/messaging/guides/webhook-request), [empty TwiML prevents an application reply](https://www.twilio.com/docs/usage/webhooks/messaging-webhooks), [signature validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security).
