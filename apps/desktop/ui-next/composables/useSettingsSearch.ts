import { SETTINGS_SECTIONS, type SettingsSectionId } from '~/components/settings/sections'
import {
  childSettingsComponents,
  extractSettingsEntries,
  type SettingsIndexEntry,
} from '~/utils/settings-index'
import { textsForKey } from '~/composables/useI18n'

// Chỉ mục tìm kiếm cài đặt cho ⌘K: mỗi mục Settings + từng cài đặt (<SettingsField>) và
// tiêu đề nhóm bên trong nó, kèm mục cha để điều hướng tới đúng chỗ.
//
// Dựng từ MÃ NGUỒN component (utils/settings-index.ts), tải LƯỜI (`?raw` không eager)
// lần đầu ⌘K có chữ gõ — không đội vào lúc khởi động app. Map mục → component đọc từ
// chính SettingsPane.vue nên thêm mục mới cũng không phải sửa ở đây.

export type SettingsHit = {
  section: SettingsSectionId
  kind: 'section' | 'field' | 'heading'
  nameKey: string
  descKey?: string
  // Mọi bản dịch của tên / mô tả / tên mục — chuỗi để khớp từ khoá (fold dấu ở caller).
  keywords: string
}

const sources = import.meta.glob('../components/settings/*.vue', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

const index = shallowRef<SettingsHit[]>([])
let building: Promise<void> | null = null

const fileOf = (component: string): string => `../components/settings/${component}.vue`

async function load(component: string): Promise<string> {
  const loader = sources[fileOf(component)]
  return loader ? loader() : ''
}

// `<SettingsGit v-else-if="active === 'git'" />` … `<SettingsAbout v-else />`.
function sectionComponents(pane: string): Map<SettingsSectionId, string> {
  const map = new Map<SettingsSectionId, string>()
  for (const m of pane.matchAll(/<(Settings\w+)\s+v-(?:else-)?if="active === '(\w+)'"/g)) {
    map.set(m[2] as SettingsSectionId, m[1] ?? '')
  }
  const fallback = /<(Settings\w+)\s+v-else\s*\/>/.exec(pane)?.[1]
  if (fallback) map.set('about', fallback)
  return map
}

async function entriesOf(component: string, depth = 0): Promise<SettingsIndexEntry[]> {
  const src = await load(component)
  if (!src) return []
  const own = extractSettingsEntries(src)
  if (depth >= 2) return own
  const kids = await Promise.all(
    childSettingsComponents(src)
      .filter((c) => sources[fileOf(c)])
      .map((c) => entriesOf(c, depth + 1)),
  )
  return [...own, ...kids.flat()]
}

async function build(): Promise<void> {
  const map = sectionComponents(await load('SettingsPane'))
  const out: SettingsHit[] = []
  for (const sec of SETTINGS_SECTIONS) {
    const secWords = textsForKey(sec.labelKey).join(' ')
    out.push({ section: sec.id, kind: 'section', nameKey: sec.labelKey, keywords: secWords })
    const component = map.get(sec.id)
    if (!component) continue
    const seen = new Set<string>()
    for (const e of await entriesOf(component)) {
      if (seen.has(e.nameKey)) continue
      seen.add(e.nameKey)
      out.push({
        section: sec.id,
        kind: e.kind,
        nameKey: e.nameKey,
        ...(e.descKey ? { descKey: e.descKey } : {}),
        keywords: [
          ...textsForKey(e.nameKey),
          ...(e.descKey ? textsForKey(e.descKey) : []),
          secWords,
        ].join(' '),
      })
    }
  }
  index.value = out
}

export function useSettingsSearch() {
  function ensureIndex(): Promise<void> {
    building ??= build().catch((err: unknown) => {
      console.warn('[settings-search] build failed', err)
      building = null
    })
    return building
  }
  return { index, ensureIndex }
}
