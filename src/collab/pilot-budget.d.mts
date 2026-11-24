export const CURRENCY_PRECISION: Readonly<Record<string, number>>
export interface Preference {
  currency: string
  minor: number
  updatedAt?: number
}
export function parseBudgetAmount(currency: string, amount: string): Preference | { error: string }
export function validBudget(value: unknown): value is Preference
export function amountText(value: Preference): string
export function budgetRows(
  roster: Record<string, { name: string }>,
  preferences: Record<string, unknown>,
): { id: string; name: string; preference: Preference | null }[]
export function budgetRanges(rows: { preference: Preference | null }[]): string[]
export function budgetSummary(
  roster: Record<string, { name: string }>,
  preferences: Record<string, unknown>,
  senderId?: string,
): string
export interface TripFinances {
  target: Preference | null
  spending: Preference[]
  remaining: Preference | null
  preferred: string | null
}
export function expenseMoney(expense: {
  amount?: number
  currency?: string
  minor?: number
}): Preference | null
export function expenseParticipants(expense: { splitAmong?: string[] }, fallback?: string[]): string[]
export function tripFinances(
  meta: { budget?: unknown; budgetTarget?: unknown },
  expenses: { amount?: number; currency?: string; minor?: number }[],
): TripFinances
