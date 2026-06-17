<template>
  <div
    class="relative px-3 py-2 flex items-center gap-3 flex-shrink-0 rounded-xl"
    :style="{
      border: `1px solid ${parts.border}`,
      background: parts.bg,
      backdropFilter: parts.blur,
      boxShadow: `0 4px 16px -10px ${t.shadow}`,
    }"
  >
    <!-- Project selector -->
    <div class="relative">
      <button
        class="flex items-center gap-1.5 px-2 py-1.5 rounded text-[1em] transition whitespace-nowrap max-w-[200px]"
        :style="{
          background: projectOpen ? t.bgActive : t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="projectOpen = !projectOpen"
      >
        <FolderGit2
          :size="12"
          class="flex-shrink-0"
          :style="{ color: currentProject?.color || t.textDim }"
        />
        <span class="font-medium truncate">{{ currentProject?.name ?? 'No project' }}</span>
        <span
          v-if="currentDirtyCount > 0"
          class="text-[12px] px-1.5 py-0.5 rounded font-mono font-medium leading-none inline-flex items-center justify-center flex-shrink-0"
          :style="{
            background: t.warning,
            color: t.accentText,
            minWidth: '18px',
          }"
        >
          {{ currentDirtyCount }}
        </span>
        <ChevronDown :size="10" class="flex-shrink-0" />
      </button>
      <div
        v-if="projectOpen"
        class="absolute left-0 top-full mt-1 z-30 min-w-[260px] rounded shadow-lg overflow-hidden"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 10px 30px ${t.shadow}`,
        }"
      >
        <div
          v-for="p in projects"
          :key="p.id"
          class="flex items-center gap-2 px-3 py-2 cursor-pointer transition"
          :style="{
            background: projectHover === p.id ? t.bgHover : 'transparent',
            borderLeft:
              p.id === selectedProjectId ? `2px solid ${t.accent}` : '2px solid transparent',
          }"
          @mouseenter="projectHover = p.id"
          @mouseleave="projectHover = null"
          @click="onSelectProject(p.id)"
        >
          <FolderGit2 :size="12" :style="{ color: p.color || t.textDim }" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">
                {{ p.name }}
              </span>
              <span
                v-if="(dirtyCountByProject[p.id] ?? 0) > 0"
                class="text-[12px] px-1.5 py-0.5 rounded font-mono font-medium leading-none inline-flex items-center justify-center flex-shrink-0"
                :style="{
                  background: t.warning,
                  color: t.accentText,
                  minWidth: '18px',
                }"
              >
                {{ dirtyCountByProject[p.id] }}
              </span>
              <Check
                v-if="p.id === selectedProjectId"
                :size="11"
                class="flex-shrink-0"
                :style="{ color: t.accent }"
              />
            </div>
            <div class="text-[1em] font-mono truncate" :style="{ color: t.textFaint }">
              {{ p.path }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <span :style="{ color: t.textFaint }">/</span>

    <!-- Repo selector — only when the project holds more than one git repo -->
    <template v-if="repos.length > 1">
      <div class="relative min-w-0">
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded text-[1em] transition whitespace-nowrap min-w-0 max-w-[220px]"
          :style="{
            background: repoOpen ? t.bgActive : t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
          }"
          :title="currentRepoLabel || tr('git.header.repo_select')"
          @click="repoOpen = !repoOpen"
        >
          <GitFork :size="12" class="flex-shrink-0" :style="{ color: t.textDim }" />
          <span class="font-mono truncate">{{ currentRepoLabel }}</span>
          <ChevronDown :size="10" class="flex-shrink-0" />
        </button>
        <div
          v-if="repoOpen"
          class="absolute left-0 top-full mt-1 z-30 min-w-[260px] rounded shadow-lg overflow-hidden"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.borderStrong}`,
            boxShadow: `0 10px 30px ${t.shadow}`,
          }"
        >
          <div
            v-for="r in repos"
            :key="r.path"
            class="flex items-center gap-2 px-3 py-2 cursor-pointer transition"
            :style="{
              background: repoHover === r.path ? t.bgHover : 'transparent',
              borderLeft:
                r.path === selectedRepoPath ? `2px solid ${t.accent}` : '2px solid transparent',
            }"
            @mouseenter="repoHover = r.path"
            @mouseleave="repoHover = null"
            @click="onSelectRepo(r.path)"
          >
            <GitFork :size="12" :style="{ color: t.textDim }" />
            <span class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
              {{ repoLabel(r) }}
            </span>
            <Check
              v-if="r.path === selectedRepoPath"
              :size="11"
              class="flex-shrink-0"
              :style="{ color: t.accent }"
            />
          </div>
        </div>
      </div>

      <span :style="{ color: t.textFaint }">/</span>
    </template>

    <div class="relative">
      <button
        class="flex items-center gap-1.5 px-2 py-1.5 rounded text-[1em] transition whitespace-nowrap max-w-[200px]"
        :style="{
          background: branchOpen ? t.bgActive : t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="branchOpen = !branchOpen"
      >
        <GitBranchIcon :size="12" class="flex-shrink-0" />
        <span class="font-mono truncate">{{ currentBranch }}</span>
        <ChevronDown :size="10" class="flex-shrink-0" />
      </button>
      <div
        v-if="branchOpen"
        class="absolute left-0 top-full mt-1 z-30 min-w-[260px] rounded shadow-lg overflow-hidden flex flex-col"
        :style="{
          background: menu.background,
          border: `1px solid ${menu.borderColor}`,
          backdropFilter: menu.backdropFilter,
          boxShadow: menu.boxShadow,
          maxHeight: 'min(70vh, 440px)',
        }"
      >
        <div class="p-2 flex-shrink-0" :style="{ borderBottom: `1px solid ${t.border}` }">
          <SearchInput v-model="branchQuery" placeholder="Filter branches…" autofocus />
        </div>
        <div class="flex-1 overflow-y-auto py-1 min-h-0">
          <GitBranchTree
            :rows="branchRows"
            :collapsed-folders="collapsedBranchFolders"
            hide-actions
            @toggle-folder="toggleBranchFolder"
            @checkout="onSwitchBranch"
          />
          <div
            v-if="branchRows.length === 0"
            class="px-3 py-4 text-center text-[1em]"
            :style="{ color: t.textFaint }"
          >
            {{ branchQuery ? 'No matching branches' : 'No branches' }}
          </div>
        </div>
      </div>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <template v-if="isMerging || isRebasing">
        <button
          class="px-2.5 py-1 text-[1em] rounded font-medium transition"
          :style="completeMergeBtnStyle"
          :disabled="hasConflict"
          :title="completeTitle"
          @click="emit('complete-merge')"
        >
          {{ isRebasing ? tr('git.header.continue_rebase') : tr('git.header.complete_merge') }}
        </button>
        <button
          class="px-2.5 py-1 text-[1em] rounded transition"
          :style="{
            background: t.dangerBg,
            color: t.danger,
            border: `1px solid ${t.dangerBorder}`,
          }"
          :title="isRebasing ? tr('git.header.abort_rebase') : tr('git.header.abort_merge')"
          @click="emit('request-abort-merge')"
        >
          {{ isRebasing ? tr('git.header.abort_rebase') : tr('git.header.abort_merge') }}
        </button>
        <span class="w-px h-4" :style="{ background: t.border }" />
      </template>
      <GitOpsToolbar />
    </div>

    <!-- Floating progress strip — anchored to header bottom border so it
         doesn't push the toolbar wider while pull/push/fetch run. -->
    <GitOpsProgressStrip />
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronDown,
  FolderGit2,
  GitBranch as GitBranchIcon,
  GitFork,
} from 'lucide-vue-next'
import type { GitBranch, GitRepoEntry, Project } from '~/types'
import { buildBranchTree, flattenTree } from '~/utils/branch-tree'

