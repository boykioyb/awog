<template>
  <div class="mvwrap">
    <div ref="hostRef" class="mvhost" />
    <!-- Heavy Monaco bundle loads async on mount; cover the blank host with a
         spinner until the editor is created (the bundle can take a beat). -->
    <div v-if="!ready && !loadError" class="mvloading">
      <span class="mvspin" />
    </div>
    <!-- Bundle failed to fetch (e.g. a Vite dev re-optimize race). Surface it with
         a retry instead of an unhandled mount error + an endless spinner. -->
    <div v-else-if="loadError" class="mverror">
      <p>{{ t('common.preview.monacoLoadFailed') }}</p>
      <button type="button" class="mvretry" @click="retry">{{ t('common.retry') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Monaco code viewer/editor for the preview overlay (§9). Self-contained:
// dynamic-imports monaco on mount (heavy → kept out of the initial bundle), wires
// language workers locally (no CDN — security invariant #5), and themes via
// useMonacoTheme (ADR 0053):
//   'follow-app' → derive editor colors from the live CSS tokens (dark/light).
//   curated      → a bundled VSCode-style scheme (Dracula/…), lazy-loaded JSON.
// Read-only by default; with `readOnly=false` it becomes an editor that emits
// `change` on every edit and `save` on ⌘/Ctrl+S (the modal owns dirty + persist).
import type * as Monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { FOLLOW_APP, useMonacoTheme } from '~/composables/useMonacoTheme'
import { loadMonaco } from '~/utils/monaco-loader'

const props = withDefaults(
  defineProps<{
    value: string
    // Monaco language id (typescript, json, markdown, …). Empty = plain text.
    language?: string
    // false → editable. The modal toggles this for the "Edit file" action.
    readOnly?: boolean
  }>(),
  { language: '', readOnly: true },
)

const emit = defineEmits<{
  // Fired on every user edit (not on programmatic value swaps) with the full text.
  change: [value: string]
  // ⌘/Ctrl+S inside the editor — the modal performs the actual save.
  save: []
}>()

const { isDark } = useTheme()
const { current, hydrate, loadThemeData } = useMonacoTheme()
const { t } = useI18n()

const hostRef = useTemplateRef<HTMLElement>('hostRef')
// Editor created + bundle loaded → hide the loading overlay.
const ready = ref(false)
// Set when the Monaco bundle fails to fetch — shows a retry instead of an endless
// spinner (and keeps the failure from bubbling as an unhandled mount-hook error).
const loadError = ref(false)
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRef = shallowRef<typeof Monaco | null>(null)
let model: Monaco.editor.ITextModel | null = null
// Suppress the change emit while we apply an external value (reload / item swap).
let suppress = false

const THEME_DARK = 'awog-pv-dark'
const THEME_LIGHT = 'awog-pv-light'
const followAppThemeId = () => (isDark.value ? THEME_DARK : THEME_LIGHT)
const curatedThemeId = (id: string) => `awog-mt-${id}`
const definedCurated = new Set<string>()
const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)

// Workers are bundled locally via Vite `?worker` imports (mirrors the legacy
// editor). Set once on the global; idempotent across multiple viewer instances.
function setupWorkers(): void {
  const g = globalThis as unknown as { MonacoEnvironment?: unknown }
  if (g.MonacoEnvironment) return
  g.MonacoEnvironment = {
    getWorker(_id: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    },
  }
}

// Resolve a CSS custom property to a concrete value off <body> (theme tokens live
// on :root / body.light). Returns '' when unset so non-hex values are skipped.
function cssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

// Define the 'follow-app' editor themes from the live token values. Only hex
// values are fed to Monaco (it rejects rgba()/var()); missing tokens fall back to
// Monaco's base palette.
function defineFollowAppThemes(monaco: typeof Monaco): void {
  const colors: Record<string, string> = {}
  const set = (key: string, varName: string) => {
    const v = cssVar(varName)
    if (isHex(v)) colors[key] = v
  }
  set('editor.background', '--bgEl')
  set('editor.foreground', '--text')
  set('editorLineNumber.foreground', '--textFaint')
  set('editorLineNumber.activeForeground', '--textDim')
  set('editorCursor.foreground', '--accent')
  set('editorWidget.background', '--bgEl')
  set('editorWidget.border', '--border')
  set('editorGutter.background', '--bgEl')
  monaco.editor.defineTheme(THEME_DARK, { base: 'vs-dark', inherit: true, rules: [], colors })
  monaco.editor.defineTheme(THEME_LIGHT, { base: 'vs', inherit: true, rules: [], colors })
}

// Apply the currently-selected theme. follow-app → CSS-derived dark/light; curated
// → lazy-load + register the JSON scheme once, then set it (guard against a race
// where the selection changed during the await).
async function applyTheme(): Promise<void> {
  const monaco = monacoRef.value
  if (!monaco) return
  const id = current.value
  if (id === FOLLOW_APP) {
    defineFollowAppThemes(monaco)
    monaco.editor.setTheme(followAppThemeId())
    return
  }
  const data = await loadThemeData(id)
  if (!data) {
    defineFollowAppThemes(monaco)
    monaco.editor.setTheme(followAppThemeId())
    return
  }
  const themeId = curatedThemeId(id)
  if (!definedCurated.has(themeId)) {
    monaco.editor.defineTheme(themeId, data)
    definedCurated.add(themeId)
  }
  if (current.value === id) monaco.editor.setTheme(themeId)
}

async function initEditor(): Promise<void> {
  if (!hostRef.value || editor.value) return
  let monaco: typeof Monaco
  try {
    setupWorkers()
    monaco = await loadMonaco()
  } catch {
    // The dynamic import failed (loadMonaco already cleared its cache so a retry
    // can re-import). Surface it rather than leaving the mount hook rejected.
    loadError.value = true
    return
  }
  loadError.value = false
  monacoRef.value = monaco
  defineFollowAppThemes(monaco)
  model = monaco.editor.createModel(props.value, props.language || undefined)
  editor.value = monaco.editor.create(hostRef.value, {
    model,
    readOnly: props.readOnly,
    domReadOnly: props.readOnly,
    theme: followAppThemeId(),
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    renderWhitespace: 'none',
    wordWrap: 'off',
    contextmenu: !props.readOnly,
  })
  // Emit user edits (skip programmatic setValue from the reload/item-swap watch).
  model.onDidChangeContent(() => {
    if (!suppress && model) emit('change', model.getValue())
  })
  // ⌘/Ctrl+S → let the modal persist. Monaco swallows the browser default.
  editor.value.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
  ready.value = true

  await hydrate()
  void applyTheme()
}

// Re-attempt the bundle load after a transient fetch failure (Vite re-optimize).
function retry(): void {
  loadError.value = false
  void initEditor()
}

// Open Monaco's own find widget (⌘/Ctrl+F). The preview overlay calls this when the
// key is pressed while a code file is shown but focus isn't yet inside the editor
// (Monaco only self-binds ⌘F when focused). Returns false if the editor isn't ready
// so the caller can leave the browser's default find alone instead of a dead no-op.
function focusFind(): boolean {
  const ed = editor.value
  if (!ed) return false
  ed.focus()
  void ed.getAction('actions.find')?.run()
  return true
}
defineExpose({ focusFind })

onMounted(() => void initEditor())

// Swap content/language without recreating the editor (item change / reload after
// save). Suppress the change emit so an external swap isn't seen as a user edit.
watch([() => props.value, () => props.language], ([val, lang]) => {
  const monaco = monacoRef.value
  if (!monaco || !model) return
  if (model.getValue() !== val) {
    suppress = true
    model.setValue(val)
    suppress = false
  }
  monaco.editor.setModelLanguage(model, lang || 'plaintext')
})

watch(
  () => props.readOnly,
  (ro) => editor.value?.updateOptions({ readOnly: ro, domReadOnly: ro, contextmenu: !ro }),
)

// Selected theme changed (picker) → re-apply.
watch(current, () => void applyTheme())

// App dark/light changed → only 'follow-app' reacts (curated themes are fixed).
watch(isDark, () => {
  const monaco = monacoRef.value
  if (!monaco || current.value !== FOLLOW_APP) return
  defineFollowAppThemes(monaco)
  monaco.editor.setTheme(followAppThemeId())
})

onBeforeUnmount(() => {
  model?.dispose()
  model = null
  editor.value?.dispose()
  editor.value = null
})
</script>

<style scoped>
.mvwrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.mvhost {
  width: 100%;
  height: 100%;
  background: var(--bgEl);
}
/* Loading overlay shown until the editor is created (covers the blank host). */
.mvloading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--bgEl);
}
.mvspin {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: mv-spin 0.8s linear infinite;
}
/* Bundle-load failure state (same footprint as the loading overlay). */
.mverror {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  text-align: center;
  background: var(--bgEl);
  color: var(--textDim);
}
.mvretry {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.mvretry:hover {
  background: var(--bgHover);
}
@keyframes mv-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
