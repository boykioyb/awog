<template>
  <div class="wsfiles">
    <!-- Unavailable / no-root → mock tree fallback (browser-dev) or message. -->
    <div v-if="!ready" class="wsfiles-fallback">
      <div v-if="!available" class="empty" style="padding: 30px">
        <div class="et">{{ t('sessions.workspace.unavailable') }}</div>
      </div>
      <!-- Engine present but no project bound → mock tree (keeps panel usable). -->
      <div v-else-if="!root" class="ftree2">
        <SessionFileTree :nodes="FTREE" />
      </div>
    </div>

    <template v-else>
      <!-- File viewer (open file) -->
      <template v-if="selectedPath">
        <div class="wsfiles-vhead">
          <button
            class="wsfiles-back"
            :title="t('sessions.workspace.files.back')"
            @click="closeFile"
          >
            <Icon name="chev" style="width: 13px; height: 13px; transform: rotate(90deg)" />
          </button>
          <span class="wsfiles-vpath">{{ selectedPath }}</span>
          <button
            class="wsfiles-back"
            :title="t('sessions.workspace.files.loading')"
            @click="reload"
          >
            <Icon name="refresh" :class="{ spin: fileLoading }" style="width: 12px; height: 12px" />
          </button>
        </div>
        <div class="wsfiles-vbody">
          <div v-if="fileError" class="empty" style="padding: 20px">
            <div class="et">{{ fileError }}</div>
          </div>
          <div v-else-if="fileBinary" class="empty" style="padding: 20px">
            <div class="et">{{ t('sessions.workspace.files.binary') }}</div>
          </div>
          <template v-else>
            <SessionCodeView mode="code" :fname="fileName" :code="fileContent" />
            <div v-if="fileTruncated" class="wsfiles-trunc">
              {{ t('sessions.workspace.files.truncated') }}
            </div>
          </template>
        </div>
      </template>

      <!-- File tree -->
      <div v-else class="ftree2">
        <SessionFileTree :nodes="rootNodes" :ctrl="ctrl" />
        <div v-if="!rootNodes.length && !treeLoading" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.workspace.files.empty') }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Files tab (§5/§10) — real lazy file tree via fs.listDir + a read-only viewer
// (fs.readFile) rendered through SessionCodeView. Drives SessionFileTree with real
// data when a workspace root resolves; in browser-dev (no engine) it falls back to
// the static mock tree. SoC: orchestrates fs IPC only.
import type { Session, TreeNode } from '~/composables/useSessionsMock'
import type { FileTreeController } from '~/components/session/SessionFileTree.vue'
import { SidecarError, useSidecar } from '~/composables/useSidecar'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const { FTREE } = useSessionsMock()
const sc = useSidecar()
const { root, ready, available } = useWorkspaceData(() => props.session.project)

// ── Sidecar fs shapes ────────────────────────────────────────────────────────
type FsEntry = { name: string; path: string; kind: 'file' | 'dir'; size?: number }
type FsFileContent = {
  path: string
  content: string
  truncated: boolean
  isBinary: boolean
  language?: string
}

// Lazy tree state: children + expanded set keyed by workspace-relative dir path
// ('' = root). Reactive so the recursive tree re-renders on load/expand.
const childrenByPath = reactive<Record<string, FsEntry[]>>({})
const expanded = reactive<Set<string>>(new Set())
const treeLoading = ref(false)

// Convert loaded FsEntry[] for a dir into the mock TreeNode shape SessionFileTree
// renders (dirs as { d }, files as { f }).
function nodesFor(dir: string): TreeNode[] {
  const entries = childrenByPath[dir] ?? []
  return entries.map<TreeNode>((e) => (e.kind === 'dir' ? { d: e.name } : { f: e.name }))
}
const rootNodes = computed<TreeNode[]>(() => nodesFor(''))

async function loadDir(dir: string): Promise<void> {
  if (!root.value || childrenByPath[dir]) return
  treeLoading.value = true
  try {
    const res = await sc.request<{ entries: FsEntry[] }>('fs.listDir', {
      workspaceRoot: root.value,
      ...(dir ? { path: dir } : {}),
    })
    childrenByPath[dir] = res.entries
  } catch {
    childrenByPath[dir] = []
  } finally {
    treeLoading.value = false
  }
}

// ── File viewer ──────────────────────────────────────────────────────────────
const selectedPath = ref<string | null>(null)
const fileContent = ref('')
const fileBinary = ref(false)
const fileTruncated = ref(false)
const fileLoading = ref(false)
const fileError = ref<string | null>(null)

const fileName = computed(() => {
  const p = selectedPath.value ?? ''
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
})

async function openFile(path: string): Promise<void> {
  if (!root.value) return
  selectedPath.value = path
  fileLoading.value = true
  fileError.value = null
  try {
    const res = await sc.request<FsFileContent>('fs.readFile', {
      workspaceRoot: root.value,
      path,
    })
    fileBinary.value = res.isBinary
    fileTruncated.value = res.truncated
    fileContent.value = res.isBinary ? '' : res.content
  } catch (err) {
    fileBinary.value = false
    fileTruncated.value = false
    fileContent.value = ''
    fileError.value =
      err instanceof SidecarError && err.message
        ? err.message
        : t('sessions.workspace.files.openFailed')
  } finally {
    fileLoading.value = false
  }
}

function closeFile(): void {
  selectedPath.value = null
}
function reload(): void {
  if (selectedPath.value) void openFile(selectedPath.value)
}

// Controller handed to SessionFileTree for real-data expand/select + lazy load.
const ctrl: FileTreeController = {
  isOpen: (p) => expanded.has(p),
  toggle: (p) => {
    if (expanded.has(p)) {
      expanded.delete(p)
    } else {
      expanded.add(p)
      void loadDir(p)
    }
  },
  selectedPath,
  selectFile: (p) => void openFile(p),
  childrenFor: (p) => nodesFor(p),
}

watch(root, (r) => {
  // Reset tree state when the root changes (session switch) + load the new root.
  for (const k of Object.keys(childrenByPath)) delete childrenByPath[k]
  expanded.clear()
  selectedPath.value = null
  if (r) void loadDir('')
})

onMounted(() => {
  if (root.value) void loadDir('')
})
</script>

<style scoped>
.wsfiles {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.wsfiles-fallback {
  flex: 1;
  min-height: 0;
}
.wsfiles-vhead {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px 8px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.wsfiles-vpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code);
  font-size: 0.8846rem;
  color: var(--text);
}
.wsfiles-back {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  flex: 0 0 auto;
}
.wsfiles-back:hover {
  color: var(--text);
}
.wsfiles-vbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.wsfiles-trunc {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--amber);
}
.spin {
  animation: wsfiles-spin 1s linear infinite;
}
@keyframes wsfiles-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
