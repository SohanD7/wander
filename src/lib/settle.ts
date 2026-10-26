export type ExpenseCategory = 'lodging' | 'gas' | 'food' | 'activities'

export interface Expense {
  id: string
  title: string
  amount: number
  category: ExpenseCategory
  paidBy: string
  /** member ids the expense is split between (evenly) */
  splitAmong: string[]
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
    const share = e.amount / e.splitAmong.length
    out[e.paidBy] = (out[e.paidBy] ?? 0) + e.amount
    for (const m of e.splitAmong) out[m] = (out[m] ?? 0) - share
  }
  for (const k of Object.keys(out)) out[k] = round(out[k])
  return out
}

/** Greedy minimum-ish set of payments that settles everyone up. */
export function settle(net: Record<string, number>): Transfer[] {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < -0.005)
    .map(([id, v]) => ({ id, v: -v }))
    .sort((a, b) => b.v - a.v)
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0.005)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v)
  const out: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amt = round(Math.min(debtors[i].v, creditors[j].v))
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: amt })
    debtors[i].v = round(debtors[i].v - amt)
    creditors[j].v = round(creditors[j].v - amt)
    if (debtors[i].v <= 0.005) i++
    if (creditors[j].v <= 0.005) j++
  }
  return out
}

export const total = (expenses: Expense[]) => round(expenses.reduce((s, e) => s + e.amount, 0))

export function byCategory(expenses: Expense[]): Record<ExpenseCategory, number> {
  const out: Record<ExpenseCategory, number> = { lodging: 0, gas: 0, food: 0, activities: 0 }
  for (const e of expenses) out[e.category] += e.amount
  return out
}

export const money = (n: number, opts: { cents?: boolean } = {}) =>
  '$' +
  n.toLocaleString('en-US', {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })
