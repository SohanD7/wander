import { useState } from 'react'
import { applySnapshot, pushFeed } from '../../collab/actions'
import { useTrip } from '../../collab/TripProvider'
import { PinLoader } from '../../components/brand/Pin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useSession } from '../../lib/session'
import { generateTrip } from './generate'

/** SIMULATED prompt-to-trip: pin loader for 3–5s, then a hardcoded snapshot is written to the shared doc. */
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
        <PinLoader className="py-6" size={112} label="building your itinerary, budget and checklist" />
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
