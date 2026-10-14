<template>
  <!-- Hàng 2 — điều hướng + ô URL + hành động trên trang. Hai nhóm CỐ ĐỊNH kẹp
       một ô co giãn, và hàng được phép XUỐNG DÒNG: panel kéo được tới 240px, ở
       đó một hàng đơn bóp ô URL còn 41px (đo được, bản 5 nút) — một ô nhập không
       hiện được gì. Basis của ô URL vì thế là SỐ HỌC, xem comment ở .bch-url. -->
  <div class="bch-bar">
    <div class="bch-grp">
      <button
        type="button"
        class="bch-act"
        :disabled="!tab?.canGoBack"
        :title="t('sessions.workspace.browser.back')"
        @click="emit('back')"
      >
        <Icon name="chev-left" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        type="button"
        class="bch-act"
        :disabled="!tab?.canGoForward"
        :title="t('sessions.workspace.browser.forward')"
        @click="emit('forward')"
      >
        <Icon name="chev-right" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        type="button"
        class="bch-act"
        :title="t('sessions.workspace.browser.reload')"
        @click="emit('reload')"
      >
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <!-- Ô URL hai chế độ: đang focus thì là input edit URL đầy đủ như cũ; không
         focus thì là lớp ĐỌC (lock/https · warn/http · host nổi · path mờ) phủ
         lên trên — một cú bấm focus input + select-all đúng kiểu omnibox. Lớp
         đọc là <button> để tab/keyboard vẫn tới được. -->
    <div class="bch-url">
      <!-- Phần ô chữ (input + lớp đọc phủ lên nó). Tách khỏi cụm nút bên phải để lớp đọc
           phủ ĐÚNG ô chữ dù cụm nút rộng hẹp theo nội dung (đồng hồ tải đổi bề rộng). -->
      <div class="bch-urlfield">
        <!-- `unstyled`: vỏ .bch-url đã mang viền + nền. Để Input tự vẽ thì nó chồng
             thêm khung h-[--ctrl-h] + viền thứ hai bên trong ⇒ ô URL dày gấp rưỡi
             hàng nút cạnh nó; .bch-urlinp (padding 4px + --lh-sm) mới là chiều cao
             thiết kế, lớp đọc .bch-urlread dùng cùng padding. -->
        <Input
          ref="urlEl"
          v-model="url"
          unstyled
          class="bch-urlinp"
          type="text"
          spellcheck="false"
          :placeholder="t('sessions.workspace.browser.urlPlaceholder')"
          @keydown.enter.prevent="emit('submit-url')"
          @focus="urlFocused = true"
          @blur="urlFocused = false"
        />
        <button
          v-if="!urlFocused"
          type="button"
          class="bch-urlread"
          :title="tab?.url || t('sessions.workspace.browser.urlPlaceholder')"
          @click="focusUrl"
        >
          <Icon :name="urlView.icon" class="bch-urlic" :class="{ warn: urlView.icon === 'warn' }" />
          <span class="bch-urltext">
            <span v-if="urlView.host" class="bch-host">{{ urlView.host }}</span>
            <span class="bch-rest">
              {{
                urlView.rest || (urlView.host ? '' : t('sessions.workspace.browser.urlPlaceholder'))
              }}
            </span>
          </span>
        </button>
      </div>

      <div class="bch-urltools">
        <!-- Đồng hồ tải trang: đếm sống khi đang tải, giữ con số cuối khi xong. -->
        <span
          v-if="loadTimer.text.value"
          class="bch-timer tnum"
          :class="{ running: loadTimer.running.value }"
          :title="loadTimer.title.value"
          role="timer"
        >
          {{ loadTimer.text.value }}
        </span>
        <!-- Network Capture (docs/features/network-capture.md): bấm = bật ghi nếu đang tắt rồi
             mở cửa sổ inspector; đang ghi thì hiện chấm đỏ + số request. -->
        <button
          type="button"
          class="bch-star bch-cap"
          :class="{ rec: capture.state.value?.recording }"
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
          <Icon name="act" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <template v-if="capture.state.value?.recording">
            <span class="bch-capdot" aria-hidden="true" />
            <span class="bch-capn tnum">{{ capture.state.value.count }}</span>
          </template>
        </button>
        <!-- Proxy / VPN của hồ sơ đang dùng (ADR 0103/0105): sáng khi đang bật. -->
        <button
          type="button"
          class="bch-star"
          :class="{ on: !!proxyTitle }"
          :title="proxyTitle || t('browser.proxy.buttonOff')"
          :aria-label="proxyTitle || t('browser.proxy.buttonOff')"
          @pointerenter="prefetchBrowserFrame"
          @pointerdown="prefetchBrowserFrame"
          @click="proxyOpen = true"
        >
          <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <!-- ☆/★ — bookmark trang đang xem vào hồ sơ hiện tại. Chưa có: thêm ngay vào thanh
             rồi mở hộp sửa (tiêu đề + thư mục) như Chrome; đã có: mở hộp sửa. -->
        <button
          type="button"
          class="bch-star"
          :class="{ on: bookmarked }"
          :disabled="!canBookmark"
          :title="bookmarked ? t('browser.bookmarks.edit') : t('browser.bookmarks.add')"
          :aria-label="bookmarked ? t('browser.bookmarks.edit') : t('browser.bookmarks.add')"
          @pointerenter="prefetchBrowserFrame"
          @pointerdown="prefetchBrowserFrame"
          @click="onStar"
        >
          <Icon
            name="bookmark"
            :style="{
              width: 'var(--icon-sm)',
              height: 'var(--icon-sm)',
              fill: bookmarked ? 'currentColor' : 'none',
            }"
          />
        </button>
      </div>
    </div>

    <!-- Hành động trên trang (ghim · chép URL · dịch · trích dẫn · chọn phần tử)
         cộng dock · popout · phóng to: TÁM thứ, tất cả tần suất thấp, gộp sau một
         nút. Mục nào không dùng được ở trạng thái hiện tại thì `disabled` ngay
         trong menu — nhìn thấy được LÝ DO thay vì một nút xám không giải thích. -->
    <div class="bch-grp">
      <!-- MỘT nút menu duy nhất. Panel/popout: mở menu ⋯ cấp-trang (⋮ cấp
           trình-duyệt sống ở hàng tab của BrowserChrome). Surface 'main' không
           có BrowserChrome nên cùng nút này mở menu gộp — mục cấp-trang prepend
           vào đầu menu cấp-trình-duyệt (BrowserOverflowMenu). -->
      <button
        type="button"
        class="bch-act"
        :class="{ on: (surface === 'main' ? overflowAt : actionsAt) !== null }"
        :title="t(surface === 'main' ? 'browser.menu.title' : 'browser.actions.title')"
        @pointerenter="prefetchBrowserFrame"
        @pointerdown="prefetchBrowserFrame"
        @click.stop="surface === 'main' ? openOverflow($event) : openActions($event)"
      >
        <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <!-- Thanh tiến trình 2px sát mép dưới hàng URL — chỉ hiện khi tab đang tải.
         Indeterminate: renderer không biết phần trăm tải của trang. -->
    <div v-if="tab?.loading" class="bch-prog" aria-hidden="true" />
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

