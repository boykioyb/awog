// Bảng emoji chuẩn của Slack (shortcode → unicode) cho render mrkdwn, chip reaction và
// picker. Dữ liệu ở `assets/slack-emoji.json`: ĐỦ bộ shortcode Slack (~1.900, từ
// emoji-datasource — sinh bằng `scripts/gen-slack-emoji.mjs`), chia nhóm theo tab picker,
// cộng alias (`thumbsup` → `+1`) và danh sách emoji nhận skin tone. Bản soạn tay ~500
// emoji trước đây thiếu cả biến thể giới tính (`man-bowing`) ⇒ hiện thành chữ.
// Emoji không có trong bảng thì bên render giữ nguyên `:name:` dạng chip text.
import data from '~/assets/slack-emoji.json'

export type EmojiItem = { name: string; char: string }
export type EmojiGroup = { id: string; items: EmojiItem[] }

type RawData = {
  groups: { id: string; items: string[][] }[]
  aliases: Record<string, string>
  skin: string[]
}

const raw = data as RawData

export const EMOJI_GROUPS: EmojiGroup[] = raw.groups.map((g) => ({
  id: g.id,
  items: g.items.map(([name = '', char = '']) => ({ name, char })),
}))

const BY_NAME = new Map<string, string>()
for (const g of EMOJI_GROUPS) for (const it of g.items) BY_NAME.set(it.name, it.char)
const SKINNABLE = new Set(raw.skin)

// Ký tự điều chỉnh màu da Fitzpatrick, theo số `skin-tone-N` của Slack (2…6).
const SKIN_MOD: Record<number, string> = {
  2: '\u{1F3FB}',
  3: '\u{1F3FC}',
  4: '\u{1F3FD}',
  5: '\u{1F3FE}',
  6: '\u{1F3FF}',
}

const VS16 = /\uFE0F/g

/** Tên Slack có thể kèm skin tone dạng `+1::skin-tone-3` (tên reaction). */
export function splitSkin(name: string): { base: string; skin: number | null } {
  const m = /^(.+?)::skin-tone-([2-6])$/.exec(name)
  return m ? { base: m[1]!, skin: Number(m[2]) } : { base: name, skin: null }
}

export function canonicalEmojiName(name: string): string {
  return raw.aliases[name] ?? name
}

function withSkin(char: string, skin: number): string {
  const mod = SKIN_MOD[skin]
  if (!mod) return char
  const [first, ...rest] = Array.from(char.replace(VS16, ''))
  // Modifier đi ngay sau code point đầu — đúng cho cả emoji đơn lẫn chuỗi ZWJ (👨‍💻),
  // nơi nối vào cuối sẽ tô màu nhầm phần sau.
  return `${first}${mod}${rest.join('')}`
}

/** Unicode của một emoji chuẩn, hoặc null khi không biết (custom hoặc lạ). */
export function standardEmoji(name: string, skin: number | null = null): string | null {
  const split = splitSkin(name)
  const base = canonicalEmojiName(split.base)
  const char = BY_NAME.get(base)
  if (!char) return null
  const tone = skin ?? split.skin
  return tone && SKINNABLE.has(base) ? withSkin(char, tone) : char
}

// Emoji hay dùng trong trao đổi công việc với khách Nhật — bù vào tab "Gần đây" khi
// người dùng chưa có / chưa đủ emoji gần đây (cúi chào, cảm ơn, đã xem, đã xong, OK…).
export const POPULAR_EMOJI: readonly string[] = [
  '+1',
  'pray',
  'bow',
  'man-bowing',
  'eyes',
  'white_check_mark',
  'ok_woman',
  'ok_hand',
  'accept',
  'white_flower',
  'raised_hands',
  'clap',
  'tada',
  'sparkles',
  'o',
  'x',
  'ok',
  'muscle',
  'thinking_face',
  'sweat_smile',
  'sweat_drops',
  'joy',
  'heart',
  'fire',
]

