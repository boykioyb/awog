// Xử lý mrkdwn của Slack phía sidecar — chỉ đủ để ra một dòng plain text cho
// `SlackThread.firstLine` (hiện trong cây thread, tiêu đề cửa sổ) và để gom
// mention/kênh/emoji xuất hiện trong tin. Render đầy đủ là việc của UI
// (`utils/slack-mrkdwn.ts`); hai bên KHÔNG dùng chung code vì sidecar không
// import gì từ renderer.
const FIRST_LINE_MAX = 120

const ENTITY: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&' }

export type NameResolver = (id: string) => string | null

// `<@U…|tên>`, `<#C…|tên>`, `<!here>`, `<!subteam^S…|@nhóm>`, `<url|chữ>`, `<url>`.
function replaceAngleTokens(text: string, resolveUser?: NameResolver): string {
  return text.replace(/<([^<>\n]+)>/g, (_whole, inner: string) => {
    const [target = '', label] = inner.split('|', 2)
    if (target.startsWith('@')) {
      const id = target.slice(1)
      return `@${label ?? resolveUser?.(id) ?? id}`
    }
    if (target.startsWith('#')) return `#${label ?? target.slice(1)}`
    if (target.startsWith('!')) {
      if (label) return label.startsWith('@') ? label : `@${label}`
      const word = target.slice(1).split('^')[0] ?? ''
      return `@${word}`
    }
    return label ?? target
  })
}

export function toPlainText(text: string, resolveUser?: NameResolver): string {
  let out = replaceAngleTokens(text, resolveUser)
  // Rào code: giữ nội dung, bỏ dấu rào.
  out = out.replace(/```/g, '')
  // `*đậm*`, `_nghiêng_`, `~gạch~`, `` `code` `` — chỉ khi dấu bám sát chữ, để
  // không ăn nhầm dấu sao/gạch dưới đứng lẻ trong câu.
  out = out.replace(/(^|[\s(])([*_~`])(\S(?:[^\n]*?\S)?)\2(?=$|[\s).,!?:;])/g, '$1$3')
  out = out.replace(/&(lt|gt|amp);/g, (e) => ENTITY[e] ?? e)
  return out
}

export function firstLine(text: string, resolveUser?: NameResolver): string {
  const plain = toPlainText(text, resolveUser)
  const line =
    plain
      .split('\n')
      .map((l) => l.replace(/^\s*(?:&gt;|>)\s?/, '').trim())
      .find((l) => l.length > 0) ?? ''
  const collapsed = line.replace(/\s+/g, ' ')
  if (collapsed.length <= FIRST_LINE_MAX) return collapsed
  return `${collapsed.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…`
}

export function mentionedUserIds(text: string): string[] {
  const ids = new Set<string>()
  for (const m of text.matchAll(/<@([UW][A-Z0-9]{6,})(?:\|[^>]*)?>/g)) {
    if (m[1]) ids.add(m[1])
  }
  return [...ids]
}

// `<#C…>` không kèm tên cần tra; kèm tên thì dùng luôn.
export function mentionedChannels(text: string): Array<{ id: string; name: string | null }> {
  const out = new Map<string, string | null>()
  for (const m of text.matchAll(/<#([CGD][A-Z0-9]{6,})(?:\|([^>]*))?>/g)) {
    if (!m[1]) continue
    const name = m[2] && m[2].length > 0 ? m[2] : null
    if (!out.has(m[1]) || name) out.set(m[1], name)
  }
  return [...out].map(([id, name]) => ({ id, name }))
}

// `:tên:` trong text (bỏ hậu tố tông da `::skin-tone-N`). Không cố phân biệt
// emoji chuẩn với tuỳ chỉnh ở đây — caller lọc theo danh sách tuỳ chỉnh.
export function emojiNames(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/:([\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{1,100}):/gu)) {
    if (m[1] && !m[1].startsWith('skin-tone-')) out.add(m[1])
  }
  return [...out]
}

export function baseEmojiName(name: string): string {
  return name.split('::')[0] ?? name
}

// Chữ do MODEL soạn để đi lên Slack (tool `slack_draft_reply`) → bỏ cú pháp điều khiển
// mà người dùng khó nhận ra lúc duyệt: `<!channel>`/`<!here>`/`<!everyone>`/
// `<!subteam^…>` (ping cả kênh / cả nhóm của KHÁCH) và `<url|nhãn>` (link giả nhãn).
// Model đọc thread do người ngoài viết, một câu injection có thể bắt nó chèn các
// token này. Đổi thành chữ đọc được (`@channel`, `nhãn (url)`) — Slack không coi chữ
// thường là lệnh ping. Giữ `<@U…>` (người dùng thấy `@Tên` trong ô), `<#C…>` và
// `<url>` trần (URL hiện nguyên văn). Renderer còn một lớp lọc nữa
// (`ui-next/utils/slack-mrkdwn.ts` → `mrkdwnToDraft`); đây là lớp ở nguồn.
const BROADCASTS = new Set(['here', 'channel', 'everyone'])

export function neutralizeDraftTokens(text: string): string {
  return text.replace(/<([^<>\n]+)>/g, (whole, inner: string) => {
    const bar = inner.indexOf('|')
    const target = bar < 0 ? inner : inner.slice(0, bar)
    const label = bar < 0 ? null : inner.slice(bar + 1)
    if (target.startsWith('!')) {
      const word = target.slice(1).split('^')[0] ?? ''
      if (BROADCASTS.has(word)) return `@${word}`
      if (word === 'subteam') return label || '@group'
      // `<!date^…|fallback>` và lệnh lạ: chỉ còn phần chữ.
      return label || word
    }
    if (target.startsWith('@') || target.startsWith('#')) return whole
    if (label === null) return whole
    return label && label !== target ? `${label} (${target})` : target
  })
}
