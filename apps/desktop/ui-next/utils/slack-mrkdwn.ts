// Parse mrkdwn của Slack thành cây token để render bằng component (không v-html).
//
// File THUẦN và cố ý không import gì: test chạy trực tiếp bằng type-stripping của Node
// (`pnpm test:unit`), mà Node không hiểu alias `~/` và không tự thêm đuôi `.ts`. Tra
// emoji/user/kênh là việc của bên render — parser chỉ trả tên/id.
//
// Quy ước của Slack mà parser bám theo:
//   - `<…>` là cú pháp điều khiển (mention, kênh, link); ký tự `<` `>` `&` người gõ
//     đã được Slack mã hoá thành `&lt;` `&gt;` `&amp;`. Vì thế phải tách `<…>` TRƯỚC,
//     rồi mới giải mã entity ở lá text.
//   - `*bold*` `_italic_` `~strike~` chỉ có hiệu lực trong MỘT dòng, mở khi ký tự trước
//     không phải chữ/số ASCII và ký tự sau không phải khoảng trắng; đóng khi ký tự
//     trước không phải khoảng trắng và ký tự sau không phải chữ/số ASCII. Chỉ xét
//     ASCII là cố ý: tiếng Nhật không có khoảng trắng giữa từ (`これは*太字*です`).
//   - Dòng bắt đầu `&gt;` là trích dẫn; `&gt;&gt;&gt;` trích dẫn toàn bộ phần còn lại.

export type MrkInline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'strike'; c: MrkInline[] }
  | { t: 'code'; v: string }
  | { t: 'user'; id: string; label: string | null }
  | { t: 'channel'; id: string; label: string | null }
  | { t: 'broadcast'; name: 'here' | 'channel' | 'everyone' }
  | { t: 'group'; label: string }
  | { t: 'link'; url: string; label: string | null }
  | { t: 'emoji'; name: string; skin: number | null }
  | { t: 'br' }

export type MrkBlock =
  | { t: 'para'; c: MrkInline[] }
  | { t: 'quote'; c: MrkInline[] }
  | { t: 'pre'; v: string }

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt);/g, (m) => ENTITY[m] ?? m)
}

export function encodeEntities(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const isWordChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9]/.test(ch)
const isSpace = (ch: string | undefined): boolean => !ch || /\s/.test(ch)

// Cùng lớp ký tự với validate của sidecar: tên emoji tuỳ chỉnh có thể là chữ Nhật (`:了解:`).
const EMOJI_AT = /^:([\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{1,100}):(?::skin-tone-([2-6]):)?/u
const SAFE_URL = /^(https?:\/\/|mailto:)/i

// `<…>` → token. Trả null khi nội dung không phải cú pháp Slack (để giữ nguyên text).
function angleToken(body: string): MrkInline | null {
  const bar = body.indexOf('|')
  const head = bar < 0 ? body : body.slice(0, bar)
  const label = bar < 0 ? null : decodeEntities(body.slice(bar + 1)) || null
  if (head.startsWith('@')) {
    const id = head.slice(1)
    return /^[UW][A-Z0-9]+$/.test(id) ? { t: 'user', id, label } : null
  }
  if (head.startsWith('#')) {
    const id = head.slice(1)
    return /^[CGD][A-Z0-9]+$/.test(id) ? { t: 'channel', id, label } : null
  }
  if (head.startsWith('!')) {
    const cmd = head.slice(1)
    if (cmd === 'here' || cmd === 'channel' || cmd === 'everyone')
      return { t: 'broadcast', name: cmd }
    if (cmd.startsWith('subteam^')) return { t: 'group', label: label ?? '@group' }
    // `<!date^…|fallback>` và lệnh lạ khác: chỉ còn phần fallback đọc được.
    return label ? { t: 'text', v: label } : null
  }
  const url = decodeEntities(head)
  if (SAFE_URL.test(url)) return { t: 'link', url, label }
  return null
}

// Vị trí `>` đóng của `<` tại `from`, hoặc -1. `<…>` không lồng và không qua dòng.
function angleEnd(s: string, from: number): number {
  for (let j = from + 1; j < s.length; j++) {
    if (s[j] === '>') return j
    if (s[j] === '<' || s[j] === '\n') return -1
  }
  return -1
}

// Tìm dấu đóng cho marker `m` mở ở `from`, bỏ qua `<…>` và `` `…` `` ở giữa.
function findCloser(s: string, from: number, m: string): number {
  for (let j = from + 1; j < s.length; j++) {
    const ch = s[j]
    if (ch === '<') {
      const e = angleEnd(s, j)
      if (e > 0) j = e
      continue
    }
    if (ch === '`') {
      const e = s.indexOf('`', j + 1)
      if (e > 0) j = e
      continue
    }
    if (ch === m && j > from + 1 && !isSpace(s[j - 1]) && !isWordChar(s[j + 1])) return j
  }
  return -1
}

const MARK: Record<string, 'bold' | 'italic' | 'strike'> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
}

