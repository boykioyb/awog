// Namespace-tolerant XML helpers for the OOXML previews. OOXML parts mix
// prefixed markup (`<w:p>` in WordprocessingML) with default-namespaced markup
// (`<row>` in SpreadsheetML), and producers are free to pick their own prefixes —
// so every lookup here goes through localName instead of the qualified name.
//
// DOMParser is the platform parser: no external entity resolution (no XXE) and no
// script execution, and we only ever read values out of it — the preview never
// injects a part's markup into the DOM (no v-html).

export class XmlError extends Error {}

/** A part is missing / unreadable — the preview surfaces this as "can't read". */
export class OfficeParseError extends Error {}

/** Parse an XML part and return its root element. Throws on malformed XML. */
export function parseXmlRoot(text: string): Element {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement
  if (!root || root.getElementsByTagName('parsererror').length || root.nodeName === 'parsererror') {
    throw new XmlError('Malformed XML part')
  }
  return root
}

/** Direct children with this local name. */
export function childrenNamed(el: Element, local: string): Element[] {
  const out: Element[] = []
  for (const child of Array.from(el.children)) if (child.localName === local) out.push(child)
  return out
}

/** First direct child with this local name, or null. */
export function childNamed(el: Element, local: string): Element | null {
  for (const child of Array.from(el.children)) if (child.localName === local) return child
  return null
}

/** True when a direct child with this local name exists (OOXML boolean flags). */
export const hasChild = (el: Element, local: string): boolean => childNamed(el, local) != null

/** All descendants with this local name, in document order. */
export const descendantsNamed = (el: Element | Document, local: string): Element[] =>
  Array.from(el.getElementsByTagNameNS('*', local))

/** First descendant with this local name, or null. */
export const firstDescendant = (el: Element | Document, local: string): Element | null =>
  el.getElementsByTagNameNS('*', local).item(0)

/** Attribute value by local name (`w:val`, `r:id` and bare `val` all match `val`). */
export function attrNamed(el: Element, local: string): string | null {
  const direct = el.getAttribute(local)
  if (direct != null) return direct
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === local) return attr.value
  }
  return null
}

/** `<w:pStyle w:val="Heading1"/>` → 'Heading1'. Null when the child is absent. */
export function valNamed(parent: Element, local: string): string | null {
  const child = childNamed(parent, local)
  return child ? attrNamed(child, 'val') : null
}

/** Numeric flavour of {@link valNamed}. */
export function intValNamed(parent: Element, local: string): number | null {
  const raw = valNamed(parent, local)
  if (raw == null) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * OOXML boolean toggle (`<w:b/>`, `<w:b w:val="0"/>`): present means on unless the
 * value explicitly says off.
 */
export function toggleOn(el: Element, local: string): boolean {
  const child = childNamed(el, local)
  if (!child) return false
  const val = attrNamed(child, 'val')
  return val == null || !['0', 'false', 'off'].includes(val)
}

/** Integer attribute by local name, or null when absent / unparsable. */
export function intAttr(el: Element, local: string): number | null {
  const raw = attrNamed(el, local)
  if (raw == null) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve a relationship target against the part that declares it
 * (`word/document.xml` + `media/img.png` → `word/media/img.png`). Absolute targets
 * ("/word/media/x.png") are workbook-root relative.
 */
export function resolvePartPath(ownerPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const base = ownerPart.slice(0, ownerPart.lastIndexOf('/') + 1)
  const out: string[] = base ? base.replace(/\/$/, '').split('/') : []
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

export type Relationship = { id: string; type: string; target: string; external: boolean }

/** Parse a `_rels/*.rels` part into id → relationship. */
export function parseRelationships(xml: string): Map<string, Relationship> {
  const out = new Map<string, Relationship>()
  for (const el of descendantsNamed(parseXmlRoot(xml), 'Relationship')) {
    const id = attrNamed(el, 'Id')
    const target = attrNamed(el, 'Target')
    if (!id || !target) continue
    out.set(id, {
      id,
      type: attrNamed(el, 'Type') ?? '',
      target,
      external: attrNamed(el, 'TargetMode') === 'External',
    })
  }
  return out
}

/** Extension → image MIME, for inlining embedded media as a data URL. */
export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    default:
      return ''
  }
}
