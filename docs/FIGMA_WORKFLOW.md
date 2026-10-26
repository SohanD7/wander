# Figma-first workflow

**Rule: design changes happen in Figma first, then flow into code.** The file is
`https://www.figma.com/design/PYB2sWoeI5mCYSt1RSUcxg/Wander`.

## Where Figma values live in code
| Figma | Code |
|---|---|
| Colors (sun `#f8ebb5`, cream `#fffaea`, sea `#57b1a8`, sunset `#f37521`, ink `#422f0e`) | `@theme` in `src/styles/index.css` → Tailwind classes (`bg-sea`, `text-ink`…) |
| Radii (pill / card 28 / panel 32), shadows, top-bar height, Fredoka font | same `@theme` block |
| Icons | `src/icons/figmaIcons.ts` (exported from Figma; stroke = `currentColor`) |
| Screen/component → file mapping | `figma.map.json` |
| Demo content (Pacific Coast trip, budget numbers) | `src/collab/seed.ts` — transcribed from the frames |

The Figma file now has matching **variables** (collections `Color`, `Radius`, `Spacing`). Each variable's name mirrors the CSS token
(`color/sea` ↔ `--color-sea`, `radius/card` ↔ `--radius-card`, `spacing/topbar` ↔ `--spacing-topbar`) and carries the CSS name as its WEB code syntax.
Existing frames still use raw fills — they have not been rebound to the variables yet (follow-up).

## Making a change
1. Edit the frame in Figma.
2. Look it up in `figma.map.json` → files to touch.
3. Re-read the frame (Figma MCP `get_design_context` / `get_screenshot` on the node id) and update the code.
4. Token changed? Edit the Figma variable, then mirror the value in `src/styles/index.css` (same name).
5. Icon changed? Re-export and update `figmaIcons.ts`.
6. Update `status` in `figma.map.json`.

## Where the code intentionally differs from Figma
- Yjs relay instead of Liveblocks (see README).
- Itinerary uses timed stops like the frames, not Morning/Afternoon/Evening slots from the requirements doc.
- Guest sign-in asks for a display name (needed for cursors/votes).
- Widgets have a delete button; the map widget, AI generator, deal scraper and availability calendar have no Figma design yet — they are built from the requirements doc.
- Brand rasters (`public/brand/wordmark.png`, `wander-sprite.png`) must be exported from Figma; text/SVG fallbacks render until then.