<style scoped>
.bch-bar {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}
/* Hai nhóm đi thành KHỐI, nên panel hẹp đẩy cả nhóm xuống dòng dưới thay vì gọt
   mỗi nút một pixel. */
.bch-grp {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.bch-act {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
}
.bch-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.bch-act:disabled {
  opacity: 0.35;
  cursor: default;
}
.bch-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
/* Đã ghim = accent-tint, đúng quy ước selection (không fill xám). */
.bch-act.on {
  background: var(--accentDim);
  color: var(--accent);
}
/* Basis CHÍNH LÀ ngưỡng xuống dòng, nên nó là số học chứ không phải khẩu vị:
   hàng còn một dòng khi nav (74) + basis + actions (22 — sau §3.6 còn đúng một
   nút ⋯) + gap (8) + padding (16) ≤ bề rộng panel ⇒ ngưỡng 216px, dưới panel
   min 240 nên hàng 2 thực tế KHÔNG BAO GIỜ xuống dòng nữa (bản 5 nút hành động
   — actions 126px, ngưỡng 320px — đã đi vào menu ⋯). `flex-wrap` giữ nguyên như
   dây an toàn: thêm nút vào hàng này thì phải đo lại số trên. */
.bch-url {
  position: relative;
  flex: 1 1 96px;
  min-width: 0;
  display: flex;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  /* Ô hẹp (panel 240px ⇒ ô ~120px) thì đồng hồ tải nhường chỗ cho chữ URL. */
  container-type: inline-size;
}
.bch-url:focus-within {
  border-color: var(--accentBorder);
}
.bch-urlfield {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  border-radius: inherit;
}
.bch-urltools {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
}
.bch-timer {
  align-self: center;
  padding: 0 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
}
.bch-timer.running {
  color: var(--accent);
}
@container (max-width: 220px) {
  .bch-timer {
    display: none;
  }
}
.bch-urlinp {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 10px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* Lớp đọc phủ MỜ lên input (bg đặc che text bên dưới), cùng padding để hai chế
   độ trông một hệt — click thì biến thành ô soạn. */
.bch-urlread {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: inherit;
  background: var(--bgInput);
  border: none;
  cursor: text;
  overflow: hidden;
}
.bch-urlread:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bch-urlic {
  flex-shrink: 0;
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--textFaint);
}
/* http:// = "không an toàn" — cảnh báo thật, không phải trang trí. */
.bch-urlic.warn {
  color: var(--danger);
}
.bch-urltext {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bch-host {
  color: var(--text);
}
.bch-rest {
  color: var(--textDim);
}
/* Thanh tiến trình dưới hàng URL: một khối accent 40% trượt ngang. Giảm động
   ⇒ khối đứng yên (vẫn báo "đang tải", chỉ không trượt). */
.bch-prog {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  overflow: hidden;
  pointer-events: none;
}
.bch-prog::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  border-radius: var(--r-xs);
  background: var(--accent);
  animation: bch-prog 1.2s ease-in-out infinite;
}
@keyframes bch-prog {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bch-prog::before {
    animation: none;
    transform: translateX(80%);
  }
}
/* ☆/★ trong ô URL: nằm TRONG luồng cạnh input (lớp đọc chừa 26px bên phải cho nó). */
.bch-star {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  border: none;
  border-radius: var(--r-btn);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.bch-star:hover:not(:disabled) {
  color: var(--text);
}
.bch-star.on {
  color: var(--accent);
}
/* Network Capture: chấm đỏ + số request khi đang ghi. Rộng theo số, nên không ép width 26px. */
.bch-star.bch-cap {
  width: auto;
  min-width: 26px;
  gap: 4px;
  padding: 0 4px;
}
.bch-star.bch-cap.rec {
  color: var(--danger);
}
.bch-capdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  flex: none;
}
.bch-capn {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.bch-star:disabled {
  opacity: 0.35;
  cursor: default;
}
.bch-star:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
