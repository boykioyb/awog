<template>
  <!-- Hàng 2 — điều hướng + ô URL + hành động trên trang. Hai nhóm CỐ ĐỊNH kẹp
       một ô co giãn, và hàng được phép XUỐNG DÒNG: panel kéo được tới 240px, ở
       đó một hàng đơn bóp ô URL còn 41px (đo được, bản 5 nút) — một ô nhập không
       hiện được gì. Basis của ô URL vì thế là SỐ HỌC, xem comment ở ô URL.
       Hairline dưới bằng inset shadow để không ăn 1px chiều cao hàng. -->
  <div
    class="relative flex flex-wrap items-center gap-1 px-2 py-1.5 shadow-[inset_0_-1px_0_var(--color-border)]"
  >
    <!-- Hai nhóm đi thành KHỐI, nên panel hẹp đẩy cả nhóm xuống dòng dưới thay vì
         gọt mỗi nút một pixel. -->
    <div class="flex flex-none items-center gap-1">
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :disabled="!tab?.canGoBack"
        :title="t('sessions.workspace.browser.back')"
        :aria-label="t('sessions.workspace.browser.back')"
        @click="emit('back')"
      >
        <Icon name="chev-left" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :disabled="!tab?.canGoForward"
        :title="t('sessions.workspace.browser.forward')"
        :aria-label="t('sessions.workspace.browser.forward')"
        @click="emit('forward')"
      >
        <Icon name="chev-right" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :title="t('sessions.workspace.browser.reload')"
        :aria-label="t('sessions.workspace.browser.reload')"
        @click="emit('reload')"
      >
        <Icon name="refresh" />
      </Button>
    </div>

    <!-- Ô URL hai chế độ: đang focus thì là input edit URL đầy đủ như cũ; không
         focus thì là lớp ĐỌC (lock/https · warn/http · host nổi · path mờ) phủ
         lên trên — một cú bấm focus input + select-all đúng kiểu omnibox. Lớp
         đọc là nút để tab/keyboard vẫn tới được.
         Basis 96px CHÍNH LÀ ngưỡng xuống dòng, nên nó là số học chứ không phải khẩu
         vị: hàng còn một dòng khi nav (3×28 + 2×4 = 92) + basis + actions (28 — còn
         đúng một nút ⋯) + gap (8) + padding (16) ≤ bề rộng panel ⇒ ngưỡng 240px, đúng
         bằng panel min 240 nên hàng 2 thực tế KHÔNG xuống dòng. `flex-wrap` giữ như dây
         an toàn: thêm nút vào hàng này thì phải đo lại số trên.
         `@container`: ô hẹp (panel 240px ⇒ ô ~120px) thì đồng hồ tải nhường chỗ cho chữ URL. -->
    <div
      class="@container relative flex h-ctrl-xs min-w-0 flex-[1_1_6rem] rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring"
    >
      <!-- Phần ô chữ (input + lớp đọc phủ lên nó). Tách khỏi cụm nút bên phải để lớp đọc
           phủ ĐÚNG ô chữ dù cụm nút rộng hẹp theo nội dung (đồng hồ tải đổi bề rộng). -->
      <div class="relative flex min-w-0 flex-auto rounded-[inherit]">
        <!-- `unstyled`: vỏ ngoài đã mang viền + nền; để Input tự vẽ thì nó chồng thêm
             khung thứ hai. `min-h-0` gỡ min-height toàn cục của ô nhập trong prototype.css
             (ô URL cao theo hàng nút, không phải --ctrl-h). Khi lớp đọc phủ lên, chữ của input trong suốt để lớp đọc
             (nền trong suốt) không lộ chữ bên dưới. -->
        <Input
          ref="urlEl"
          v-model="url"
          unstyled
          class="min-h-0 min-w-0 flex-auto px-2.5 text-sm text-foreground"
          :class="!urlFocused && 'text-transparent placeholder:text-transparent'"
          type="text"
          spellcheck="false"
          :placeholder="t('sessions.workspace.browser.urlPlaceholder')"
          @keydown.enter.prevent="emit('submit-url')"
          @focus="urlFocused = true"
          @blur="urlFocused = false"
        />
        <!-- Lớp đọc phủ nguyên ô chữ (absolute inset-0) — là vùng bấm của ô nhập, không
             phải nút hành động; Button sẽ áp chiều cao/căn giữa riêng của nó. -->
        <!-- raw-ok: lớp đọc của ô URL (vùng bấm phủ ô nhập) -->
        <button
          v-if="!urlFocused"
          type="button"
          class="absolute inset-0 flex cursor-text items-center gap-1.5 overflow-hidden rounded-[inherit] px-2.5 focus-visible:outline-2 focus-visible:outline-ring"
          :title="tab?.url || t('sessions.workspace.browser.urlPlaceholder')"
          @click="focusUrl"
        >
          <!-- http:// = "không an toàn" — cảnh báo thật, không phải trang trí. -->
          <Icon
            :name="urlView.icon"
            class="size-3 shrink-0"
            :class="urlView.icon === 'warn' ? 'text-destructive' : 'text-faint'"
          />
          <span class="min-w-0 flex-auto truncate text-left text-sm">
            <span v-if="urlView.host" class="text-foreground">{{ urlView.host }}</span>
            <span class="text-muted-foreground">
              {{
                urlView.rest || (urlView.host ? '' : t('sessions.workspace.browser.urlPlaceholder'))
              }}
            </span>
          </span>
        </button>
      </div>

      <div class="flex flex-none items-stretch">
        <!-- Đồng hồ tải trang: đếm sống khi đang tải, giữ con số cuối khi xong. -->
        <span
          v-if="loadTimer.text.value"
          class="tnum self-center px-1 text-xs whitespace-nowrap @max-[220px]:hidden"
          :class="loadTimer.running.value ? 'text-primary' : 'text-muted-foreground'"
          :title="loadTimer.title.value"
          role="timer"
        >
          {{ loadTimer.text.value }}
        </span>
        <!-- Network Capture (docs/features/network-capture.md): bấm = bật ghi nếu đang tắt rồi
             mở cửa sổ inspector; đang ghi thì hiện chấm đỏ + số request (rộng theo số). -->
        <Button
          variant="ghost"
          size="iconSm"
          class="h-full w-auto min-w-7 gap-1 px-1"
          :class="capture.state.value?.recording ? 'text-destructive' : 'text-muted-foreground'"
          :disabled="!tab"
          :title="
            capture.state.value?.recording
              ? t('capture.nav.recording', { n: capture.state.value.count })
              : t('capture.nav.open')
          "
          :aria-label="t('capture.nav.open')"
          @pointerenter="prefetchBrowserFrame"
          @click="capture.openInspector()"
        >
          <Icon name="act" />
          <template v-if="capture.state.value?.recording">
            <span class="size-1.5 flex-none rounded-full bg-destructive" aria-hidden="true" />
            <span class="tnum text-xs">{{ capture.state.value.count }}</span>
          </template>
        </Button>
        <!-- Proxy / VPN của hồ sơ đang dùng (ADR 0103/0105): sáng khi đang bật. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="h-full"
          :class="proxyTitle ? 'text-primary' : 'text-muted-foreground'"
          :title="proxyTitle || t('browser.proxy.buttonOff')"
          :aria-label="proxyTitle || t('browser.proxy.buttonOff')"
          @pointerenter="prefetchBrowserFrame"
          @pointerdown="prefetchBrowserFrame"
          @click="proxyOpen = true"
        >
          <Icon name="globe" />
        </Button>
        <!-- ☆/★ — bookmark trang đang xem vào hồ sơ hiện tại. Chưa có: thêm ngay vào thanh
             rồi mở hộp sửa (tiêu đề + thư mục) như Chrome; đã có: mở hộp sửa. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="h-full"
          :class="bookmarked ? 'text-primary' : 'text-muted-foreground'"
          :disabled="!canBookmark"
          :title="bookmarked ? t('browser.bookmarks.edit') : t('browser.bookmarks.add')"
          :aria-label="bookmarked ? t('browser.bookmarks.edit') : t('browser.bookmarks.add')"
          @pointerenter="prefetchBrowserFrame"
          @pointerdown="prefetchBrowserFrame"
          @click="onStar"
        >
          <Icon name="bookmark" :class="bookmarked && 'fill-current'" />
        </Button>
      </div>
    </div>

    <!-- Hành động trên trang (ghim · chép URL · dịch · trích dẫn · chọn phần tử)
         cộng dock · popout · phóng to: TÁM thứ, tất cả tần suất thấp, gộp sau một
         nút. Mục nào không dùng được ở trạng thái hiện tại thì `disabled` ngay
         trong menu — nhìn thấy được LÝ DO thay vì một nút xám không giải thích. -->
    <div class="flex flex-none items-center gap-1">
      <!-- MỘT nút menu duy nhất. Panel/popout: mở menu ⋯ cấp-trang (⋮ cấp
           trình-duyệt sống ở hàng tab của BrowserChrome). Surface 'main' không
           có BrowserChrome nên cùng nút này mở menu gộp — mục cấp-trang prepend
           vào đầu menu cấp-trình-duyệt (BrowserOverflowMenu). Đang mở = accent-tint. -->
      <Button
        variant="ghost"
        size="iconSm"
        :class="
          (surface === 'main' ? overflowAt : actionsAt) !== null
            ? 'bg-selected text-primary'
            : 'text-muted-foreground'
        "
        :title="t(surface === 'main' ? 'browser.menu.title' : 'browser.actions.title')"
        :aria-label="t(surface === 'main' ? 'browser.menu.title' : 'browser.actions.title')"
        @pointerenter="prefetchBrowserFrame"
        @pointerdown="prefetchBrowserFrame"
        @click.stop="surface === 'main' ? openOverflow($event) : openActions($event)"
      >
        <Icon name="dots" />
      </Button>
    </div>

    <!-- Thanh tiến trình 2px sát mép dưới hàng URL — chỉ hiện khi tab đang tải.
         Indeterminate: renderer không biết phần trăm tải của trang. Giảm động ⇒
         khối đứng yên (vẫn báo "đang tải", chỉ không trượt). -->
    <div
      v-if="tab?.loading"
      class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
      aria-hidden="true"
    >
      <div
        class="absolute inset-y-0 left-0 w-2/5 animate-[bch-prog_1.2s_ease-in-out_infinite] rounded-sm bg-primary motion-reduce:translate-x-4/5 motion-reduce:animate-none"
      />
    </div>
  </div>

  <BrowserBookmarkBar :profile-id="profileId" :current-url="tab?.url ?? ''" @open="onOpenUrl" />
  <BrowserBookmarkDialog
    :open="dialogOpen"
    :profile-id="profileId"
    :url="tab?.url ?? ''"
    :title="tab?.title ?? ''"
    :bookmark-id="dialogBookmarkId"
    @close="dialogOpen = false"
  />
  <BrowserProxyModal
    :open="proxyOpen"
    :profile="profilesApi.resolve(profileId) ?? null"
    @close="proxyOpen = false"
  />

  <!-- Menu split-view: đổi mép dock của view Browser. -->
  <AppContextMenu
    :open="dockAt !== null"
    :position="dockAt ?? { x: 0, y: 0 }"
    :items="dockItems"
    @close="dockAt = null"
    @select="onDockSelect"
  />
  <AppContextMenu
    :open="actionsAt !== null"
    :position="actionsAt ?? { x: 0, y: 0 }"
    :items="actionItems"
    @close="actionsAt = null"
    @select="onActionSelect"
  />
  <BrowserOverflowMenu
    :open="overflowAt !== null"
    :position="overflowAt ?? { x: 0, y: 0 }"
    :root="root"
    :tab-id="tabId"
    :scope="tab?.scope"
    :page-url="tab?.url"
    :profile-id="profileId"
    :prepend="surface === 'main' ? actionItems : undefined"
    @close="overflowAt = null"
    @action="onActionSelect"
    @open-url="onOpenUrl"
  />