// Từ khoá tìm kiếm (en / vi / ja) cho emoji hay dùng — shortcode Slack không chứa các
// từ người dùng hay gõ ("like", "cảm ơn", "了解"…). Khoá là shortcode chuẩn.
const KEYWORDS: Record<string, readonly string[]> = {
  '+1': ['like', 'good', 'thích', 'tốt', 'đồng ý', 'いいね', '了解', 'グッド'],
  ok_hand: ['ok', 'oke', 'được', 'オーケー', 'オッケー'],
  ok_woman: ['ok', 'được', '了解', '承知', 'オッケー', 'まる'],
  'man-gesturing-ok': ['ok', 'được', '了解', '承知'],
  'woman-gesturing-ok': ['ok', 'được', '了解', '承知'],
  ok: ['ok', 'oke', 'được'],
  accept: ['ok', 'accept', 'đồng ý', '了解', '可'],
  pray: ['thanks', 'thank', 'please', 'cảm ơn', 'nhờ', 'xin', 'ありがとう', 'お願い', '感謝'],
  bow: [
    'sorry',
    'thanks',
    'xin lỗi',
    'cảm ơn',
    'cúi',
    'すみません',
    '申し訳',
    'お辞儀',
    'よろしく',
  ],
  'man-bowing': [
    'sorry',
    'thanks',
    'xin lỗi',
    'cảm ơn',
    'cúi',
    'すみません',
    '申し訳',
    'お辞儀',
    'よろしく',
  ],
  'woman-bowing': [
    'sorry',
    'thanks',
    'xin lỗi',
    'cảm ơn',
    'cúi',
    'すみません',
    '申し訳',
    'お辞儀',
    'よろしく',
  ],
  eyes: ['look', 'seen', 'checking', 'xem', 'đã xem', 'đang xem', '確認', '見て', '見ました'],
  white_check_mark: ['done', 'check', 'xong', 'hoàn thành', '完了', '済', '対応済'],
  heavy_check_mark: ['done', 'check', 'xong', '完了', '済'],
  white_flower: ['good job', 'tốt lắm', 'よくできました', 'はなまる'],
  o: ['yes', 'correct', 'đúng', 'まる', '正解', '○'],
  x: ['no', 'wrong', 'sai', 'không', 'ばつ', '×', 'ダメ'],
  no_good: ['no', 'ng', 'không', 'ダメ', 'ばつ'],
  ng: ['ng', 'no', 'ダメ'],
  raised_hands: ['yay', 'hooray', 'great', 'tuyệt', 'ばんざい', 'やった'],
  clap: ['clap', 'great', 'vỗ tay', 'hay', '拍手', 'すごい'],
  tada: ['congrats', 'party', 'chúc mừng', 'おめでとう', 'やった'],
  sparkles: ['new', 'nice', 'mới', 'キラキラ'],
  muscle: ['strong', 'fighting', 'cố lên', '頑張', 'がんばれ'],
  thinking_face: ['think', 'hmm', 'nghĩ', 'suy nghĩ', '考え', 'うーん'],
  sweat_smile: ['hehe', 'awkward', 'ngại', '苦笑', '汗'],
  sweat_drops: ['sweat', 'tired', 'mồ hôi', '汗', 'あせ'],
  joy: ['lol', 'haha', 'cười', '笑'],
  smile: ['smile', 'happy', 'cười', 'vui', '笑顔'],
  heart: ['love', 'tim', 'yêu', '好き', 'ハート'],
  fire: ['hot', 'lit', 'cháy', '炎', 'アツい'],
  '100': ['perfect', 'hoàn hảo', '完璧'],
  sob: ['cry', 'khóc', '泣'],
  rocket: ['release', 'deploy', 'launch', 'phát hành', 'リリース'],
  warning: ['warning', 'cảnh báo', 'chú ý', '注意'],
  question: ['question', 'hỏi', '質問', '?'],
  bulb: ['idea', 'ý tưởng', 'アイデア'],
  memo: ['note', 'ghi chú', 'メモ'],
  hourglass_flowing_sand: ['wait', 'pending', 'chờ', '待ち', '対応中'],
  coffee: ['break', 'nghỉ', '休憩'],
  relieved: ['phew', 'yên tâm', '安心', 'ほっ'],
  u5408: ['pass', 'đạt', '合格'],
}

/** Tìm emoji chuẩn theo tên + từ khoá (khớp đầu tên trước, rồi khớp giữa, rồi từ khoá). */
export function searchStandardEmoji(query: string, limit = 40): EmojiItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const head: EmojiItem[] = []
  const mid: EmojiItem[] = []
  const kw: EmojiItem[] = []
  const has = (name: string): boolean =>
    head.some((h) => h.name === name) || mid.some((h) => h.name === name)
  for (const g of EMOJI_GROUPS) {
    for (const it of g.items) {
      if (it.name.startsWith(q)) head.push(it)
      else if (it.name.includes(q)) mid.push(it)
    }
  }
  for (const [alias, target] of Object.entries(raw.aliases)) {
    if (!alias.startsWith(q)) continue
    const char = BY_NAME.get(target)
    if (char && !has(target)) head.push({ name: alias, char })
  }
  for (const [name, words] of Object.entries(KEYWORDS)) {
    // Khớp ĐẦU từ khoá, không khớp giữa: "ok" khớp-giữa sẽ lôi cả "look" (👀).
    if (has(name) || !words.some((w) => w.toLowerCase().startsWith(q))) continue
    const char = BY_NAME.get(name)
    if (char) kw.push({ name, char })
  }
  // Từ khoá xếp TRƯỚC khớp-giữa-tên: gõ "ok" mong 👌🙆 hơn là các tên có chứa "ok" (book…).
  return [...head, ...kw, ...mid].slice(0, limit)
}
