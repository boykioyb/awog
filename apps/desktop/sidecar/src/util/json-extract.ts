// Bóc JSON ra khỏi output của model cho các one-shot *.generate.
// Chịu được: ```lang fence BẤT KỲ (label ngôn ngữ nằm trên dòng mở fence,
// không lọt vào content — bản cũ chỉ ăn ```json nên ```text nuôi chữ "text"
// vào body → JSON.parse chết), prose đứng trước/sau object, hoặc object thuần.
// Trả chuỗi ứng viên tốt nhất — caller vẫn JSON.parse + báo lỗi nếu không được.
export function extractJson(raw: string): string {
  const trimmed = raw.trim()

  // Fenced block — capture starts AFTER the opening line (```json, ```text,
  // hoặc bare ```), nên label ngôn ngữ tự bị loại.
  const fenced = trimmed.match(/```[^\n]*\n([\s\S]*?)```/)
  const inner = fenced?.[1]?.trim()
  // Body có thể là prose — chỉ short-circuit khi trông giống JSON.
  if (inner && (inner.startsWith('{') || inner.startsWith('['))) return inner

  // Không có fence dùng được — lấy span object/array ngoài cùng để preamble
  // hoặc prose sau JSON không poison JSON.parse.
  const brace = trimmed.indexOf('{')
  const bracket = trimmed.indexOf('[')
  const first =
    brace < 0 ? bracket : bracket < 0 ? brace : Math.min(brace, bracket)
  if (first >= 0) {
    const last = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
    if (last > first) return trimmed.slice(first, last + 1)
  }
  return trimmed
}