</template>

<script setup lang="ts">
// Hàng điều hướng của chrome trình duyệt (ADR 0086) — nav + ô URL + nút ⋯ + ba
// menu (trang / dock / ⋮ overflow). Tách khỏi BrowserChrome §refactor:
// component này giữ phần TƯƠNG TÁC của hàng 2, còn logic menu sống ở
// `useBrowserActions`.
import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { WorkspaceDockSide } from '~/stores/settings'
import type { BrowserChromeSurface } from './BrowserChrome.vue'
import { useBrowserActions } from '~/composables/useBrowserActions'
import Input from '~/components/ui/input/Input.vue'
import BrowserBookmarkBar from '~/components/browser/BrowserBookmarkBar.vue'
import BrowserBookmarkDialog from '~/components/browser/BrowserBookmarkDialog.vue'
import BrowserProxyModal from '~/components/browser/BrowserProxyModal.vue'
import { useBookmarks } from '~/composables/useBookmarks'
import { useBrowserProfiles, useScopeProfile } from '~/composables/useBrowserProfiles'
import { sidecarErrorText } from '~/composables/useSidecar'
import { prefetchBrowserFrame } from '~/composables/useEmbeddedBrowser'
import { usePageLoadTimer } from '~/composables/usePageLoadTimer'
import { useCaptureIndicator } from '~/composables/useCaptureIndicator'

