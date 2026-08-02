// DOCX (WordprocessingML) → a small block model the preview renders with plain
// Vue components. Deliberately a *reading* model, not a fidelity-faithful layout
// engine: headings, inline formatting, lists, tables, links and embedded images —
// the things that make a spec/brief readable in-app. Page geometry, sections,
// footnotes, revision marks and fields are out of scope; "open externally" stays
// the full-fidelity path.
//
// The model is structured data (no HTML string), so the view renders it through
// normal templates and never needs v-html.

import {
  attrNamed,
  childNamed,
  childrenNamed,
  descendantsNamed,
  imageMime,
  intAttr,
  intValNamed,
  OfficeParseError,
  parseRelationships,
  parseXmlRoot,
  resolvePartPath,
  toggleOn,
  valNamed,
  type Relationship,
} from './office-xml'
import {
  bytesToBase64,
  openZip,
  zipEntryBytes,
  zipEntryText,
  type Bytes,
  type Zip,
} from './office-zip'

export type DocxRun = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  mono?: boolean
  vert?: 'sup' | 'sub'
  /** External hyperlink target (internal anchors are dropped — nothing to jump to). */
  href?: string
}

export type DocxParaStyle = 'body' | 'h1' | 'h2' | 'h3' | 'h4' | 'quote' | 'code' | 'caption'

export type DocxParagraph = {
  type: 'p'
  style: DocxParaStyle
  align?: 'center' | 'right' | 'justify'
  /** Indent level: list level, or the paragraph's own left indent in "steps". */
  indent: number
  /** List marker ('•', '1.') — absent for non-list paragraphs. */
  marker?: string
  runs: DocxRun[]
}

export type DocxImage = { type: 'image'; src: string; alt: string; width: number }
export type DocxTableCell = { paras: DocxParagraph[]; colSpan: number }
export type DocxTable = { type: 'table'; rows: DocxTableCell[][] }
export type DocxBlock = DocxParagraph | DocxImage | DocxTable
export type DocxDoc = { blocks: DocxBlock[]; truncated: boolean }

// Bounds so a pathological file can't lock the renderer. A 6k-block document is
// already ~100 pages of prose; past that the preview says so and stops.
const MAX_BLOCKS = 6000
const MAX_IMAGES = 60
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const EMU_PER_PX = 9525
const BULLETS = ['•', '◦', '▪']
const MONO_FONTS = /mono|consol|courier|menlo/i

type StyleInfo = { name: string; basedOn: string | null }

type Ctx = {
  zip: Zip
  rels: Map<string, Relationship>
  /** numId → per-level number format ('bullet' | 'decimal' | …). */
  numbering: Map<string, string[]>
  styles: Map<string, StyleInfo>
  imageCount: number
  /** Running list counters per level, reset when the list identity changes. */
  counters: number[]
  lastNumId: string | null
}

export async function parseDocx(bytes: Bytes): Promise<DocxDoc> {
  const zip = openZip(bytes)
  const xml = await zipEntryText(zip, 'word/document.xml')
  if (!xml) throw new OfficeParseError('Not a Word document (word/document.xml missing)')

  const ctx: Ctx = {
    zip,
    rels: await loadRels(zip),
    numbering: await loadNumbering(zip),
    styles: await loadStyles(zip),
    imageCount: 0,
    counters: [],
    lastNumId: null,
  }
  const root = parseXmlRoot(xml)
  const body = childNamed(root, 'body') ?? root
  const blocks: DocxBlock[] = []
  const truncated = await collectBlocks(body, ctx, blocks)
  return { blocks, truncated }
}

/** Plain-text projection — used for "copy" and "add to chat". */
export function docxPlainText(doc: DocxDoc): string {
  const lines: string[] = []
  const paraText = (p: DocxParagraph): string =>
    (p.marker ? `${'  '.repeat(p.indent)}${p.marker} ` : '') + p.runs.map((r) => r.text).join('')
  for (const block of doc.blocks) {
    if (block.type === 'p') lines.push(paraText(block))
    else if (block.type === 'image') lines.push(block.alt ? `[${block.alt}]` : '[image]')
    else {
      for (const row of block.rows) {
        lines.push(row.map((c) => c.paras.map(paraText).join(' ')).join('\t'))
      }
    }
  }
  return lines.join('\n')
}

