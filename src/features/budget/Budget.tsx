import { useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import type { Member } from '../../collab/types'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { balances, byCategory, money, settle, total, type ExpenseCategory } from '../../lib/settle'
import { useSession } from '../../lib/session'
import { DealsModal } from './DealsModal'

const CATS: { id: ExpenseCategory; label: string; color: string }[] = [
  { id: 'lodging', label: 'lodging', color: '#57b1a8' },
  { id: 'gas', label: 'gas', color: '#f37521' },
  { id: 'food', label: 'food', color: '#422f0e' },
  { id: 'activities', label: 'activities', color: '#e0c24f' },
]

/** Figma: "Budget — overview" + "settle up" + "add expense". Not in the requirements doc, but it is in the designs. */
export function Budget() {
  const { room, actions } = useTrip()
  const { session } = useSession()
  const expenses = Object.values(useYMap(room.expenses)).sort((a, b) => b.createdAt - a.createdAt)
  const members = useYMap(room.members)
  const paid = useYMap(room.paid)
  const [adding, setAdding] = useState(false)
  const [settling, setSettling] = useState(false)
  const [deals, setDeals] = useState(false)

  const sum = total(expenses)
  const crewIds = Object.keys(members)
  const share = crewIds.length ? sum / crewIds.length : 0
  const cats = byCategory(expenses)
  const transfers = settle(balances(expenses))
  const name = (id: string) => members[id]?.name ?? 'someone'

  return (
    <div className="bg-dot-grid scrollbar-none h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card title="total spent"><div className="text-4xl font-semibold tabular-nums">{money(sum)}</div></Card>
          <Card title="about each"><div className="text-4xl font-semibold tabular-nums">{money(share)}</div><div className="text-sm text-ink/55">split {crewIds.length} ways</div></Card>
          <Card title="by category">
            <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-white">
              {CATS.map((c) => <span key={c.id} style={{ width: `${sum ? (cats[c.id] / sum) * 100 : 0}%`, background: c.color }} />)}
            </div>
            <ul className="grid grid-cols-2 gap-x-3 text-xs">{CATS.map((c) => (
              <li key={c.id} className="flex items-center justify-between"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.label}</span><b className="tabular-nums">{money(cats[c.id])}</b></li>
            ))}</ul>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setAdding(true)}>add expense</Button>
          <Button variant="sea" onClick={() => setSettling(true)} disabled={transfers.length === 0}>settle up</Button>
          <Button variant="cream" onClick={() => setDeals(true)}>find deals</Button>
        </div>

        <Card title="expenses">
          {expenses.length === 0 && <p className="py-6 text-center text-sm text-ink/50">no expenses yet</p>}
          <ul className="divide-y divide-ink/10">
            {expenses.map((e) => (
              <li key={e.id} className="group flex items-center gap-3 py-3">
                <Avatar name={name(e.paidBy)} tone={members[e.paidBy]?.tone ?? 'sea'} size={36} />
                <div className="min-w-0 flex-1"><div className="truncate font-semibold lowercase">{e.title}</div><div className="text-xs text-ink/55">{name(e.paidBy)} paid · {e.date} · {e.category}</div></div>
                <b className="tabular-nums">{money(e.amount)}</b>
                <button onClick={() => actions.removeExpense(e.id)} aria-label={`delete ${e.title}`} className="rounded-full px-2 text-ink/35 hover:bg-ink/10 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100">×</button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <AddExpense open={adding} onOpenChange={setAdding} members={Object.values(members)} meId={session?.id ?? ''} />
      <Modal open={settling} onOpenChange={setSettling} title="settle up">
        <ul className="space-y-2">
          {transfers.map((t) => {
            const key = `${t.from}>${t.to}`
            const done = !!paid[key]
            return (
              <li key={key} className="flex items-center gap-3 rounded-card bg-white p-3">
                <Avatar name={name(t.from)} tone={members[t.from]?.tone ?? 'sea'} size={32} />
                <div className="min-w-0 flex-1 text-sm"><b>{name(t.from)}</b> pays <b>{name(t.to)}</b></div>
                <b className={`tabular-nums ${done ? 'text-ink/40 line-through' : ''}`}>{money(t.amount)}</b>
                <Button small variant={done ? 'ghost' : 'sea'} onClick={() => actions.togglePaid(key)}>{done ? 'undo' : 'mark paid'}</Button>
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
      <h2 className="mb-3 text-sm font-semibold lowercase text-ink/55">{title}</h2>
      {children}
    </section>
  )
}

function AddExpense({ open, onOpenChange, members, meId }: { open: boolean; onOpenChange: (o: boolean) => void; members: Member[]; meId: string }) {
  const { actions } = useTrip()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('food')
  const [paidBy, setPaidBy] = useState('')
  const payer = paidBy || meId
  const amt = parseFloat(amount)

  const submit = () => {
    if (!title.trim() || !(amt > 0)) return
    actions.addExpense({
      title: title.trim(), amount: amt, category, paidBy: payer,
      splitAmong: members.map((m) => m.id),
      date: new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' }).toLowerCase(),
    })
    setTitle(''); setAmount('')
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="add expense">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="what for" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="tacos on the beach" autoFocus />
        <Field label="amount ($)" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {CATS.map((c) => <button type="button" key={c.id} onClick={() => setCategory(c.id)} aria-pressed={category === c.id} className={`h-9 rounded-pill px-4 text-sm font-semibold lowercase ${category === c.id ? 'bg-sea text-cream' : 'bg-white text-ink/70'}`}>{c.label}</button>)}
        </div>
        <label className="block text-sm"><span className="mb-1.5 block font-medium lowercase text-ink/70">paid by</span>
          <select value={payer} onChange={(e) => setPaidBy(e.target.value)} className="h-12 w-full rounded-pill border-2 border-ink/15 bg-white px-4">
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === meId ? ' (you)' : ''}</option>)}
          </select>
        </label>
        <p className="text-xs text-ink/50">split evenly between everyone in the trip.</p>
        <Button type="submit" className="w-full" disabled={!title.trim() || !(amt > 0)}>add expense</Button>
      </form>
    </Modal>
  )
}
