import { describe, expect, it } from 'vitest'
import { balances, byCategory, expenseShares, expenseTransfers, settle, total, type Expense } from './settle'

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

describe('expense-specific splits', () => {
  it('assigns leftover cents by member ID and allows the payer to have no share', () => {
    const dinner = { ...e('dinner', 85.43, 'food', 'sam'), splitAmong: ['sam', 'maya', 'jordan'] }
    const ride = { ...e('ride', 60, 'other', 'sam'), splitAmong: ['maya', 'jordan'] }
    expect(expenseShares(dinner)).toEqual([
      { id: 'jordan', currency: 'USD', minor: 2848 },
      { id: 'maya', currency: 'USD', minor: 2848 },
      { id: 'sam', currency: 'USD', minor: 2847 },
    ])
    expect(expenseTransfers([dinner, ride])).toEqual([
      { from: 'jordan', to: 'sam', currency: 'USD', minor: 5848 },
      { from: 'maya', to: 'sam', currency: 'USD', minor: 5848 },
    ])
    expect(expenseShares({ ...dinner, splitAmong: dinner.splitAmong.toReversed() })).toEqual(
      expenseShares(dinner),
    )
  })

  it('uses the trip roster only when no original selection exists', () => {
    const legacy = { ...e('legacy', 4.03, 'food', 'sam'), splitAmong: undefined }
    expect(expenseShares(legacy, crew).map(({ minor }) => minor)).toEqual([101, 101, 101, 100])
    const original = { ...legacy, splitAmong: ['jordan', 'sam'] }
    expect(expenseShares(original, crew).map(({ minor }) => minor)).toEqual([202, 201])
    expect(expenseTransfers([original], ['priya', 'sam'])).toEqual([
      { from: 'jordan', to: 'sam', currency: 'USD', minor: 202 },
    ])
  })
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
