export const OSM_ATTRIBUTION: string
export interface Location { lat: number; lon: number; provider?: string; attribution?: string; confirmedBy?: string; confirmedAt?: number }
export interface SavedPlace { id: string; label: string; url?: string; dedupeKey: string; createdAt: number; source: { senderId: string; name: string }; location?: Location | null }
export function normalizePlaceName(text: string): string
export function validLocation(value: unknown): value is Location
export function parseCoordinates(text: string): Location | null
export function parseMapLink(text: string): { error: string } | { url: string; label: string; coordinates: Location | null }
export function savedPlaceRows(places: Record<string, SavedPlace>, labels: Record<string, string>, locations: Record<string, Location>): SavedPlace[]

export function placeName(candidate: { name?: string; label?: string }): string
export function placeChoice(candidate: { name?: string; city?: string; label?: string; provider?: string }): string
