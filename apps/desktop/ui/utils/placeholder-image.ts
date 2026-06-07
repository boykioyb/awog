/**
 * Generate an inline SVG data URI for demo image attachments.
 * Used so sample sessions render real-looking thumbnails without
 * shipping binary assets or hitting the network.
 */

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const shade = (hex: string, percent: number) => {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (!m || !m[1]) return hex
  const n = parseInt(m[1], 16)

  const r = Math.max(0, Math.min(255, (n >> 16) + percent))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + percent))
  const b = Math.max(0, Math.min(255, (n & 0xff) + percent))
  const out = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')

  return `#${out}`
}

export const placeholderImage = (opts: {
  label: string
  sublabel?: string
  width?: number
  height?: number
  background?: string
  foreground?: string
}) => {
  const width = opts.width ?? 640
  const height = opts.height ?? 400
  const bg = opts.background ?? '#1e293b'
  const fg = opts.foreground ?? '#cbd5e1'
  const accent = '#60a5fa'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}"/>
        <stop offset="100%" stop-color="${shade(bg, -10)}"/>
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${fg}" stroke-opacity="0.06" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#grid)"/>
    <g font-family="ui-monospace, SF Mono, Menlo, monospace" text-anchor="middle">
      <text x="${width / 2}" y="${height / 2 - 8}" font-size="28" font-weight="600" fill="${fg}">${escapeXml(opts.label)}</text>
      ${opts.sublabel ? `<text x="${width / 2}" y="${height / 2 + 24}" font-size="14" fill="${accent}">${escapeXml(opts.sublabel)}</text>` : ''}
    </g>
    <rect x="12" y="12" width="56" height="20" rx="3" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.5"/>
    <text x="40" y="26" font-family="ui-monospace, monospace" font-size="11" text-anchor="middle" fill="${accent}">PNG</text>
  </svg>`

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
