// Granular checklist items/order, with legacy widget.items retained as an import snapshot.
// Both the canvas and server use these exact Yjs objects and stable item IDs.
const validId = (v) => typeof v === 'string' && v.length > 0 && !v.includes('|')
const orderFor = (doc, id) => doc.getArray(`checklistOrder:${id}`)
export function checklistItems(doc, widget) {
  if (!doc.getMap('checklistModels').has(widget.id)) return widget.items ?? []
  const items = doc.getMap('checklistItems'), seen = new Set()
  return orderFor(doc, widget.id).toArray().flatMap((id) => {
    if (seen.has(id)) return []
    seen.add(id)
    const item = items.get(`${widget.id}|${id}`)
    return item ? [{ id, text: item.text }] : []
  })
}
export function ensureChecklist(doc, widget) {
  if (doc.getMap('checklistModels').has(widget.id)) return
  doc.transact(() => {
    const used = new Set(), items = (widget.items ?? []).map((item, index) => {
      let id = item?.id
      if (!validId(id) || used.has(id)) {
        id = `legacy_${index}`
        while (used.has(id) || (widget.items ?? []).some((other) => other?.id === id)) id += '_'
      }
      used.add(id)
      return { id, text: typeof item === 'string' ? item : item?.text ?? '' }
    })
    for (const item of items) doc.getMap('checklistItems').set(`${widget.id}|${item.id}`, item)
    if (items.length) orderFor(doc, widget.id).push(items.map((item) => item.id))
    doc.getMap('checklistModels').set(widget.id, 1)
  }, 'checklist-migration')
}
export function appendChecklistItems(doc, widget, items) {
  ensureChecklist(doc, widget)
  doc.transact(() => {
    for (const item of items) doc.getMap('checklistItems').set(`${widget.id}|${item.id}`, item)
    if (items.length) orderFor(doc, widget.id).push(items.map((item) => item.id))
  })
}
export function editChecklistItem(doc, widget, id, text) {
  ensureChecklist(doc, widget)
  const items = doc.getMap('checklistItems'), key = `${widget.id}|${id}`
  if (items.has(key)) items.set(key, { id, text })
}
export function removeChecklistItem(doc, widget, id) {
  ensureChecklist(doc, widget)
  doc.transact(() => {
    doc.getMap('checklistItems').delete(`${widget.id}|${id}`)
    const order = orderFor(doc, widget.id)
    for (let index = order.length - 1; index >= 0; index--) if (order.get(index) === id) order.delete(index, 1)
    doc.getMap('checks').delete(`${widget.id}|${id}`)
  })
}
export function clearChecklist(doc, id) {
  doc.transact(() => {
    const items = doc.getMap('checklistItems')
    for (const key of items.keys()) if (key.startsWith(`${id}|`)) items.delete(key)
    const order = orderFor(doc, id)
    if (order.length) order.delete(0, order.length)
    doc.getMap('checklistModels').delete(id)
  })
}
export function placementWidgets(doc, widgets) {
  return Array.from(widgets, (w) => w.type === 'checklist' ? { ...w, items: checklistItems(doc, w) } : w)
}
