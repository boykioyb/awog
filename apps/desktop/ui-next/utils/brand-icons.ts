// Brand marks for known connection providers — renders the REAL product logo
// in pickers/avatars instead of an emoji or a generic glyph. Everything is
// bundled locally: icons that still ship in `simple-icons` come straight from
// the package (CC0-1.0 data); Slack and Microsoft were removed from that set
// on trademark request, so their geometry is vendored below (same upstream
// path data, pinned from the last releases that carried them).
//
// `fill: 'currentColor'` → inherits the surrounding text color — used for
// marks whose brand color is near-black, which would vanish on dark themes.
import { siBrave, siGithub, siGoogle, siLinear, siNotion } from 'simple-icons'

export type BrandIcon =
  | { kind: 'path'; d: string; fill: string }
  | { kind: 'rects'; rects: { x: number; y: number; w: number; h: number; fill: string }[] }

const path = (d: string, fill: string): BrandIcon => ({ kind: 'path', d, fill })

// Provider string (Source.provider / preset meta.provider, lowercased) → mark.
// Extend alongside the sidecar PROVIDER_DOMAINS map (sources/icon.ts).
const BRAND_ICONS: Record<string, BrandIcon> = {
  github: path(siGithub.path, 'currentColor'), // brand #181717 → theme-aware
  linear: path(siLinear.path, '#5E6AD2'),
  notion: path(siNotion.path, 'currentColor'), // brand black → theme-aware
  google: path(siGoogle.path, '#4285F4'),
  brave: path(siBrave.path, '#FB542B'),
  slack: path(
    'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z',
    '#4A154B', // Slack aubergine
  ),
  microsoft: {
    kind: 'rects',
    rects: [
      { x: 0, y: 0, w: 11.408, h: 11.408, fill: '#F25022' },
      { x: 12.594, y: 0, w: 11.406, h: 11.408, fill: '#7FBA00' },
      { x: 0, y: 12.594, w: 11.408, h: 11.406, fill: '#00A4EF' },
      { x: 12.594, y: 12.594, w: 11.406, h: 11.406, fill: '#FFB900' },
    ],
  },
}

/** Brand mark for a provider string, or undefined when there is no known mark. */
export function brandIcon(provider: string | undefined | null): BrandIcon | undefined {
  if (!provider) return undefined
  return BRAND_ICONS[provider.toLowerCase()]
}
