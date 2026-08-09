// Page-controller for the Task Artifact Editor (pages/edit/[taskId].vue). Loads a
// task via tasks.get, discovers its declared artifact files from the workflow
// snapshot (node.outputs) mapped to each run's streamed output, and exposes the
// selected file's content + view-mode state. Edits are in-memory (read-only-ish
// preview of engine artifacts — the page does not write back; artifacts are
// engine-owned, edited via the Project Code Workspace if needed). SoC: IPC only.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { loadProjects } from '~/composables/useWorkspaceData'
import type {
  EditorFileKind,
  EditorViewMode,
  EditorTaskFile,
  EditorDiffStats,
} from '~/components/editor/types'

// ── Task slice (mirrors sidecar types/shared.ts; node.outputs is NOT in the
// ui-next tasks store slice, so we define our own minimal shape here). ──
type RunSlice = { version: number; status: string; output: string }
type PhaseSlice = { nodeId: string; skillName: string; runs: RunSlice[] }
type NodeSlice = { id: string; outputs: string[] }
type WorkflowSlice = { nodes: NodeSlice[] }
type TaskSlice = {
  id: string
  title: string
  // The project the task ran in — resolved to an absolute path so a file-path link
  // inside an artifact can open the real file in the shared PreviewModal.
  projectId?: string
  workflowSnapshot?: WorkflowSlice
  phases: Record<string, PhaseSlice>
}

const basename = (p: string): string => p.split('/').pop() || p

function resolveKind(name: string): EditorFileKind | null {
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md'
  if (name.endsWith('.diff') || name.endsWith('.patch')) return 'diff'
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml'
  return null
}

export function useTaskArtifacts(taskId: string) {
  const sc = useSidecar()

  const task = ref<TaskSlice | null>(null)
  const loaded = ref(false)
  // Absolute path of the task's project (from the shared, cached projects roster).
  // Anchors the file-path links an artifact writes (`backend/app/x.py`) so clicking
  // one opens the real file instead of navigating the SPA to a dead route.
  const workspaceRoot = ref<string | null>(null)
  const selectedName = ref<string>('')
  const activeView = ref<EditorViewMode>('split')

  // Artifact files: each non-superseded run × its node's declared outputs. The
  // primary output (index 0) carries the run's streamed body; others stay empty
  // (engine writes them to disk, but the run event only streams output[0]).
  const files = computed<EditorTaskFile[]>(() => {
    const t = task.value
    if (!t || !t.workflowSnapshot) return []
    const out: EditorTaskFile[] = []
    for (const phase of Object.values(t.phases)) {
      const node = t.workflowSnapshot.nodes.find((n) => n.id === phase.nodeId)
      if (!node) continue
      for (const run of phase.runs) {
        if (run.status === 'superseded') continue
        node.outputs.forEach((outName, outIndex) => {
          const content = outIndex === 0 ? run.output : ''
          if (!content) return
          const kind = resolveKind(outName)
          if (!kind) return
          out.push({
            path: outName,
            name: basename(outName),
            kind,
            phase: phase.skillName,
            version: run.version,
          })
        })
      }
    }
    return out
  })

  // Content map keyed by file name (kept alongside `files` so the viewer reads it
  // synchronously). Rebuilt from the same run/output mapping.
  const contentByName = computed<Record<string, string>>(() => {
    const t = task.value
    const map: Record<string, string> = {}
    if (!t || !t.workflowSnapshot) return map
    for (const phase of Object.values(t.phases)) {
      const node: NodeSlice | undefined = t.workflowSnapshot.nodes.find(
        (n) => n.id === phase.nodeId,
      )
      if (!node) continue
      for (const run of phase.runs) {
        if (run.status === 'superseded') continue
        const primary = node.outputs[0]
        if (primary && run.output) map[primary] = run.output
      }
    }
    return map
  })

  const currentFile = computed<EditorTaskFile | null>(
    () =>
      files.value.find((f) => f.name === selectedName.value || f.path === selectedName.value) ??
      null,
  )
  const content = computed<string>(() => {
    const f = currentFile.value
    return f ? (contentByName.value[f.path] ?? '') : ''
  })

  const currentKind = computed<EditorFileKind>(() => currentFile.value?.kind ?? 'md')
  // Diff artifacts force code view (no preview/split for a unified diff).
  const effectiveView = computed<EditorViewMode>(() =>
    currentKind.value === 'diff' ? 'code' : activeView.value,
  )

  const lineCount = computed(() => content.value.split('\n').length)
  const charCount = computed(() => content.value.length)
  const wordCount = computed(() => content.value.trim().split(/\s+/).filter(Boolean).length)

  const diffStats = computed<EditorDiffStats | null>(() => {
    if (currentKind.value !== 'diff') return null
    const additions = (content.value.match(/^\+[^+]/gm) || []).length
    const deletions = (content.value.match(/^-[^-]/gm) || []).length
    const fileCount = (content.value.match(/^diff --git/gm) || []).length
    return { files: fileCount, additions, deletions }
  })

  const languageLabel = computed(() => {
    if (currentKind.value === 'diff') return 'Diff'
    if (currentKind.value === 'yaml') return 'YAML'
    return 'Markdown'
  })

  function selectFile(name: string): void {
    selectedName.value = name
  }
  function setView(view: EditorViewMode): void {
    activeView.value = view
  }
  function copyContent(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(content.value).catch(() => {})
    }
  }

  async function init(): Promise<void> {
    if (!sc.available) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ task: TaskSlice | null }>('tasks.get', { id: taskId })
      task.value = res.task ?? null
    } catch {
      task.value = null
    } finally {
      loaded.value = true
      // Auto-select the first artifact when none chosen yet.
      if (!selectedName.value && files.value[0]) selectedName.value = files.value[0].name
    }
    const projectId = task.value?.projectId
    if (projectId) {
      const projects = await loadProjects()
      workspaceRoot.value = projects.find((p) => p.id === projectId)?.path ?? null
    }
  }

  return {
    taskTitle: computed(() => task.value?.title ?? ''),
    workspaceRoot: computed(() => workspaceRoot.value),
    loaded: computed(() => loaded.value),
    available: sc.available,
    files,
    currentFile,
    selectedName: computed(() => selectedName.value),
    content,
    currentKind,
    activeView: computed(() => activeView.value),
    effectiveView,
    diffStats,
    languageLabel,
    lineCount,
    charCount,
    wordCount,
    init,
    selectFile,
    setView,
    copyContent,
  }
}
