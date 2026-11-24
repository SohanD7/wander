import { useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import {
  amountText,
  expenseMoney,
  expenseParticipants,
  parseBudgetAmount,
  tripFinances,
} from '../../collab/pilot-budget.mjs'
import type { Member } from '../../collab/types'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { expenseShares, expenseTransfers, type Expense, type ExpenseCategory } from '../../lib/settle'
import { useSession } from '../../lib/session'
import { DealsModal } from './DealsModal'
import { MoneyFields } from './MoneyFields'

const categories: ExpenseCategory[] = ['lodging', 'gas', 'food', 'activities', 'other']

interface ExpenseDraft {
  title: string
  value: string
  currency: string
  category: ExpenseCategory
  paidBy: string
  splitAmong?: string[]
}

interface BudgetActions {
  addExpense: (expense: ExpenseDraft) => unknown
  editExpense?: (id: string, expense: ExpenseDraft) => unknown
  removeExpense: (id: string) => void
  togglePaid: (key: string) => void
}

export function Budget() {
  const { room, actions } = useTrip()
  const { session } = useSession()
  const expenses = Object.values(useYMap(room.expenses)).sort((a, b) => b.createdAt - a.createdAt)
  const members = useYMap(room.members)
  const paid = useYMap(room.paid)
  const meta = useYMap(room.meta)
  return (
    <BudgetView
      expenses={expenses}
      members={members}
      paid={paid}
      meId={session?.id ?? ''}
      tripCurrency={tripFinances(meta, expenses).preferred}
      actions={{
        ...actions,
        addExpense: (draft) => {
          const money = parseBudgetAmount(draft.currency, draft.value)
          if ('error' in money) return
          actions.addExpense({
            title: draft.title,
            category: draft.category,
            paidBy: draft.paidBy,
            ...money,
            splitAmong: draft.splitAmong,
            date: new Date().toISOString().slice(0, 10),
          })
        },
      }}
    />
  )
}

export function BudgetView({
  expenses,
  members,
  paid,
  meId,
  actions,
  tripCurrency,
  activeIds,
}: {
  expenses: Expense[]
  members: Record<string, Member>
  paid: Record<string, boolean>
  meId: string
  actions: BudgetActions
  tripCurrency: string | null
  activeIds?: string[]
}) {
  const [editor, setEditor] = useState<'new' | Expense | null>(null)
  const [settling, setSettling] = useState(false)
  const [deals, setDeals] = useState(false)
  const { spending } = tripFinances({}, expenses)
  const name = (id: string) => members[id]?.name ?? 'Trip member'
  const currentIds = activeIds ?? Object.keys(members)
  const roster = currentIds.map((id) => members[id]).filter(Boolean)
  const transfers = expenseTransfers(expenses, currentIds)

  return (
    <div className="bg-dot-grid scrollbar-none h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card title="Total spent">
            {spending.length
              ? spending.map((value) => (
                  <div key={value.currency} className="text-3xl font-semibold tabular-nums">
                    {amountText(value)}
                  </div>
                ))
              : 'No expenses yet'}
          </Card>
          <Card title="Sharing">
            <p className="text-sm">
              Each expense has its own equal split. Open its split details to see each share.
            </p>
          </Card>
          <Card title="By category">
            <ul className="space-y-1 text-sm">
              {categories.map((category) => {
                const totals = tripFinances(
                  {},
                  expenses.filter((expense) => expense.category === category),
                ).spending
                return (
                  !!totals.length && (
                    <li className="flex flex-wrap justify-between gap-1 capitalize" key={category}>
                      <span>{category}</span>
                      <b>{totals.map(amountText).join(' · ')}</b>
                    </li>
                  )
                )
              })}
            </ul>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setEditor('new')}>add expense</Button>
          <Button variant="sea" onClick={() => setSettling(true)} disabled={transfers.length === 0}>
            settle up
          </Button>
          <Button variant="cream" onClick={() => setDeals(true)}>
            find deals
          </Button>
        </div>

        <Card title="Expenses">
          {expenses.length === 0 && (
            <p className="py-6 text-center text-sm text-ink/50">No expense entries</p>
          )}
          <ul className="divide-y divide-ink/10">
            {expenses.map((expense) => {
              const value = expenseMoney(expense)
              const shares = expenseShares(expense, currentIds)
              return (
                <li key={expense.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar
                    name={name(expense.paidBy)}
                    tone={members[expense.paidBy]?.tone ?? 'sea'}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{expense.title}</div>
                    <div className="text-xs text-ink/55">
                      {name(expense.paidBy)} paid · {expense.date} · {expense.category}
                    </div>
                  </div>
                  <b className="tabular-nums">{value ? amountText(value) : 'Amount unavailable'}</b>
                  {actions.editExpense && expense.paidBy === meId && (
                    <button
                      onClick={() => setEditor(expense)}
                      aria-label={`Edit ${expense.title}`}
                      className="rounded-full px-2 text-sm text-sea hover:bg-ink/10"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => actions.removeExpense(expense.id)}
                    aria-label={`delete ${expense.title}`}
                    className="rounded-full px-2 text-ink/55 hover:bg-ink/10"
                  >
                    ×
                  </button>
                  <details className="w-full text-sm">
                    <summary className="cursor-pointer text-ink/60">
                      Split details · {shares.length} {shares.length === 1 ? 'person' : 'people'}
                    </summary>
                    <dl className="mt-2 divide-y divide-ink/10 rounded-card bg-white/55 px-3">
                      {shares.map((share) => (
                        <div key={share.id} className="flex justify-between gap-2 py-1.5">
                          <dt>{name(share.id)}</dt>
                          <dd className="font-medium tabular-nums">{amountText(share)}</dd>
                        </div>
                      ))}
                    </dl>
                    {!shares.length && <p className="mt-2">No shares were recorded.</p>}
                  </details>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
      {editor && (
        <ExpenseEditor
          existing={editor === 'new' ? undefined : editor}
          close={() => setEditor(null)}
          members={roster}
          memberNames={name}
          meId={meId}
          actions={actions}
          tripCurrency={tripCurrency}
        />
      )}
      <Modal open={settling} onOpenChange={setSettling} title="settle up">
        <ul className="space-y-2">
          {transfers.map((t) => {
            const key = (t.currency === 'USD' ? '' : t.currency + ':') + `${t.from}>${t.to}`
            const done = !!paid[key]
            return (
              <li key={key} className="flex items-center gap-3 rounded-card bg-white p-3">
                <Avatar name={name(t.from)} tone={members[t.from]?.tone ?? 'sea'} size={32} />
                <div className="min-w-0 flex-1 text-sm">
                  <b>{name(t.from)}</b> pays <b>{name(t.to)}</b>
                </div>
                <b className={`tabular-nums ${done ? 'text-ink/40 line-through' : ''}`}>{amountText(t)}</b>
                <Button small variant={done ? 'ghost' : 'sea'} onClick={() => actions.togglePaid(key)}>
                  {done ? 'undo' : 'mark paid'}
                </Button>
              </li>
            )
          })}
        </ul>
      </Modal>
      <DealsModal open={deals} onOpenChange={setDeals} />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-cream p-5 shadow-card">
      <h2 className="mb-3 text-sm font-semibold text-ink/55">{title}</h2>
      {children}
    </section>
  )
}

function ExpenseEditor({
  existing,
  close,
  members,
  memberNames,
  meId,
  actions,
  tripCurrency,
}: {
  existing?: Expense
  close: () => void
  members: Member[]
  memberNames: (id: string) => string
  meId: string
  actions: BudgetActions
  tripCurrency: string | null
}) {
  const money = existing && expenseMoney(existing)
  const [title, setTitle] = useState(existing?.title ?? '')
  const [amount, setAmount] = useState(money ? amountText(money).slice(4) : '')
  const [currency, setCurrency] = useState(money?.currency ?? tripCurrency ?? '')
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'food')
  const [payer, setPayer] = useState(existing?.paidBy ?? meId)
  const activeIds = members.map(({ id }) => id)
  const original = expenseParticipants(existing ?? {}, activeIds)
  const [selection, setSelection] = useState(original)
  const former = selection.filter((id) => !activeIds.includes(id))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const parsed = parseBudgetAmount(currency, amount.trim())
    if (!title.trim() || !payer || 'error' in parsed || !parsed.minor) {
      setError('Enter a label, a positive amount, and a currency.')
      return
    }
    if (!selection.length) {
      setError('Choose at least one person to share this expense.')
      return
    }
    setSaving(true)
    const unchanged =
      existing && selection.length === original.length && selection.every((id) => original.includes(id))
    const expense = {
      title: title.trim(),
      value: amount.trim(),
      currency,
      category,
      paidBy: payer,
      splitAmong: unchanged ? undefined : selection,
    }
    try {
      if (existing) await actions.editExpense?.(existing.id, expense)
      else await actions.addExpense(expense)
      close()
    } catch (error) {
      setError((error as Error).message)
      setSaving(false)
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !saving) close()
      }}
      title={existing ? 'Edit expense' : 'add expense'}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field
          label="what for"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          required
        />
        <MoneyFields currency={currency} amount={amount} onCurrency={setCurrency} onAmount={setAmount} />
        <div className="flex flex-wrap gap-2">
          {categories.map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
              className={`h-9 rounded-pill px-4 text-sm font-semibold capitalize ${category === value ? 'bg-sea text-cream' : 'bg-white text-ink/70'}`}
            >
              {value}
            </button>
          ))}
        </div>
        {existing ? (
          <p className="text-sm">
            <b>Paid by</b> {memberNames(payer)}
          </p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-ink/70">Paid by</span>
            <select
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              className="h-12 w-full rounded-pill border-2 border-ink/15 bg-white px-4"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.id === meId ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Split with</legend>
          <Button type="button" small variant="cream" onClick={() => setSelection(activeIds)}>
            Everyone
          </Button>
          <div className="grid max-h-36 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
            {[...activeIds, ...former].map((id) => (
              <label
                key={id}
                className="flex min-w-0 items-center gap-2 rounded-card bg-white px-2.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  className="accent-sea"
                  checked={selection.includes(id)}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setSelection((previous) =>
                      checked ? [...previous, id] : previous.filter((value) => value !== id),
                    )
                  }}
                />
                <span className="break-words">
                  {memberNames(id)}
                  {former.includes(id) ? ' (former member)' : ''}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-ink/60">Only selected people share the cost equally.</p>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {existing ? 'Save expense' : 'add expense'}
        </Button>
      </form>
    </Modal>
  )
}
