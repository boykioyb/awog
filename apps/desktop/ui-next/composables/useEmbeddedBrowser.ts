import type { ShallowRef } from 'vue'
import type { AwogBrowserTab, AwogBrowserTabList } from '~/types/awog-bridge'

// Embedded browser (ADR 0086) — the state behind the workspace panel's "Browser"
// view. The page itself is a native `WebContentsView` owned by the Electron main
// process (electron/src/browser.ts); this composable does two things only:
//
//   1. keeps that view's rectangle glued to a placeholder element in the DOM, and
//   2. exposes the tab list / URL bar actions the chrome around it binds to.
//
// THE NATIVE VIEW PAINTS ABOVE THE WHOLE DOM. It is not an element, so nothing in
// CSS can put a modal, a menu or a toast in front of it — the app's z-index bands
// simply do not apply. So the view has to be pulled off screen whenever something
// would have covered it. `occluded` is that rule, and it keys off the two markup
// conventions this app already has for "something is floating above the page":
// `.ovl.on` (modal scrim; `.ovl` alone is `display:none` in prototype.css) and the
// v-if-mounted `.lbox` / `.smenu` / `.pop`. Menus count: the panel's own dock and
// "+" menus open directly over the panel body.
//
// `.sttpop` is on the list for the same reason and not by convention: the shared
// selection-translate popover (mounted by AppGlobalHosts) has its own class, and the
// chrome's Translate button opens it right over the page box — without this entry the
// translation would render UNDER the native view, i.e. invisible.
//
// ONE OWNER PER WINDOW. Two panel instances can be docked at once (right + bottom),
// and both may hold a Browser tab — but a single webContents cannot be in two
// rectangles, so they would fight over the bounds on every resize. The module-level
// `owner` is the arbiter: the first visible instance claims the view, the rest render
// a "showing in the other dock" placeholder with a button to take it over. Same
// hand-off shape as the session popout.
const OCCLUDING = '.ovl.on, .lbox, .smenu, .pop, .sttpop'

// Claim held by at most one instance per renderer (window).
const owner = ref<number | null>(null)
let seq = 0

export interface EmbeddedBrowserOptions {
  // Element the native view is glued to. Its box IS the browser viewport.
  viewport: Readonly<ShallowRef<HTMLElement | null>>
  // Is this panel's Browser tab the visible one right now?
  visible: () => boolean
}

