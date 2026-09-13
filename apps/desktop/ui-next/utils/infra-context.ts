// Giải ngữ cảnh hạ tầng ba tầng — phiên → project → toàn app (ADR 0088 §7).
//
// Hàm THUẦN, không store, không IPC: đây là *tri thức* về thứ tự kế thừa, và nó
// phải có đúng một nguồn. `useInfraContext()` bọc nó lại cho UI; các bề mặt khác
// (đóng băng lúc tạo phiên) gọi thẳng.
//
// Giải theo TỪNG TRƯỜNG chứ không theo cả object: một phiên ghim `profile` nhưng
// không nói gì về `region` thì `region` vẫn phải kế thừa xuống project/app — nếu
// giải theo object thì cú ghim `profile` sẽ âm thầm xoá luôn region mặc định.
//
// Ngữ nghĩa ô giá trị bám theo `githubAccount` (utils/project-gh-account.ts), KHÔNG
// phát minh cái khác:
//   - `undefined` → kế thừa tiếp xuống tầng dưới
//   - `''`        → cố ý KHÔNG ghim, DỪNG kế thừa (tầng dưới không được dùng nữa)
//   - chuỗi khác  → ghim
// Vì `''` nghĩa là "không ghim", nó KHÔNG xuất hiện trong kết quả: field đó vắng
// mặt, và người gọi (sidecar) chỉ chèn cờ cho field có mặt.
import type { InfraContext } from '~/types'

export const INFRA_FIELDS = [
  'profile',
  'region',
  'accountId',
  'cluster',
  'namespace',
  'workspace',
] as const

export type InfraField = (typeof INFRA_FIELDS)[number]

/**
 * Ngữ cảnh hiệu lực = phiên ?? project ?? toàn app, từng trường một.
 * Trả về object chỉ chứa các field thật sự được ghim.
 */
export function resolveInfraContext(
  session: InfraContext | undefined,
  project: InfraContext | undefined,
  app: InfraContext | undefined,
): InfraContext {
  const out: InfraContext = {}
  for (const field of INFRA_FIELDS) {
    // `??` chứ KHÔNG `||`: `''` ở tầng trên phải thắng (dừng kế thừa), thay vì rơi
    // xuống tầng dưới như một giá trị falsy bình thường.
    const chosen = session?.[field] ?? project?.[field] ?? app?.[field]
    const trimmed = chosen?.trim()
    if (trimmed) out[field] = trimmed
  }
  return out
}

/**
 * Ảnh chụp để ĐÓNG BĂNG vào một phiên mới (ADR 0088 §2): ý kiến hiện có của hai
 * tầng dưới, giữ NGUYÊN VĂN — kể cả `''`.
 *
 * Khác `resolveInfraContext` ở đúng chỗ đó, và sự khác biệt là cả điểm của hàm này:
 *   - `''` phải được chép lại thành `''` (không phải bỏ đi). Bỏ đi thì "project cố
 *     ý không ghim profile" biến thành "phiên kế thừa tiếp", và một lần ghim profile
 *     ở project sau này sẽ âm thầm đổi tài khoản của phiên đang chạy dở.
 *   - Field mà KHÔNG tầng nào có ý kiến thì không có gì để đóng băng ⇒ để vắng mặt.
 *     Phiên sẽ kế thừa nếu sau này có ai đó đặt — đúng, vì không có giá trị cũ nào
 *     bị thay đổi ngầm dưới chân người dùng.
 */
export function freezeInfraContext(
  project: InfraContext | undefined,
  app: InfraContext | undefined,
): InfraContext {
  const out: InfraContext = {}
  for (const field of INFRA_FIELDS) {
    const chosen = project?.[field] ?? app?.[field]
    if (chosen !== undefined) out[field] = chosen
  }
  return out
}

/**
 * Bản sao chỉ giữ các field có mặt — dùng trước khi ghi xuống đĩa/IPC để `undefined`
 * không thành khoá `"profile": null` trong JSON, và để "không ghim gì" là một object
 * RỖNG (sidecar xoá hẳn key) chứ không phải object đầy `undefined`.
 */
export function compactInfraContext(input: InfraContext | undefined): InfraContext {
  const out: InfraContext = {}
  if (!input) return out
  for (const field of INFRA_FIELDS) {
    const value = input[field]
    if (value !== undefined) out[field] = value
  }
  return out
}

/** True khi ngữ cảnh không ghim gì (mọi field vắng mặt hoặc rỗng). */
export function isInfraContextEmpty(input: InfraContext | undefined): boolean {
  if (!input) return true
  return INFRA_FIELDS.every((field) => !input[field]?.trim())
}
