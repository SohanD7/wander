// The pilot handlers require synchronous durable claims before outbound calls. A dedicated
// SQL worker preserves that contract. One writer owns all live Yjs rooms on the free service.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads'
export function database(options) {
  const { port1, port2 } = new MessageChannel()
  const wake = new Int32Array(new SharedArrayBuffer(4))
  const worker = new Worker(new URL('./sql-worker.mjs', import.meta.url), {
    workerData: { options, port: port2, wake },
    transferList: [port2],
  })
  let broken = false
  function query(sql, params = []) {
    if (broken) throw Error('Database unavailable')
    Atomics.store(wake, 0, 0)
    port1.postMessage({ sql, params })
    if (Atomics.wait(wake, 0, 0, 30000) === 'timed-out') {
      broken = true
      throw Error('Database timeout')
    }
    const reply = receiveMessageOnPort(port1)?.message
    if (!reply?.ok) throw Error('Database operation failed')
    return reply.rows
  }
  try {
    query('SELECT 1')
  } catch (error) {
    worker.terminate()
    throw error
  }
  return {
    query,
    close: async () => {
      port1.close()
      await worker.terminate()
    },
  }
}
