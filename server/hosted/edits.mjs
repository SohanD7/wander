import { randomUUID } from 'node:crypto'
import { problem } from './claim.mjs'
import { checklistItems, appendChecklistItems, placementWidgets } from '../../src/collab/checklists.mjs'
import { parseBudgetAmount } from '../../src/collab/pilot-budget.mjs'
import { placeWidget, snap } from '../../src/collab/placement.mjs'
export function editCanvas(doc, identity, name, edit) {
  const widgets = doc.getMap('widgets'),
    w = widgets.get(edit.card)
  if (edit.action === 'add-note') {
    const text = plain(edit.value, 2000),
      id = randomUUID()
    widgets.set(id, {
      type: 'note',
      id,
      text,
      author: name,
      source: { senderId: identity },
      ...placeWidget(placementWidgets(doc, widgets.values())),
      z: 1 + Math.max(0, ...[...widgets.values()].map((c) => c.z)),
    })
    return
  }
  if (!w) throw problem(404, 'Card unavailable.')
  if (edit.action === 'move' && [edit.x, edit.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 100000)) {
    widgets.set(w.id, { ...w, x: snap(edit.x), y: snap(edit.y) })
    return
  }
  if (edit.action === 'note' && w.type === 'note') {
    if (edit.previous !== w.text)
      throw problem(409, 'This note changed while you were editing. Reopen it to see the latest text.')
    widgets.set(w.id, { ...w, text: plain(edit.value, 2000) })
    return
  }
  if (w.type === 'budget' && w.purpose === 'preferences') {
    const preferences = doc.getMap('budgetPreferences')
    if (edit.action === 'clear-budget') {
      preferences.delete(identity)
      return
    }
    if (edit.action === 'budget') {
      const p = parseBudgetAmount(plain(edit.currency, 3), plain(edit.value, 20))
      if (p.error) throw problem(400, p.error)
      preferences.set(identity, { ...p, updatedAt: Date.now() })
      return
    }
  }
  if (w.type === 'map' && w.purpose === 'saved-places' && doc.getMap('savedPlaces').has(edit.item)) {
    if (edit.action === 'label') {
      doc.getMap('savedPlaceLabels').set(edit.item, plain(edit.value, 200))
      return
    }
    if (edit.action === 'remove-place') {
      for (const key of ['savedPlaces', 'savedPlaceLabels', 'placeLocations'])
        doc.getMap(key).delete(edit.item)
      return
    }
  }
  if (w.type === 'checklist' && edit.action === 'append') {
    appendChecklistItems(doc, w, [{ id: randomUUID(), text: plain(edit.value, 200) }])
    return
  }
  if (w.type === 'vote' && w.options.some((o) => o.id === edit.item) && typeof edit.selected === 'boolean') {
    const k = w.id + '|' + edit.item + '|' + identity
    if (edit.selected) doc.getMap('votes').set(k, Date.now())
    else doc.getMap('votes').delete(k)
    return
  }
  if (
    w.type === 'checklist' &&
    checklistItems(doc, w).some((i) => i.id === edit.item) &&
    typeof edit.selected === 'boolean'
  ) {
    doc.getMap('checks').set(w.id + '|' + edit.item, edit.selected)
    return
  }
  throw problem(400, 'Unsupported canvas edit.')
}
function plain(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw problem(400, 'Enter a shorter, nonempty value.')
  return value.trim()
}