// ── body walk ────────────────────────────────────────────────────────────────
// Returns true when the block cap cut the document short. `sdt` (structured
// document tag — TOC, content controls) is transparent: its content is inlined.
async function collectBlocks(container: Element, ctx: Ctx, out: DocxBlock[]): Promise<boolean> {
  for (const el of Array.from(container.children)) {
    if (out.length >= MAX_BLOCKS) return true
    switch (el.localName) {
      case 'p': {
        const para = paragraphOf(el, ctx)
        // A picture-only paragraph contributes just its image(s).
        if (para.runs.length) out.push(para)
        out.push(...(await imagesOf(el, ctx)))
        break
      }
      case 'tbl':
        out.push(tableOf(el, ctx))
        break
      case 'sdt': {
        const content = childNamed(el, 'sdtContent')
        if (content && (await collectBlocks(content, ctx, out))) return true
        break
      }
      default:
        break // sectPr, bookmarks, proofing marks — nothing to render
    }
  }
  return false
}

// ── paragraph ────────────────────────────────────────────────────────────────
function paragraphOf(el: Element, ctx: Ctx): DocxParagraph {
  const pPr = childNamed(el, 'pPr')
  const styleId = pPr ? (valNamed(pPr, 'pStyle') ?? '') : ''
  const style = paraStyleOf(styleId, ctx)
  const runs = runsOf(el, ctx, style === 'code')

  const para: DocxParagraph = { type: 'p', style, indent: 0, runs }
  if (!pPr) return para

  const align = valNamed(pPr, 'jc')
  if (align === 'center' || align === 'right') para.align = align
  else if (align === 'both' || align === 'justify') para.align = 'justify'

  const numPr = childNamed(pPr, 'numPr')
  if (numPr) {
    const numId = valNamed(numPr, 'numId') ?? ''
    const level = intValNamed(numPr, 'ilvl') ?? 0
    para.indent = Math.min(Math.max(level, 0), 8)
    para.marker = listMarker(numId, para.indent, ctx)
    return para
  }

  // Not a list → derive a reading indent from the left indent (720 twips = 1 tab).
  const ind = childNamed(pPr, 'ind')
  const left = ind ? (intAttr(ind, 'left') ?? intAttr(ind, 'start')) : null
  if (left && left > 0) para.indent = Math.min(Math.round(left / 720), 8)
  return para
}

function paraStyleOf(styleId: string, ctx: Ctx): DocxParaStyle {
  if (!styleId) return 'body'
  // Prefer the human style name from styles.xml (localized/custom ids resolve
  // through it); fall back to the id itself ("Heading2" → "heading 2").
  const name = (resolveStyleName(styleId, ctx) || styleId.replace(/([a-z])([0-9])/gi, '$1 $2'))
    .toLowerCase()
    .trim()
  const heading = /^heading\s*([1-9])/.exec(name)
  if (heading) return `h${Math.min(Number(heading[1]), 4)}` as DocxParaStyle
  if (name === 'title') return 'h1'
  if (name === 'subtitle') return 'h2'
  if (name.includes('quote')) return 'quote'
  if (name.includes('caption')) return 'caption'
  if (name.includes('code') || name.includes('preformatted')) return 'code'
  return 'body'
}

// Walk basedOn once or twice so "MySpecHeading → Heading 2" still reads as h2.
function resolveStyleName(styleId: string, ctx: Ctx): string {
  let id: string | null = styleId
  for (let hop = 0; hop < 3 && id; hop++) {
    const info: StyleInfo | undefined = ctx.styles.get(id)
    if (!info) return ''
    if (/^heading|^title$|^subtitle$|quote|caption|code/i.test(info.name)) return info.name
    id = info.basedOn
  }
  return ctx.styles.get(styleId)?.name ?? ''
}

function listMarker(numId: string, level: number, ctx: Ctx): string {
  const fmt = ctx.numbering.get(numId)?.[level] ?? 'bullet'
  if (fmt === 'bullet' || fmt === 'none') return BULLETS[level % BULLETS.length] as string
  // A new list restarts the counters; a deeper level starts fresh under its parent.
  if (ctx.lastNumId !== numId) {
    ctx.counters = []
    ctx.lastNumId = numId
  }
  ctx.counters.length = level + 1
  ctx.counters[level] = (ctx.counters[level] ?? 0) + 1
  const n = ctx.counters[level] ?? 1
  if (fmt === 'lowerLetter') return `${letter(n).toLowerCase()}.`
  if (fmt === 'upperLetter') return `${letter(n)}.`
  if (fmt === 'lowerRoman') return `${roman(n).toLowerCase()}.`
  if (fmt === 'upperRoman') return `${roman(n)}.`
  return `${n}.`
}