const props = withDefaults(
  defineProps<{
    // Tab đang active — nguồn của URL THẬT hiển thị ở chế độ đọc, canGo* và
    // cờ loading (thanh tiến trình). null = chưa có tab.
    tab: AwogBrowserTab | null
    // id tab để hỏi selection trên đúng webContents + menu ⋮.
    tabId: string | null
    root?: string | null
    project?: string
    selectionText?: string
    surface?: BrowserChromeSurface
    expanded?: boolean
    canExpand?: boolean
    dock?: WorkspaceDockSide
    // Scope sở hữu bề mặt — dùng khi CHƯA có tab nào (không có `tab.scope` để đọc) mà
    // vẫn phải biết bookmark/hồ sơ của phiên. Vắng = pool global.
    scope?: string
  }>(),
  {
    root: null,
    project: undefined,
    selectionText: '',
    surface: 'panel',
    expanded: false,
    canExpand: true,
    dock: 'right',
    scope: undefined,
  },
)

const emit = defineEmits<{
  back: []
  forward: []
  reload: []
  'submit-url': []
  popout: []
  'set-dock': [side: WorkspaceDockSide]
  'toggle-expand': []
  // Mở một URL từ bookmark (thanh / ☆ / menu "Tất cả bookmark"). Bề mặt quyết định
  // 'current' = điều hướng tab đang xem, 'new' = tab mới.
  'open-url': [url: string, mode: 'current' | 'new']
}>()

