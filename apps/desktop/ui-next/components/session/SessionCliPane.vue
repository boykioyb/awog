<template>
  <div class="clipane" :style="{ '--clipane-bg': paneBg }">
    <!-- Không có cầu engine (browser-dev) hoặc phiên chưa persist (chưa có
         engineId → openCli không có gì để gắn) → trạng thái trống. -->
    <div v-if="!canRun" class="empty" style="padding: 30px">
      <div class="et">{{ unavailableMsg }}</div>
    </div>

    <template v-else>
      <!-- Không còn thanh điều khiển riêng — Sync / Ngắt / Aa / Về chat nằm trên
           HEADER của SessionDetail (chỉ hiện khi cliMode), theo ghi chú layout
           "bỏ hẳn hàng bar, nút đưa lên header". Drawer cỡ/font mở qua
           `toggleAppearance` (defineExpose) từ nút Aa trên header. -->
      <SshAppearancePanel v-if="appearanceOpen" @close="appearanceOpen = false" />

      <!-- Lỗi spawn (phiên bận / runtime không hỗ trợ / thiếu binary) hiện TRONG
           thân pane — thanh trên vẫn sống nên người dùng chọn CLI khác để thử lại
           hoặc quay về chat, thay vì bị kẹt trên một màn hình lỗi. -->
      <div v-if="errorMsg" class="empty" style="padding: 30px">
        <div class="et">{{ errorMsg }}</div>
      </div>
      <!-- Khung xterm giữ mount suốt (v-show ở cha) nên PTY sống qua các lần đổi
           chỗ chat ↔ CLI. Container phải tồn tại kể cả lúc có errorMsg vì xterm
           đã mở vào nó — v-show chứ không v-if. Padding đặt ở WRAPPER, tuyệt đối
           không ở `.clibox`: FitAddon đo clientHeight BAO GỒM padding, nên gutter
           trên chính box đo sẽ làm hàng cuối tràn vào vùng đệm và bị cắt glyph. -->
      <div v-show="!errorMsg" class="cliwrap">
        <div ref="box" class="clibox" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// "Open in CLI" — pane một-xterm chạy CLI agent thật (claude / codex / devin)
// trong workspace của phiên, thay CHỖ transcript + composer khi bật. PTY đi qua
// sessions.openCli (gom dưới khoá `cli:<engineId>`) rồi dùng chung kênh
// terminal.data / terminal.exit / terminal.write/resize/kill với terminal thường.
//
// Giản lược từ WorkspaceTerminal (multi-tab + split → một pane): vẫn giữ buffer
// output sớm trong lúc `creating` (burst đầu của CLI đến trước khi openCli trả
// terminalId), markDead "press any key to restart", theme xterm qua token CSS +
// useTerminalAppearanceStore, ResizeObserver + FitAddon. `active` = pane đang
// hiển thị (terminal ngoài màn hình đo được 0px → refit khi hiện lại).
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { useTerminalAppearanceStore } from '~/stores/terminalAppearance'
import { useSidecar, type SidecarEvent, type UnlistenFn } from '~/composables/useSidecar'
import { useTerminalApi, type CliKind } from '~/composables/useTerminalApi'
import { useFilePreview } from '~/composables/useFilePreview'
import { registerTerminalFileLinks } from '~/composables/useTerminalFileLinks'
import { enableTerminalWebgl } from '~/utils/xterm-webgl'
import type { Session } from '~/composables/useSessionsData'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  session: Session
  // True khi pane đang hiển thị — lái refit/focus (một terminal bị v-show giấu
  // đo ra kích thước 0 nên phải fit lại lúc hiện).
  active: boolean
}>()

const emit = defineEmits<{
  // Trạng thái PTY CLI, báo nguyên trạng cho cha:
  //   attached — một PTY `cli:` còn sống → cha KHOÁ composer (engine chặn
  //              sendMessage trên mọi link sống — kể cả devin unlinked);
  //   linked   — cờ `res.linked` THẬT của openCli (native resume đúng phiên
  //              này / devin mở phiên riêng) để cha chọn copy notice đúng.
  linked: [state: { attached: boolean; linked: boolean }]
}>()

const { t } = useI18n()
const sc = useSidecar()
const api = useTerminalApi()
const store = useSessionsStore()
const filePreview = useFilePreview()

const engineId = computed(() => props.session.engineId ?? null)
const canRun = computed(() => sc.available && engineId.value != null)
const unavailableMsg = computed(() =>
  sc.available ? t('sessions.cli.unsaved') : t('sessions.workspace.unavailable'),
)

