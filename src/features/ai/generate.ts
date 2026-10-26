import { FLIGHT_DEALS, GREECE_SNAPSHOT, HOTEL_DEALS } from '../../collab/greece'
import type { TripSnapshot } from '../../collab/types'

/**
 * SIMULATED — no model is called. Waits 3–5s (so the loader is visible) and resolves a hardcoded trip.
 * To go real, replace the body with a fetch() that returns a TripSnapshot; callers don't change.
 */
export function generateTrip(_prompt: string): Promise<TripSnapshot> {
  const ms = 3000 + Math.random() * 2000
  return new Promise((resolve) => setTimeout(() => resolve(GREECE_SNAPSHOT), ms))
}

/** SIMULATED deal scraper — radar loader, then hardcoded cards. */
export function scrapeDeals(): Promise<{ flights: typeof FLIGHT_DEALS; hotels: typeof HOTEL_DEALS }> {
  return new Promise((resolve) => setTimeout(() => resolve({ flights: FLIGHT_DEALS, hotels: HOTEL_DEALS }), 2500))
}
