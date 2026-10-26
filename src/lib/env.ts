/** True only in the single-file preview build (`npm run build:artifact`): no sync server, in-memory routing. */
export const ARTIFACT = (import.meta.env.VITE_ARTIFACT as string | undefined) === '1'