const letter = (n: number): string => String.fromCharCode(64 + ((n - 1) % 26) + 1)

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let rest = n
  let out = ''
  for (const [value, sym] of table) {
    while (rest >= value) {
      out += sym
      rest -= value
    }
  }
  return out
}

// ── runs ─────────────────────────────────────────────────────────────────────
// Flattens the run containers Word nests text in (hyperlink / ins / smartTag /
// fldSimple / sdt); `del` (tracked deletion) is dropped so the accepted text reads
// as final.
function runsOf(container: Element, ctx: Ctx, forceMono: boolean, href?: string): DocxRun[] {
  const out: DocxRun[] = []
  for (const el of Array.from(container.children)) {
    switch (el.localName) {
      case 'r': {
        const run = runOf(el, forceMono, href)
        if (run) out.push(run)
        break
      }
      case 'hyperlink': {
        const rel = ctx.rels.get(attrNamed(el, 'id') ?? '')
        const link = rel?.external ? rel.target : href
        out.push(...runsOf(el, ctx, forceMono, link))
        break
      }
      case 'ins':
      case 'smartTag':
      case 'fldSimple':
      case 'bdo':
      case 'dir':
        out.push(...runsOf(el, ctx, forceMono, href))
        break
      case 'sdt': {
        const content = childNamed(el, 'sdtContent')
        if (content) out.push(...runsOf(content, ctx, forceMono, href))
        break
      }
      default:
        break // del, pPr, bookmarkStart, commentRangeStart…
    }
  }
  return out
}

function runOf(el: Element, forceMono: boolean, href?: string): DocxRun | null {
  let text = ''
  for (const child of Array.from(el.children)) {
    switch (child.localName) {
      case 't':
        text += child.textContent ?? ''
        break
      case 'tab':
        text += '\t'
        break
      case 'br':
      case 'cr':
        text += '\n'
        break
      case 'noBreakHyphen':
        text += '-'
        break
      default:
        break
    }
  }
  if (!text) return null

  const run: DocxRun = { text }
  const rPr = childNamed(el, 'rPr')
  if (rPr) {
    if (toggleOn(rPr, 'b')) run.bold = true
    if (toggleOn(rPr, 'i')) run.italic = true
    if (toggleOn(rPr, 'strike') || toggleOn(rPr, 'dstrike')) run.strike = true
    const underline = childNamed(rPr, 'u')
    if (underline && attrNamed(underline, 'val') !== 'none') run.underline = true
    const vert = valNamed(rPr, 'vertAlign')
    if (vert === 'superscript') run.vert = 'sup'
    else if (vert === 'subscript') run.vert = 'sub'
    const fonts = childNamed(rPr, 'rFonts')
    const ascii = fonts ? (attrNamed(fonts, 'ascii') ?? '') : ''
    if (MONO_FONTS.test(ascii)) run.mono = true
  }
  if (forceMono) run.mono = true
  if (href) run.href = href
  return run
}

