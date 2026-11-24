const money = String.raw`(?:(?<currency>[a-z]{3})\s+)?(?<symbol>\$\s*)?(?<amount>[+-]?\d+(?:\.\d+)?)`
const paid = String.raw`i\s+(?:paid|covered|spent)`
const log = String.raw`(?:log|record|add)(?:\s+(?:an?\s+)?expense(?:\s+of)?)?`
const paidOrLog = `(?:${paid}|${log})`
const expenseForms = [
  new RegExp(String.raw`^${paidOrLog}\s+${money}\s+(?:for|on)\s+(?<label>.+)$`, 'i'),
  new RegExp(String.raw`^for\s+(?<label>.+?),\s*${paidOrLog}\s+${money}$`, 'i'),
  new RegExp(String.raw`^${paidOrLog}\s+(?:for\s+|)(?<label>.+?)\s*(?::|[—–]|\bfor)\s*${money}$`, 'i'),
]
const personalForms = [
  new RegExp(
    String.raw`^(?:my\s+(?:trip\s+)?budget\s*(?:is\b|would\s+be\b|:)|i\s+(?:can|could|plan\s+to)\s+spend)\s+(?:about\s+|around\s+|up\s+to\s+)?${money}(?:\s+(?:(?:on|for)\s+(?:this|the|our)\s+trip|per\s+person))*$`,
    'i',
  ),
  new RegExp(String.raw`^${money}\s+(?:is|would\s+be)\s+my\s+(?:trip\s+)?budget$`, 'i'),
]
const groupSummary =
  /^(?:(?:what(?:['’]s|\s+(?:is|are))|show(?:\s+(?:me|us))?)\s+)(?:(?:everyone|everybody)['’]s\s+(?:personal\s+)?budgets?|(?:our|the|all(?:\s+of\s+our)?)\s+(?:personal|individual|per-person)\s+budgets?)$/i
const terminal = (text) =>
  text
    .trim()
    .replace(/[.?!]+$/, '')
    .trim()

export function expenseNames(text) {
  return terminal(text)
    .replace(/^(?:just|only)\s+/i, '')
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)
    .map((name) => name.trim().replace(/^@/, '').trim())
    .filter(Boolean)
}

export function interpretMoney(request) {
  const text = terminal(request)
  if (groupSummary.test(text)) return { action: 'group-summary' }
  if (/\?\s*$/.test(request) && !/^(?:log|record|add)\b/i.test(text)) return null
  for (const pattern of personalForms) {
    const fields = pattern.exec(text)?.groups
    if (fields?.currency || fields?.symbol) return { action: 'set', ...fields, conversational: true }
  }
  // Pull out the sharing language first so it can never become part of the expense label.
  const after =
    /(?:[.!;]\s+|,\s+|\s+(?:and\s+)?)(?:please\s+)?split(?:\s+(?:it|this|that|the (?:bill|check|cost|expense)))?(?:\s+(?:evenly|equally))?(?:\s+(?:between|among|with|by|for)(?:\s+|$)|$)(.*)$/i.exec(
      text,
    )
  const others =
    !after &&
    /[.!;,]\s+(.+?)\s+(?:(?:are|is|will be)\s+(?:splitting|sharing)|will\s+(?:split|share))(?:\s+(?:it|this|the cost|the expense))?$/i.exec(
      text,
    )
  const clause = after || others
  const entry = (clause ? text.slice(0, clause.index) : text).trim()
  for (const pattern of expenseForms) {
    const fields = pattern.exec(entry)?.groups
    if (!fields || (!fields.currency && !fields.symbol)) continue
    const label = terminal(fields.label)
    if (!label || label.length > 200 || /[?!]|[.;]\s/u.test(label)) continue
    if (
      /\b(?:splitting|split\s+(?:it|this|between|with|among|by|evenly|equally|the (?:bill|check|cost|expense)|\d)|sharing\s+(?:it|the cost))/i.test(
        label,
      )
    )
      return {
        error: 'Who’s sharing this expense? Try “Wanda, I paid $60 for dinner. Split it with Alex and Maya.”',
      }
    return {
      ...fields,
      action: 'expense',
      label,
      conversational: true,
      ...(clause ? { split: expenseNames(clause[1]) } : {}),
    }
  }
  return null
}
