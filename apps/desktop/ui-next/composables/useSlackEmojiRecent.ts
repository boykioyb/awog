import { ref, type Ref } from 'vue'

// "Gần đây" của bảng emoji Slack — lưu localStorage (máy này, không đồng bộ).
//
// Cấp MODULE và parse localStorage MỘT lần: mỗi tin nhắn có một picker, trước đây mỗi
// picker tự `JSON.parse` lúc setup ⇒ một thread 200 tin là 400 lần parse. Dùng chung
// một ref còn để emoji vừa chọn ở picker này hiện ngay ở picker khác.

const RECENT_KEY = 'awog.slack.emojiRecent'
const RECENT_MAX = 24

let recent: Ref<string[]> | null = null

function readRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

export function useSlackEmojiRecent() {
  recent ??= ref<string[]>(readRecent())
  const list = recent

  function remember(name: string): void {
    list.value = [name, ...list.value.filter((n) => n !== name)].slice(0, RECENT_MAX)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.value))
    } catch {
      // Không ghi được (quota / bị chặn) — danh sách chỉ sống trong phiên này.
    }
  }

  return { recent: list, remember }
}
