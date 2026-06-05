<template>
  <div ref="hostRef" class="h-full w-full" :style="{ background: t.bg }" />
</template>

<script setup lang="ts">
// Monaco code-editor surface (ADR 0021). Owns a model cache keyed by file path
// so each open tab keeps its own undo stack + scroll/cursor (VSCode semantics);
// the parent workspace drives tabs/dirty/save imperatively via defineExpose.
// Monaco is dynamic-imported on mount so it lands in the route chunk, not the
// initial bundle. Workers are bundled locally (no CDN — invariant #5).
import type * as Monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { useTheme } from '~/composables/useTheme'

const props = withDefaults(
  defineProps<{
    // Active file path (model key). Empty string = nothing open.
    path?: string
    readOnly?: boolean
  }>(),
  { path: '', readOnly: false },
)

const emit = defineEmits<{
  change: [payload: { path: string; value: string }]
  save: []
  ready: []
  'cursor-change': [pos: { line: number; column: number }]
}>()

const { t, themeName } = useTheme()

const hostRef = useTemplateRef<HTMLElement>('hostRef')
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const monacoRef = shallowRef<typeof Monaco | null>(null)
const models = new Map<string, Monaco.editor.ITextModel>()
const viewStates = new Map<string, Monaco.editor.ICodeEditorViewState | null>()
const pendingOpens: { path: string; content: string; language?: string }[] = []
let activePath = ''

const THEME_DARK = 'awog-dark'
const THEME_LIGHT = 'awog-light'
const activeThemeId = () => (themeName.value === 'light' ? THEME_LIGHT : THEME_DARK)
const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)

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

function defineThemes(monaco: typeof Monaco): void {
  const tok = t.value
  const colors: Record<string, string> = {}
  const set = (key: string, v: string) => {
    if (isHex(v)) colors[key] = v
  }
  set('editor.background', tok.bg)
  set('editor.foreground', tok.text)
  set('editorLineNumber.foreground', tok.textFaint)
  set('editorLineNumber.activeForeground', tok.textDim)
  set('editor.lineHighlightBackground', tok.bgHover)
  set('editorCursor.foreground', tok.accent)
  set('editorWidget.background', tok.bgElevated)
  set('editorWidget.border', tok.border)
  set('editorGutter.background', tok.bg)
  set('input.background', tok.bgInput)
  set('dropdown.background', tok.bgElevated)
  set('list.hoverBackground', tok.bgHover)
  set('list.activeSelectionBackground', tok.bgActive)
  monaco.editor.defineTheme(THEME_DARK, { base: 'vs-dark', inherit: true, rules: [], colors })
  monaco.editor.defineTheme(THEME_LIGHT, { base: 'vs', inherit: true, rules: [], colors })
}

function modelUri(monaco: typeof Monaco, path: string): Monaco.Uri {
  return monaco.Uri.parse(`file:///${path.replace(/^\/+/, '')}`)
}

// Ensure a model exists for `path`. Creates it (with content) on first open;
// replaces content on an explicit reload. Idempotent for already-open files
// whose content hasn't changed (keeps the undo stack intact).
function ensureModel(path: string, content: string, language?: string): void {
  const monaco = monacoRef.value
  if (!monaco) return
  const existing = models.get(path)
  if (existing) {
    if (existing.getValue() !== content) existing.setValue(content)
    if (language) monaco.editor.setModelLanguage(existing, language)
    return
  }
  const model = monaco.editor.createModel(content, language, modelUri(monaco, path))
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

function revealPosition(path: string, line: number, column: number): void {
  const ed = editor.value
  if (!ed || activePath !== path) return
  ed.revealLineInCenter(line)
  ed.setPosition({ lineNumber: line, column })
  ed.focus()
}

// Reveal + highlight a line range (selects whole lines start..end). endLine ≤
// startLine collapses to a single line.
function revealRange(path: string, startLine: number, endLine: number): void {
  const ed = editor.value
  if (!ed || activePath !== path) return
  const model = ed.getModel()
  // Clamp to the file so a stale chat reference (line past EOF) can't throw.
  const lineCount = model ? model.getLineCount() : Math.max(startLine, endLine)
  const start = Math.min(Math.max(1, startLine), lineCount)
  const end = Math.min(Math.max(start, endLine || start), lineCount)
  const endColumn = model ? model.getLineMaxColumn(end) : 1
  ed.revealLinesInCenter(start, end)
  ed.setSelection({ startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn })
  ed.focus()
}

defineExpose({
  openFile,
  closeFile,
  getValue,
  revealPosition,
  revealRange,
  focus: () => editor.value?.focus(),
})

onMounted(async () => {
  if (!hostRef.value) return
  setupWorkers()
  const monaco = await import('monaco-editor')
  monacoRef.value = monaco
  defineThemes(monaco)
  const ed = monaco.editor.create(hostRef.value, {
    model: null,
    readOnly: props.readOnly,
    theme: activeThemeId(),
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderWhitespace: 'selection',
    smoothScrolling: true,
  })
  editor.value = ed

  ed.onDidChangeModelContent(() => {
    if (!activePath) return
    emit('change', { path: activePath, value: ed.getValue() })
  })
  ed.onDidChangeCursorPosition((e) => {
    emit('cursor-change', { line: e.position.lineNumber, column: e.position.column })
  })
  // eslint-disable-next-line no-bitwise -- Monaco keybinding API uses a bitmask
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))

  // Flush any opens requested before Monaco finished loading.
  pendingOpens.forEach((op) => ensureModel(op.path, op.content, op.language))
  pendingOpens.length = 0
  if (props.path) activate(props.path)
  emit('ready')
})

watch(
  () => props.path,
  (path) => activate(path),
)

watch(
  () => props.readOnly,
  (ro) => editor.value?.updateOptions({ readOnly: ro }),
)

watch([t, themeName], () => {
  const monaco = monacoRef.value
  if (!monaco) return
  defineThemes(monaco)
  monaco.editor.setTheme(activeThemeId())
})

onBeforeUnmount(() => {
  models.forEach((model) => model.dispose())
  models.clear()
  viewStates.clear()
  editor.value?.dispose()
  editor.value = null
})
</script>
