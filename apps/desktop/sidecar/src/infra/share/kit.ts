// Bộ DỰNG bản xuất dùng chung (mốc 6.5) — Markdown và HTML-một-file.
//
// VIẾT MỘT LẦN, BA BỀ MẶT DÙNG. `playbooks.md:134` nói rõ: playbook, báo cáo và
// graph kiến trúc "dùng chung một bộ xuất: cùng ba định dạng, cùng lớp che, cùng
// chân trang ghi nguồn". Nên tầng này KHÔNG biết gì về playbook/báo cáo/graph —
// nó biết `ShareDoc`, còn ai dựng `ShareDoc` là việc của `templates.ts`.
//
// TRẢ VỀ CHUỖI, KHÔNG GHI FILE. Cùng khuôn với `infra/audit/export.ts`: việc ghi
// phải đi qua `fs.writeFile` (đã có `assertInsideWorkspace`, ghi nguyên tử). Một
// đường ghi riêng ở đây chỉ để tiện là một đường ghi thứ hai phải bảo vệ — và nó
// sẽ là đường duy nhất không đi qua invariant #2.
//
// HTML MỘT FILE NGHĨA LÀ BA ĐIỀU, VÀ CẢ BA ĐỀU LÀ HÀNG RÀO:
//   1. KHÔNG `<script>`. Bản xuất đi qua email/chat; chạy được mã là biến một tệp
//      "báo cáo" thành vector chạy mã trên máy người nhận.
//   2. KHÔNG tài nguyên ngoài (`<link>`, `<img src>`, `@import`, `url(http…)`).
//      "Mở lên là đủ hiểu" là yêu cầu của spec; tệp tự gọi mạng về là vừa phá
//      yêu cầu đó vừa tạo một kênh rò rỉ (beacon) khi người nhận mở tệp.
//   3. CSS INLINE + SVG INLINE. Không có bước build, không có `dist/`.
// Có `Content-Security-Policy` ngay trong `<head>` như lưới an toàn thứ hai: kể
// cả khi một khối nội dung lọt được thẻ lạ vào markup thì trình duyệt vẫn từ chối
// nạp mã.
//
// SVG đi vào từ bên gọi (bề mặt UI đã vẽ sẵn) nên là dữ liệu L1 — `sanitizeSvg()`
// cắt `<script>`, thuộc tính `on*`, `javascript:` và `<foreignObject>` trước khi
// nhúng. Bản xuất Markdown KHÔNG nhúng SVG: nó dùng khối ```mermaid để GitHub/
// GitLab và `MermaidView.vue` của app tự render từ nguồn.

import { redactString } from '../../sessions/redact.js'
import { maskText, type MaskOptions } from './mask.js'

// ─── Hình dạng tài liệu ──────────────────────────────────────────────────────

export type ShareBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'list'; ordered?: boolean; items: readonly string[] }
  | { kind: 'table'; columns: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'callout'; tone: 'info' | 'warn' | 'danger'; text: string }
  /** Markdown đã định dạng sẵn (thân báo cáo do agent viết). Không parse lại. */
  | { kind: 'raw'; text: string }

export type ShareSection = { title: string; blocks: readonly ShareBlock[] }

/**
 * Sơ đồ. `mermaid` là nguồn dùng cho Markdown (và cho bản HTML khi không có
 * `svg`); `svg` là markup đã vẽ sẵn dùng cho bản HTML. Không bắt buộc phải có
 * cả hai: bề mặt nào chỉ có nguồn Mermaid thì bản HTML rơi về một khối
 * `<pre class="diagram-src">` — vẫn là tệp một-file hợp lệ, không script.
 */
export type ShareDiagram = { title?: string; mermaid?: string; svg?: string }

/** Chân trang bắt buộc của mọi bản xuất (spec §"Bản xuất là ảnh chụp"). */
export type ShareFooter = {
  /** ISO — bản xuất sinh lúc nào. */
  generatedAt: string
  /** Nguồn: tên playbook / loại báo cáo / "architecture graph". */
  sourceLabel: string
  /** Phiên bản nguồn (playbook `updatedAt`, hoặc nhãn phiên bản báo cáo). */
  sourceVersion: string
  /** Trạng thái lúc xuất (`awaiting-approval`, `done`, `rolled-back`…). */
  status: string
}

export type ShareDoc = {
  title: string
  subtitle?: string
  sections: readonly ShareSection[]
  diagram?: ShareDiagram
  footer: ShareFooter
  /**
   * Ngôn ngữ của bản xuất. Chỉ ảnh hưởng tới các CÂU CỐ ĐỊNH của bộ dựng (chân
   * trang); thân tài liệu do `templates.ts` lo theo cùng tham số này. Bản xuất đi
   * cho người đọc cùng ngôn ngữ với người xuất — một kế hoạch "đủ hiểu khi mở lên"
   * mà viết bằng thứ tiếng người nhận không đọc được thì đã trượt mục tiêu đó.
   */
  lang?: ShareLang
}

