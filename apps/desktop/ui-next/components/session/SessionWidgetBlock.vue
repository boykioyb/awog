<template>
  <div ref="rootEl" class="wgt">
    <div class="wgthead">
      <Icon name="layers" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="wgttitle">
        {{ t(isSvg ? 'sessionsWidget.svgTitle' : 'sessionsWidget.title') }}
      </span>
      <span class="wgtnote">
        {{ scripts ? t('sessionsWidget.scriptsOn') : t('sessionsWidget.sandboxed') }}
      </span>
      <span class="wgtgrow" />
      <button
        v-if="!tooLarge && !scripts"
        class="wgtbtn"
        :title="t('sessionsWidget.enableScriptsHint')"
        @click="enableScripts"
      >
        <Icon name="play" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <span>{{ t('sessionsWidget.enableScripts') }}</span>
      </button>
      <button
        v-if="!tooLarge"
        class="wgticon"
        :title="t('sessionsWidget.taller')"
        :aria-label="t('sessionsWidget.taller')"
        @click="cycleHeight"
      >
        <Icon name="maximize" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        v-if="scripts"
        class="wgticon"
        :title="t('sessionsWidget.openFull')"
        :aria-label="t('sessionsWidget.openFull')"
        @click="openFull"
      >
        <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        class="wgticon"
        :class="{ on: showSource }"
        :title="t(showSource ? 'sessionsWidget.hideSource' : 'sessionsWidget.showSource')"
        :aria-label="t(showSource ? 'sessionsWidget.hideSource' : 'sessionsWidget.showSource')"
        @click="showSource = !showSource"
      >
        <Icon name="code" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        class="wgticon"
        :title="t('sessionsWidget.copy')"
        :aria-label="t('sessionsWidget.copy')"
        @click="copySource"
      >
        <Icon
          :name="copied ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
      </button>
    </div>

    <div v-if="tooLarge" class="wgtstate">
      {{ t('sessionsWidget.tooLarge', { size: sizeLabel }) }}
    </div>

    <!-- Sandboxed, opaque-origin frame. `sandbox` never carries allow-same-origin, so the
         document cannot touch the app's DOM, storage or the `window.awog` bridge (which
         Electron does not inject into subframes anyway); scripts stay off until the user
         asks for them. See docs/features/session-inline-widgets.md. -->
    <iframe
      v-else
      :key="frameKey"
      class="wgtframe"
      :style="{ height: `${height}px` }"
      :sandbox="sandbox"
      referrerpolicy="no-referrer"
      :srcdoc="srcdoc"
      :title="t('sessionsWidget.title')"
    />

    <pre v-if="showSource" class="wgtsrc">{{ code }}</pre>
  </div>
</template>

<script setup lang="ts">
// Inline widget block: an HTML/SVG artifact the model emitted, rendered as an interactive
// card in the transcript.
//
// SECURITY (rules/security.md — model output is L1, and this is the only surface in the
// app that renders it as MARKUP rather than text):
//   1. Never `v-html`. The content only ever reaches an <iframe srcdoc>.
//   2. `sandbox` NEVER includes allow-same-origin, so the document runs on an opaque
//      origin: no access to the parent DOM, cookies, localStorage or `window.awog`
//      (Electron's preload doesn't run in subframes — nodeIntegrationInSubFrames is off —
//      and cross-origin blocks it regardless). No allow-top-navigation, no allow-popups:
//      the widget cannot navigate the app away or spawn windows.
//   3. Scripts are OFF by default (empty `sandbox` attribute = every restriction on). The
//      user opts in per widget via "Enable interactivity"; only then is allow-scripts
//      added. This is browser-enforced, not a heuristic scan of the markup — and it also
//      contains the DoS case, since a sandboxed srcdoc frame can share the renderer's
//      event loop and a `while(true)` would otherwise hang the transcript.
//   4. A CSP is injected as the first element of the frame document: `default-src 'none'`
//      kills fetch/XHR/websocket/beacon/external img/CDN css/font, and `webrtc 'block'`
//      closes the STUN/TURN side channel. Extra policies can only intersect, so markup
//      carrying its own <meta csp> can never loosen ours.
//      CẨN THẬN — CSP KHÔNG phủ hết đường ra. Không directive nào của nó cai quản việc
//      một document TỰ điều hướng chính nó (`navigate-to` chưa từng ship; `form-action`
//      chỉ chặn `<form>`). Với script đã bật, `location.href = '…?d=' + payload` là một
//      kênh xuất thật. Nó bị chặn ở TẦNG KHÁC — `will-frame-navigate` trong
//      electron/src/window.ts — chứ không phải bởi CSP ở đây. Comment cũ ở chỗ này
//      khẳng định "không có kênh exfiltrate nào" và điều đó SAI; một khẳng định an
//      toàn sai là thứ người review dựa vào.
//   5. Byte cap (WIDGET_MAX) + fixed height + lazy mount (IntersectionObserver): a huge or
//      broken widget cannot stall the transcript, and a long session doesn't spawn dozens
//      of frames at once.
// The residual risk is content spoofing (a convincing fake UI drawn inside the card) —
// mitigated by the always-visible chrome + "sandboxed" label, never by the markup itself.

const props = defineProps<{
  /** Raw widget markup as the model emitted it (fence body). Untrusted, L1. */
  code: string
  /** `svg` renders the markup as a standalone drawing; `html` as a document body. */
  lang: 'html' | 'svg'
}>()

