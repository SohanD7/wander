import { useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import {
  amountText,
  budgetRows,
  parseBudgetAmount,
  tripFinances,
  type Preference,
  type TripFinances,
} from '../../collab/pilot-budget.mjs'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { MoneyFields } from '../budget/MoneyFields'

export interface BudgetCardData extends TripFinances {
  rows: ReturnType<typeof budgetRows>
}

export function PilotBudgetBody() {
  const { room } = useTrip()
  const roster = useYMap(room.doc.getMap<{ id: string; name: string }>('pilotRoster'))
  const preferences = useYMap(room.doc.getMap<Preference>('budgetPreferences'))
  const meta = useYMap(room.meta)
  const expenses = Object.values(useYMap(room.expenses))
  const [tester, setTester] = useState('')
  const rows = budgetRows(roster, preferences)
  const selected = tester && roster[tester] ? tester : undefined
  return (
    <PilotBudgetView
      data={{ ...tripFinances(meta, expenses), rows }}
      viewerId={selected}
      personalEditor={
        <select
          aria-label="Participant"
          className="rounded-pill bg-white px-2 py-1 text-xs"
          value={selected ?? ''}
          onChange={(event) => setTester(event.target.value)}
        >
          <option value="">Select participant</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      }
      savePersonal={async (value) => {
        if (selected) room.doc.getMap('budgetPreferences').set(selected, value)
      }}
      clearPersonal={async () => {
        if (selected) room.doc.getMap('budgetPreferences').delete(selected)
      }}
      saveTarget={async (value) => {
        room.doc.getMap('meta').set('budgetTarget', value)
      }}
    />
  )
}

export function PilotBudgetView({
  data,
  viewerId,
  savePersonal,
  clearPersonal,
  saveTarget,
  openExpenses,
  personalEditor,
}: {
  data: BudgetCardData
  viewerId?: string
  personalEditor?: React.ReactNode
  savePersonal: (value: Preference) => Promise<unknown>
  clearPersonal: () => Promise<unknown>
  saveTarget: (value: Preference) => Promise<unknown>
  openExpenses?: () => void
}) {
  const [editing, setEditing] = useState<'personal' | 'target' | null>(null)
  const mine = data.rows.find((row) => row.id === viewerId)?.preference ?? null
  const responded = data.rows.filter((row) => row.preference).length
  return (
    <section aria-label="Trip budget" data-budget-preferences className="min-w-0 space-y-2 text-sm">
      <h3 className="text-lg font-semibold">Trip budget</h3>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <strong>Planned budget per person</strong>
        {personalEditor}
        <Button small variant="sea" disabled={!viewerId} onClick={() => setEditing('personal')}>
          {mine ? 'Edit my budget' : 'Set my budget'}
        </Button>
      </div>
      <div className="text-xs text-ink/60">
        {responded} of {data.rows.length} responded · {data.rows.length - responded} missing
      </div>
      <ul className="max-h-24 space-y-0.5 overflow-auto" aria-label="Planned budgets">
        {data.rows.map(({ id, name, preference }) => (
          <li key={id}>
            <b>{name}</b>: {preference ? amountText(preference) : 'Waiting for a response'}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-1 border-t border-ink/10 pt-2">
        <div>
          <strong>Trip budget target</strong>
          <div>{data.target ? amountText(data.target) : 'No target yet'}</div>
        </div>
        <Button small variant="cream" onClick={() => setEditing('target')}>
          {data.target ? 'Edit trip target' : 'Set trip target'}
        </Button>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div>
          <strong>Actual spending</strong>
          <div>{data.spending.length ? data.spending.map(amountText).join(' · ') : 'No expenses yet'}</div>
        </div>
        {data.remaining ? (
          <div>
            <strong>Remaining budget</strong>
            <div>{amountText(data.remaining)}</div>
          </div>
        ) : (
          data.target &&
          data.spending.length > 0 && (
            <p className="text-xs text-ink/60">Remaining requires spending in the target currency.</p>
          )
        )}
      </div>
      {openExpenses && (
        <button className="text-xs font-semibold underline" onClick={openExpenses}>
          See expenses
        </button>
      )}
      {editing && (
        <BudgetEditor
          kind={editing}
          current={editing === 'personal' ? mine : data.target}
          preferred={data.preferred}
          close={() => setEditing(null)}
          save={editing === 'personal' ? savePersonal : saveTarget}
          clear={editing === 'personal' && mine ? clearPersonal : undefined}
        />
      )}
    </section>
  )
}

function BudgetEditor({
  kind,
  current,
  preferred,
  save,
  clear,
  close,
}: {
  kind: 'personal' | 'target'
  current: Preference | null
  preferred: string | null
  save: (value: Preference) => Promise<unknown>
  clear?: () => Promise<unknown>
  close: () => void
}) {
  const [amount, setAmount] = useState(current ? amountText(current).slice(4) : '')
  const [currency, setCurrency] = useState(current?.currency ?? preferred ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (task: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await task()
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
      title={kind === 'personal' ? 'My budget per person' : 'Whole-trip budget target'}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          const value = parseBudgetAmount(currency, amount.trim())
          if ('error' in value) {
            setError('Enter an amount in the selected currency.')
            return
          }
          void submit(() => save(value))
        }}
      >
        <MoneyFields currency={currency} amount={amount} onCurrency={setCurrency} onAmount={setAmount} />
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={saving}>
          {kind === 'personal' ? 'Save budget' : 'Save trip target'}
        </Button>
        {clear && (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void submit(clear)}>
            Clear my budget
          </Button>
        )}
      </form>
    </Modal>
  )
}