export type ShareFormat = 'markdown' | 'html'

export const SHARE_LANGS = ['en', 'vi'] as const
export type ShareLang = (typeof SHARE_LANGS)[number]

// ─── Tiện ích ────────────────────────────────────────────────────────────────

/**
 * Hàng rào dài hơn mọi dãy backtick có trong nội dung, để một khối ``` nằm
 * TRONG văn bản không đóng sớm khối của mình (cùng lý do `fenceFor` tồn tại ở
 * mọi bộ render markdown).
 */
function fenceFor(text: string): string {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Thoát ký tự điều khiển bảng của Markdown. */
function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function markdownBlock(block: ShareBlock): string[] {
  switch (block.kind) {
    case 'paragraph':
      return [block.text, '']
    case 'heading':
      return [`${'#'.repeat(block.level)} ${block.text}`, '']
    case 'list': {
      const bullet = block.ordered === true ? '1.' : '-'
      return [...block.items.map((item) => `${bullet} ${item}`), '']
    }
    case 'table': {
      const head = `| ${block.columns.map(mdCell).join(' | ')} |`
      const sep = `| ${block.columns.map(() => '---').join(' | ')} |`
      const rows = block.rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)
      return [head, sep, ...rows, '']
    }
    case 'code': {
      const fence = fenceFor(block.text)
      const lang = block.language ?? ''
      return [`${fence}${lang}`, block.text, fence, '']
    }
    case 'callout':
      // Blockquote + nhãn chữ: bản markdown không có "hộp", nên sắc thái phải
      // nằm ở chữ — cùng nguyên tắc "luôn có biểu tượng + chữ, không bao giờ chỉ
      // màu" của spec giám sát.
      return [`> ${CALLOUT_MARK[block.tone]} ${block.text}`, '']
    case 'raw':
      return [block.text, '']
  }
}

const CALLOUT_MARK: Record<'info' | 'warn' | 'danger', string> = {
  info: '**Note:**',
  warn: '**Warning:**',
  danger: '**Important:**',
}

// ─── Câu cố định của chân trang, hai thứ tiếng ───────────────────────────────
//
// Phần CHÈN VÀO (`generatedAt`, tên nguồn, trạng thái) là dữ liệu, không dịch.
// Chỉ hai câu do bộ dựng tự viết mới cần bản dịch.
type FooterLabels = { generated: string; status: string; snapshot: string }

const FOOTER_LABELS: Record<ShareLang, FooterLabels> = {
  en: {
    generated: 'Generated by AWOG on',
    status: 'status',
    snapshot:
      'This is a snapshot. Editing the source later does not change this file; ' +
      'exporting again produces a new file rather than overwriting this one.',
  },
  vi: {
    generated: 'AWOG sinh lúc',
    status: 'trạng thái',
    snapshot:
      'Đây là bản chụp. Sửa nguồn sau đó không làm đổi tệp này; ' +
      'xuất lại sẽ sinh tệp mới chứ không ghi đè.',
  },
}

function footerLabels(lang: ShareLang | undefined): FooterLabels {
  return FOOTER_LABELS[lang ?? 'en']
}

/**
 * Chân trang: ba thứ spec bắt buộc (sinh lúc nào · bản nào · trạng thái nào) cộng
 * một câu nói rõ bản xuất KHÔNG tự cập nhật — người đọc cần biết mình đang cầm
 * bản chụp, không phải bản sống.
 */
function markdownFooter(footer: ShareFooter, lang: ShareLang | undefined): string[] {
  const L = footerLabels(lang)
  return [
    '---',
    '',
    `_${L.generated} ${footer.generatedAt} · ${footer.sourceLabel} (${footer.sourceVersion}) · ` +
      `${L.status}: ${footer.status}_`,
    '',
    `_${L.snapshot}_`,
    '',
  ]
}

export function renderMarkdown(doc: ShareDoc): string {
  const lines: string[] = [`# ${doc.title}`, '']
  if (doc.subtitle) lines.push(`_${doc.subtitle}_`, '')
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, '')
    for (const block of section.blocks) lines.push(...markdownBlock(block))
  }
  if (doc.diagram?.mermaid) {
    lines.push(`## ${doc.diagram.title ?? 'Diagram'}`, '')
    lines.push('```mermaid', doc.diagram.mermaid, '```', '')
  }
  lines.push(...markdownFooter(doc.footer, doc.lang))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

// ─── HTML một file ───────────────────────────────────────────────────────────

