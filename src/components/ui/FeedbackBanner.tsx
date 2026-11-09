import { useState } from 'react'
import { Icon } from './Icon'

const SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScwE4vJXxz2W_8gGUN_7FyiaQ8OGeQexM-jkk-2qLvuwAtm-w/viewform?usp=publish-editor'
const DISMISSED_KEY = 'wander.feedback-banner.dismissed.v1'

const wasDismissed = () => {
  try { return localStorage.getItem(DISMISSED_KEY) === '1' } catch { return false }
}

/** App-wide preview banner, shown above every screen until the X is clicked. */
export function FeedbackBanner() {
  const [dismissed, setDismissed] = useState(wasDismissed)
  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* stays dismissed until reload */ }
  }

  return (
    <div role="region" aria-label="feedback" className="relative z-[60] flex shrink-0 items-center gap-2 bg-sunset py-2 pr-1.5 pl-4 text-ink">
      <p className="flex-1 text-center text-sm font-medium">
        Enjoying Wander? It’s an early preview. Tell us what you think in 2 minutes{' '}
        <a href={SURVEY_URL} target="_blank" rel="noreferrer" className="font-semibold underline">here</a>.
      </p>
      <button type="button" onClick={dismiss} aria-label="dismiss banner" className="shrink-0 rounded-full p-1 hover:bg-ink/10">
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
