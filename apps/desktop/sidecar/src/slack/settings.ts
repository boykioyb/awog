// Cài đặt riêng của Slack threads: `~/.awog/slack/settings.json`.
//
// Ở sidecar (không localStorage) vì hai bề mặt — modal trong cửa sổ chính và cửa sổ
// Slack riêng — là hai renderer, cần MỘT nguồn; và vì sidecar tự đọc phong cách dịch +
// bảng thuật ngữ khi dựng prompt (renderer không gửi được prompt lên).
//
// File là L2 (người dùng sửa tay được) ⇒ qua zod. Mỗi field có `.catch(mặc định)`: một
// field sai (gõ nhầm style) chỉ rơi về mặc định của field đó, không xoá các field khác.
// JSON hỏng hẳn ⇒ readJsonFile cách ly file rồi trả null ⇒ toàn bộ về mặc định.
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, serialize, slackHome, writeJsonAtomic } from './json-file.js'
import { ProviderSchema, TargetLangSchema } from './params.js'

export const TranslateStyleSchema = z.enum(['precise', 'balanced', 'natural'])
export type TranslateStyle = z.infer<typeof TranslateStyleSchema>

// `inherit` = chuỗi chọn model như cũ (model dịch chung của app → project → app), do
// renderer resolve. `pinned` = model riêng cho Slack.
export const SlackLlmSettingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }),
  z.object({
    mode: z.literal('pinned'),
    provider: ProviderSchema,
    modelId: z.string().min(1).max(200),
    accountId: z.string().min(1).max(200).optional(),
  }),
])
export type SlackLlmSetting = z.infer<typeof SlackLlmSettingSchema>

export type SlackTranslateSettings = {
  llm: SlackLlmSetting
  style: TranslateStyle
  // null = theo ngôn ngữ giao diện (renderer quyết).
  readLang: string | null
  // Ngôn ngữ dịch tin GỬI ĐI, theo thứ tự xuất hiện trong tin (vd Nhật + Anh: hay gửi
  // song ngữ cho khách). 1–3 phần tử, không trùng.
  sendLangs: string[]
  // Thuật ngữ nghiệp vụ dịch nghĩa KÈM chữ Nhật trong ngoặc (để trích lại cho khách).
  keepJapaneseTerms: boolean
}

export type SlackSettings = { translate: SlackTranslateSettings }

export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
  translate: {
    llm: { mode: 'inherit' },
    style: 'precise',
    readLang: null,
    sendLangs: ['Japanese'],
    keepJapaneseTerms: true,
  },
}

const D = DEFAULT_SLACK_SETTINGS.translate

const SendLangsSchema = z
  .array(TargetLangSchema)
  .min(1)
  .max(3)
  .refine((a) => new Set(a).size === a.length, 'duplicate language')

// File cũ lưu một chuỗi `sendLang` ⇒ chuyển thành `sendLangs: [sendLang]` khi đọc.
function migrateTranslate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const o = raw as Record<string, unknown>
  if (o.sendLangs === undefined && typeof o.sendLang === 'string') {
    return { ...o, sendLangs: [o.sendLang] }
  }
  return raw
}

const FileSchema = z.object({
  version: z.literal(1),
  translate: z.preprocess(
    migrateTranslate,
    z.object({
      llm: SlackLlmSettingSchema.catch(D.llm),
      style: TranslateStyleSchema.catch(D.style),
      readLang: TargetLangSchema.nullable().catch(D.readLang),
      sendLangs: SendLangsSchema.catch(D.sendLangs),
      keepJapaneseTerms: z.boolean().catch(D.keepJapaneseTerms),
    }),
  ).catch(D),
})

// Patch từ renderer (L1): chỉ đúng các field này, field lạ bị zod bỏ (không mass-assign).
export const SlackTranslatePatchSchema = z
  .object({
    llm: SlackLlmSettingSchema,
    style: TranslateStyleSchema,
    readLang: TargetLangSchema.nullable(),
    sendLangs: SendLangsSchema,
    keepJapaneseTerms: z.boolean(),
  })
  .partial()
export type SlackTranslatePatch = z.infer<typeof SlackTranslatePatchSchema>

const STORE_KEY = 'slack-settings'

function settingsFile(): string {
  return join(slackHome(), 'settings.json')
}

async function readSettings(): Promise<SlackSettings> {
  const doc = await readJsonFile(settingsFile(), FileSchema)
  return doc ? { translate: doc.translate } : structuredClone(DEFAULT_SLACK_SETTINGS)
}

export function getSlackSettings(): Promise<SlackSettings> {
  return serialize(STORE_KEY, readSettings)
}

// Gộp patch vào bản trên đĩa (đọc-sửa-ghi tuần tự). `changed` = có khác bản cũ không,
// để caller chỉ phát event khi thật sự đổi.
export function updateSlackSettings(
  patch: SlackTranslatePatch,
): Promise<{ settings: SlackSettings; changed: boolean }> {
  return serialize(STORE_KEY, async () => {
    const cur = await readSettings()
    const next: SlackSettings = { translate: { ...cur.translate } }
    // Pick tường minh từng field — không spread patch.
    if (patch.llm !== undefined) next.translate.llm = patch.llm
    if (patch.style !== undefined) next.translate.style = patch.style
    if (patch.readLang !== undefined) next.translate.readLang = patch.readLang
    if (patch.sendLangs !== undefined) next.translate.sendLangs = [...patch.sendLangs]
    if (patch.keepJapaneseTerms !== undefined)
      next.translate.keepJapaneseTerms = patch.keepJapaneseTerms
    const changed = JSON.stringify(next) !== JSON.stringify(cur)
    if (changed) await writeJsonAtomic(settingsFile(), { version: 1, ...next })
    return { settings: next, changed }
  })
}

// Payload event `slack.settings-changed`: cửa sổ còn lại nạp bản mới và bỏ các bản dịch
// đang hiện (dịch theo cài đặt cũ).
export const SLACK_SETTINGS_CHANGED_EVENT = 'slack.settings-changed'
export type SlackSettingsChangedEvent = {
  settings: SlackSettings
  reason: 'settings' | 'glossary'
}