// Sanitize SVG đến từ bên gọi. Bề mặt UI vẽ SVG này bằng mã của chính AWOG (không
// phải nội dung người dùng), nên đây là lưới an toàn chứ không phải hàng rào
// chính — nhưng nó là thứ đứng giữa "dữ liệu vào" và "markup phát ra", và bản
// xuất đi tới máy người khác.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(?:xlink:href|href)\s*=\s*"(?:javascript:|data:text\/html)[^"]*"/gi, '')
}

const CALLOUT_CLASS: Record<'info' | 'warn' | 'danger', string> = {
  info: 'callout info',
  warn: 'callout warn',
  danger: 'callout danger',
}

function htmlBlock(block: ShareBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`
    case 'heading':
      return block.level === 2 ? `<h3>${escapeHtml(block.text)}</h3>` : `<h4>${escapeHtml(block.text)}</h4>`
    case 'list': {
      const tag = block.ordered === true ? 'ol' : 'ul'
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
      return `<${tag}>${items}</${tag}>`
    }
    case 'table': {
      const head = block.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
      const rows = block.rows
        .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
        .join('')
      return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
    }
    case 'code':
      return `<pre class="code"><code>${escapeHtml(block.text)}</code></pre>`
    case 'callout':
      return `<div class="${CALLOUT_CLASS[block.tone]}"><p>${escapeHtml(block.text)}</p></div>`
    case 'raw':
      // Không có bộ parse Markdown trong sidecar (không thêm thư viện), nên thân
      // văn bản đã định dạng sẵn ra dưới dạng khối chữ nguyên văn. Nói rõ bằng
      // class để người đọc biết đây là chủ ý, không phải lỗi render.
      return `<pre class="raw">${escapeHtml(block.text)}</pre>`
  }
}

function htmlDiagram(diagram: ShareDiagram | undefined): string {
  if (!diagram) return ''
  const title = diagram.title ? `<figcaption>${escapeHtml(diagram.title)}</figcaption>` : ''
  if (diagram.svg) {
    return `<figure class="diagram">${sanitizeSvg(diagram.svg)}${title}</figure>`
  }
  if (diagram.mermaid) {
    return (
      `<figure class="diagram">` +
      `<pre class="diagram-src"><code>${escapeHtml(diagram.mermaid)}</code></pre>` +
      `<figcaption>Mermaid source — this single-file export has no script, so the diagram ` +
      `renders in any Mermaid-aware viewer (GitHub, the AWOG app).</figcaption>` +
      title +
      `</figure>`
    )
  }
  return ''
}

// CSS inline. Không `@import`, không `url()`, không font ngoài — font hệ thống.
// `@media print` biến Ctrl+P thành PDF gọn gàng (spec: "không thêm thư viện PDF").
const HTML_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 28px 48px;
  background: #ffffff;
  color: #1d1d1f;
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main { max-width: 860px; margin: 0 auto; }
h1 { font-size: 22px; line-height: 1.3; margin: 0 0 4px; }
h2 { font-size: 17px; line-height: 1.35; margin: 28px 0 10px; border-bottom: 1px solid #e5e5ea; padding-bottom: 6px; }
h3 { font-size: 15px; line-height: 1.4; margin: 18px 0 6px; }
h4 { font-size: 14px; line-height: 1.4; margin: 14px 0 6px; }
p { margin: 8px 0; }
ul, ol { margin: 8px 0; padding-left: 22px; }
li { margin: 3px 0; }
.subtitle { color: #6e6e73; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-variant-numeric: tabular-nums; }
th, td { border: 1px solid #e5e5ea; padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: #f5f5f7; font-weight: 600; }
pre.code, pre.raw, pre.diagram-src {
  background: #f5f5f7; border: 1px solid #e5e5ea; border-radius: 8px;
  padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.5;
}
.callout { border-left: 3px solid #8e8e93; background: #f5f5f7; border-radius: 0 8px 8px 0; padding: 8px 12px; margin: 10px 0; }
.callout.info { border-left-color: #0a84ff; }
.callout.warn { border-left-color: #ff9f0a; }
.callout.danger { border-left-color: #ff3b30; }
.callout p { margin: 0; }
figure.diagram { margin: 14px 0; }
figure.diagram svg { max-width: 100%; height: auto; background: #ffffff; }
figcaption { color: #6e6e73; font-size: 12px; margin-top: 6px; }
footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e5e5ea; color: #6e6e73; font-size: 12px; line-height: 1.5; }
footer p { margin: 4px 0; }
@media print {
  body { padding: 0; font-size: 11pt; }
  main { max-width: none; }
  h2 { break-after: avoid; }
  table, figure, pre { break-inside: avoid; }
  footer { position: static; }
}
@page { margin: 16mm; }
`

export function renderHtml(doc: ShareDoc): string {
  const parts: string[] = []
  parts.push(`<h1>${escapeHtml(doc.title)}</h1>`)
  if (doc.subtitle) parts.push(`<p class="subtitle">${escapeHtml(doc.subtitle)}</p>`)
  for (const section of doc.sections) {
    parts.push(`<h2>${escapeHtml(section.title)}</h2>`)
    for (const block of section.blocks) parts.push(htmlBlock(block))
  }
  parts.push(htmlDiagram(doc.diagram))
  const footer = doc.footer
  const L = footerLabels(doc.lang)
  parts.push(
    `<footer>` +
      `<p>${escapeHtml(L.generated)} ${escapeHtml(footer.generatedAt)} · ` +
      `${escapeHtml(footer.sourceLabel)} (${escapeHtml(footer.sourceVersion)}) · ` +
      `${escapeHtml(L.status)}: ${escapeHtml(footer.status)}</p>` +
      `<p>${escapeHtml(L.snapshot)}</p>` +
      `</footer>`,
  )
  return (
    `<!DOCTYPE html>\n<html lang="${doc.lang ?? 'en'}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">\n` +
    `<title>${escapeHtml(doc.title)}</title>\n` +
    `<style>${HTML_STYLE}</style>\n</head>\n<body>\n<main>\n` +
    parts.join('\n') +
    `\n</main>\n</body>\n</html>\n`
  )
}

export function renderDoc(doc: ShareDoc, format: ShareFormat): string {
  return format === 'html' ? renderHtml(doc) : renderMarkdown(doc)
}

// ─── Biến đổi nội dung trước khi render ──────────────────────────────────────
//
// Che/khử chạy trên CẤU TRÚC, không trên chuỗi đã render. Với HTML thì đó là bắt
// buộc: placeholder `<endpoint nội bộ>` chèn thẳng vào markup đã render sẽ vỡ
// thẻ (và là một lỗ XSS do chính mình tạo). Chạy trước, `escapeHtml` lo phần sau.

function mapDocText(doc: ShareDoc, fn: (text: string) => string): ShareDoc {
  const out: ShareDoc = {
    title: fn(doc.title),
    sections: doc.sections.map((section) => ({
      title: fn(section.title),
      blocks: section.blocks.map((block) => mapBlockText(block, fn)),
    })),
    footer: {
      generatedAt: doc.footer.generatedAt,
      sourceLabel: fn(doc.footer.sourceLabel),
      sourceVersion: fn(doc.footer.sourceVersion),
      status: fn(doc.footer.status),
    },
  }
  if (doc.lang !== undefined) out.lang = doc.lang
  if (doc.subtitle !== undefined) out.subtitle = fn(doc.subtitle)
  if (doc.diagram !== undefined) {
    const diagram: ShareDiagram = { ...doc.diagram }
    if (diagram.mermaid !== undefined) diagram.mermaid = fn(diagram.mermaid)
    if (diagram.title !== undefined) diagram.title = fn(diagram.title)
    out.diagram = diagram
  }
  return out
}

function mapBlockText(block: ShareBlock, fn: (text: string) => string): ShareBlock {
  switch (block.kind) {
    case 'paragraph':
    case 'code':
    case 'callout':
    case 'raw':
      return { ...block, text: fn(block.text) }
    case 'heading':
      return { ...block, text: fn(block.text) }
    case 'list':
      return { ...block, items: block.items.map(fn) }
    case 'table':
      return {
        ...block,
        columns: block.columns.map(fn),
        rows: block.rows.map((row) => row.map(fn)),
      }
  }
}

/** Lớp che hạ tầng (mặc định bật) — xem `mask.ts`. */
export function applyMask(doc: ShareDoc, opts: MaskOptions = {}): ShareDoc {
  return mapDocText(doc, (text) => maskText(text, opts))
}

/**
 * Lớp khử bí mật của `sessions/redact.ts` — spec yêu cầu "toàn bộ đi qua
 * `redact.ts` thêm một lớp nữa để bắt token lỡ nằm trong ghi chú". Chạy SAU lớp
 * che: hai bộ lọc trả lời hai câu hỏi khác nhau nên không thay thế nhau được.
 */
export function applyRedact(doc: ShareDoc): ShareDoc {
  return mapDocText(doc, redactString)
}

// ─── Tên tệp ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  )
}

/**
 * Tên tệp gợi ý: `<chủ đề>-<YYYYMMDD-HHMMSS>.<ext>`.
 *
 * Có GIÂY trong tên vì spec nói "xuất lại sinh bản mới, không ghi đè" — hai lần
 * xuất trong cùng một phút phải ra hai tên khác nhau (hộp thoại lưu của hệ điều
 * hành mở sẵn tên này; trùng tên là đường ngắn nhất tới một lần ghi đè).
 */
export function shareFilename(subject: string, format: ShareFormat, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
  return `${slugify(subject)}-${stamp}.${format === 'html' ? 'html' : 'md'}`
}
