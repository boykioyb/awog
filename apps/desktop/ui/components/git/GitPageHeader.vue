<template>
  <div
    class="relative px-3 py-2 flex items-center gap-3 flex-shrink-0"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
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
        class="absolute left-0 top-full mt-1 z-30 min-w-[220px] rounded shadow-lg"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 10px 30px ${t.shadow}`,
        }"
      >
        <div
          v-for="b in localBranches"
          :key="b.name"
          class="flex items-center gap-2 px-3 py-2 cursor-pointer transition"
          :style="{
            background: branchHover === b.name ? t.bgHover : 'transparent',
          }"
          @mouseenter="branchHover = b.name"
          @mouseleave="branchHover = null"
          @click="onSwitchBranch(b.name, b.isCurrent)"
        >
          <Check
            :size="11"
            :style="{
              color: b.isCurrent ? t.accent : 'transparent',
            }"
          />
          <span class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
            {{ b.name }}
          </span>
          <span
            v-if="b.ahead > 0 || b.behind > 0"
            class="text-[1em] font-mono"
            :style="{ color: t.textDim }"
          >
            {{ b.ahead > 0 ? `↑${b.ahead}` : '' }}{{ b.behind > 0 ? ` ↓${b.behind}` : '' }}
          </span>
        </div>
      </div>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <template v-if="isMerging">
        <button
          class="px-2.5 py-1 text-[1em] rounded font-medium transition"
          :style="completeMergeBtnStyle"
          :disabled="hasConflict"
          :title="
            hasConflict ? tr('git.header.complete_merge_disabled') : tr('git.header.complete_merge')
          "
          @click="emit('complete-merge')"
        >
          {{ tr('git.header.complete_merge') }}
        </button>
        <button
          class="px-2.5 py-1 text-[1em] rounded transition"
          :style="{
            background: t.dangerBg,
            color: t.danger,
            border: `1px solid ${t.dangerBorder}`,
          }"
          :title="tr('git.header.abort_merge')"
          @click="emit('request-abort-merge')"
        >
          Abort merge
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
const { t: tr } = useI18n()

const projectOpen = ref(false)
const projectHover = ref<string | null>(null)
const repoOpen = ref(false)
const repoHover = ref<string | null>(null)
const branchOpen = ref(false)
const branchHover = ref<string | null>(null)

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
</script>
