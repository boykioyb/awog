// Dynamic-import bền cho các dep nặng ngoài bundle chính (monaco-editor,
// mermaid). Dev server của Vite có thể re-optimize giữa session: trong cửa sổ
// đó, URL `/deps/x.js` trả 404 (hash `?v=` cũ) hoặc transform pipeline nổ
// "Maximum call stack size exceeded" khi một plugin chạy code-filter regex trên
// chunk nhiều MB. Retry một nhịp ngắn thường đáp vào hash mới; nếu vẫn hỏng thì
// trang đang giữ URL chết — chỉ reload mới cứu, đúng cơ chế Vite tự làm
// ("optimized dependencies changed. reloading"), có guard chống loop.
const RELOAD_KEY = 'awog:heavy-dep-reload'
const RETRY_DELAY_MS = 500
const RELOAD_GUARD_MS = 60_000

export async function loadHeavyDep<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader()
  } catch (err) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    try {
      return await loader()
    } catch {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
      if (import.meta.dev && Date.now() - last > RELOAD_GUARD_MS) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        location.reload()
        // Trang đang teardown — promise không bao giờ settle là chủ đích.
        return new Promise<T>(() => {})
      }
      throw err
    }
  }
}