export function useEmbeddedBrowser(options: EmbeddedBrowserOptions) {
  const id = ++seq
  const bridge = computed(() =>
    typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
  )
  const available = computed(() => bridge.value !== null)

  const tabs = ref<AwogBrowserTab[]>([])
  const activeTabId = ref<string | null>(null)
  const occluded = ref(false)
  const urlDraft = ref('')
  const error = ref('')
  // True while THIS instance holds the native view.
  const holding = ref(false)
  // Text the user has highlighted INSIDE the page. Two chrome buttons (translate,
  // quote into the chat) are disabled without it, and there is no event to learn it
  // from: the selection lives in another webContents, so the only way to know is to
  // ask. Hence a poll, and only while this instance actually holds the view.
  const selectionText = ref('')

  const activeTab = computed<AwogBrowserTab | null>(
    () => tabs.value.find((t) => t.tabId === activeTabId.value) ?? null,
  )
  const isOwner = computed(() => owner.value === null || owner.value === id)
  // The view is somewhere we are not: the popout window, or the other dock.
  const elsewhere = computed(() => !isOwner.value || activeTab.value?.shownElsewhere === true)

  // ── Geometry ──────────────────────────────────────────────────────────────

  // `getBoundingClientRect` is already in the window's content coordinates — the
  // renderer fills the content view — which is exactly what setBounds wants.
  const rectOf = (el: HTMLElement): { x: number; y: number; width: number; height: number } => {
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  }

  // Is the placeholder box ACTUALLY on screen right now? Not "is this component
  // mounted" — those are different questions here, and the difference was a bug:
  // this app keeps pages alive (`<NuxtPage keepalive>`) and keeps other sessions'
  // detail panes alive (`<KeepAlive :max="5">` in pages/sessions.vue), so leaving a
  // session or switching project DEACTIVATES this component without unmounting it.
  // The native view is not an element — nothing in CSS or Vue detaches it — so a
  // stale attachment kept painting the agent's page on top of whatever the user
  // opened next. Asking the DOM covers every hiding path at once: KeepAlive moves
  // the subtree out of the document (`isConnected` false), an ancestor `display:none`
  // or a collapsed panel gives a zero box.
  const onScreen = (el: HTMLElement | null): el is HTMLElement => {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    return r.width >= 8 && r.height >= 8
  }

  let syncing = false
  const sync = async (): Promise<void> => {
    const api = bridge.value
    const el = options.viewport.value
    if (!api || syncing) return
    const wanted = onScreen(el) && options.visible() && !occluded.value && isOwner.value
    if (!wanted) {
      if (holding.value) {
        holding.value = false
        if (owner.value === id) owner.value = null
        await api.detach().catch(() => {})
      }
      return
    }
    syncing = true
    try {
      const rect = rectOf(el)
      if (!holding.value) {
        owner.value = id
        const info = await api.attach(rect, activeTabId.value ?? undefined)
        holding.value = true
        applyOne(info)
      } else {
        await api.setBounds(rect, activeTabId.value ?? undefined)
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      syncing = false
    }
  }

  const applyOne = (info: AwogBrowserTab): void => {
    activeTabId.value = info.tabId
    const at = tabs.value.findIndex((t) => t.tabId === info.tabId)
    if (at >= 0) tabs.value[at] = info
    else tabs.value.push(info)
    if (document.activeElement?.tagName !== 'INPUT') urlDraft.value = info.url
  }

  const applyList = (list: AwogBrowserTabList): void => {
    tabs.value = list.tabs
    // FOLLOW THE AGENT. When a tool call opens a tab or switches tabs, the panel
    // moves with it — that is the whole point of showing the browser next to the
    // transcript. Only while we hold the view: a panel that isn't showing anything
    // must not yank the view over on a background navigation.
    const followed = holding.value && !!list.activeTabId && list.activeTabId !== activeTabId.value
    if (list.activeTabId) activeTabId.value = list.activeTabId
    const active = list.tabs.find((t) => t.tabId === list.activeTabId)
    // Don't clobber what the user is typing.
    if (active && document.activeElement?.tagName !== 'INPUT') urlDraft.value = active.url
    // The view can be taken away from us (popout, another window). Drop the claim
    // so this instance stops pushing bounds at a view it no longer holds.
    if (holding.value && active && !active.shown) {
      holding.value = false
      if (owner.value === id) owner.value = null
    }
    if (followed) {
      // A different tab means a different view in our rect — re-attach.
      holding.value = false
      void sync()
      return
    }
    // NHẬN LẠI VIEW KHI NÓ ĐƯỢC TRẢ TỰ DO.
    //
    // Lỗi thật 2026-09-09: mở tab ra cửa sổ riêng rồi đóng cửa sổ đó ⇒ panel
    // trống mãi. Main park view lại và phát `changed`, nhưng không ai gọi `sync`:
    // nhánh trên chỉ chạy khi tab ACTIVE đổi, mà ở đây nó không đổi. Nên panel
    // ngồi im với `holding = false` trong khi view đang rảnh.
    //
    // Điều kiện: không ai đang giữ (`!shown && !shownElsewhere`) và chỗ này đang
    // là chủ hợp lệ — `sync()` tự kiểm nốt "khung có đang hiện thật không".
    if (!holding.value && active && !active.shown && !active.shownElsewhere && isOwner.value) {
      void sync()
    }
  }

  // ── Page selection ────────────────────────────────────────────────────────

  const SELECTION_POLL_MS = 1200
  // Give up after a few failures in a row rather than on the first one: "there is
  // no tab yet" is a transient reject, while "this build's main process has no
  // phần E" is permanent — and a permanent one would otherwise cost an IPC
  // round-trip every 1.2s forever. Three strikes tells them apart without matching
  // on an error string.
  const SELECTION_MAX_FAILS = 3
  let selectionTimer: ReturnType<typeof setInterval> | null = null
  let selectionFails = 0
  // Một lời gọi tại một thời điểm. Nhịp poll (1,2s) NGẮN HƠN thời gian một lời gọi
  // xấu có thể mất, nên không có cờ này thì các lời gọi xếp hàng: lỗi thật
  // 2026-09-09 là 12 lời gọi treo cùng lúc rồi cùng ném timeout.
  let selectionInFlight = false

  // Tab trắng thì không có gì để đọc — và quan trọng hơn, KHÔNG ĐƯỢC hỏi: một
  // webContents chưa commit document nào làm `executeJavaScript` treo vô hạn ở
  // main (main giờ cũng tự chặn, đây là lớp thứ hai để khỏi tốn IPC mỗi 1,2s).
  const hasPage = (): boolean => {
    const url = activeTab.value?.url?.trim() ?? ''
    return !!url && url !== 'about:blank'
  }

  const refreshSelection = async (): Promise<void> => {
    const api = bridge.value
    if (!api || selectionFails >= SELECTION_MAX_FAILS || !holding.value) return
    if (selectionInFlight) return
    if (!hasPage()) {
      selectionText.value = ''
      return
    }
    selectionInFlight = true
    try {
      const sel = await api.selection(activeTabId.value ?? undefined)
      selectionText.value = sel.text.trim()
      selectionFails = 0
    } catch {
      selectionFails += 1
      selectionText.value = ''
    } finally {
      selectionInFlight = false
    }
  }

  const stopSelectionPoll = (): void => {
    if (!selectionTimer) return
    clearInterval(selectionTimer)
    selectionTimer = null
  }

  // ── Actions (chrome) ──────────────────────────────────────────────────────

  const guard = async (fn: () => Promise<unknown>): Promise<void> => {
    error.value = ''
    try {
      await fn()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  const submitUrl = (): Promise<void> =>
    guard(async () => {
      const api = bridge.value
      if (!api || !urlDraft.value.trim()) return
      applyOne(await api.open(urlDraft.value, activeTabId.value ?? undefined))
      await sync()
    })

  const back = (): Promise<void> => guard(() => bridge.value!.back(activeTabId.value ?? undefined))
  const forward = (): Promise<void> =>
    guard(() => bridge.value!.forward(activeTabId.value ?? undefined))
  const reload = (): Promise<void> =>
    guard(() => bridge.value!.reload(activeTabId.value ?? undefined))
  const popout = (): Promise<void> => guard(() => bridge.value!.popout())

  // `wait: false` — mọi lời gọi từ đây đều là NGƯỜI DÙNG bấm (nút "+", chip trang
  // đã ghim), nên phải thấy khung đổi ngay. Chờ `loadURL` xong mới trả về là 208ms
  // với trang nhẹ nhất và vài giây với một trang thật (đo được), tức UI đứng im
  // đúng lúc người ta vừa bấm. Trạng thái tải theo về sau qua event `changed`.
  const newTab = (url?: string): Promise<void> =>
    guard(async () => {
      const created = await bridge.value!.newTab(url, { wait: false })
      activeTabId.value = created.tabId
      holding.value = false
      await sync()
    })

  const selectTab = (tabId: string): Promise<void> =>
    guard(async () => {
      applyOne(await bridge.value!.selectTab(tabId))
      // Re-attach: a different tab means a different view in our rect.
      holding.value = false
      await sync()
    })

  const closeTab = (tabId: string): Promise<void> =>
    guard(async () => {
      await bridge.value!.closeTab(tabId)
      holding.value = false
      await sync()
    })

  // Take the view back from the other dock / the popout.
  const takeOver = (): Promise<void> =>
    guard(async () => {
      owner.value = id
      holding.value = false
      await sync()
    })

  // ── Wiring ────────────────────────────────────────────────────────────────

  // "Get it off the screen", for the paths that must not wait for a sync trigger:
  // deactivation and teardown.
  //
  // ONLY THE CURRENT OWNER MAY DETACH. Vue can activate the incoming instance
  // before it deactivates the outgoing one, and main's `detachFrom(window)` parks
  // every tab in that window — so a late detach from the instance that just lost
  // the claim would rip the view off the instance that legitimately took it.
  // Releasing the claim is enough there; the new owner's `isOwner` watcher does
  // the rest.
  const detachNow = async (): Promise<void> => {
    const wasOwner = owner.value === id
    holding.value = false
    if (!wasOwner) return
    owner.value = null
    await bridge.value?.detach().catch(() => {})
  }

  let stopChanged: (() => void) | null = null
  let ro: ResizeObserver | null = null
  let frame = 0
  const nudge = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      void sync()
    })
  }

  const refreshOccluded = (): void => {
    const next = document.querySelector(OCCLUDING) !== null
    if (next !== occluded.value) occluded.value = next
  }
  let mo: MutationObserver | null = null

  onMounted(() => {
    const api = bridge.value
    if (!api) return
    void api.tabs().then(applyList)
    stopChanged = api.onChanged(applyList)
    // `class` for `.ovl.on`, childList for the v-if-mounted menus and lightboxes.
    mo = new MutationObserver(refreshOccluded)
    mo.observe(document.body, { subtree: true, childList: true, attributeFilter: ['class'] })
    ro = new ResizeObserver(nudge)
    if (options.viewport.value) ro.observe(options.viewport.value)
    window.addEventListener('resize', nudge)
    // Capture phase: any scroll container between the panel and the root moves us.
    window.addEventListener('scroll', nudge, true)
    void sync()
  })

  // The element arrives after mount when the tab is opened later.
  watch(options.viewport, (el) => {
    ro?.disconnect()
    if (el && ro) ro.observe(el)
    void sync()
  })
  watch([() => options.visible(), occluded, isOwner], () => void sync())

  // Poll only while the page is on screen in THIS instance: a parked panel has no
  // selection to report, and asking would cost an IPC round-trip per tick per dock.
  watch(holding, (on) => {
    stopSelectionPoll()
    if (!on) {
      selectionText.value = ''
      return
    }
    void refreshSelection()
    selectionTimer = setInterval(() => void refreshSelection(), SELECTION_POLL_MS)
  })

  // KeepAlive, explicitly. Leaving the Sessions page or switching to another
  // session deactivates this component instead of unmounting it, and a native view
  // left attached goes on painting over the next screen — the one visible failure
  // mode this surface has. `sync()` would also catch it (the box leaves the
  // document, so `onScreen` is false), but only on its next trigger; deactivation
  // itself is not one, so detach here rather than wait for a resize that may never
  // come. Re-attaching on activate is the other half: the user comes back and the
  // page has to be there.
  onDeactivated(() => {
    void detachNow()
  })
  onActivated(() => {
    void sync()
  })

  onUnmounted(() => {
    stopSelectionPoll()
    stopChanged?.()
    mo?.disconnect()
    ro?.disconnect()
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('resize', nudge)
    window.removeEventListener('scroll', nudge, true)
    void detachNow()
  })

  return {
    available,
    tabs,
    activeTabId,
    activeTab,
    urlDraft,
    error,
    occluded,
    holding,
    elsewhere,
    selectionText,
    submitUrl,
    back,
    forward,
    reload,
    popout,
    newTab,
    selectTab,
    closeTab,
    takeOver,
  }
}
