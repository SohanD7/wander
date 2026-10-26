import type { TripSnapshot } from './types'
import type { Expense } from '../lib/settle'

/**
 * SIMULATED "Prompt-to-Trip" output. There is no LLM: the generator UI waits a few seconds and
 * then writes this hardcoded object into the shared document, so every connected client sees the
 * board fill in at once. Swap `generateTrip` in ai/generate.ts for a real call later.
 */
const crew = ['m-maya', 'm-jordan', 'm-priya', 'm-sam']
const e = (id: string, title: string, amount: number, category: Expense['category'], paidBy: string, date: string, createdAt: number): Expense => ({
  id, title, amount, category, paidBy, splitAmong: crew, date, createdAt,
})

export const GREECE_SNAPSHOT: TripSnapshot = {
  meta: { name: 'Greece, group of 4', type: 'flight trip', place: 'athens + santorini', start: 'jun 6', end: 'jun 8', budget: 3200 },
  widgets: [
    {
      id: 'w_vote', type: 'vote', x: 176, y: 128, z: 1,
      question: 'where should we spend night two?', closes: 'closes sunday', eligible: 4,
      options: [
        { id: 'o_oia', text: 'oia cave house' },
        { id: 'o_fira', text: 'fira hotel' },
        { id: 'o_kamari', text: 'kamari beach airbnb' },
      ],
    },
    { id: 'w_budget', type: 'budget', x: 572, y: 128, z: 2 },
    {
      id: 'w_note', type: 'note', x: 968, y: 128, z: 3, author: 'wander AI',
      text: 'book the acropolis for first thing — it gets hot and crowded by 11. sunset in oia is the one thing not to skip 🌅',
    },
    {
      id: 'w_list', type: 'checklist', x: 176, y: 468, z: 4, title: 'before we fly',
      items: [
        { id: 'c1', text: 'passports (6+ months valid)' },
        { id: 'c2', text: 'ferry tickets athens → santorini' },
        { id: 'c3', text: 'travel adapter' },
        { id: 'c4', text: 'sunscreen + hat' },
      ],
    },
  ],
  votes: {},
  checks: {},
  days: [
    { id: 'd1', n: 1, date: 'sat, jun 6', title: 'athens' },
    { id: 'd2', n: 2, date: 'sun, jun 7', title: 'ferry to santorini' },
    { id: 'd3', n: 3, date: 'mon, jun 8', title: 'oia + sunset' },
  ],
  stops: [
    { id: 'g1', dayId: 'd1', order: 10, time: '9:00a', title: 'acropolis', sub: 'go early, before the heat', icon: 'mountain' },
    { id: 'g2', dayId: 'd1', order: 20, time: '1:00p', title: 'souvlaki in monastiraki', sub: 'lunch', icon: 'food' },
    { id: 'g3', dayId: 'd1', order: 30, time: '4:00p', title: 'plaka wander', sub: 'shops + gelato', icon: 'camera' },
    { id: 'g4', dayId: 'd2', order: 10, time: '7:30a', title: 'ferry to santorini', sub: '5 hrs · bring snacks', icon: 'plane' },
    { id: 'g5', dayId: 'd2', order: 20, time: '3:00p', title: 'check in', sub: 'oia cave house', icon: 'home' },
    { id: 'g6', dayId: 'd2', order: 30, time: '8:00p', title: 'dinner in fira', sub: 'caldera view', icon: 'food' },
    { id: 'g7', dayId: 'd3', order: 10, time: '10:00a', title: 'red beach', sub: 'swim + chill', icon: 'sun' },
    { id: 'g8', dayId: 'd3', order: 20, time: '2:00p', title: 'wine tasting', sub: 'santo wines', icon: 'coffee' },
    { id: 'g9', dayId: 'd3', order: 30, time: '7:15p', title: 'sunset in oia', sub: 'the main event', icon: 'camera' },
  ],
  expenses: [
    e('g_e1', 'flights (athens)', 1400, 'activities', 'm-maya', 'may 2', 3),
    e('g_e2', 'cave house deposit', 480, 'lodging', 'm-priya', 'may 4', 2),
    e('g_e3', 'ferry tickets', 220, 'activities', 'm-jordan', 'may 9', 1),
  ],
}

/** Simulated "deal scraper" results — hardcoded on purpose. */
export const FLIGHT_DEALS = [
  { id: 'f1', vendor: 'Delta', detail: 'SEA → ATH · 1 stop · 14h 20m', price: 450, unit: 'per person' },
  { id: 'f2', vendor: 'Lufthansa', detail: 'SEA → ATH · 1 stop · 15h 05m', price: 512, unit: 'per person' },
  { id: 'f3', vendor: 'Aegean', detail: 'SEA → ATH · 2 stops · 19h 40m', price: 388, unit: 'per person' },
]
export const HOTEL_DEALS = [
  { id: 'h1', vendor: 'Airbnb', detail: 'Oia cave house · sleeps 4 · 4.9★', price: 120, unit: 'per night' },
  { id: 'h2', vendor: 'Booking.com', detail: 'Fira caldera hotel · 4.6★', price: 164, unit: 'per night' },
  { id: 'h3', vendor: 'Vrbo', detail: 'Kamari beach flat · sleeps 4 · 4.7★', price: 98, unit: 'per night' },
]
