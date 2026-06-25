<template>
  <div ref="hostRef" class="mvhost" />
</template>

<script setup lang="ts">
// Read-only Monaco code viewer for the preview overlay (§9). Self-contained:
// dynamic-imports monaco on mount (heavy → kept out of the initial bundle), wires
// language workers locally (no CDN — security invariant #5), and derives its
// editor theme from the live CSS custom properties so it follows the app's
// dark/light + accent. Adapted from the legacy MonacoEditor.vue but stripped to a
// single read-only model (no tabs / model cache / dirty tracking).
import type * as Monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const props = withDefaults(
  defineProps<{
    value: string
    // Monaco language id (typescript, json, markdown, …). Empty = plain text.
    language?: string
  }>(),
  { language: '' },
)

const { isDark } = useTheme()

const hostRef = useTemplateRef<HTMLElement>('hostRef')
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRef = shallowRef<typeof Monaco | null>(null)
let model: Monaco.editor.ITextModel | null = null

const THEME_DARK = 'awog-pv-dark'
const THEME_LIGHT = 'awog-pv-light'
const activeThemeId = () => (isDark.value ? THEME_DARK : THEME_LIGHT)
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

// Define both editor themes from the live token values. Only hex values are fed
// to Monaco (it rejects rgba()/var()); missing tokens fall back to Monaco's base.
function defineThemes(monaco: typeof Monaco): void {
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

onMounted(async () => {
  if (!hostRef.value) return
  setupWorkers()
  const monaco = await import('monaco-editor')
  monacoRef.value = monaco
  defineThemes(monaco)
  model = monaco.editor.createModel(props.value, props.language || undefined)
  editor.value = monaco.editor.create(hostRef.value, {
    model,
    readOnly: true,
    theme: activeThemeId(),
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    renderWhitespace: 'none',
    wordWrap: 'off',
    // Read-only viewer: hide the cursor + selection chrome so it reads as a viewer.
    domReadOnly: true,
    contextmenu: false,
  })
})

// Swap content/language without recreating the editor.
watch([() => props.value, () => props.language], ([val, lang]) => {
  const monaco = monacoRef.value
  if (!monaco || !model) return
  if (model.getValue() !== val) model.setValue(val)
  monaco.editor.setModelLanguage(model, lang || 'plaintext')
})

watch(isDark, () => {
  const monaco = monacoRef.value
  if (!monaco) return
  defineThemes(monaco)
  monaco.editor.setTheme(activeThemeId())
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
