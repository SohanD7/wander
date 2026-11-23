import type { IconName } from '../icons/figmaIcons'
import type { Tone } from '../lib/session'
import type { Expense } from '../lib/settle'

export type TripType = 'day trip' | 'road trip' | 'flight trip'

export interface Member {
  id: string
  name: string
  tone: Tone
  status: 'organizer' | 'joined' | 'invited'
}

export interface FeedItem {
  id: string
  by: string
  byId: string
  text: string
  ts: number
}

interface WidgetBase {
  id: string
  /** canvas px (snapped to the 12px grid) */
  x: number
  y: number
  z: number
  /** user-resized size in canvas px; unset = default width, height hugs content */
  userResized?: boolean
  w?: number
  h?: number
}
export interface VoteWidget extends WidgetBase {
  type: 'vote'
  question: string
  options: { id: string; text: string }[]
  eligible: number
  closes: string
  nativePoll?: { commandId: string; state: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain'; reason?: string }
}
export interface BudgetWidget extends WidgetBase {
  type: 'budget'
  purpose?: 'preferences'
}
export interface NoteWidget extends WidgetBase {
  type: 'note'
  text: string
  author: string
  source?: { provider: string; messageId: string; senderId: string; url: string; messageText: string; commentMessageId?: string }
}
export interface ChecklistWidget extends WidgetBase {
  type: 'checklist'
  title: string
  /** Import snapshot; use checklistItems(doc, widget) for live granular items after migration. */
  items: { id: string; text: string }[]
  source?: { provider: string; messageId: string; senderId: string; author: string }
}
export interface MapWidget extends WidgetBase {
  type: 'map'
  purpose?: 'saved-places'
  /** free-text place shown on the map (defaults to the trip destination) */
  place: string
}
export type Widget = VoteWidget | BudgetWidget | NoteWidget | ChecklistWidget | MapWidget
export type WidgetType = Widget['type']

export interface Day {
  id: string
  n: number
  date: string
  title: string
}

export interface Stop {
  id: string
  dayId: string
  order: number
  time: string
  title: string
  sub: string
  icon: IconName
}

export type { Expense }

/** Shape of the whole trip — what "Prompt-to-Trip" injects in one transaction. */
export interface TripSnapshot {
  meta: { name: string; type: TripType; place: string; start: string; end: string; budget: number }
  widgets: Widget[]
  /** voter ids per option key `${widgetId}|${optionId}` */
  votes?: Record<string, string[]>
  checks?: Record<string, boolean>
  days: Day[]
  stops: Stop[]
  expenses: Expense[]
}