/** Parse một dòng (không chứa `\n`) thành inline token. */
export function parseInline(s: string): MrkInline[] {
  const out: MrkInline[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) out.push({ t: 'text', v: decodeEntities(buf) })
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    if (ch === '<') {
      const e = angleEnd(s, i)
      const tok = e > 0 ? angleToken(s.slice(i + 1, e)) : null
      if (tok) {
        flush()
        out.push(tok)
        i = e + 1
        continue
      }
    } else if (ch === '`') {
      const e = s.indexOf('`', i + 1)
      if (e > i + 1) {
        flush()
        out.push({ t: 'code', v: decodeEntities(s.slice(i + 1, e)) })
        i = e + 1
        continue
      }
    } else if (ch === ':' && !isWordChar(s[i - 1])) {
      const m = EMOJI_AT.exec(s.slice(i))
      if (m) {
        flush()
        out.push({ t: 'emoji', name: m[1]!, skin: m[2] ? Number(m[2]) : null })
        i += m[0].length
        continue
      }
    } else if (MARK[ch] && !isWordChar(s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== ch) {
      const e = findCloser(s, i, ch)
      if (e > 0) {
        flush()
        out.push({ t: MARK[ch]!, c: parseInline(s.slice(i + 1, e)) })
        i = e + 1
        continue
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

function linesToInline(lines: string[]): MrkInline[] {
  const out: MrkInline[] = []
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ t: 'br' })
    out.push(...parseInline(line))
  })
  return out
}

const QUOTE_ALL = /^&gt;&gt;&gt; ?/
const QUOTE_LINE = /^&gt; ?/

// Phần text ngoài khối code → đoạn văn + trích dẫn.
function textBlocks(text: string): MrkBlock[] {
  const blocks: MrkBlock[] = []
  const lines = text.split('\n')
  let kind: 'para' | 'quote' | null = null
  let acc: string[] = []
  const push = (): void => {
    if (kind && acc.length) blocks.push({ t: kind, c: linesToInline(acc) })
    kind = null
    acc = []
  }
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!
    if (QUOTE_ALL.test(line)) {
      push()
      kind = 'quote'
      acc = [line.replace(QUOTE_ALL, ''), ...lines.slice(idx + 1)]
      push()
      return blocks
    }
    const next: 'para' | 'quote' = QUOTE_LINE.test(line) ? 'quote' : 'para'
    if (kind !== next) push()
    kind = next
    acc.push(next === 'quote' ? line.replace(QUOTE_LINE, '') : line)
  }
  push()
  return blocks
}

