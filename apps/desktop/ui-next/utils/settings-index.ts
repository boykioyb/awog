// Trích danh sách cài đặt từ MÃ NGUỒN các component Settings — nguồn cho tìm kiếm
// cài đặt trong ⌘K (composables/useSettingsSearch.ts). Hàm thuần, có test
// (utils/__tests__/settings-index.test.mjs).
//
// Vì sao đọc mã nguồn thay vì khai báo tay một danh sách: thêm một <SettingsField> mới
// là ⌘K tìm được ngay, không có danh sách thứ hai để quên cập nhật. Chỉ bắt khuôn đang
// dùng thật: `<SettingsField :name="t('k')" :desc="t('k')">` (hoặc `<template #name>`
// chứa `t('k')`) và tiêu đề nhóm `<div class="sech">{{ t('k') }}</div>`.

export type SettingsIndexEntry = { kind: 'field' | 'heading'; nameKey: string; descKey?: string }

const T_KEY = /\bt\(\s*'([^']+)'/

export function extractSettingsEntries(source: string): SettingsIndexEntry[] {
  const out: SettingsIndexEntry[] = []
  // Thẻ mở <SettingsField …> (có thể nhiều dòng) + phần thân tới </SettingsField>.
  const fieldRe = /<SettingsField\b([^>]*)>([\s\S]*?)<\/SettingsField>/g
  for (const m of source.matchAll(fieldRe)) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const nameAttr = /:name="([^"]*)"/.exec(attrs)?.[1]
    const descAttr = /:desc="([^"]*)"/.exec(attrs)?.[1]
    let nameKey = nameAttr ? T_KEY.exec(nameAttr)?.[1] : undefined
    if (!nameKey) {
      const slot = /<template #name>([\s\S]*?)<\/template>/.exec(body)?.[1]
      nameKey = slot ? T_KEY.exec(slot)?.[1] : undefined
    }
    if (!nameKey) continue
    const descKey = descAttr ? T_KEY.exec(descAttr)?.[1] : undefined
    out.push({ kind: 'field', nameKey, ...(descKey ? { descKey } : {}) })
  }
  for (const m of source.matchAll(/class="sech"[^>]*>([\s\S]*?)</g)) {
    const key = T_KEY.exec(m[1] ?? '')?.[1]
    if (key) out.push({ kind: 'heading', nameKey: key })
  }
  return out
}

// Component Settings con được một mục nhúng (`<SettingsBrowserProxy …>` trong
// SettingsBrowser…) — để cài đặt của component con được quy về đúng mục cha.
export function childSettingsComponents(source: string): string[] {
  const tpl = source.slice(
    0,
    source.indexOf('<script') >= 0 ? source.indexOf('<script') : undefined,
  )
  return [...new Set([...tpl.matchAll(/<(Settings[A-Z]\w*)\b/g)].map((m) => m[1] ?? ''))].filter(
    (n) => n && n !== 'SettingsField' && n !== 'SettingsPaneHeader',
  )
}

// So khớp không phân biệt hoa thường + dấu tiếng Việt ("giao dien" khớp "Giao diện").
export function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// Mọi từ của query xuất hiện trong chuỗi từ khoá (đã fold) — thứ tự tự do.
export function matchesAllWords(query: string, haystack: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  const hay = foldText(haystack)
  return words.length > 0 && words.every((w) => hay.includes(w))
}
