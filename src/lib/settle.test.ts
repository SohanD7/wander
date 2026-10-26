import { describe, expect, it } from 'vitest'
import { balances, byCategory, settle, total, type Expense } from './settle'

// The exact expenses shown in the Figma "Budget — overview" frame.
const crew = ['maya', 'jordan', 'priya', 'sam']
const e = (title: string, amount: number, category: Expense['category'], paidBy: string): Expense => ({
  id: title,
  title,
  amount,
  category,
  paidBy,
  splitAmong: crew,
  date: 'jul 12',
  createdAt: 0,
})
const figmaExpenses = [
  e('nepenthe dinner', 200, 'food', 'priya'),
  e('aquarium tickets', 100, 'activities', 'sam'),
  e('gas · big sur', 90, 'gas', 'jordan'),
  e('tacos on the beach', 120, 'food', 'jordan'),
  e('gas · half moon bay', 90, 'gas', 'jordan'),
  e('cliffside cabin', 640, 'lodging', 'maya'),
]

describe('budget math matches the Figma frames', () => {
  it('totals $1,240 with a $310 share', () => {
    expect(total(figmaExpenses)).toBe(1240)
    expect(total(figmaExpenses) / crew.length).toBe(310)
  })
  it('splits by category like the "spent so far" card', () => {
    expect(byCategory(figmaExpenses)).toEqual({ lodging: 640, gas: 180, food: 320, activities: 100 })
  })
  it('settles up like the "settle up" dialog', () => {
    const t = settle(balances(figmaExpenses))
    expect(t).toEqual([
      { from: 'sam', to: 'maya', amount: 210 },
      { from: 'priya', to: 'maya', amount: 110 },
      { from: 'jordan', to: 'maya', amount: 10 },
    ])
  })
})
