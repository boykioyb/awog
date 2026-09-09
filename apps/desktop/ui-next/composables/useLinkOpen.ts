import { ref } from 'vue'

// Where a web link opens: the app's own browser tab, or the OS browser.
//
// WHY THIS IS ONE PLACE. Before the embedded browser (ADR 0086) every http(s)
// link had exactly one destination — the OS browser — and the app did not even
// need code for it: `<a href>`/`target=_blank` in the renderer were caught by
// `will-navigate` / `setWindowOpenHandler` in electron/src/window.ts, which called
// `shell.openExternal`. Now there are two destinations and the user has to be able
// to pick, which means the decision has to happen in the RENDERER (main cannot
// show a popover). So one delegated capture listener owns every `<a>` in the app —
// transcript markdown, project pages, the GH drawer, session Info, office docs —
// and the handful of surfaces that call `openExternal` imperatively route through
// `openLink` too. The main-process handlers stay exactly as they are: they are now
// the backstop for anything the renderer misses (a script-driven `location.href`,
// a window with no host mounted), and their behaviour — straight to the OS
// browser — is the safe default.
//
// TWO CALL SITES DELIBERATELY DO NOT COME HERE: the OAuth dialogs (Claude, Codex).
// An auth flow must land in the browser where the user's real login lives, and an
// auth code must not end up in the agent's cookie jar. They keep calling
// `openExternal` directly, with a comment saying so.
//
// Mode lives in localStorage, not the sidecar: this is renderer-side routing, it
// changes nothing the engine can see — same shape as useKeymap.

export type LinkOpenMode = 'ask' | 'app' | 'external'

const STORAGE_KEY = 'awog.linkOpenMode'
const MODES: LinkOpenMode[] = ['ask', 'app', 'external']

const readMode = (): LinkOpenMode => {
  if (typeof window === 'undefined') return 'ask'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return MODES.includes(raw as LinkOpenMode) ? (raw as LinkOpenMode) : 'ask'
  } catch {
    return 'ask'
  }
}

const mode = ref<LinkOpenMode>(readMode())
// The link waiting on a choice, with the click position so the popover opens where
// the user's eyes already are.
const pending = ref<{ url: string; x: number; y: number } | null>(null)
let installed = false

