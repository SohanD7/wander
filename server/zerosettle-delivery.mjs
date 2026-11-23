// A durable claim must be saved by claim() before deliver(). Never automatically repeat a send claim.
export function createDeliveryQueue({ enabled, claim, finish, pending, deliver }) {
  let closed = false
  let running
  const queued = new Set()
  const abort = new AbortController()
  function enqueue(id) {
    if (closed || !enabled) return
    queued.add(id)
    if (running) return
    running = (async () => {
      while (!closed && queued.size) {
        const id = queued.values().next().value
        queued.delete(id)
        const item = claim(id)
        if (!item) continue // duplicate, disabled, or claim could not be saved: no send
        let outcome
        try { outcome = await deliver(item, abort.signal) } catch { outcome = { state: 'uncertain', reason: 'network_or_timeout' } }
        if (closed) break
        if (!outcome || !['sent', 'failed', 'uncertain'].includes(outcome.state)) outcome = { state: 'uncertain', reason: 'unconfirmed_response' }
        finish(id, outcome)
      }
    })().finally(() => { running = null })
  }
  return {
    enqueue,
    resume: () => { if (enabled) for (const id of pending()) enqueue(id) },
    // Abort transport on shutdown. A saved sending claim becomes uncertain when loaded next time.
    close: () => { closed = true; abort.abort(); queued.clear() },
    idle: async () => { while (running) await running },
  }
}
