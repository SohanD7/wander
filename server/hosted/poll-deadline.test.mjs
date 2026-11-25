import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { closesText, isPastDue, isPollDate, isSettablePollDate, pollWaiting, reminderText, waitingOn } from '../../src/collab/poll-deadline.mjs'
import { editCanvas } from './edits.mjs'
import { boardView } from './view.mjs'

const NOW = Date.parse('2026-11-24T15:00:00Z')

describe('poll reply-by dates', () => {
  it('accepts only real calendar dates', () => {
    expect(isPollDate('2026-12-04')).toBe(true)
    for (const bad of ['2026-13-45', '2027-02-30', '12/04/2026', '', null, 20261204, { x: 1 }]) expect(isPollDate(bad)).toBe(false)
  })
  it('only lets people set dates from today up to two years out', () => {
    expect(isSettablePollDate('2026-11-24', NOW)).toBe(true)
    expect(isSettablePollDate('2026-12-04', NOW)).toBe(true)
    expect(isSettablePollDate('2020-01-01', NOW)).toBe(false)
    expect(isSettablePollDate('2099-01-01', NOW)).toBe(false)
  })
  it('formats closes text to match the existing lowercase style', () => {
    expect(closesText('2026-12-04')).toBe('closes fri, dec 4')
    expect(closesText(undefined)).toBe(null)
  })
  it('flags past-due polls by calendar day', () => {
    expect(isPastDue('2026-11-20', '2026-11-24')).toBe(true)
    expect(isPastDue('2026-11-24', '2026-11-24')).toBe(false)
    expect(isPastDue(undefined, '2026-11-24')).toBe(false)
  })
})

describe('who has not voted', () => {
  it('lists members with no vote on this poll, in member order', () => {
    const keys = ['p1|a|maya', 'p1|b|priya', 'p2|a|sam', 'p1|a|priya']
    expect(waitingOn('p1', ['maya', 'priya', 'sam', 'jordan'], keys)).toEqual(['sam', 'jordan'])
    expect(waitingOn('p2', ['maya', 'sam'], keys)).toEqual(['maya'])
  })
  it('shows nothing rather than a wrong list when votes come from unknown people', () => {
    expect(pollWaiting('p1', ['maya', 'sam'], ['maya', 'sam'], ['p1|a|seed-1', 'p1|a|maya'])).toBe(null)
    expect(pollWaiting('p1', ['maya', 'sam'], ['maya', 'sam'], ['p2|a|seed-1', 'p1|a|maya'])).toEqual(['sam'])
  })
  it('only lists the active roster, not people who left', () => {
    expect(pollWaiting('p1', ['maya', 'sam'], ['maya', 'sam', 'left'], ['p1|a|maya'])).toEqual(['sam'])
    // someone who voted and then left the group is still a known member, so the list stays valid
    expect(pollWaiting('p1', ['maya', 'sam'], ['maya', 'sam', 'left'], ['p1|a|left'])).toEqual(['maya', 'sam'])
  })
  it('builds a paste-ready reminder naming only the people still to vote', () => {
    expect(reminderText({ question: 'where should we stay?', due: '2026-12-04', names: ['Sam', 'Jordan'], link: 'https://x.test/join/1#t' }))
      .toBe('Sam, Jordan: quick reminder to vote on "where should we stay?" by fri, dec 4 🗳️ https://x.test/join/1#t')
    expect(reminderText({ question: '', names: [] })).toBe('quick reminder to vote on "our trip poll" 🗳️')
  })
})

describe('hosted canvas: reply-by date edits and the waiting list', () => {
  const setup = () => {
    const doc = new Y.Doc()
    for (const [id, name] of [['maya', 'Maya'], ['sam', 'Sam'], ['jo', '+15550100199']]) doc.getMap('members').set(id, { id, name, tone: 'sea', status: 'joined' })
    doc.getMap('widgets').set('p1', { id: 'p1', type: 'vote', x: 0, y: 0, z: 1, question: 'stay?', options: [{ id: 'a', text: 'A' }], eligible: 3, closes: 'closes friday' })
    doc.getMap('votes').set('p1|a|maya', 1)
    return doc
  }
  const due = (doc, value) => editCanvas(doc, 'maya', 'Maya', { action: 'due', card: 'p1', value })
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)

  it('leaves existing polls exactly as they were until someone sets a date', () => {
    const card = boardView(setup(), 'maya').cards.find((c) => c.id === 'p1')
    expect(card.voteSummary).toBe('1 of 3 voted · closes friday')
    expect(card.due).toBeUndefined()
  })
  it('sets a date, rewrites closes, and clears back to "no deadline"', () => {
    const doc = setup()
    due(doc, in7)
    const w = doc.getMap('widgets').get('p1')
    expect(w.due).toBe(in7)
    expect(w.closes).toBe(closesText(in7))
    due(doc, '')
    const cleared = doc.getMap('widgets').get('p1')
    expect('due' in cleared).toBe(false)
    expect(cleared.closes).toBe('no deadline')
  })
  it('rejects bad dates without changing the poll', () => {
    const doc = setup()
    for (const value of ['2026-13-45', '2020-01-01', 'friday', 12]) expect(() => due(doc, value)).toThrow(/reply-by date/)
    expect(doc.getMap('widgets').get('p1').closes).toBe('closes friday')
  })
  it('only accepts the due edit on polls', () => {
    const doc = setup()
    doc.getMap('widgets').set('n1', { id: 'n1', type: 'note', x: 0, y: 0, z: 1, text: 'hi', author: 'Maya' })
    expect(() => editCanvas(doc, 'maya', 'Maya', { action: 'due', card: 'n1', value: in7 })).toThrow()
  })
  it('lists who has not voted, with the viewer as "you" and phone numbers masked', () => {
    expect(boardView(setup(), 'maya').cards.find((c) => c.id === 'p1').waiting).toEqual(['Sam', 'Member 0199'])
    expect(boardView(setup(), 'sam').cards.find((c) => c.id === 'p1').waiting).toEqual(['you', 'Member 0199'])
  })
  it('uses the active iMessage roster when the trip has one', () => {
    const doc = setup()
    for (const id of ['maya', 'sam']) doc.getMap('pilotRoster').set(id, { id, name: id })
    expect(boardView(doc, 'maya').cards.find((c) => c.id === 'p1').waiting).toEqual(['Sam'])
  })
  it('hides the list (not the poll) when votes do not match members', () => {
    const doc = setup()
    doc.getMap('votes').set('p1|a|seed-9', 1)
    const card = boardView(doc, 'maya').cards.find((c) => c.id === 'p1')
    expect(card.waiting).toBeUndefined()
    expect(card.voteSummary).toBe('2 of 3 voted · closes friday')
  })
})