/** Parse cả tin nhắn mrkdwn thành danh sách block. */
export function parseMrkdwn(text: string): MrkBlock[] {
  const blocks: MrkBlock[] = []
  const fence = /```([\s\S]*?)```/g
  let last = 0
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const before = text.slice(last, m.index).replace(/\n$/, '')
    if (before.trim()) blocks.push(...textBlocks(before))
    blocks.push({ t: 'pre', v: decodeEntities(m[1]!.replace(/^\n/, '').replace(/\n$/, '')) })
    last = m.index + m[0].length
  }
  const rest = text.slice(last).replace(/^\n/, '')
  if (rest.trim()) blocks.push(...textBlocks(rest))
  return blocks
}

// ── Chuyển giữa mrkdwn và bản nháp người gõ ────────────────────────────────────
//
// Ô soạn là textarea thường. Mention user hiện dạng `@Tên` và được ghi lại trong
// `mentions` (nhãn → userId); lúc gửi `@Tên` đổi thành `<@U…>`. Phần còn lại mã hoá
// entity để `<` `>` `&` người gõ không bị Slack hiểu thành cú pháp điều khiển.
//
// Token điều khiển KHÁC mention (`<#C…|kênh>`, `<url|nhãn>`, `<!here>`, `<!date…>`) có
// trong tin gốc thì giữ NGUYÊN DẠNG `<…>` trong ô và ghi vào `tokens`; lúc gửi, chuỗi
// nào khớp đúng một token đã ghi thì đi thẳng, không mã hoá. Đổi sang chữ đọc được
// (`#kênh`, `nhãn (url)`) như bản trước thì sửa một tin là mất link/kênh/@here vĩnh
// viễn. Chỉ token CÓ SẴN trong tin gốc mới được giữ: `<!channel>` người dùng tự gõ vẫn
// là chữ thường như trước, không thành lệnh ping cả kênh.
//
// "Tin gốc" chỉ đáng tin khi nó là TIN CỦA CHÍNH NGƯỜI DÙNG đang sửa (`keep: 'all'`).
// Nháp agent và bản dịch là chữ MODEL sinh ra — model đọc thread do người ngoài viết,
// một câu injection có thể bắt nó chèn `<!channel>` (ping cả kênh khách) hay
// `<https://lừa|tài liệu>` (link giả nhãn) để người dùng bấm Gửi mà không thấy. Với hai
// nguồn đó chỉ giữ mention user `<@U…>` (người dùng thấy `@Tên` trong ô), token nằm
// trong danh sách `keep` truyền vào (bản dịch: token của bản nháp TRƯỚC khi dịch); mọi
// token khác thành chữ đọc được (`@channel`, `nhãn (url)`), lúc gửi được mã hoá như chữ.

export type DraftMention = { label: string; id: string }
export type SlackDraft = { draft: string; mentions: DraftMention[]; tokens: string[] }

const ANGLE = /<([^<>\n]+)>/g

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Nhãn mention cho user `id` không trùng nhãn của user KHÁC đã có trong `taken` — hai
 * người cùng tên hiển thị mà chung nhãn thì lúc gửi cả hai thành cùng một `<@U…>`.
 * Trùng ⇒ thêm tên thật trong ngoặc; vẫn trùng (hoặc không có tên thật) ⇒ thêm id.
 */
export function uniqueMentionLabel(
  base: string,
  alt: string | null,
  id: string,
  taken: readonly DraftMention[],
): string {
  const free = (label: string): boolean => !taken.some((m) => m.label === label && m.id !== id)
  if (free(base)) return base
  const withAlt = alt && alt !== base ? `${base} (${alt})` : null
  if (withAlt && free(withAlt)) return withAlt
  return `${base} (${id})`
}

