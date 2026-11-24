import { useId } from 'react'
import { CURRENCY_PRECISION } from '../../collab/pilot-budget.mjs'
import { Field } from '../../components/ui/Field'

export function MoneyFields({
  currency,
  amount,
  onCurrency,
  onAmount,
}: {
  currency: string
  amount: string
  onCurrency: (value: string) => void
  onAmount: (value: string) => void
}) {
  const currencyId = useId()
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <div className="text-sm">
        <label htmlFor={currencyId} className="mb-1.5 block font-medium text-ink/70">
          Currency
        </label>
        <select
          id={currencyId}
          value={currency}
          onChange={(event) => onCurrency(event.target.value)}
          className="h-12 w-full rounded-pill border-2 border-ink/15 bg-white px-3"
        >
          {!currency && <option value="">Select</option>}
          {Object.keys(CURRENCY_PRECISION).map((code) => (
            <option key={code}>{code}</option>
          ))}
        </select>
      </div>
      <Field
        label="Amount"
        inputMode="decimal"
        value={amount}
        onChange={(event) => onAmount(event.target.value)}
        required
      />
    </div>
  )
}
