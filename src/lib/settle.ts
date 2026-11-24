import { CURRENCY_PRECISION, expenseMoney, expenseParticipants } from '../collab/pilot-budget.mjs'

export type ExpenseCategory = 'lodging' | 'gas' | 'food' | 'activities' | 'other'

export interface Expense {
  id: string
  title: string
  amount?: number
  currency?: string
  minor?: number
  category: ExpenseCategory
  paidBy: string
  /** member ids the expense is split between (evenly) */
  splitAmong?: string[]
  /** display date, e.g. "jul 13" */
  date: string
  createdAt: number
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

const round = (n: number) => Math.round(n * 100) / 100

/** Net balance per member: positive = is owed money, negative = owes money. */
export function balances(expenses: Expense[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of expenses) {
    const value = expenseAmount(e)
    const participants = expenseParticipants(e)
    const share = value / participants.length
    out[e.paidBy] = (out[e.paidBy] ?? 0) + value
    for (const m of participants) out[m] = (out[m] ?? 0) - share
  }
  for (const k of Object.keys(out)) out[k] = round(out[k])
  return out
}

/** Greedy minimum-ish set of payments that settles everyone up. */
export function settle(net: Record<string, number>): Transfer[] {
  const cents = Object.fromEntries(Object.entries(net).map(([id, amount]) => [id, Math.round(amount * 100)]))
  return settleMinorUnits(cents).map(({ minor, ...transfer }) => ({ ...transfer, amount: minor / 100 }))
}

function settleMinorUnits(net: Record<string, number>) {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }))
    .sort((a, b) => b.v - a.v)
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v)
  const out = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const minor = Math.min(debtors[i].v, creditors[j].v)
    out.push({ from: debtors[i].id, to: creditors[j].id, minor })
    debtors[i].v -= minor
    creditors[j].v -= minor
    if (!debtors[i].v) i++
    if (!creditors[j].v) j++
  }
  return out
}

function expenseAmount(expense: Expense) {
  const money = expenseMoney(expense)
  return money ? money.minor / 10 ** CURRENCY_PRECISION[money.currency] : 0
}

export const total = (expenses: Expense[]) => round(expenses.reduce((s, e) => s + expenseAmount(e), 0))

export function byCategory(expenses: Expense[]) {
  const out: Partial<Record<ExpenseCategory, number>> = { lodging: 0, gas: 0, food: 0, activities: 0 }
  for (const e of expenses) out[e.category] = (out[e.category] ?? 0) + expenseAmount(e)
  return out
}

export const money = (n: number, opts: { cents?: boolean } = {}) =>
  '$' +
  n.toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })

// Split integer minor units evenly, assigning any remainder by stable member ID.
export function expenseShares(expense: Expense, fallback?: string[]) {
  const money = expenseMoney(expense)
  const ids = expenseParticipants(expense, fallback).sort()
  if (!money || !ids.length) return []
  const share = Math.floor(money.minor / ids.length)
  const remainder = money.minor % ids.length
  return ids.map((id, index) => ({
    id,
    currency: money.currency,
    minor: share + (index < remainder ? 1 : 0),
  }))
}

export function expenseTransfers(expenses: Expense[], fallback?: string[]) {
  const ledgers = new Map<string, Record<string, number>>()
  for (const expense of expenses) {
    const money = expenseMoney(expense)
    const shares = expenseShares(expense, fallback)
    if (!money || !shares.length) continue
    const net = ledgers.get(money.currency) ?? Object.create(null)
    net[expense.paidBy] = (net[expense.paidBy] ?? 0) + money.minor
    for (const { id, minor } of shares) net[id] = (net[id] ?? 0) - minor
    ledgers.set(money.currency, net)
  }
  return [...ledgers].flatMap(([currency, ledger]) =>
    settleMinorUnits(ledger).map((transfer) => ({ ...transfer, currency })),
  )
}
