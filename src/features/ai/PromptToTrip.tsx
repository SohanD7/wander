import { useState } from 'react'
import { applySnapshot, pushFeed } from '../../collab/actions'
import { useTrip } from '../../collab/TripProvider'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useSession } from '../../lib/session'
import { generateTrip } from './generate'

/** SIMULATED prompt-to-trip: loader for 3–5s, then a hardcoded snapshot is written to the shared doc. */
export function PromptToTrip({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { room } = useTrip()
  const { session } = useSession()
  const [prompt, setPrompt] = useState('3 days in greece for 4 friends, beaches + good food, mid budget')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    const snap = await generateTrip(prompt)
    applySnapshot(room, snap)
    if (session) pushFeed(room, session, 'generated a trip with wander AI')
    setBusy(false)
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title="plan it for me">
      {busy ? (
        <div className="space-y-3 py-2" role="status" aria-label="generating your trip">
          <p className="text-sm text-ink/70">building your itinerary, budget and checklist…</p>
          {[80, 100, 64, 90].map((w, i) => <div key={i} className="skeleton h-10 rounded-pill" style={{ width: `${w}%` }} />)}
        </div>
      ) : (
        <div className="space-y-4">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} className="w-full resize-none rounded-card border-2 border-ink/15 bg-white p-4" placeholder="describe the trip you want…" />
          <p className="text-xs text-ink/50">prototype: this doesn’t call a model — it drops in a sample greece trip. it replaces what’s on the board for everyone.</p>
          <Button className="w-full" onClick={run} disabled={!prompt.trim()}>generate trip</Button>
        </div>
      )}
    </Modal>
  )
}