// Ô URL là thứ người dùng đang GÕ (khác `tab.url` = URL đang tải thật), nên nó
// thuộc về bề mặt (composable đồng bộ lại mỗi lần agent điều hướng) → v-model.
const url = defineModel<string>('url', { required: true })

const { t } = useI18n()

const {
  overflowAt,
  dockAt,
  actionsAt,
  dockItems,
  actionItems,
  openOverflow,
  openActions,
  onDockSelect,
  onActionSelect,
} = useBrowserActions(
  {
    tab: () => props.tab,
    tabId: () => props.tabId,
    selectionText: () => props.selectionText ?? '',
    project: () => props.project,
    expanded: () => props.expanded,
    canExpand: () => props.canExpand,
    dock: () => props.dock,
    isPanel: () => props.surface === 'panel',
    isMain: () => props.surface === 'main',
  },
  emit,
)

// ── Hồ sơ + bookmark ────────────────────────────────────────────────────────

// Hồ sơ hiệu lực của scope này; tab đang xem cho gợi ý tức thì, main (`profileOf`) là
// câu trả lời cuối — đúng cả khi scope chưa có tab nào.
const { profileId } = useScopeProfile(
  () => props.tab?.scope ?? props.scope,
  () => props.tab?.profileId,
)
const bm = useBookmarks(() => profileId.value)