type Props = {
  projects: Project[]
  currentProject: Project | undefined
  currentDirtyCount: number
  dirtyCountByProject: Record<string, number>
  selectedProjectId: string
  repos: GitRepoEntry[]
  selectedRepoPath: string | null
  localBranches: GitBranch[]
  currentBranch: string | null
  hasConflict: boolean
  isMerging: boolean
  isRebasing: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'select-project': [id: string]
  'select-repo': [path: string]
  'switch-branch': [name: string, isCurrent: boolean]
  'complete-merge': []
  'request-abort-merge': []
}>()

const { t } = useTheme()
const { parts, menu } = useGlass()
const { t: tr } = useI18n()

const projectOpen = ref(false)
const projectHover = ref<string | null>(null)
const repoOpen = ref(false)
const repoHover = ref<string | null>(null)
const branchOpen = ref(false)

// Branch picker: filter + tree grouping (reuses the sidebar's branch-tree logic).
const branchQuery = ref('')
const collapsedBranchFolders = ref<Set<string>>(new Set())

const filteredBranches = computed(() => {
  const q = branchQuery.value.trim().toLowerCase()
  if (!q) return props.localBranches
  return props.localBranches.filter((b) => b.name.toLowerCase().includes(q))
})

const branchRows = computed(() =>
  flattenTree(buildBranchTree(filteredBranches.value), collapsedBranchFolders.value),
)

const toggleBranchFolder = (id: string) => {
  const next = new Set(collapsedBranchFolders.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedBranchFolders.value = next
}

// Fresh filter each time the picker opens.
watch(branchOpen, (open) => {
  if (open) branchQuery.value = ''
})

// Root repo shows its folder name; sub-repos show their path within the project.
const repoLabel = (r: GitRepoEntry) => (r.isRoot ? r.name : r.relativePath)

const currentRepoLabel = computed(() => {
  const active = props.repos.find((r) => r.path === props.selectedRepoPath)
  return active ? repoLabel(active) : ''
})

const onSelectProject = (id: string) => {
  projectOpen.value = false
  emit('select-project', id)
}

const onSelectRepo = (path: string) => {
  repoOpen.value = false
  emit('select-repo', path)
}

const onSwitchBranch = (name: string, isCurrent: boolean) => {
  branchOpen.value = false
  emit('switch-branch', name, isCurrent)
}

const completeMergeBtnStyle = computed(() => ({
  background: props.hasConflict ? t.value.bgInput : t.value.accent,
  color: props.hasConflict ? t.value.textDim : t.value.accentText,
  border: `1px solid ${props.hasConflict ? t.value.border : t.value.accent}`,
  cursor: props.hasConflict ? 'not-allowed' : 'pointer',
}))

// Title for the Complete/Continue button — explains why it's disabled while
// conflicts remain, switching wording between merge and rebase.
const completeTitle = computed(() => {
  if (props.isRebasing) {
    return props.hasConflict
      ? tr('git.header.continue_rebase_disabled')
      : tr('git.header.continue_rebase')
  }
  return props.hasConflict
    ? tr('git.header.complete_merge_disabled')
    : tr('git.header.complete_merge')
})
</script>
