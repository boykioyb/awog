<template>
  <div ref="hostRef" class="mvhost" />
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

const hostRef = useTemplateRef<HTMLElement>('hostRef')
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

onMounted(async () => {
  if (!hostRef.value) return
  setupWorkers()
  const monaco = await loadMonaco()
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

  await hydrate()
  void applyTheme()
})

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
.mvhost {
  width: 100%;
  height: 100%;
  background: var(--bgEl);
}
</style>