const pageUrl = computed(() => props.tab?.url ?? '')
const canBookmark = computed(() => /^https?:\/\//i.test(pageUrl.value))
const bookmarked = computed(() => bm.isBookmarked(pageUrl.value))

const dialogOpen = ref(false)
const dialogBookmarkId = ref<string | undefined>(undefined)

const onStar = async (): Promise<void> => {
  if (!canBookmark.value) return
  try {
    if (!bm.isBookmarked(pageUrl.value)) {
      await bm.add(pageUrl.value, props.tab?.title ?? '')
    }
    dialogBookmarkId.value = bm.find(pageUrl.value)?.node.id
    dialogOpen.value = dialogBookmarkId.value !== undefined
  } catch (err) {
    useToast().add({
      title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
      color: 'error',
    })
  }
}

const onOpenUrl = (u: string, mode: 'current' | 'new'): void => {
  emit('open-url', u, mode)
}

// Nút ⋮ sống ở hàng TAB (BrowserChrome), menu render ở đây — expose để chrome
// gọi mở đúng vị trí neo của nút.
defineExpose({ openOverflow })

// ── Proxy / VPN (ADR 0103/0105) ─────────────────────────────────────────────
// Hồ sơ của tab này đi qua proxy? Cờ `proxied` của main là sự thật về tab; host:port chỉ
// lấy từ danh sách hồ sơ (cùng thứ trang Settings đã hiện) — không từ đâu khác. Nút cạnh
// ☆ vừa là chỉ báo (sáng khi bật) vừa là lối mở editor cho đúng hồ sơ này.
const profilesApi = useBrowserProfiles()
const proxyTitle = computed<string>(() => {
  const p = profilesApi.resolve(profileId.value)?.proxy
  if (p) return t('browser.proxy.indicator', { addr: `${p.host}:${p.port}` })
  return props.tab?.proxied ? t('browser.proxy.indicatorNoAddr') : ''
})
const proxyOpen = ref(false)

// ── Đồng hồ tải trang ───────────────────────────────────────────────────────
const loadTimer = usePageLoadTimer(() => props.tab)
const capture = useCaptureIndicator(
  () => props.tab?.tabId ?? null,
  () => props.tab?.scope ?? props.scope,
)

// ── Ô URL: chế độ đọc ───────────────────────────────────────────────────────

const urlEl = useTemplateRef<HTMLInputElement>('urlEl')
const urlFocused = ref(false)

// Một cú bấm lên lớp đọc = vào ô soạn + select-all, đúng thói quen omnibox.
const focusUrl = (): void => {
  const el = urlEl.value
  if (!el) return
  el.focus()
  el.select()
}

// Phân tích URL ĐANG TẢI THẬT (không phải draft): icon bảo mật + host nổi bật +
// path mờ. Parse hỏng (scheme lạ) thì hiện nguyên văn ở phần mờ.
type UrlView = { icon: 'lock' | 'warn' | 'globe'; host: string; rest: string }
const urlView = computed<UrlView>(() => {
  const raw = (props.tab?.url ?? '').trim()
  if (!raw || raw === 'about:blank') return { icon: 'globe', host: '', rest: '' }
  try {
    const u = new URL(raw)
    const icon = u.protocol === 'https:' ? 'lock' : u.protocol === 'http:' ? 'warn' : 'globe'
    // Chrome cũng giấu "/" trần của trang chủ — chỉ hiện phần path có nghĩa.
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`
    return { icon, host: u.host, rest }
  } catch {
    return { icon: 'globe', host: '', rest: raw }
  }
})
</script>

<style>
/* style-ok: keyframes thanh tải indeterminate — tw-animate-css không có kiểu trượt
   ngang này. Không `scoped` vì Vue đổi tên keyframes scoped còn class Tailwind
   `animate-[bch-prog…]` tham chiếu tên gốc. */
@keyframes bch-prog {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
</style>
