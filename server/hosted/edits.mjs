import { workspaceEdit } from './workspace.mjs'
import { randomUUID } from 'node:crypto'
import { problem } from './claim.mjs'
import {
  checklistItems,
  appendChecklistItems,
  editChecklistItem,
  removeChecklistItem,
  clearChecklist,
  placementWidgets,
} from '../../src/collab/checklists.mjs'
import { parseBudgetAmount } from '../../src/collab/pilot-budget.mjs'
import { placeWidget, snap } from '../../src/collab/placement.mjs'
export function editCanvas(doc, identity, name, edit) {
  if (workspaceEdit(doc, edit, identity)) return
  const widgets = doc.getMap('widgets'),
    w = widgets.get(edit.card)
  if (edit.action === 'add-note' || edit.action === 'create') {
    const type = edit.action === 'add-note' ? 'note' : edit.type
    const id = randomUUID()
    let fields
    switch (type) {
      case 'note':
        fields = { text: edit.action === 'add-note' ? plain(edit.value, 2000) : '', author: name }
        break
      case 'vote':
        fields = {
          question: 'New poll',
          options: ['Option one', 'Option two'].map((text) => ({ id: randomUUID(), text })),
          closes: 'no deadline',
          eligible: doc.getMap('members').size,
        }
        break
      case 'checklist':
        fields = { title: 'New list', items: [] }
        break
      case 'budget':
        fields = {}
        break
      case 'map':
        fields = { place: '', h: 324 }
        break
      default:
        throw problem(400, 'Unsupported widget.')
    }
    widgets.set(id, {
      id,
      type,
      ...fields,
      source: { senderId: identity },
      ...placeWidget(placementWidgets(doc, widgets.values()), { type, ...fields }),
      z: 1 + Math.max(0, ...[...widgets.values()].map((c) => c.z || 0)),
    })
    return
  }
  if (!w) throw problem(404, 'Card unavailable.')
  if (
    edit.action === 'resize' &&
    Number.isFinite(edit.width) &&
    Number.isFinite(edit.height) &&
    edit.width >= 240 &&
    edit.height >= 144 &&
    Math.max(edit.width, edit.height) <= 10000
  ) {
    widgets.set(w.id, { ...w, w: snap(edit.width), h: snap(edit.height), userResized: true })
    return
  }
  if (edit.action === 'delete') {
    if (w.type === 'checklist') clearChecklist(doc, w.id)
    for (const map of ['checks', 'votes'])
      for (const key of doc.getMap(map).keys()) if (key.startsWith(w.id + '|')) doc.getMap(map).delete(key)
    widgets.delete(w.id)
    return
  }
  if (edit.action === 'field') {
    const key = { vote: 'question', checklist: 'title', map: 'place', note: 'text' }[w.type]
    if (
      !key ||
      w.purpose ||
      typeof edit.value !== 'string' ||
      edit.value.length > (key === 'text' ? 2000 : 200)
    )
      throw problem(400, 'Invalid field.')
    if ((w[key] ?? '') !== edit.previous)
      throw problem(409, 'This field changed. Please edit the latest value.')
    widgets.set(w.id, { ...w, [key]: edit.value })
    return
  }
  if (w.type === 'vote' && edit.action === 'add-option') {
    if (w.options.length >= 50) throw problem(400, 'Poll is full.')
    widgets.set(w.id, { ...w, options: [...w.options, { id: randomUUID(), text: plain(edit.value, 200) }] })
    return
  }
  if (['vote', 'checklist'].includes(w.type) && ['rename-item', 'remove-item'].includes(edit.action)) {
    const items = w.type === 'vote' ? w.options : checklistItems(doc, w)
    const item = items.find((i) => i.id === edit.item)
    if (!item || item.text !== edit.previous) throw problem(409, 'Item changed. Please try again.')
    const remove = edit.action === 'remove-item'
    const value = remove ? '' : plain(edit.value, 200)
    if (w.type === 'vote') {
      widgets.set(w.id, {
        ...w,
        options: remove
          ? items.filter((i) => i.id !== item.id)
          : items.map((i) => (i.id === item.id ? { ...i, text: value } : i)),
      })
      if (remove)
        for (const key of doc.getMap('votes').keys())
          if (key.startsWith(w.id + '|' + item.id + '|')) doc.getMap('votes').delete(key)
    } else if (remove) removeChecklistItem(doc, w, item.id)
    else editChecklistItem(doc, w, item.id, value)
    return
  }
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
  if (w.type === 'budget') {
    const preferences = doc.getMap('budgetPreferences')
    if (edit.action === 'clear-budget') {
      preferences.delete(identity)
      return
    }
    if (edit.action === 'budget' || edit.action === 'budget-target') {
      const value = parseBudgetAmount(plain(edit.currency, 3), plain(edit.value, 20))
      if (value.error) throw problem(400, 'Enter a valid budget amount and currency.')
      if (edit.action === 'budget-target') doc.getMap('meta').set('budgetTarget', value)
      else preferences.set(identity, { ...value, updatedAt: Date.now() })
      return
    }
  }
  if (w.type === 'map' && w.purpose === 'saved-places' && doc.getMap('savedPlaces').has(edit.item)) {
    if (edit.action === 'label') {
      const current =
        doc.getMap('savedPlaceLabels').get(edit.item) ?? doc.getMap('savedPlaces').get(edit.item)?.label
      if (edit.previous !== undefined && edit.previous !== current) throw problem(409, 'Place label changed.')
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
