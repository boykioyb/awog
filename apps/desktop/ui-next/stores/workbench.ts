import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import type { DockView, SideView, TermTab, WorkbenchDoc } from '~/types/workbench'
import { useSessionsStore } from '~/stores/sessions'

// Bounded context for the Session Workbench chrome (ADR 0098): doc tabs, dock,
// explorer selection, terminal tabs. Session data stays in `stores/sessions`,
// project data in `stores/projects` — this store only owns *layout state*.
export const useWorkbenchStore = defineStore('workbench', () => {
  // ── docs ──────────────────────────────────────────────────────────────
  // 'chat' + 'settings'/'monitor' là global; mọi doc còn lại (file, web, img,
  // mmd, diff, task…) đi theo `sessions.activeId` — đổi session là strip đổi,
  // không leak tab browser của session khác.
  const GLOBAL_KINDS = new Set<WorkbenchDoc['kind']>(['settings', 'monitor'])
  const docsBySession = reactive(new Map<string, WorkbenchDoc[]>())
  const globalDocs = ref<WorkbenchDoc[]>([])
  const activeDoc = ref<string>('chat')
  const DOC_CAP = 12

  const sessionsStore = useSessionsStore()
  const curSid = computed(() => String(sessionsStore.active?.id ?? ''))

  const chatDoc = computed<WorkbenchDoc>(() => ({
    kind: 'chat',
    id: 'chat',
    title: 'Trao đổi',
    pin: true,
  }))
  const sessionDocs = computed(() => docsBySession.get(curSid.value) ?? [])
  const docs = computed<WorkbenchDoc[]>(() => [
    chatDoc.value,
    ...sessionDocs.value,
    ...globalDocs.value,
  ])
  // Id của MỌI doc đang mở ở mọi session (+ global). State file của một doc chỉ được
  // bỏ khi không còn session nào mở nó — `docs` chỉ là strip của session HIỆN TẠI,
  // dọn theo nó là xoá state của tab session khác đang giữ (component KeepAlive của
  // tab đó vẫn trỏ vào object cũ ⇒ quay lại thấy nội dung cũ, nạp lại vô tác dụng).
  const openDocIds = computed<Set<string>>(() => {
    const ids = new Set<string>(globalDocs.value.map((d) => d.id))
    for (const list of docsBySession.values()) for (const d of list) ids.add(d.id)
    return ids
  })

  function openDoc(d: WorkbenchDoc) {
    if (GLOBAL_KINDS.has(d.kind)) {
      const existing = globalDocs.value.find((x) => x.id === d.id)
      if (!existing) globalDocs.value.push(d)
    } else {
      const list = docsBySession.get(curSid.value) ?? []
      const existing = list.find((x) => x.id === d.id)
      if (!existing) {
        list.push(d)
        if (list.length > DOC_CAP) {
          const idx = list.findIndex((x) => !x.pin && !x.dirty && x.id !== activeDoc.value)
          if (idx >= 0) list.splice(idx, 1)
        }
      }
      docsBySession.set(curSid.value, list)
    }
    activeDoc.value = d.id
  }

  function closeDoc(id: string) {
    const isGlobal = GLOBAL_KINDS.has(docs.value.find((x) => x.id === id)?.kind ?? 'file')
    if (isGlobal) {
      globalDocs.value = globalDocs.value.filter((x) => x.id !== id)
    } else {
      const list = docsBySession.get(curSid.value) ?? []
      const d = list.find((x) => x.id === id)
      if (d?.pin) return
      docsBySession.set(
        curSid.value,
        list.filter((x) => x.id !== id),
      )
    }
    if (activeDoc.value === id) {
      activeDoc.value = docs.value[docs.value.length - 1]?.id ?? 'chat'
    }
  }

  function markDirty(id: string, dirty = true) {
    const d = docs.value.find((x) => x.id === id)
    if (d) d.dirty = dirty
  }

  /** Ghim/bỏ ghim: doc ghim dồn về đầu dải session của nó (chat luôn đầu). */
  function reorderPinned(): void {
    const list = docsBySession.get(curSid.value)
    if (!list) return
    const pinned = list.filter((d) => d.pin)
    const rest = list.filter((d) => !d.pin)
    docsBySession.set(curSid.value, [...pinned, ...rest])
  }

  // ── explorer ──────────────────────────────────────────────────────────
  /** node đang chọn trong tree — quyết định thư mục cha khi New File/Folder */
  const selPath = ref('')
  const sideView = ref<SideView>('files')
  const sideClosed = ref(false)
  function setView(v: SideView) {
    sideView.value = v
    sideClosed.value = false
  }
  function toggleSide() {
    sideClosed.value = !sideClosed.value
  }

  // ── dock ──────────────────────────────────────────────────────────────
  const dockView = ref<DockView>('Terminal')
  const dockH = ref(210)
  const dockHidden = ref(false)
  const DOCK_MIN = 34
  const DOCK_MAX = 480
  function toggleDock(show?: boolean) {
    dockHidden.value = show === undefined ? !dockHidden.value : !show
  }

  // ── terminal tabs ─────────────────────────────────────────────────────
  const termTabs = ref<TermTab[]>([])
  const termActive = ref<string>('')
  let termSeq = 0
  function addTermTab(cwd: string, title?: string) {
    const t: TermTab = {
      id: `t${Date.now()}-${termSeq++}`,
      title: title || `zsh ${termTabs.value.length + 1}`,
      cwd,
    }
    termTabs.value.push(t)
    termActive.value = t.id
    return t
  }
  function closeTermTab(id: string) {
    const i = termTabs.value.findIndex((x) => x.id === id)
    if (i < 0) return
    termTabs.value.splice(i, 1)
    if (termActive.value === id)
      termActive.value = (termTabs.value[i] || termTabs.value[i - 1] || termTabs.value[0])?.id ?? ''
  }

  // ── helpers ───────────────────────────────────────────────────────────
  const isChatActive = computed(() => activeDoc.value === 'chat')

  // Đổi session → nếu activeDoc là doc của session cũ, về 'chat'.
  watch(curSid, () => {
    const visible = docs.value.map((d) => d.id)
    if (!visible.includes(activeDoc.value)) activeDoc.value = 'chat'
  })

  return {
    docs,
    openDocIds,
    activeDoc,
    openDoc,
    closeDoc,
    markDirty,
    reorderPinned,
    selPath,
    sideView,
    sideClosed,
    setView,
    toggleSide,
    dockView,
    dockH,
    dockHidden,
    DOCK_MIN,
    DOCK_MAX,
    toggleDock,
    termTabs,
    termActive,
    addTermTab,
    closeTermTab,
    isChatActive,
  }
})
