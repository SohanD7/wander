// Fictional identifiers and credentials only. Shared by CLI samples and local verification.
import twilio from 'twilio'
export const SAMPLE_ACCOUNT = 'AC' + '1'.repeat(32)
export const SAMPLE_CONVERSATION = 'CH' + '2'.repeat(32)
export const SAMPLE_TOKEN = 'wander-sample-auth-token-not-a-real-secret'
export function sampleConfig(port) {
  return {
    accountSid: SAMPLE_ACCOUNT, authToken: SAMPLE_TOKEN,
    webhookUrl: `http://127.0.0.1:${port}/webhooks/twilio/conversations`,
    conversationTrips: { [SAMPLE_CONVERSATION]: 'pilot-lisbon-demo' },
    ownAuthor: 'wander', boardBaseUrl: `http://127.0.0.1:${port}`, replies: 'dry-run',
  }
}
export function sampleEvent(who = 'alice', body = 'I vote for Lisbon') {
  const digit = who === 'alice' ? '3' : who === 'bob' ? '4' : '5'
  return {
    EventType: 'onMessageAdded', AccountSid: SAMPLE_ACCOUNT,
    ConversationSid: SAMPLE_CONVERSATION, MessageSid: 'IM' + digit.repeat(32),
    ParticipantSid: 'MB' + digit.repeat(32), Author: `sample-${who}`, Body: body,
    Attributes: '{}', DateCreated: '2026-11-16T12:00:00Z', Index: digit,
  }
}
export function signSample(config, event) {
  return twilio.getExpectedTwilioSignature(config.authToken, config.webhookUrl, event)
}
