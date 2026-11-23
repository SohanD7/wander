import { isDeepStrictEqual } from 'node:util'
import { destinationStarter } from '../pilot-fixture.mjs'

export function removeUntouchedStarter(doc) {
  const widgets = doc.getMap('widgets')
  const meta = doc.getMap('meta')
  const starter = destinationStarter()
  if (meta.get('destinationPollId') !== starter.id || !isDeepStrictEqual(widgets.get(starter.id), starter))
    return
  if ([...doc.getMap('votes').keys()].some((key) => key.startsWith(starter.id + '|'))) return
  widgets.delete(starter.id)
  meta.delete('destinationPollId')
}