// Một đoạn chữ người gõ (không chứa token giữ nguyên) → mrkdwn. Thay mọi nhãn trong MỘT
// lượt quét, nhãn dài trước (`@Tanaka (Jiro)` thắng `@Tanaka`): thay lần lượt từng nhãn
// thì nhãn sau có thể khớp vào `<@U…>` vừa chèn của nhãn trước.
function encodeTyped(s: string, mentions: readonly DraftMention[]): string {
  const out = encodeEntities(s)
  if (!mentions.length) return out
  const byLabel = new Map(mentions.map((m) => [encodeEntities(`@${m.label}`), m.id]))
  const alts = [...byLabel.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  return out.replace(
    new RegExp(`(?:${alts.join('|')})(?![\\w])`, 'g'),
    (hit) => `<@${byLabel.get(hit)}>`,
  )
}

/** Bản nháp + mention + token giữ nguyên → text mrkdwn gửi Slack. */
export function draftToMrkdwn(
  draft: string,
  mentions: readonly DraftMention[],
  tokens: readonly string[] = [],
): string {
  const keep = new Set(tokens)
  let out = ''
  let last = 0
  for (const m of draft.matchAll(ANGLE)) {
    if (!keep.has(m[0])) continue
    const at = m.index ?? 0
    out += encodeTyped(draft.slice(last, at), mentions) + m[0]
    last = at + m[0].length
  }
  return out + encodeTyped(draft.slice(last), mentions)
}

/**
 * Text mrkdwn (tin cũ để sửa, nháp agent, bản dịch trả về) → bản nháp có `@Tên` +
 * mentions + token giữ nguyên. `altName` (tên thật) chỉ dùng để tách hai người trùng
 * tên hiển thị. `keep` = token điều khiển nào được giữ dạng `<…>`: `'all'` CHỈ cho tin
 * của chính người dùng; mặc định `[]` (chữ do model sinh) — xem ghi chú đầu mục.
 */
export function mrkdwnToDraft(
  text: string,
  userName: (id: string) => string | null,
  altName: (id: string) => string | null = () => null,
  keep: 'all' | readonly string[] = [],
): SlackDraft {
  const mentions: DraftMention[] = []
  const tokens: string[] = []
  let draft = ''
  let last = 0
  for (const m of text.matchAll(ANGLE)) {
    const whole = m[0]
    const at = m.index ?? 0
    draft += decodeEntities(text.slice(last, at))
    last = at + whole.length
    const tok = angleToken(m[1]!)
    if (tok?.t === 'user') {
      let mention = mentions.find((x) => x.id === tok.id)
      if (!mention) {
        const base = userName(tok.id) ?? tok.label ?? tok.id
        mention = { label: uniqueMentionLabel(base, altName(tok.id), tok.id, mentions), id: tok.id }
        mentions.push(mention)
      }
      draft += `@${mention.label}`
    } else if (tok && (keep === 'all' || keep.includes(whole))) {
      draft += whole
      if (!tokens.includes(whole)) tokens.push(whole)
    } else if (tok) {
      // Token không được giữ ⇒ chữ đọc được; lúc gửi bị mã hoá như chữ người gõ.
      draft += readable(tok, userName) ?? decodeEntities(whole)
    } else {
      draft += decodeEntities(whole)
    }
  }
  draft += decodeEntities(text.slice(last))
  return { draft, mentions, tokens }
}

// Token → chữ đọc được (copy, xem trước).
function readable(tok: MrkInline, userName: (id: string) => string | null): string | null {
  if (tok.t === 'user') return `@${userName(tok.id) ?? tok.label ?? tok.id}`
  if (tok.t === 'channel') return `#${tok.label ?? tok.id}`
  if (tok.t === 'broadcast') return `@${tok.name}`
  if (tok.t === 'group') return tok.label
  if (tok.t === 'link')
    return tok.label && tok.label !== tok.url ? `${tok.label} (${tok.url})` : tok.url
  if (tok.t === 'text') return tok.v
  return null
}

/** Text đọc được (copy, xem trước) — mention thành `@Tên`, link thành nhãn/URL. */
export function mrkdwnToPlain(text: string, userName: (id: string) => string | null): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(ANGLE)) {
    const at = m.index ?? 0
    out += decodeEntities(text.slice(last, at))
    last = at + m[0].length
    const tok = angleToken(m[1]!)
    out += (tok && readable(tok, userName)) ?? decodeEntities(m[0])
  }
  return out + decodeEntities(text.slice(last))
}
