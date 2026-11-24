import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  clarificationQuestion,
  interpretAnswer,
  interpretWanda,
  listMatches,
  wandaHelpReply,
} from './wanda-language.mjs'
import { parseWandaBudget } from './zerosettle-budget.mjs'
import { parseWandaPoll } from './zerosettle-polls.mjs'
import { parseWandaList } from './zerosettle-lists.mjs'
import { parseWandaPlace } from './zerosettle-places.mjs'
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

  it('recognizes item-only completion and explicit widget rename requests', () => {
    expect(interpretWanda('Wanda mark merrell as done')).toMatchObject({
      kind: 'list',
      action: 'done',
      items: ['merrell'],
    })
    expect(interpretWanda('Wanda rename the hike checklist to Trail Gear')).toEqual({
      kind: 'rename',
      widgetType: 'checklist',
      title: 'hike',
      newTitle: 'Trail Gear',
    })
    expect(interpretWanda('@Wanda rename poll "Where to eat?" to "What’s for dinner?"')).toEqual({
      kind: 'rename',
      widgetType: 'vote',
      title: 'Where to eat?',
      newTitle: 'What’s for dinner?',
    })
    expect(interpretWanda('Wanda rename the file to Lunch')).toBeNull()
    expect(interpretWanda('Wanda mark the time')).toBeNull()
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
    ['@Wanda help', 'general'],
    ['@WANDA WHAT CAN YOU DO?', 'general'],
    ['Wanda HeLp PoLLs', 'polls'],
    ['@Wanda help lists', 'lists'],
  ])('recognizes %s as help', (text, topic) => {
    expect(interpretWanda(text)).toEqual({ kind: 'help', topic })
  })

  it('organizes enabled actions and publishes syntax handled by their parsers', () => {
    const config = {polls:true,lists:true,budgets:true,places:true,geocoderEnabled:true}
    const general = wandaHelpReply('general', config)
    expect(general).toMatch(/Trip & board[\s\S]+Polls & votes[\s\S]+Lists[\s\S]+Links & places[\s\S]+Budget & expenses/)
    expect(wandaHelpReply('general', {})).not.toMatch(/Polls & votes|Lists|Budget & expenses/)
    expect(wandaHelpReply('polls', {})).toBe('That feature is turned off in this chat.')
    expect(wandaHelpReply('places',{places:true})).not.toContain('Find a place by name')
    const examples = (topic) => wandaHelpReply(topic,config).split('\n').filter((line)=>line.startsWith('@Wanda '))
    const budget = examples('budget').map(parseWandaBudget)
    expect(budget.map((command)=>command.action)).toEqual(['set','summary','clear','set-target','target','expense'])
    const [poll, rename] = examples('polls')
    expect(parseWandaPoll(poll).valid).toBe(true)
    expect(interpretWanda(rename)).toMatchObject({kind:'rename',widgetType:'vote'})
    const lists = examples('lists')
    expect(lists.slice(0,4).map((command)=>parseWandaList(command).valid)).toEqual([true,true,true,true])
    expect(interpretWanda(lists[4])).toMatchObject({kind:'rename',widgetType:'checklist'})
    expect(examples('places').map((command)=>parseWandaPlace(command).action)).toEqual(['name','url','choose','list','remove'])
    expect(interpretWanda('@Wanda help budget')).toEqual({kind:'help',topic:'budget'})
  })

  it('asks for only the missing detail and interprets the reply', () => {
    const vote = interpretWanda('@Wanda can we vote?').prompt
    expect(clarificationQuestion(vote)).toMatch(/^What are the options\?/)
    const list = interpretWanda('@Wanda could you make a day bag checklist?').prompt
    expect(clarificationQuestion(list)).toBe('What should I put on Day bag?')
    expect(interpretAnswer(list, 'Water and snacks')).toMatchObject({
      action: 'list',
      title: 'Day bag',
      items: ['Water', 'snacks'],
    })
    const unnamed = interpretWanda('@Wanda make a list with water and snacks').prompt
    expect(clarificationQuestion(unnamed)).toBe('What should I call the list?')
    expect(interpretAnswer(unnamed, 'Day bag')).toMatchObject({
      action: 'list',
      title: 'Day bag',
      items: ['water', 'snacks'],
    })
    const add = interpretWanda('@Wanda add marshmallows').prompt
    expect(clarificationQuestion(add)).toBe('Which list should I add that to?')
    expect(interpretAnswer(add, 'our day bag checklist')).toMatchObject({
      action: 'add',
      title: 'day bag',
      items: ['marshmallows'],
    })
  })

  it.each([
    'Wanda is a great person',
    'Wanda help is on the way',
    'can anyone help with the trip?',
    'did anyone ask @Wanda for help?',
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
        type: 'select-target',
        choices: [
          { label: 'Sunscreen · Packing · item 1', intent: { itemId: 'first' } },
          { label: 'sunscreen · Packing · item 2', intent: { itemId: 'second' } },
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

  it('waits to rename an ambiguous poll and preserves the selected poll’s existing data', () => {
    const doc = new Y.Doc()
    try {
      doc.getMap('meta').set('seeded', true)
      const widgets = doc.getMap('widgets')
      const first = {
        id: 'first',
        type: 'vote',
        question: 'Dinner?',
        options: [{ id: 'taco', text: 'Tacos' }],
      }
      const second = {
        id: 'second',
        type: 'vote',
        question: 'Dinner?',
        options: [{ id: 'pasta', text: 'Pasta' }],
      }
      widgets.set(first.id, first)
      widgets.set(second.id, second)
      doc.getMap('votes').set('second|pasta|alice', 1)
      const language = createWandaClarifications({
        config: { naturalLanguage: true, apiKey: 'test', chatId: 'iMessage;+;a', tripId: 'a' },
        roomForTrip: () => ({ doc }),
        persistNow: () => true,
      })
      const request = { messageId: '1', senderId: 'alice', text: 'Wanda rename vote Dinner? to Food plans' }
      language.command(request, language.route(request).parsed)
      expect(widgets.get('second')).toEqual(second)
      const reply = { messageId: '2', senderId: 'alice', text: '@Wanda answer 2' }
      const choice = language.route(reply)
      language.command(reply, choice.parsed, (d) => language.record(d, reply, choice))
      expect(widgets.get('first')).toEqual(first)
      expect(widgets.get('second')).toEqual({ ...second, question: 'Food plans' })
      expect(doc.getMap('votes').get('second|pasta|alice')).toBe(1)
      expect(language.route(reply)).toEqual({ feature: 'clarify' })
      const conflict = language.route({
        messageId: '3',
        senderId: 'alice',
        text: 'Wanda rename poll Food plans to Dinner?',
      })
      expect(conflict.parsed.reply).toContain('already exists')
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
