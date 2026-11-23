import { useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import { amountText, budgetRows, budgetRanges, CURRENCY_PRECISION, parseBudgetAmount, type Preference } from '../../collab/pilot-budget.mjs'

export function PilotBudgetBody() {
  const { room } = useTrip()
  const roster = useYMap(room.doc.getMap<{ id: string; name: string }>('pilotRoster'))
  const preferences = useYMap(room.doc.getMap<Preference>('budgetPreferences'))
  const rows = budgetRows(roster, preferences), ranges = budgetRanges(rows)
  const [tester, setTester] = useState(''), [currency, setCurrency] = useState('USD'), [amount, setAmount] = useState(''), [error, setError] = useState('')
  const selected = tester && roster[tester] ? tester : rows[0]?.id
  return <div className="space-y-3" data-budget-preferences>
    <h3 className="text-lg font-semibold">Personal budgets</h3>
    <p className="text-xs text-ink/60">Per person, total trip · configured pilot testers only. Separate from agreed budget and expenses.</p>
    <ul className="max-h-40 space-y-1 overflow-auto text-sm" aria-label="pilot budget preferences">
      {rows.map((row) => <li key={row.id}><b>{row.name}</b>: {row.preference ? amountText(row.preference) : 'Waiting for a response'}</li>)}
      {!rows.length && <li>No pilot roster configured.</li>}
    </ul>
    <div className="max-h-24 overflow-auto text-sm" aria-label="budget ranges">{ranges.length ? ranges.map((range) => <p key={range}>Range: {range}</p>) : null}</div>
    <details><summary className="cursor-pointer text-xs underline">Edit preferences</summary><form className="space-y-2" onSubmit={(event) => {
      event.preventDefault()
      const parsed = parseBudgetAmount(currency, amount.trim())
      if ('error' in parsed) { setError(parsed.error); return }
      if (!selected) return
      room.doc.getMap('budgetPreferences').set(selected, { ...parsed, updatedAt: Date.now() }); setError('')
    }}>
      <label className="block text-xs">Edit pilot tester
        <select aria-label="budget tester" className="mt-1 w-full rounded-pill bg-white px-3 py-2" value={selected ?? ''} onChange={(e) => setTester(e.target.value)}>
          {rows.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <select aria-label="budget currency" className="rounded-pill bg-white px-3" value={currency} onChange={(e) => setCurrency(e.target.value)}>{Object.keys(CURRENCY_PRECISION).map((c) => <option key={c}>{c}</option>)}</select>
        <input aria-label="personal budget amount" className="min-w-0 flex-1 rounded-pill bg-white px-3 py-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="600" />
      </div>
      <div className="flex gap-2"><button className="rounded-pill bg-sea px-4 py-2 text-sm" type="submit" disabled={!selected}>Save preference</button>
        <button className="rounded-pill bg-white px-4 py-2 text-sm" type="button" disabled={!selected} onClick={() => selected && room.doc.getMap('budgetPreferences').delete(selected)}>Clear preference</button></div>
      {error && <p role="alert" className="text-xs">{error}</p>}
    </form></details>
  </div>
}
