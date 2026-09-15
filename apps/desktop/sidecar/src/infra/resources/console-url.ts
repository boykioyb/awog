// Deep link Console của Explorer (task 3.4).
//
// VÌ SAO Ở SIDECAR chứ không ở renderer. URL này được dựng từ `consoleUrl(row, ctx)`
// — một HÀM nằm trong spec view. Renderer cố ý không nhận hàm nào qua IPC
// (`registry.toDescriptor()` cắt hết phần thực thi), nên nếu UI tự ghép URL thì
// luật "dịch vụ toàn cầu không kèm region" và "đường dẫn tới đúng đối tượng" sẽ
// phải chép lại ở lần thứ hai — và hai bản sao của một luật là một bản sẽ lệch.
//
// BỌC SSO START-URL. Với profile đăng nhập qua IAM Identity Center, mở thẳng URL
// Console thường rơi vào trang đăng nhập rồi đứng đó: người dùng đã có phiên SSO
// nhưng trình duyệt không biết. Cổng truy cập SSO nhận tham số `goto` để sau khi
// đăng nhập nó đưa người dùng tới ĐÚNG đích đã hỏi. Vì vậy khi profile có
// `sso_start_url`, đích được nhét vào `goto` của cổng thay vì mở trực tiếp.
//
// HÀM THUẦN. Không CLI, không đọc đĩa ở đây: `buildConsoleUrl` chỉ nhận dữ liệu đã
// có. Nhờ vậy nó test được bằng bảng ca và không có đường nào "mở Console" lại
// vô tình chạy một lệnh `aws`.

/** Ghép `goto` vào cổng SSO, giữ nguyên hash sẵn có của start URL. */
export function wrapSsoStartUrl(startUrl: string, destination: string): string {
  const url = startUrl.trim()
  if (url === '') return destination
  try {
    const u = new URL(url)
    u.searchParams.set('goto', destination)
    return u.toString()
  } catch {
    // Start URL hỏng (thiếu scheme chẳng hạn): KHÔNG nuốt đích. Trả về đích trực
    // tiếp còn hơn trả về một URL không mở được.
    return destination
  }
}

export type ConsoleUrlInput = {
  /** Hàm deep link của spec view — vắng = view chưa khai Console. */
  build?: ((row: Record<string, string>, ctx: { region: string }) => string) | undefined
  row: Record<string, string>
  region: string
  /** `sso_start_url` của profile đang dùng, nếu có. */
  ssoStartUrl?: string | undefined
}

/**
 * Deep link để mở Console cho một dòng. Trả `null` khi view không khai Console —
 * UI ẩn nút thay vì mở một URL đoán mò.
 */
export function buildConsoleUrl(input: ConsoleUrlInput): string | null {
  if (!input.build) return null
  const target = input.build(input.row, { region: input.region })
  if (target === '') return null
  const sso = input.ssoStartUrl?.trim() ?? ''
  return sso === '' ? target : wrapSsoStartUrl(sso, target)
}
