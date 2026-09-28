import { ref } from 'vue'

// Bridge between the global status bar and a session's workspace panel, whose
// dock/open state lives locally in SessionDetail. The footer requests a view toggle
// (Files / Terminal …); SessionDetail performs it and publishes back which views are
// currently open so the footer chip can reflect active state. Mirrors useGitModal /
// useStatusConfig (module-level single source of truth).
//
// `requested` carries a nonce so toggling the SAME view twice still re-fires the
// watcher in SessionDetail (the ref identity changes each call).
const requested = ref<{ view: string; nonce: number } | null>(null)
const openViews = ref<string[]>([])
// View Browser có đang là tab ACTIVE của dock trong session đang hiển thị không.
// Khác với openViews (danh sách view mở, kể cả tab bị park): cờ này nói "panel
// đang THỰC SỰ hiển thị trang" — auto-PiP gate theo nó, vì một tab Browser đang
// park hay một session bị KeepAlive giấu đi đều không "che" trang, và card vẫn
// được phép hiện ở đúng lúc đó (đúng semantics Codex).
const browserActive = ref(false)

export function useWorkspacePanel() {
  function toggleView(view: string): void {
    requested.value = { view, nonce: (requested.value?.nonce ?? 0) + 1 }
  }
  function publishOpenViews(views: string[]): void {
    openViews.value = [...views]
  }
  function publishBrowserActive(v: boolean): void {
    browserActive.value = v
  }
  return { requested, openViews, browserActive, toggleView, publishOpenViews, publishBrowserActive }
}
