import type { FeedItem, Member, TripSnapshot } from './types'
import type { Expense } from '../lib/settle'

/**
 * Demo data transcribed from the Figma frames ("Trip Space", "Itinerary", "Budget").
 * Ids are deterministic so two clients seeding at the same moment write identical keys.
 */
export const DEMO_TRIPS = {
  'pch-roadtrip': { name: 'Pacific Coast Road Trip', type: 'road trip', place: 'big sur, ca' },
  'lake-tahoe': { name: 'Lake Tahoe Weekend', type: 'day trip', place: 'south lake tahoe' },
  'nyc-birthday': { name: 'NYC Birthday', type: 'flight trip', place: 'new york, ny' },
} as const

export const CREW: Member[] = [
  { id: 'm-maya', name: 'Maya', tone: 'sunset', status: 'organizer' },
  { id: 'm-jordan', name: 'Jordan', tone: 'sea', status: 'joined' },
  { id: 'm-priya', name: 'Priya', tone: 'ink', status: 'joined' },
  { id: 'm-sam', name: 'Sam', tone: 'sun', status: 'invited' },
]

const crew = CREW.map((m) => m.id)
const exp = (
  id: string,
  title: string,
  amount: number,
  category: Expense['category'],
  paidBy: string,
  date: string,
  createdAt: number,
): Expense => ({ id, title, amount, category, paidBy, splitAmong: crew, date, createdAt })

export const PCH_SNAPSHOT: TripSnapshot = {
  meta: { name: 'Pacific Coast Road Trip', type: 'road trip', place: 'big sur, ca', start: 'jul 12', end: 'jul 14', budget: 1600 },
  widgets: [
    {
      id: 'w_vote', type: 'vote', x: 176, y: 128, z: 1,
      question: 'where should we stay in big sur?', closes: 'closes friday', eligible: 8,
      options: [
        { id: 'o_cliff', text: 'cliffside cabin' },
        { id: 'o_glamp', text: 'glamping tents' },
        { id: 'o_motel', text: 'beach motel' },
      ],
    },
    { id: 'w_budget', type: 'budget', x: 572, y: 128, z: 2 },
    {
      id: 'w_note', type: 'note', x: 968, y: 128, z: 3, author: 'Priya',
      text: "don't forget: grab a national park pass, and book nepenthe for a saturday sunset dinner 🌅",
    },
    {
      id: 'w_list', type: 'checklist', x: 176, y: 468, z: 4, title: 'packing list',
      items: [
        { id: 'c1', text: 'sunscreen' },
        { id: 'c2', text: 'hiking boots' },
        { id: 'c3', text: 'national park pass' },
        { id: 'c4', text: 'car snacks' },
        { id: 'c5', text: 'aux cord + road trip playlist' },
      ],
    },
  ],
  votes: {
    'w_vote|o_cliff': ['seed-1', 'seed-2', 'seed-3', 'seed-4'],
    'w_vote|o_glamp': ['seed-5', 'seed-6'],
    'w_vote|o_motel': ['seed-7'],
  },
  checks: { 'w_list|c1': true, 'w_list|c2': true },
  days: [
    { id: 'd1', n: 1, date: 'sat, jul 12', title: 'san francisco → big sur' },
    { id: 'd2', n: 2, date: 'sun, jul 13', title: 'big sur' },
    { id: 'd3', n: 3, date: 'mon, jul 14', title: 'carmel + monterey' },
  ],
  stops: [
    { id: 's1', dayId: 'd1', order: 10, time: '9:00a', title: 'leave sf', sub: 'meet at maya’s', icon: 'car' },
    { id: 's2', dayId: 'd1', order: 20, time: '11:30a', title: 'half moon bay', sub: 'coffee + pastries', icon: 'coffee' },
    { id: 's3', dayId: 'd1', order: 30, time: '2:00p', title: 'santa cruz boardwalk', sub: 'rides + arcade', icon: 'ferris' },
    { id: 's4', dayId: 'd1', order: 40, time: '6:30p', title: 'tacos on the beach', sub: 'sunset in capitola', icon: 'food' },
    { id: 's5', dayId: 'd1', order: 50, time: '9:00p', title: 'check in', sub: 'cliffside cabin', icon: 'home' },
    { id: 's6', dayId: 'd2', order: 10, time: '8:30a', title: 'bixby bridge', sub: 'photo stop', icon: 'camera' },
    { id: 's7', dayId: 'd2', order: 20, time: '11:00a', title: 'mcway falls', sub: 'short hike', icon: 'mountain' },
    { id: 's8', dayId: 'd2', order: 30, time: '7:30p', title: 'nepenthe', sub: 'sunset dinner', icon: 'food' },
    { id: 's9', dayId: 'd3', order: 10, time: '9:30a', title: 'drive to monterey', sub: 'hwy 1 north', icon: 'car' },
    { id: 's10', dayId: 'd3', order: 20, time: '10:30a', title: 'monterey bay aquarium', sub: 'tickets booked', icon: 'fish' },
    { id: 's11', dayId: 'd3', order: 30, time: '1:00p', title: 'lunch in carmel', sub: 'by-the-sea', icon: 'food' },
    { id: 's12', dayId: 'd3', order: 40, time: '4:00p', title: 'drive home', sub: 'back to sf', icon: 'car' },
  ],
  expenses: [
    exp('e1', 'nepenthe dinner', 200, 'food', 'm-priya', 'jul 13', 6),
    exp('e2', 'aquarium tickets', 100, 'activities', 'm-sam', 'jul 13', 5),
    exp('e3', 'gas · big sur', 90, 'gas', 'm-jordan', 'jul 13', 4),
    exp('e4', 'tacos on the beach', 120, 'food', 'm-jordan', 'jul 12', 3),
    exp('e5', 'gas · half moon bay', 90, 'gas', 'm-jordan', 'jul 12', 2),
    exp('e6', 'cliffside cabin', 640, 'lodging', 'm-maya', 'jul 10', 1),
  ],
}

const MIN = 60_000
const HOUR = 60 * MIN
/** Activity feed shown in the notifications panel (relative to "now" at seed time). */
export function seedFeed(now: number): FeedItem[] {
  const f = (i: number, by: string, byId: string, text: string, ago: number): FeedItem => ({ id: `f${i}`, by, byId, text, ts: now - ago })
  return [
    f(1, 'Maya', 'm-maya', 'created Pacific Coast Road Trip', 2 * 24 * HOUR),
    f(2, 'Maya', 'm-maya', 'invited Sam, Priya, and Jordan', 26 * HOUR),
    f(3, 'Jordan', 'm-jordan', 'suggested glamping tents', 25 * HOUR),
    f(4, 'Sam', 'm-sam', 'joined the trip space', HOUR),
    f(5, 'Priya', 'm-priya', 'added beach motel to the vote', 25 * MIN),
    f(6, 'Jordan', 'm-jordan', 'voted for cliffside cabin', 10 * MIN),
    f(7, 'Maya', 'm-maya', 'added a budget widget', 2 * MIN),
    f(8, 'Priya', 'm-priya', 'added a note', MIN),
    f(9, 'Jordan', 'm-jordan', 'added a packing list', 5_000),
  ]
}
