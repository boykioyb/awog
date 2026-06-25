<template>
  <div ref="hostRef" class="mehost" />
</template>

<script setup lang="ts">
// Editable multi-tab Monaco surface (ADR 0021) for the Project Code Workspace and
// the Task Artifact Editor. Owns a model cache keyed by file path so each open tab
// keeps its own undo stack + scroll/cursor (VSCode semantics); the parent drives
// tabs/dirty/save imperatively via defineExpose. Monaco is dynamic-imported on
// mount (heavy → kept out of the initial bundle); workers bundled locally (no CDN,
// security invariant #5). Theming reuses useMonacoTheme like MonacoViewer:
//   'follow-app' → derive editor colors from the live CSS tokens (dark/light).
//   curated      → a bundled VSCode-style scheme, lazy-loaded JSON.
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
    // Active file path (model key). Empty string = nothing open.
    path?: string
    readOnly?: boolean
  }>(),
  { path: '', readOnly: false },
)

const emit = defineEmits<{
  // Fired on every user edit (skips programmatic value swaps) with the full text.
  change: [payload: { path: string; value: string }]
  // ⌘/Ctrl+S inside the editor — the parent performs the actual save.
  save: []
  // Monaco mounted + ready (flush pending opens, deep-link a file, …).
  ready: []
  'cursor-change': [pos: { line: number; column: number }]
}>()

const { isDark } = useTheme()
const { current, hydrate, loadThemeData } = useMonacoTheme()

const hostRef = useTemplateRef<HTMLElement>('hostRef')
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRef = shallowRef<typeof Monaco | null>(null)
// Model cache keyed by path so each tab keeps its own undo stack + content.
const models = new Map<string, Monaco.editor.ITextModel>()
const viewStates = new Map<string, Monaco.editor.ICodeEditorViewState | null>()
const pendingOpens: { path: string; content: string; language?: string }[] = []
let activePath = ''
// Suppress the change emit while we apply an external value (reload / item swap).
let suppress = false

const THEME_DARK = 'awog-ed-dark'
const THEME_LIGHT = 'awog-ed-light'
const followAppThemeId = () => (isDark.value ? THEME_DARK : THEME_LIGHT)
const curatedThemeId = (id: string) => `awog-mt-${id}`
const definedCurated = new Set<string>()
const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)

// Workers bundled locally via Vite `?worker` imports. Set once on the global;
// idempotent across multiple editor/viewer instances.
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
// values reach Monaco (it rejects rgba()/var()); missing tokens fall back to the
// base palette.
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
  set('editor.lineHighlightBackground', '--bgHover')
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

function modelUri(monaco: typeof Monaco, path: string): Monaco.Uri {
  return monaco.Uri.parse(`file:///${path.replace(/^\/+/, '')}`)
}

// Ensure a model exists for `path`. Creates it (with content) on first open;
// replaces content on an explicit reload. Idempotent for an already-open file
// whose content hasn't changed (keeps the undo stack intact).
function ensureModel(path: string, content: string, language?: string): void {
  const monaco = monacoRef.value
  if (!monaco) return
  const existing = models.get(path)
  if (existing) {
    if (existing.getValue() !== content) {
      suppress = true
      existing.setValue(content)
      suppress = false
    }
    if (language) monaco.editor.setModelLanguage(existing, language)
    return
  }
  const model = monaco.editor.createModel(content, language, modelUri(monaco, path))
  model.onDidChangeContent(() => {
    if (suppress || activePath !== path) return
    emit('change', { path, value: model.getValue() })
  })
  models.set(path, model)
}

function activate(path: string): void {
  const ed = editor.value
  const monaco = monacoRef.value
  if (!ed || !monaco) return
  if (activePath && activePath !== path) {
    viewStates.set(activePath, ed.saveViewState())
  }
  activePath = path
  const model = path ? (models.get(path) ?? null) : null
  ed.setModel(model)
  if (model) {
    const vs = viewStates.get(path)
    if (vs) ed.restoreViewState(vs)
    ed.focus()
  }
}

// ── Imperative API for the parent workspace ──────────────────────────────────
function openFile(path: string, content: string, language?: string): void {
  if (!monacoRef.value) {
    pendingOpens.push({ path, content, language })
    return
  }
  ensureModel(path, content, language)
  if (path === props.path) activate(path)
}

function closeFile(path: string): void {
  viewStates.delete(path)
  const model = models.get(path)
  if (model) {
    if (activePath === path) {
      editor.value?.setModel(null)
      activePath = ''
    }
    model.dispose()
    models.delete(path)
  }
}

function getValue(path: string): string {
  return models.get(path)?.getValue() ?? ''
}

// Reset a tab to a freshly-loaded value (after a successful save / external
// reload) so the parent's dirty tracking re-baselines without a change emit.
function setValue(path: string, content: string): void {
  const model = models.get(path)
  if (!model || model.getValue() === content) return
  suppress = true
  model.setValue(content)
  suppress = false
}

function revealPosition(path: string, line: number, column: number): void {
  const ed = editor.value
  if (!ed || activePath !== path) return
  ed.revealLineInCenter(line)
  ed.setPosition({ lineNumber: line, column })
  ed.focus()
}

defineExpose({
  openFile,
  closeFile,
  getValue,
  setValue,
  revealPosition,
  focus: () => editor.value?.focus(),
})

onMounted(async () => {
  if (!hostRef.value) return
  setupWorkers()
  const monaco = await loadMonaco()
  monacoRef.value = monaco
  defineFollowAppThemes(monaco)
  const ed = monaco.editor.create(hostRef.value, {
    model: null,
    readOnly: props.readOnly,
    domReadOnly: props.readOnly,
    theme: followAppThemeId(),
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderWhitespace: 'selection',
    smoothScrolling: true,
    contextmenu: !props.readOnly,
  })
  editor.value = ed

  ed.onDidChangeCursorPosition((e) => {
    emit('cursor-change', { line: e.position.lineNumber, column: e.position.column })
  })
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))

  // Flush any opens requested before Monaco finished loading.
  pendingOpens.forEach((op) => ensureModel(op.path, op.content, op.language))
  pendingOpens.length = 0
  if (props.path) activate(props.path)

  await hydrate()
  void applyTheme()
  emit('ready')
})

watch(
  () => props.path,
  (path) => activate(path),
)

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
  models.forEach((model) => model.dispose())
  models.clear()
  viewStates.clear()
  editor.value?.dispose()
  editor.value = null
})
</script>

<style scoped>
.mehost {
  width: 100%;
  height: 100%;
  background: var(--bgEl);
}
</style>
