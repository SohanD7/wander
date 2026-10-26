import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/** Centered dialog on desktop, bottom sheet on phones. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="animate-pop fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-panel bg-cream p-6 shadow-float sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(520px,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-panel sm:p-8"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <Dialog.Title className="text-2xl font-semibold lowercase text-ink">{title}</Dialog.Title>
            <Dialog.Close aria-label="close" className="rounded-full p-1 text-ink/60 hover:bg-ink/10 hover:text-ink">
              <Icon name="close" size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
