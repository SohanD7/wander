import { expect, test } from 'vitest'
import { Doc } from 'yjs'
import { seedPilotTrip } from '../pilot-fixture.mjs'
import { removeUntouchedStarter } from './starter.mjs'

test.each(['untouched', 'moved', 'resized', 'voted', 'custom'])('cleaning a %s starter', (variant) => {
  const doc = new Doc()
  seedPilotTrip(doc)
  const widgets = doc.getMap('widgets')
  const poll = widgets.get('w_destination')
  widgets.set('user-poll', { ...poll, id: 'user-poll' })
  if (variant === 'moved') widgets.set(poll.id, { ...poll, x: 600 })
  if (variant === 'resized') widgets.set(poll.id, { ...poll, h: 420 })
  if (variant === 'custom')
    widgets.set(poll.id, { ...poll, options: [{ id: 'different', text: 'Lisbon' }, poll.options[1]] })
  if (variant === 'voted') doc.getMap('votes').set(poll.id + '|o_lisbon|member', 1)
  removeUntouchedStarter(doc)
  expect(widgets.has(poll.id)).toBe(variant !== 'untouched')
  expect(widgets.has('user-poll')).toBe(true)
  doc.destroy()
})
