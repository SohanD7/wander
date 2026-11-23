import crypto from 'node:crypto'
export function normalizeHandle(value) {
  if (typeof value !== 'string' || value.length > 128) return null
  if (/^\+[1-9]\d{1,14}$/.test(value)) return value
  if (/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(value)) return value.toLowerCase()
  return null
}
export const zeroSettleSenderId = (handle) => 'zs-' + crypto.createHash('sha256').update(handle).digest('hex')

export function providerMessageId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d{0,18}$/.test(String(value))) return null
  if (BigInt(value) > 9223372036854775807n) return null
  return String(value)
}
