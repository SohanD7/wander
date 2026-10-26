/** True only in the single-file preview build (`npm run build:artifact`): no sync server, in-memory routing. */
export const ARTIFACT = (import.meta.env.VITE_ARTIFACT as string | undefined) === '1'

/** Where the hosted preview lives (set at build time) — used for invite links, since in-frame paths 404. */
export const ARTIFACT_URL = (import.meta.env.VITE_ARTIFACT_URL as string | undefined) ?? ''
