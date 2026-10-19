<template>
  <!-- Chỉ là chỗ neo cho menu + modal (cả hai tự fixed / teleport ra body). -->
  <span class="contents">
    <AppContextMenu
      :open="open"
      :position="position"
      :items="items"
      @close="emit('close')"
      @select="onSelect"
    />

    <!-- Nhập profile browser thật vào jar của agent — modal đã có sẵn, giờ mở từ
         menu này thay vì một nút riêng trên thanh công cụ. -->
    <WorkspaceBrowserImport
      :open="importOpen"
      :profile-id="profileId"
      @close="importOpen = false"
    />
    <BrowserSitesModal :open="sitesOpen" @close="sitesOpen = false" />
    <UserscriptEditorModal
      :open="userscripts.editorOpen.value"
      :initial-source="userscripts.initialSource.value"
      @close="userscripts.editorOpen.value = false"
    />
  </span>
</template>

<script setup lang="ts">
// Menu `⋮` của chrome trình duyệt (ADR 0086) + hai hộp thoại nó mở ra.
//
// Tách khỏi BrowserChrome vì đây là một trách nhiệm riêng: chrome lo BỐ CỤC (tab
// strip, điều hướng, ô URL, ngưỡng xuống dòng), menu này lo NHỮNG VIỆC ÍT DÙNG của
// trình duyệt agent — hồ sơ + bookmark (ADR 0101), ảnh chụp trang, cookie, chính sách
// host, đích mở link, xoá dữ liệu. Chỉ những món CÓ THẬT ở tầng dưới; không có
// "Open file" / "Disable auto verify" / "Persist sessions".
import type { MenuItem } from '~/composables/useContextMenu'
import { useBookmarks } from '~/composables/useBookmarks'
import { useBrowserProfiles } from '~/composables/useBrowserProfiles'
import { useConfirm } from '~/composables/useConfirm'
import { useLinkOpen } from '~/composables/useLinkOpen'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { sidecarErrorText } from '~/composables/useSidecar'
import { useTabUserscripts } from '~/composables/useTabUserscripts'

const props = withDefaults(
  defineProps<{
    open: boolean
    // Điểm mở (toạ độ viewport) — ContextMenu tự kẹp vào trong màn hình.
    position: { x: number; y: number }
    // Root tuyệt đối của workspace: đích ghi ảnh chụp. null ⇒ món đó tắt.
    root?: string | null
    tabId?: string | null
    // Scope của tab đang xem (session sở hữu nó) — main kiểm ownership khi chụp.
    scope?: string
    // Hồ sơ hiệu lực của scope này: bookmark, nhập cookie và xoá dữ liệu đều tác động
    // lên ĐÚNG hồ sơ này, không phải 'default'.
    profileId?: string
    // Mục ghép phía TRÊN (surface 'main' gộp menu ⋯ trang vào một menu duy nhất
    // vì không còn hàng tab để đặt ⋮). Id không thuộc nhóm của menu này được
    // đẩy lên qua emit `action`.
    prepend?: MenuItem[]
    // URL của tab đang xem — "Tạo script cho trang này…" điền @match từ origin của nó.
    pageUrl?: string
  }>(),
  {
    root: null,
    tabId: null,
    scope: undefined,
    profileId: 'default',
    prepend: undefined,
    pageUrl: undefined,
  },
)

const emit = defineEmits<{
  close: []
  action: [id: string]
  'open-url': [url: string, mode: 'current' | 'new']
}>()

const { t } = useI18n()
const { confirm } = useConfirm()
const linkOpen = useLinkOpen()
const profilesApi = useBrowserProfiles()
const bm = useBookmarks(() => props.profileId)
const { openSettings } = useSettingsModal()

const bridge = computed(() =>
  typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
)
const importOpen = ref(false)
const sitesOpen = ref(false)

// Submenu "Userscript trên trang này" + modal soạn script (logic ở composable riêng).
const userscripts = useTabUserscripts({
  open: () => props.open,
  tabId: () => props.tabId,
  scope: () => props.scope,
  pageUrl: () => props.pageUrl,
})

const OWN_IDS = new Set(['screenshot', 'import', 'sites', 'link-app', 'clear'])
const isOwnId = (id: string): boolean =>
  OWN_IDS.has(id) || id.startsWith('go:') || id.startsWith('profile')

// Chỉ phiên thật mới có override hồ sơ. Pool global (không scope) và scope task
// (`task:<id>…`) đi theo mặc định/project, không có "đổi cho phiên này".
const sessionId = computed(() =>
  props.scope && !props.scope.startsWith('task:') ? props.scope : undefined,
)

const currentProfile = computed(() => profilesApi.resolve(props.profileId))

const profileItem = computed<MenuItem>(() => {
  const cur = currentProfile.value
  const canSwitch = !!sessionId.value
  return {
    id: 'profile',
    label: cur?.proxy
      ? t('browser.profiles.currentProxied', {
          name: cur.name,
          addr: `${cur.proxy.host}:${cur.proxy.port}`,
        })
      : t('browser.profiles.current', { name: cur?.name ?? '…' }),
    icon: 'users',
    ...(cur ? { dot: cur.color } : {}),
    children: [
      ...profilesApi.profiles.value.map<MenuItem>((p) => ({
        id: `profile:${p.id}`,
        label: p.name,
        dot: p.color,
        active: p.id === props.profileId,
        ...(p.proxy
          ? { hint: `${p.proxy.type.toUpperCase()} ${p.proxy.host}:${p.proxy.port}` }
          : {}),
        disabled: !canSwitch,
      })),
      { separator: true },
      {
        id: 'profile-inherit',
        label: t('browser.profiles.inherit'),
        disabled: !canSwitch,
        ...(canSwitch ? {} : { hint: t('browser.profiles.sessionOnly') }),
      },
      { separator: true },
      { id: 'profile-manage', label: t('browser.profiles.manage'), icon: 'settings' },
    ],
  }
})

