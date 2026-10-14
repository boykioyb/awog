import { computed, ref, watch } from 'vue'
import type { MenuItem } from '~/composables/useContextMenu'
import type { AwogBrowserUserscriptsForTab } from '~/types/awog-bridge'
import { buildUserscriptTemplate, useUserscripts } from '~/composables/useUserscripts'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { sidecarErrorText } from '~/composables/useSidecar'

// Submenu ⋮ → "Userscript trên trang này" (docs/features/browser-userscripts.md).
//
// Tách khỏi BrowserOverflowMenu vì menu đó đã gánh hồ sơ/bookmark/ảnh chụp/cookie…; đây là
// một trách nhiệm riêng (script nào khớp trang của tab này, chúng có chạy không, bật/tắt,
// tạo script mới cho trang). Menu chỉ ghép `item`, chuyển `select` và dựng modal soạn thảo.
//
// "Khớp" và "đã chạy" là câu trả lời của Electron main (`userscriptsForTab`) — nó là nơi
// duy nhất thực sự khớp URL và chạy script, nên UI không tự khớp lại. Hỏi lúc menu MỞ
// (không poll): trạng thái chỉ đổi khi trang tải xong, và người xem menu thì vừa mở nó.

const ID_PREFIX = 'us:'
const ID_NEW = 'us-new'
const ID_MANAGE = 'us-manage'

type Args = {
  open: () => boolean
  tabId: () => string | null | undefined
  scope: () => string | undefined
  pageUrl: () => string | undefined
}

export function useTabUserscripts(args: Args) {
  const { t } = useI18n()
  const api = useUserscripts()
  const { openSettings } = useSettingsModal()

  const info = ref<AwogBrowserUserscriptsForTab>({ ran: [], matching: [] })
  const editorOpen = ref(false)
  const initialSource = ref<string | null>(null)
  let seq = 0

  const refresh = async (): Promise<void> => {
    const bridge = typeof window === 'undefined' ? null : (window.awog?.browser ?? null)
    if (!bridge) return
    const mine = ++seq
    try {
      const res = await bridge.userscriptsForTab(args.tabId() ?? undefined, args.scope())
      if (mine === seq) info.value = res
    } catch {
      if (mine === seq) info.value = { ran: [], matching: [] }
    }
  }

  watch(
    args.open,
    (isOpen) => {
      if (isOpen) void refresh()
    },
    { immediate: true },
  )

  const item = computed<MenuItem>(() => {
    const ran = new Map(info.value.ran.map((r) => [r.id, r]))
    const rows: MenuItem[] = info.value.matching.map((m) => {
      const r = ran.get(m.id)
      const hint = r?.error
        ? t('userscripts.menu.error', { message: r.error })
        : r
          ? t('userscripts.menu.ran')
          : m.enabled
            ? undefined
            : t('userscripts.menu.disabled')
      return {
        id: `${ID_PREFIX}${m.id}`,
        label: m.name,
        // ✓ của menu = công tắc BẬT (bấm để đảo); trạng thái chạy nằm ở hint + icon lỗi.
        active: m.enabled,
        ...(r?.error ? { icon: 'warn' } : {}),
        ...(hint ? { hint } : {}),
      }
    })
    return {
      id: 'userscripts',
      label: t('userscripts.menu.title'),
      icon: 'code',
      children: [
        ...(rows.length
          ? rows
          : [{ id: 'us-none', label: t('userscripts.menu.none'), disabled: true }]),
        { separator: true },
        { id: ID_NEW, label: t('userscripts.menu.create'), icon: 'plus' },
        { id: ID_MANAGE, label: t('userscripts.menu.manage'), icon: 'settings' },
      ],
    }
  })

  const handles = (id: string): boolean =>
    id.startsWith(ID_PREFIX) || id === ID_NEW || id === ID_MANAGE

  const toggle = async (scriptId: string): Promise<void> => {
    const m = info.value.matching.find((x) => x.id === scriptId)
    if (!m) return
    try {
      await api.setEnabled(scriptId, !m.enabled)
    } catch (err) {
      useToast().add({
        title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
        color: 'error',
      })
    }
  }

  const select = (id: string): void => {
    if (id === ID_NEW) {
      initialSource.value = buildUserscriptTemplate(args.pageUrl())
      editorOpen.value = true
    } else if (id === ID_MANAGE) openSettings('userscripts')
    else if (id.startsWith(ID_PREFIX)) void toggle(id.slice(ID_PREFIX.length))
  }

  return { item, handles, select, editorOpen, initialSource }
}
