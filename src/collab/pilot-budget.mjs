// Explicit pilot currencies (ISO 4217 minor-unit precision); no FX conversion.
export const CURRENCY_PRECISION = Object.freeze({ USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, CNY: 2, INR: 2, JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3 })
export function parseBudgetAmount(currency, amount) {
  const code = currency.toUpperCase(), precision = CURRENCY_PRECISION[code]
  if (precision === undefined) return { error: 'That currency isn’t supported. Try @Wanda budget USD 600 per person.' }
  if (!/^(0|[1-9]\d{0,8})(?:\.\d+)?$/.test(amount)) return { error: 'Use a nonnegative amount without commas or symbols. Try @Wanda budget USD 600 per person.' }
  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > precision) return { error: `${code} allows ${precision} decimal places. Try @Wanda budget ${code} 600 per person.` }
  const minor = Number(BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction || '').padEnd(precision, '0') || '0'))
  return { currency: code, minor }
}
export function validBudget(value) {
  return !!value && Object.hasOwn(CURRENCY_PRECISION, value.currency) && Number.isSafeInteger(value.minor) && value.minor >= 0 && value.minor <= 999999999 * 10 ** CURRENCY_PRECISION[value.currency] + 10 ** CURRENCY_PRECISION[value.currency] - 1
}
export function amountText(value) {
  const precision = CURRENCY_PRECISION[value.currency], n = BigInt(value.minor), divisor = 10n ** BigInt(precision)
  return `${value.currency} ${n / divisor}${precision ? '.' + String(n % divisor).padStart(precision, '0') : ''}`
}
export function budgetRows(roster, preferences) {
  return Object.entries(roster).map(([id, member]) => ({ id, name: member.name, preference: validBudget(preferences[id]) ? preferences[id] : null }))
}
export function budgetRanges(rows) {
  const groups = new Map()
  for (const row of rows) if (row.preference) {
    const p = row.preference, group = groups.get(p.currency) ?? []
    group.push(p.minor); groups.set(p.currency, group)
  }
  return [...groups].filter(([, values]) => new Set(values).size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => `${amountText({ currency, minor: Math.min(...values) })}–${amountText({ currency, minor: Math.max(...values) })}`)
}
export function budgetSummary(roster, preferences, senderId) {
  const rows = budgetRows(roster, preferences), ranges = budgetRanges(rows)
  const own = rows.find((row) => row.id === senderId)?.preference
  const missing = rows.filter((row) => !row.preference).length
  const waiting = rows.filter((row) => !row.preference && row.id !== senderId).length
  const submitted = rows.length - missing
  return [senderId ? (own ? `Your budget is ${amountText(own)} per person.` : 'Your budget is not set.') : `${submitted} pilot budgets submitted.`, waiting ? `Waiting on ${waiting} ${waiting === 1 ? 'other' : 'others'}.` : missing ? 'The other pilot testers have responded.' : 'All pilot testers have responded.', ...ranges.map((range) => `Range: ${range}.`)].join(' ')
}