export function useLinkOpen() {
  const bridge = () => (typeof window === 'undefined' ? null : (window.awog ?? null))

  const setMode = (next: LinkOpenMode): void => {
    mode.value = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private window / blocked storage — the choice just won't stick.
    }
  }

  const openExternally = async (url: string): Promise<void> => {
    const api = bridge()
    if (api?.openExternal) {
      await api.openExternal(url).catch(() => {
        // Main rejects anything that is not http/https/mailto; nothing to do here.
      })
      return
    }
    // Browser-dev (no Electron shell): a real tab is the honest equivalent.
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Open in the agent's own Chromium. Always a NEW tab: the agent may be mid-turn
  // on the active one, and hijacking it would break a running task.
  const openInApp = async (url: string): Promise<void> => {
    const api = bridge()?.browser
    if (!api) return openExternally(url)
    // MỞ KHUNG TRƯỚC, TẢI SAU.
    //
    // Lỗi thật 2026-09-09: chỗ này `await api.newTab(url)` trước khi mở panel, mà
    // `newTab` ở main await `loadURL` ⇒ bấm một link tới PR GitHub là UI đứng vài
    // giây rồi trình duyệt mới hiện. `wait: false` trả về ngay khi tab đã tạo và
    // điều hướng đã bắt đầu, nên người dùng thấy khung + spinner tức thì; trạng
    // thái tải về sau qua event `changed`.
    //
    // Guard host vẫn chạy đồng bộ ở main trước khi trả về, nên URL bị chặn
    // (loopback/IP private/không trong allowlist) vẫn ném về đây — và phải NÓI RA:
    // người dùng vừa bấm và chọn "mở trong app", im lặng thì họ tưởng app treo.
    const { openViews, toggleView } = useWorkspacePanel()
    const sessions = useSessionsStore()
    const inSession = !!sessions.active
    const failed = (err: unknown): void => {
      pushActionToast(
        useI18n().t('link.openFailed', {
          message: err instanceof Error ? err.message : String(err),
        }),
        'error',
      )
    }

    // TRONG SESSION: mở khung TRƯỚC, không await gì cả.
    //
    // Mở view Browser là việc thuần renderer (`toggleView` → SessionDetail), nên nó
    // xảy ra ngay trong cú bấm. Tạo tab bắn sau và KHÔNG chặn: dù `newTab` mất bao
    // lâu — hay bản main đang chạy còn là bản cũ vẫn await `loadURL` — khung vẫn
    // hiện tức thì, và trang điền vào sau. Đây là thứ tự người dùng yêu cầu: "nhấn
    // link mở browser luôn, load url là phần sau".
    if (inSession) {
      if (!openViews.value.includes('Browser')) toggleView('Browser')
      api.newTab(url, { wait: false }).catch(failed)
      return
    }

    // KHÔNG có session: bề mặt duy nhất là cửa sổ popout, nên thứ tự phải ngược —
    // `popout()` gọi `this.tab()`, mà hàm đó TẠO một tab trắng nếu chưa có tab nào.
    // Bắn `newTab` song song ở đây sẽ để lại một tab trắng và popout hiện đúng cái
    // tab trắng đó. Chờ tab xong rồi mới mở cửa sổ; chi phí ở đường này bị việc
    // dựng cửa sổ + nạp route lấn át rồi.
    try {
      await api.newTab(url, { wait: false })
    } catch (err) {
      failed(err)
      return
    }
    await api.popout()
  }

  // The one entry point. `evt` is optional; when given, its position anchors the
  // popover and its modifiers act as the usual escape hatch (⌘/Ctrl-click = OS
  // browser, no question asked).
  const openLink = async (url: string, evt?: MouseEvent): Promise<void> => {
    const text = String(url ?? '').trim()
    if (!text) return
    // Anything that is not a web page (mailto:, etc.) has only one sensible home.
    if (!/^https?:\/\//i.test(text)) return openExternally(text)
    if (evt?.metaKey || evt?.ctrlKey || evt?.shiftKey) return openExternally(text)
    if (mode.value === 'external') return openExternally(text)
    if (mode.value === 'app') return openInApp(text)
    pending.value = { url: text, x: evt?.clientX ?? 0, y: evt?.clientY ?? 0 }
  }

  const resolvePending = async (kind: 'app' | 'external', remember: boolean): Promise<void> => {
    const url = pending.value?.url
    pending.value = null
    if (remember) setMode(kind)
    if (!url) return
    await (kind === 'app' ? openInApp(url) : openExternally(url))
  }

  const cancelPending = (): void => {
    pending.value = null
  }

  // Delegated capture listener — installed once per renderer by LinkOpenHost.
  //
  // Capture phase so it runs before a component's own click handler, and only for
  // a plain left click on an anchor with a web href. Everything else is left alone:
  // the transcript's file-path chips (`SessionMarkdownHtml`) are anchors too, and
  // they must keep opening the shared PreviewModal.
  const installInterceptor = (): (() => void) => {
    if (installed || typeof document === 'undefined') return () => {}
    installed = true
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || event.defaultPrevented) return
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!/^https?:\/\//i.test(href)) return
      // An opt-out for a surface that owns its own link behaviour.
      if (anchor.hasAttribute('data-link-raw')) return
      event.preventDefault()
      event.stopPropagation()
      void openLink(href, event)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      installed = false
    }
  }

  return {
    mode,
    pending,
    setMode,
    openLink,
    openInApp,
    openExternally,
    resolvePending,
    cancelPending,
    installInterceptor,
  }
}
