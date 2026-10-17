// Đọc permalink Slack người dùng dán vào ô "Thêm thread". Hàm thuần, không I/O.
//
// Hai dạng link gặp thực tế:
// - Nút "Copy link" của Slack: `https://<ws>.slack.com/archives/<C…>/p<16 số>`;
//   link vào MỘT REPLY mang thêm `?thread_ts=<ts tin gốc>&cid=<C…>`.
// - Thanh địa chỉ bản web: `https://app.slack.com/client/<T…>/<C…>/thread/<C…>-<ts>`.
//
// `p1729000000123456` là ts bỏ dấu chấm: 10 số giây + 6 số micro-giây ⇒ chèn
// lại dấu chấm sau chữ số thứ 10. Link vào một reply KHÔNG có `thread_ts` (một
// số client cắt query) thì không phân biệt được với link tin gốc — caller phải
// hỏi Slack xem tin đó có `thread_ts` khác chính nó không.
import { CHANNEL_RE, TEAM_RE, TS_RE } from './params.js'

export type SlackPermalink = {
  // `malme.slack.com`; null với link app.slack.com (không mang tên workspace).
  workspaceHost: string | null
  // Chỉ có ở link app.slack.com.
  teamId: string | null
  channelId: string
  // ts của chính tin được link tới.
  messageTs: string
  // ts tin gốc nếu link nói rõ (reply có `thread_ts`, hoặc link dạng /thread/);
  // null = chưa biết, có thể chính là `messageTs`.
  threadTs: string | null
}

function isSlackHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'slack.com' || h.endsWith('.slack.com')
}

function pToTs(p: string): string | null {
  const m = /^p(\d{10})(\d{6})$/.exec(p)
  return m ? `${m[1]}.${m[2]}` : null
}

export function parsePermalink(raw: string): SlackPermalink | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !isSlackHost(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)

  // https://<ws>.slack.com/archives/<C>/p<ts>
  if (parts[0] === 'archives' && parts.length >= 3) {
    const channelId = parts[1] ?? ''
    const messageTs = pToTs(parts[2] ?? '')
    if (!CHANNEL_RE.test(channelId) || !messageTs) return null
    const tt = url.searchParams.get('thread_ts')
    const threadTs = tt && TS_RE.test(tt) ? tt : null
    const host = url.hostname.toLowerCase()
    return {
      workspaceHost: host === 'slack.com' ? null : host,
      teamId: null,
      channelId,
      messageTs,
      threadTs,
    }
  }

  // https://app.slack.com/client/<T>/<C>/thread/<C>-<ts>
  if (parts[0] === 'client' && parts.length >= 5 && parts[3] === 'thread') {
    const teamId = parts[1] ?? ''
    const channelId = parts[2] ?? ''
    const m = /^([CGD][A-Z0-9]{6,})-(\d{10}\.\d{6})$/.exec(parts[4] ?? '')
    if (!TEAM_RE.test(teamId) || !CHANNEL_RE.test(channelId) || !m || m[1] !== channelId) {
      return null
    }
    const ts = m[2] ?? ''
    return { workspaceHost: null, teamId, channelId, messageTs: ts, threadTs: ts }
  }

  return null
}

// Host workspace từ `auth.test.url` (`https://malme.slack.com/`) để so với link.
export function hostOfTeamUrl(teamUrl: string): string | null {
  try {
    return new URL(teamUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}
