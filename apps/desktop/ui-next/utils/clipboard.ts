// Copy text to the OS clipboard (best-effort).
//
// Trả về `true`/`false` thay vì `void`: người gọi cần biết mình có được chép thật
// hay không, vì "Đã chép" khi clipboard không ghi được là một lời nói dối (API bị
// chặn khi cửa sổ mất tiêu điểm, hoặc không có trong webview). Người gọi cũ bỏ qua
// giá trị trả về thì hành vi không đổi.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text)
    return true
  } catch {
    // Clipboard API blocked (no focus / permission) — non-fatal.
    return false
  }
}
