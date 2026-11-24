// Observed native mention text is "Wanda …"; literal typed commands use "@Wanda …".
// Only an exact leading address is recognized. No arbitrary mention/person inference.
export function wandaCommandText(text) {
  return typeof text === 'string' && /^\s*@?wanda\s+/i.test(text) ? text.replace(/^\s*@?wanda\s+/i, '') : null
}

// Only the literal mention distinguishes an unknown command from ordinary chatter.
export function hasLiteralWandaAddress(text) {
  return typeof text === 'string' && /^\s*@wanda(?:\s|$)/i.test(text)
}