// CLI native của phiên theo provider (store.providerOf đã resolve qua accountId
// trước, rồi mới tới nhãn `account`): anthropic → claude, openai → codex. Mục
// menu chỉ hiện cho hai provider đó nên đến đây không bao giờ là giá trị khác.
const nativeCli = computed<CliKind>(() =>
  store.providerOf(props.session) === 'openai' ? 'codex' : 'claude',
)
const cli = ref<CliKind>(nativeCli.value)
// Panel cỡ/font terminal (drawer SSH dùng lại — dock absolute phải pane). Toggle
// từ nút Aa trên header của SessionDetail qua defineExpose.
const appearanceOpen = ref(false)

defineExpose({
  toggleAppearance: () => {
    appearanceOpen.value = !appearanceOpen.value
  },
})

// ── Trạng thái pane (không reactive — xterm lớn, đừng proxy nó) ──────────────
const box = useTemplateRef<HTMLElement>('box')
let term: Terminal | null = null
let fit: FitAddon | null = null
let terminalId: string | null = null
let resizeObserver: ResizeObserver | null = null
let creating = false
// Shell đã chết (exit / engine restart) nhưng xterm + scrollback còn trên màn
// hình; pane chết không tự respawn khi resize — chờ một phím bấm, đúng kiểu
// "press any key to restart" của VS Code / iTerm (xem WorkspaceTerminal).
let exited = false
let pending: SidecarEvent[] = []
let unlisten: UnlistenFn | null = null
const errorMsg = ref<string | null>(null)

// ── Theme xterm — đọc token CSS sống để theo theme đang bật (đọc từ <body>, KHÔNG
// <html>: override light-mode nằm trên body.light — xem WorkspaceTerminal). ────
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined' || !document.body) return fallback
  const v = getComputedStyle(document.body).getPropertyValue(name).trim()
  return v || fallback
}
const { family: themeFamily } = useThemeFamily()
const { isDark } = useTheme()
const appearance = useTerminalAppearanceStore()

// Nền của KHUNG pane (padding đọc như padding nội tại của terminal): preset hex
// của người dùng, else --termBg rồi mới tới --bg — cùng thứ tự ưu tiên xterm.
const paneBg = computed(() => appearance.theme?.background ?? 'var(--termBg, var(--background))')

// Màu slider scrollbar — xterm 6 tự vẽ scrollbar và chỉ lấy màu từ ba token này.
const SLIDER_COLORS: ITheme = {
  scrollbarSliderBackground: 'rgba(145, 145, 145, 0.4)',
  scrollbarSliderHoverBackground: 'rgba(145, 145, 145, 0.62)',
  scrollbarSliderActiveBackground: 'rgba(145, 145, 145, 0.8)',
}

const resolveTheme = (): ITheme => ({
  ...SLIDER_COLORS,
  ...(appearance.theme ?? {
    background: cssVar('--termBg', cssVar('--background', '#0d0d0d')),
    foreground: cssVar('--termText', cssVar('--foreground', '#e5e5e5')),
    cursor: cssVar('--primary', '#3b82f6'),
    selectionBackground: cssVar('--primary', '#3b82f6'),
    selectionForeground: cssVar('--primary-foreground', '#ffffff'),
  }),
})

// ── Chết + khởi động lại ─────────────────────────────────────────────────────
// Idempotent: hai nguồn (event exit rồi write bị từ chối) không được in thông báo
// hai lần.
const markDead = (notice: string): void => {
  if (exited) return
  exited = true
  terminalId = null
  pending = []
  term?.write(
    `\r\n\x1b[90m[${notice} — ${t('sessions.workspace.terminal.restartHint')}]\x1b[0m\r\n`,
  )
  emit('linked', { attached: false, linked: false })
}

// Spawn một shell mới vào CÙNG xterm (giữ scrollback, như reuse tab).
const restartPane = (): void => {
  if (!exited || creating) return
  exited = false
  syncSize()
}

// Backend id không còn tồn tại — engine đã restart (hoặc shell bị thu hồi) trong
// khi pane còn giữ id cũ. Trường hợp duy nhất write bị từ chối nghĩa là pane chết.
const isStaleBackendError = (err: unknown): boolean =>
  err instanceof Error && /unknown (terminal|connection)/i.test(err.message)

const onBackendError = (err: unknown): void => {
  if (isStaleBackendError(err)) markDead(t('sessions.workspace.terminal.disconnected'))
}