// "Tất cả bookmark": menu cấp một nên thư mục thành hàng tiêu đề (disabled) rồi tới
// các bookmark của nó — dài hơn dropdown của thanh nhưng vẫn duyệt được hết.
const bookmarksItem = computed<MenuItem>(() => {
  const rows: MenuItem[] = []
  for (const n of bm.items.value) {
    if (n.kind === 'url') {
      rows.push({ id: `go:${n.id}`, label: bm.labelOf(n), icon: 'bookmark' })
      continue
    }
    rows.push({ separator: true }, { label: n.title, icon: 'folder', disabled: true })
    for (const c of n.children) rows.push({ id: `go:${c.id}`, label: bm.labelOf(c) })
  }
  return {
    id: 'bookmarks',
    label: t('browser.bookmarks.all'),
    icon: 'bookmark',
    children: rows.length
      ? rows
      : [{ id: 'none', label: t('browser.bookmarks.none'), disabled: true }],
  }
})

const items = computed<MenuItem[]>(() => [
  ...(props.prepend ?? []),
  ...(props.prepend?.length ? [{ separator: true } as MenuItem] : []),
  bookmarksItem.value,
  profileItem.value,
  userscripts.item.value,
  { separator: true },
  {
    id: 'screenshot',
    label: t('browser.menu.screenshot'),
    icon: 'save',
    disabled: !props.root,
    ...(props.root ? {} : { hint: t('browser.menu.noProject') }),
  },
  { id: 'import', label: t('browser.menu.importCookies'), icon: 'download' },
  { id: 'sites', label: t('browser.menu.sites'), icon: 'shield' },
  { separator: true },
  {
    id: 'link-app',
    label: t('browser.menu.openLinksHere'),
    icon: 'external',
    active: linkOpen.mode.value === 'app',
  },
  { separator: true },
  { id: 'clear', label: t('browser.menu.clearData'), icon: 'trash', danger: true },
])

const fail = (err: unknown): void => {
  useToast().add({
    title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
    color: 'error',
  })
}

const onScreenshot = async (): Promise<void> => {
  const api = bridge.value
  const root = props.root
  if (!api || !root) return
  try {
    const res = await api.saveScreenshot(root, props.tabId ?? undefined, props.scope)
    // Đường dẫn tuyệt đối dài hơn cả cái toast, nên hiện phần TRONG workspace như
    // mọi chỗ khác của app (Files/Diff), và cho bấm để mở trong Finder.
    const rel = res.path.startsWith(root)
      ? res.path.slice(root.length).replace(/^[/\\]+/, '')
      : res.path
    useToast().add({
      title: t('browser.toast.screenshot', { path: rel }),
      color: 'success',
      onClick: () => void window.awog?.revealPath(root, rel).catch(() => {}),
    })
  } catch (err) {
    fail(err)
  }
}

const onClearData = async (): Promise<void> => {
  const api = bridge.value
  if (!api) return
  const ok = await confirm({
    title: t('browser.profiles.clearTitle', { name: currentProfile.value?.name ?? '' }),
    description: t('browser.profiles.clearDesc'),
    confirmLabel: t('browser.menu.clearData'),
  })
  if (!ok) return
  try {
    await api.clearData(props.profileId)
    useToast().add({ title: t('browser.toast.cleared'), color: 'success' })
  } catch (err) {
    fail(err)
  }
}

// `profile:<id>` đổi hồ sơ CHO PHIÊN NÀY; `profile-inherit` gỡ override (null) để phiên
// quay về hồ sơ của project / mặc định. Main đóng + mở lại tab của phiên ở partition
// mới — nói trước trong toast để việc tab nháy không làm người dùng giật mình.
const switchProfile = async (profileId: string | null): Promise<void> => {
  const sid = sessionId.value
  if (!sid) return
  try {
    await profilesApi.setSessionProfile(sid, profileId)
    useToast().add({ title: t('browser.profiles.switched'), color: 'success' })
  } catch (err) {
    fail(err)
  }
}

const onSelect = (id: string): void => {
  // Mục của menu ⋯ ghép vào (surface 'main') không phải việc của menu này —
  // đẩy ngược lên NavBar → useBrowserActions.
  if (!isOwnId(id) && !userscripts.handles(id)) {
    emit('action', id)
    return
  }
  if (id.startsWith('go:')) {
    const hit = bm.flat.value.find((e) => e.node.id === id.slice(3))
    if (hit) emit('open-url', hit.node.url, 'current')
  } else if (id === 'profile-manage') openSettings('browser')
  else if (id === 'profile-inherit') void switchProfile(null)
  else if (id.startsWith('profile:')) void switchProfile(id.slice('profile:'.length))
  else if (id === 'import') importOpen.value = true
  else if (id === 'sites') sitesOpen.value = true
  else if (id === 'screenshot') void onScreenshot()
  // Công tắc nối thẳng vào mode của useLinkOpen — không dựng state thứ hai.
  else if (id === 'link-app') linkOpen.setMode(linkOpen.mode.value === 'app' ? 'ask' : 'app')
  else if (id === 'clear') void onClearData()
  else if (userscripts.handles(id)) userscripts.select(id)
}
</script>
