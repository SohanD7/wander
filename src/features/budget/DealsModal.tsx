import { useEffect, useState } from 'react'
import { PinLoader } from '../../components/brand/Pin'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { money } from '../../lib/settle'
import { scrapeDeals } from '../ai/generate'

type Deals = Awaited<ReturnType<typeof scrapeDeals>>

/** SIMULATED deal scraper: pin loader, then hardcoded price cards. */
export function DealsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [deals, setDeals] = useState<Deals | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setDeals(null)
    scrapeDeals().then((d) => live && setDeals(d))
    return () => { live = false }
  }, [open])

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="best deals">
      {!deals ? (
        <PinLoader className="py-8" size={72} label="crawling flights and stays" />
      ) : (
        <div className="space-y-5">
          {([['flights', deals.flights], ['stays', deals.hotels]] as const).map(([label, list]) => (
            <section key={label}>
              <h3 className="mb-2 text-sm font-semibold lowercase text-ink/60">{label}</h3>
              <ul className="space-y-2">
                {list.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-card bg-white p-4">
                    <div className="min-w-0"><div className="font-semibold">{d.vendor}</div><div className="truncate text-xs text-ink/60">{d.detail}</div></div>
                    <div className="shrink-0 text-right"><div className="text-lg font-semibold tabular-nums">{money(d.price)}</div><div className="text-xs text-ink/50">{d.unit}</div></div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>close</Button>
        </div>
      )}
    </Modal>
  )
}
