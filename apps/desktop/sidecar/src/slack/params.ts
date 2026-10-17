// Mảnh zod dùng chung cho mọi tham số RPC `slack.*` do renderer cấp.
//
// Renderer là L1 (không tin): mọi id đi vào URL query của Slack hoặc thành
// một đoạn đường dẫn dưới `~/.awog/slack/` nên phải khớp regex chặt TRƯỚC khi
// chạm tới mạng hay đĩa. Regex chặn sẵn `/`, `\`, `..` vì chỉ cho chữ hoa + số.
import { z } from 'zod'

export const TS_RE = /^\d{10}\.\d{6}$/
export const CHANNEL_RE = /^[CGD][A-Z0-9]{6,}$/
export const TEAM_RE = /^T[A-Z0-9]{6,}$/
export const USER_RE = /^[UW][A-Z0-9]{6,}$/
export const FILE_RE = /^F[A-Z0-9]{6,}$/
// Tên emoji tuỳ chỉnh của Slack cho phép cả chữ không-Latin (workspace Nhật hay
// đặt `:了解:`), nên không chỉ `[a-z0-9]`. Reaction có tông da mang hậu tố
// `::skin-tone-N` — chip "react theo" gửi lại đúng tên Slack trả về, nên phải
// nhận hậu tố đó. Không có `/`, `\`, `.` ⇒ vẫn an toàn khi thành tên file.
export const EMOJI_RE = /^[\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{1,100}(?:::skin-tone-[2-6])?$/u
export const THREAD_ID_RE = /^(T[A-Z0-9]{6,}):([CGD][A-Z0-9]{6,}):(\d{10}\.\d{6})$/

export const TsSchema = z.string().regex(TS_RE, 'invalid Slack ts')
export const ChannelIdSchema = z.string().regex(CHANNEL_RE, 'invalid channel id')
export const TeamIdSchema = z.string().regex(TEAM_RE, 'invalid team id')
export const FileIdSchema = z.string().regex(FILE_RE, 'invalid file id')
export const EmojiNameSchema = z.string().regex(EMOJI_RE, 'invalid emoji name')
export const ThreadIdSchema = z.string().regex(THREAD_ID_RE, 'invalid thread id')

// Id dự án/phiên chỉ được lưu lại và tra cứu, không ghép đường dẫn trực tiếp
// (projects/store.ts tự sanitize), nhưng vẫn chặn ký tự lạ để file JSON sạch.
export const OpaqueIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'invalid id')

export const ProviderSchema = z.enum(['anthropic', 'openai', 'google'])

// Tên ngôn ngữ đích (đi thẳng vào prompt dịch): chỉ chữ + dấu + khoảng trắng/ngoặc/gạch —
// đủ cho "Japanese", "Tiếng Việt", "Chinese (Simplified)", "日本語", không đủ để nhét câu
// lệnh/xuống dòng vào prompt. Ở đây (không ở translate.ts) vì cả settings.ts lẫn
// translate.ts cùng dùng, đặt ở translate.ts thì hai file import vòng nhau.
export const TARGET_LANG_RE = /^[\p{L}\p{M} ()-]{2,40}$/u
export const TargetLangSchema = z.string().regex(TARGET_LANG_RE, 'invalid target language')

export type ParsedThreadId = { teamId: string; channelId: string; threadTs: string }

export function splitThreadId(id: string): ParsedThreadId | null {
  const m = THREAD_ID_RE.exec(id)
  if (!m || !m[1] || !m[2] || !m[3]) return null
  return { teamId: m[1], channelId: m[2], threadTs: m[3] }
}