const { t } = useI18n()
const { open: openPreview } = usePreview()

// A widget is a UI fragment, not a bundle. Past this it's almost certainly a data blob
// (or a runaway generation) and is shown as source only.
const WIDGET_MAX = 256 * 1024
const HEIGHTS = [260, 440, 720] as const

const isSvg = computed(() => props.lang === 'svg')
const tooLarge = computed(() => props.code.length > WIDGET_MAX)
const sizeLabel = computed(() => `${Math.round(props.code.length / 1024)} KB`)

const scripts = ref(false)
const showSource = ref(false)
const copied = ref(false)
const heightIdx = ref(0)
const height = computed(() => HEIGHTS[heightIdx.value] ?? HEIGHTS[0])
// Re-creating the frame is the only way to change its sandbox: the attribute is read at
// document creation, so flipping it on a live frame would be a lie until the next load.
const frameKey = ref(0)

// New markup (a re-render / an edited message) starts from the safe default again —
// consent was given to the code the user saw, not to whatever replaced it.
watch(
  () => props.code,
  () => {
    scripts.value = false
    frameKey.value++
  },
)

function enableScripts() {
  scripts.value = true
  frameKey.value++
}
function cycleHeight() {
  heightIdx.value = (heightIdx.value + 1) % HEIGHTS.length
}
async function copySource() {
  await navigator.clipboard.writeText(props.code)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1200)
}
// Full-screen goes through the shared PreviewModal ('html' kind → its own sandboxed
// iframe). Offered only once the user already enabled scripts here, because that modal's
// frame carries allow-scripts unconditionally — showing it earlier would silently run
// code the user declined.
function openFull() {
  // Cố ý gửi bản KHÔNG script sang PreviewModal: khung của modal mang
  // `allow-popups`, và `window.open` ở renderer này được biến thành
  // `shell.openExternal` (electron/src/window.ts), tức một widget bật script mở
  // được trình duyệt THẬT của người dùng bằng URL nó tự dựng. Xem toàn màn hình
  // là để ĐỌC nội dung, không phải để chạy nó.
  openPreview({
    name: t('sessionsWidget.title'),
    kind: 'html',
    text: buildDocWithoutScripts(props.code),
  })
}

const sandbox = computed(() => (scripts.value ? 'allow-scripts' : ''))

// `default-src 'none'` is the load-bearing directive: no connect-src, no external
// img/font/style/frame. Inline styles are allowed because a widget's whole layout is
// inline; script-src is added only in the opted-in variant.
const CSP_BASE =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; " +
  "font-src data:; form-action 'none'; base-uri 'none'; webrtc 'block'"

// The frame gets a white canvas (same choice as PreviewModal's html render): model-authored
// markup assumes a light page, and pushing app theme colours across the boundary would only
// half-apply. Colours here are literals inside a string that becomes a foreign document —
// not app chrome — so they are not theme tokens.
// Bản cố định KHÔNG script, dùng cho bề mặt nào không kiểm soát được sandbox.
function buildDocWithoutScripts(body: string): string {
  return buildDocWith(body, false)
}

function buildDoc(body: string): string {
  return buildDocWith(body, scripts.value)
}

function buildDocWith(body: string, withScripts: boolean): string {
  const csp = withScripts
    ? `${CSP_BASE}; script-src 'unsafe-inline'`
    : `${CSP_BASE}; script-src 'none'`
  const style =
    'html,body{margin:0;padding:12px;background:#fff;color:#111;' +
    'font:14px/1.5 system-ui,-apple-system,sans-serif}svg,img{max-width:100%;height:auto}'
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="light"><style>${style}</style></head><body>${body}</body></html>`
}

// Lazy mount: the frame stays empty until the card scrolls into view, so a transcript with
// many widgets doesn't create every document up front.
const rootEl = useTemplateRef<HTMLElement>('rootEl')
const visible = ref(false)
let observer: IntersectionObserver | null = null
onMounted(() => {
  const el = rootEl.value
  if (!el) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      visible.value = true
      observer?.disconnect()
      observer = null
    },
    { rootMargin: '200px' },
  )
  observer.observe(el)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const srcdoc = computed(() => (visible.value && !tooLarge.value ? buildDoc(props.code) : ''))
</script>

<style scoped>
.wgt {
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--bgSubtle);
}
.wgthead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 10px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* Hairline on a fixed-height bar (ADR 0079): a border would eat 1px of the box and
     push the vertically centered children onto a half pixel. */
  box-shadow: inset 0 -1px 0 var(--border);
}
.wgttitle {
  color: var(--text);
  font-weight: 600;
}
.wgtnote {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wgtgrow {
  flex: 1;
}
.wgtbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wgtbtn:hover {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--text);
}
.wgticon {
  padding: 5px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  transition: background 0.12s ease;
}
.wgticon:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wgticon.on {
  background: var(--accentDim);
  color: var(--accent);
}
.wgtframe {
  display: block;
  width: 100%;
  border: 0;
  background: #fff; /* design-token-ok: matches the srcdoc's own white canvas */
}
.wgtsrc {
  /* mono-ok: the widget's source markup, meant to be read/copied as code */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin: 0;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  color: var(--textDim);
  box-shadow: inset 0 1px 0 var(--border);
}
.wgtstate {
  padding: 16px 12px;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
@media (prefers-reduced-motion: reduce) {
  .wgticon {
    transition: none;
  }
}
</style>