// ── Định tuyến event ─────────────────────────────────────────────────────────
const routeEvent = (evt: SidecarEvent): void => {
  const payload = evt.payload as Record<string, unknown>
  if (payload?.terminalId !== terminalId || !term) return
  if (evt.type === 'terminal.data' && typeof payload.chunk === 'string') {
    term.write(payload.chunk)
  } else if (evt.type === 'terminal.exit') {
    const code = typeof payload.exitCode === 'number' ? payload.exitCode : 0
    markDead(`${t('sessions.workspace.terminal.exited')} ${code}`)
  }
}

// Listener chia sẻ: event tới trong lúc openCli còn chờ thì đệm lại (burst đầu
// của CLI — prompt hiện tức thì — sẽ mất nếu không có chỗ đỗ; flush lọc theo
// terminalId sau khi create trả về). Event của terminal KHÁC (workspace PTYs)
// cũng vào đệm rồi bị routeEvent lọc rơi — một chút rác chấp nhận được, giống hệt
// trade-off của WorkspaceTerminal.
const onSidecarEvent = (evt: SidecarEvent): void => {
  if (evt.type === 'engine.crashed' || evt.type === 'engine.restarted') {
    // Engine chết rồi sống lại: terminalId đang giữ là cũ — write sẽ bị nuốt mãi
    // và pane nhìn như treo. Khai tử nó; respawn ngay nếu pane đang hiện.
    if (term) markDead(t('sessions.workspace.terminal.engineRestarted'))
    if (evt.type === 'engine.restarted' && props.active) restartPane()
    return
  }
  if (evt.type !== 'terminal.data' && evt.type !== 'terminal.exit') return
  if (creating) {
    pending.push(evt)
    return
  }
  routeEvent(evt)
}

// ── Vòng đời PTY ──────────────────────────────────────────────────────────────
const createPty = async (cols: number, rows: number): Promise<void> => {
  const eid = engineId.value
  if (terminalId || creating || exited || !term || !eid) return
  creating = true
  try {
    const res = await api.openCli(eid, cli.value, cols, rows)
    terminalId = res.terminalId
    // `res.linked` THẬT — devin trả false (phiên riêng); composer khoá theo
    // `attached` (PTY sống) chứ không theo cờ engine này.
    emit('linked', { attached: true, linked: res.linked })
  } catch (err) {
    // Phiên bận / runtime không hỗ trợ / thiếu binary — hiện trong thân pane
    // (thanh CLI vẫn cho chọn chương trình khác hoặc quay về chat). Vứt buffer:
    // event đang đệm có thể là của PTY khác, không được flush vào spawn sau.
    errorMsg.value = err instanceof Error ? err.message : t('sessions.cli.unavailable')
    pending = []
    return
  } finally {
    creating = false
  }
  const buffered = pending
  pending = []
  buffered.forEach(routeEvent)
}

const syncSize = (): void => {
  const el = box.value
  if (!fit || !term || !el) return
  if (el.clientWidth === 0 || el.clientHeight === 0) return
  try {
    fit.fit()
  } catch {
    // container chưa đo được — bỏ qua
  }
  const { cols, rows } = term
  if (!terminalId) {
    // Pane chết (`exited`) bị createPty chặn — resize cửa sổ không được phép âm
    // thầm hồi sinh shell người dùng đã đóng.
    void createPty(cols, rows)
  } else {
    api.resize(terminalId, cols, rows).catch((err: unknown) => onBackendError(err))
  }
}

// Gắn listener sidecar một lần, TRƯỚC khi PTY nào tồn tại — đệm trong
// onSidecarEvent giữ burst đầu cho tới khi pane học được terminalId.
const ensureListener = async (): Promise<void> => {
  if (unlisten || !sc.available) return
  unlisten = await sc.onEvent(onSidecarEvent)
}