// ── images ───────────────────────────────────────────────────────────────────
// DrawingML (`a:blip r:embed`) and legacy VML (`v:imagedata r:id`). Media is
// inlined as a data URL: the bytes are already in memory and a relative src would
// resolve against app://, not the document.
async function imagesOf(para: Element, ctx: Ctx): Promise<DocxImage[]> {
  const out: DocxImage[] = []
  const refs: { id: string; width: number; alt: string }[] = []

  for (const drawing of descendantsNamed(para, 'drawing')) {
    const blip = descendantsNamed(drawing, 'blip')[0]
    const id = blip ? attrNamed(blip, 'embed') : null
    if (!id) continue
    const extent = descendantsNamed(drawing, 'extent')[0]
    const cx = extent ? intAttr(extent, 'cx') : null
    const docPr = descendantsNamed(drawing, 'docPr')[0]
    refs.push({
      id,
      width: cx ? Math.round(cx / EMU_PER_PX) : 0,
      alt: docPr ? (attrNamed(docPr, 'descr') ?? attrNamed(docPr, 'name') ?? '') : '',
    })
  }
  for (const data of descendantsNamed(para, 'imagedata')) {
    const id = attrNamed(data, 'id')
    if (id) refs.push({ id, width: 0, alt: attrNamed(data, 'title') ?? '' })
  }

  // Word wraps some pictures in mc:AlternateContent — the DrawingML choice and the
  // VML fallback point at the SAME relationship, which would render twice.
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    if (ctx.imageCount >= MAX_IMAGES) break
    const rel = ctx.rels.get(ref.id)
    if (!rel || rel.external) continue
    const part = resolvePartPath('word/document.xml', rel.target)
    const mime = imageMime(part)
    if (!mime) continue // EMF/WMF and friends can't render in a browser
    const entry = ctx.zip.entries.get(part)
    if (!entry || entry.size > MAX_IMAGE_BYTES) continue
    const bytes = await zipEntryBytes(ctx.zip, part)
    if (!bytes) continue
    ctx.imageCount++
    out.push({
      type: 'image',
      src: `data:${mime};base64,${bytesToBase64(bytes)}`,
      alt: ref.alt,
      width: ref.width,
    })
  }
  return out
}

// ── tables ───────────────────────────────────────────────────────────────────
// Cells render their paragraphs only — a picture inside a table cell is skipped
// (rare in the documents this preview is for, and it keeps the walk synchronous).
function tableOf(el: Element, ctx: Ctx): DocxTable {
  const rows: DocxTableCell[][] = []
  for (const tr of childrenNamed(el, 'tr')) {
    const cells: DocxTableCell[] = []
    for (const tc of childrenNamed(tr, 'tc')) {
      const tcPr = childNamed(tc, 'tcPr')
      const span = tcPr ? intValNamed(tcPr, 'gridSpan') : null
      const paras: DocxParagraph[] = []
      for (const p of childrenNamed(tc, 'p')) {
        const para = paragraphOf(p, ctx)
        if (para.runs.length) paras.push(para)
      }
      cells.push({ paras, colSpan: span && span > 1 ? span : 1 })
    }
    if (cells.length) rows.push(cells)
  }
  return { type: 'table', rows }
}

// ── side parts (rels / numbering / styles) ───────────────────────────────────
async function loadRels(zip: Zip): Promise<Map<string, Relationship>> {
  const xml = await zipEntryText(zip, 'word/_rels/document.xml.rels')
  return xml ? parseRelationships(xml) : new Map()
}

// numId → abstractNum → per-level w:numFmt. Only the format matters here; start
// values and restart rules are approximated by the renderer's own counters.
async function loadNumbering(zip: Zip): Promise<Map<string, string[]>> {
  const xml = await zipEntryText(zip, 'word/numbering.xml')
  if (!xml) return new Map()
  try {
    const root = parseXmlRoot(xml)
    const abstract = new Map<string, string[]>()
    for (const el of childrenNamed(root, 'abstractNum')) {
      const id = attrNamed(el, 'abstractNumId')
      if (!id) continue
      const levels: string[] = []
      for (const lvl of childrenNamed(el, 'lvl')) {
        const index = intAttr(lvl, 'ilvl') ?? levels.length
        levels[index] = valNamed(lvl, 'numFmt') ?? 'bullet'
      }
      abstract.set(id, levels)
    }
    const out = new Map<string, string[]>()
    for (const el of childrenNamed(root, 'num')) {
      const numId = attrNamed(el, 'numId')
      const abstractId = valNamed(el, 'abstractNumId')
      if (numId && abstractId) out.set(numId, abstract.get(abstractId) ?? [])
    }
    return out
  } catch {
    return new Map() // a broken numbering part only costs us list markers
  }
}

async function loadStyles(zip: Zip): Promise<Map<string, StyleInfo>> {
  const xml = await zipEntryText(zip, 'word/styles.xml')
  if (!xml) return new Map()
  try {
    const out = new Map<string, StyleInfo>()
    for (const el of childrenNamed(parseXmlRoot(xml), 'style')) {
      const id = attrNamed(el, 'styleId')
      if (!id) continue
      out.set(id, { name: valNamed(el, 'name') ?? '', basedOn: valNamed(el, 'basedOn') })
    }
    return out
  } catch {
    return new Map() // fall back to classifying by styleId
  }
}
