import type * as Y from 'yjs'
import type { ChecklistWidget, Widget } from './types'
export function checklistItems(doc: Y.Doc, widget: ChecklistWidget): { id: string; text: string }[]
export function ensureChecklist(doc: Y.Doc, widget: ChecklistWidget): void
export function appendChecklistItems(doc: Y.Doc, widget: ChecklistWidget, items: { id: string; text: string }[]): void
export function editChecklistItem(doc: Y.Doc, widget: ChecklistWidget, id: string, text: string): void
export function removeChecklistItem(doc: Y.Doc, widget: ChecklistWidget, id: string): void
export function clearChecklist(doc: Y.Doc, id: string): void
export function placementWidgets(doc: Y.Doc, widgets: Iterable<Widget>): Widget[]
