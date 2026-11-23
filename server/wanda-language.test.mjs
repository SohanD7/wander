import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { interpretAnswer, interpretWanda, listMatches } from './wanda-language.mjs'
import { createWandaClarifications } from './wanda-clarifications.mjs'

describe('Wanda’s deterministic interpreter', () => {
  it.each([
    ['@Wanda can we vote on hiking or going to the museum?', ['Hiking', 'Museum']],
    ['Wanda lets vote on an activity, museum or beach', ['Museum', 'Beach']],
    ['@Wanda let’s vote on an activity: hiking, swimming, or surfing', ['Hiking', 'Swimming', 'Surfing']],
    ["@Wanda let's vote on rock climbing or swimming", ['Rock climbing', 'Swimming']],
    ['Wanda let us vote on Lisbon or Porto', ['Lisbon', 'Porto']],
    ['Wanda could you set up a poll with tacos, pizza, or sushi?', ['Tacos', 'Pizza', 'Sushi']],
    ['@WANDA please choose between Lisbon or Porto.', ['Lisbon', 'Porto']],
  ])('extracts choices from %s', (text, options) => {
    expect(interpretWanda(text)).toEqual({ kind: 'poll', question: 'What should we do?', options })
  })

  it('preserves a question and prompts for missing or invalid choices', () => {
    expect(interpretWanda('@Wanda make a poll: Where should we go? Lisbon or Porto')).toEqual({
      kind: 'poll',
      question: 'Where should we go?',
      options: ['Lisbon', 'Porto'],
    })
    const { prompt } = interpretWanda('@Wanda make a poll: Where should we eat?')
    expect(prompt).toEqual({ type: 'poll-choices', question: 'Where should we eat?' })
    expect(interpretAnswer(prompt, 'tacos')).toBeNull()
    expect(interpretWanda('Wanda lets vote on an activity, beach').kind).toBe('ask')
    expect(interpretAnswer(prompt, 'Tacos or tacos')).toBeNull()
    expect(interpretAnswer(prompt, '@Wanda answer tacos or pizza').question).toBe('Where should we eat?')
    expect(interpretWanda('@Wanda can we vote on ' + 'X'.repeat(151) + ' or Porto').kind).toBe('ask')
  })

  it.each([
    [
      '@Wanda make a packing list with chargers and rain jackets',
      'list',
      'Packing',
      ['chargers', 'rain jackets'],
    ],
    ['@Wanda add sunscreen to our packing list', 'add', 'packing', ['sunscreen']],
    ['Wanda check off sunscreen on the packing list', 'done', 'packing', ['sunscreen']],
    ['@Wanda could you mark USB-C Charger as done in Travel Kit?', 'done', 'Travel Kit', ['USB-C Charger']],
  ])('returns a list intent for %s', (text, action, title, items) => {
    expect(interpretWanda(text)).toEqual({ kind: 'list', action, title, items })
  })

  it('uses the existing title normalization and keeps multiple matches for clarification', () => {
    const entries = [{ title: ' PACKING  List ' }, { title: 'Packing' }, { title: 'Packing at home' }]
    expect(listMatches(entries, ' packing ')).toEqual(entries.slice(0, 2))
  })

  it.each([
    '@Wanda send the trip link again',
    'Wanda please share our board link',
    '@Wanda where’s the canvas link?',
  ])('recognizes an explicit request for the link, %s', (text) =>
    expect(interpretWanda(text)).toEqual({ kind: 'board' }),
  )

  it.each([
    'Wanda is a great person',
    'Wanda add more salt to the soup',
    'I vote for Lisbon',
    'can we vote on hiking or going to the museum?',
    'lets vote on an activity, museum or beach',
    'Wanda lets us vote later',
    'what do you think @Wanda',
    '@Wanda poll Where? | Lisbon | Porto',
    '@Wanda add to Packing | Sunscreen',
    'see https://example.org/',
    'Wanda send Mike a message',
    '1',
    'yes',
  ])('leaves %s to existing handling', (text) => expect(interpretWanda(text)).toBeNull())
})

describe('saved clarifications', () => {
  it('asks which duplicate item and pins the selection to its stable ID', () => {
    const doc = new Y.Doc()
    try {
      doc.getMap('meta').set('seeded', true)
      doc.getMap('widgets').set('list', {
        id: 'list',
        type: 'checklist',
        title: 'Packing',
        items: [
          { id: 'first', text: 'Sunscreen' },
          { id: 'second', text: 'sunscreen' },
        ],
      })
      const language = createWandaClarifications({
        config: { naturalLanguage: true, apiKey: 'test', chatId: 'iMessage;+;a', tripId: 'a' },
        roomForTrip: () => ({ doc }),
        persistNow: () => true,
      })
      const request = {
        messageId: '1',
        senderId: 'alice',
        text: '@Wanda check off sunscreen on the packing list',
      }
      const route = language.route(request)
      expect(route.parsed.prompt).toMatchObject({
        type: 'choose-item',
        choices: [
          { id: 'first', label: 'Sunscreen · item 1' },
          { id: 'second', label: 'sunscreen · item 2' },
        ],
      })
      language.command(request, route.parsed)
      const answer = { messageId: '2', senderId: 'alice', text: '@Wanda answer 2' }
      expect(language.route(answer)).toMatchObject({
        feature: 'list',
        parsed: { listId: 'list', itemId: 'second' },
        consumed: '1',
      })
      const other = { messageId: '3', senderId: 'alice', text: '@Wanda make a poll' }
      language.command(other, language.route(other).parsed)
      expect(language.route(answer).parsed.reply).toBe(
        'Please reply directly to the question you want to answer.',
      )
      expect(doc.getMap('checks').size).toBe(0)
    } finally {
      doc.destroy()
    }
  })

  it('requires the same requester and matching provider metadata before expiry', () => {
    const doc = new Y.Doc()
    try {
      doc.getMap('meta').set('seeded', true)
      const language = createWandaClarifications({
        config: { naturalLanguage: true, apiKey: 'test', chatId: 'iMessage;+;a', tripId: 'a' },
        roomForTrip: () => ({ doc }),
        persistNow: () => true,
      })
      const request = { messageId: '1', senderId: 'alice', text: '@Wanda make a poll' }
      const action = language.route(request)
      language.command(request, action.parsed)
      const pending = doc.getMap('pilotWandaClarifications')
      doc.getMap('pilotWandaClarificationDeliveries').set('1', {
        state: 'sent',
        providerMessageId: 23,
        providerGuid: 'provider-guid',
      })
      const response = {
        messageId: '2',
        senderId: 'alice',
        text: 'Hiking or Museum',
        replyTo: { id: '23', guid: 'provider-guid' },
      }
      expect(language.route(response)).toMatchObject({ feature: 'poll', consumed: '1' })
      expect(language.route({ ...response, senderId: 'bob' })).toEqual({ ignore: true })
      expect(language.route({ ...response, replyTo: { id: '23', guid: 'wrong' } })).toBeNull()
      expect(language.route({ ...response, replyTo: undefined })).toBeNull()
      pending.set('1', { ...pending.get('1'), expiresAt: Date.now() - 1 })
      expect(language.route(response)).toEqual({ ignore: true })
      expect(
        language.route({ ...response, replyTo: undefined, text: '@Wanda answer Hiking or Museum' }).parsed
          .reply,
      ).toContain('don’t have an open question')
    } finally {
      doc.destroy()
    }
  })
})