// Mở xterm vào khung (một lần — gọi lại khi `errorMsg` vừa được gỡ mà term đã
// có thì không làm gì; container vẫn là `box` đã quan sát).
const initTerm = async (): Promise<void> => {
  const container = box.value
  if (!container || term || !canRun.value) return

  await ensureListener()

  const instance = new Terminal({
    fontSize: appearance.fontSize,
    fontFamily: appearance.fontFamily,
    // xterm mặc định 1000 dòng — một log dài cuốn mất hết.
    scrollback: 10_000,
    cursorBlink: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    theme: resolveTheme(),
  })
  fit = new FitAddon()
  instance.loadAddon(fit)
  instance.open(container)
  term = instance
  enableTerminalWebgl(instance)

  // Bấm path trong output CLI → PreviewModal (resolve qua file index của phiên
  // host — cùng đường `filePreview.open` với link trong transcript).
  registerTerminalFileLinks(instance, (path) => filePreview.open(path))

  // Input → PTY. Đăng ký MỘT lần cho mỗi xterm; đọc terminalId lười nên vẫn chạy
  // sau reconnect (id PTY mới). Shell chết: phím bấm spawn shell mới thay vì biến
  // mất — pane trơ mà nhìn như sống là bug cũ đã sửa ở WorkspaceTerminal.
  instance.onData((data) => {
    if (exited) {
      restartPane()
      return
    }
    if (terminalId) api.write(terminalId, data).catch((err: unknown) => onBackendError(err))
  })

  // Chỉ copy: Cmd+C (mac) / Ctrl+Shift+C khi ĐANG có selection; Ctrl+C trần vẫn
  // là SIGINT. Paste KHÔNG xử lý — paste sẵn của xterm đã viết qua onData một lần
  // với bracketed-paste đúng; xử lý thêm là nhân đôi.
  instance.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const wantsCopy =
      (e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC')
    if (wantsCopy && instance.hasSelection()) {
      navigator.clipboard.writeText(instance.getSelection()).catch(() => undefined)
      return false
    }
    return true
  })

  resizeObserver = new ResizeObserver(() => syncSize())
  resizeObserver.observe(container)
  syncSize()
}

// ── Hành động ────────────────────────────────────────────────────────────────
// Kill PTY hiện tại khi pane unmount, nuốt lỗi (record có thể đã tự reap).
// KHÔNG xoá terminalId ở đây — event terminal.exit đến sau vẫn đi đường markDead
// (hint restart + báo cha). "Ngắt CLI" / "Đồng bộ" sống trên header SessionDetail
// (detachCli / syncCliTranscript của cha) — pane chỉ còn terminal thuần.
const killPty = async (): Promise<void> => {
  const id = terminalId
  if (!id) return
  await api.kill(id).catch(() => undefined)
}

// ── Wiring ────────────────────────────────────────────────────────────────────
// Appearance đổi (preset / cỡ / font / theme-family / light-dark) → repaint xterm
// đang mở + refit (font metrics đổi làm lệch cols/rows).
watch(
  [
    () => appearance.theme,
    () => appearance.fontSize,
    () => appearance.fontFamily,
    themeFamily,
    isDark,
  ],
  () => {
    if (!term) return
    term.options.theme = resolveTheme()
    term.options.fontSize = appearance.fontSize
    term.options.fontFamily = appearance.fontFamily
    nextTick(syncSize)
  },
)

// Pane trở nên nhìn thấy (cha v-show) → xterm đang đo 0px cần fit lại + focus.
watch(
  () => props.active,
  (v) => {
    if (!v) return
    nextTick(() => {
      syncSize()
      // Repaint cưỡng bức khi pane hiện lại — renderer WebGL hay để canvas đen
      // sau một chu kỳ display:none nếu chỉ trông chờ vào output tiếp theo.
      term?.refresh(0, term.rows - 1)
      term?.focus()
    })
  },
)

onMounted(() => void initTerm())

// KeepAlive của trang sessions giữ SessionDetail (và pane này) sống khi đổi
// phiên — DOM được tháo ra nên kích thước xterm cũ; PTY vẫn sống, chỉ refit.
onActivated(() => {
  if (props.active) nextTick(syncSize)
})

onBeforeUnmount(() => {
  if (unlisten) unlisten()
  unlisten = null
  resizeObserver?.disconnect()
  resizeObserver = null
  void killPty()
  terminalId = null
  term?.dispose()
  term = null
  fit = null
  emit('linked', { attached: false, linked: false })
})
</script>

<style scoped>
.clipane {
  position: relative; /* dock cho SshAppearancePanel (absolute right) */
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--background);
}
/* Wrapper mang gutter — đáy rộng hơn các cạnh khác: hàng cuối của TUI nằm sát
   mép pane → text bị status bar app lấn/cắt nếu không chừa chỗ. `.clibox` bên
   trong KHÔNG có padding: nó là vùng FitAddon đo, clientHeight gồm cả padding sẽ
   xếp hàng cuối vào vùng đệm và cắt ngang glyph. */
.cliwrap {
  flex: 1;
  min-height: 0;
  padding: 6px 2px 36px 10px;
  background: var(--clipane-bg, var(--background));
}
.clibox {
  height: 100%;
  min-height: 0;
}
</style>
