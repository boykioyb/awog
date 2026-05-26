<template>
  <div class="flex flex-1 overflow-hidden flex-col">
    <!-- Header: branch picker + ops toolbar -->
    <div
      class="px-3 py-2 flex items-center gap-3 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="relative">
        <button
          class="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition"
          :style="{
            background: branchOpen ? t.bgActive : t.bgInput,
            color: t.text,
            border: `1px solid ${t.border}`,
          }"
          @click="branchOpen = !branchOpen"
        >
          <GitBranchIcon :size="12" />
          <span class="font-mono">{{ store.currentBranch }}</span>
          <ChevronDown :size="10" />
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
            @click="switchBranch(b.name, b.isCurrent)"
          >
            <Check
              :size="11"
              :style="{
                color: b.isCurrent ? t.accent : 'transparent',
              }"
            />
            <span class="text-xs font-mono flex-1 truncate" :style="{ color: t.text }">
              {{ b.name }}
            </span>
            <span
              v-if="b.ahead > 0 || b.behind > 0"
              class="text-[10px] font-mono"
              :style="{ color: t.textDim }"
            >
              {{ b.ahead > 0 ? `↑${b.ahead}` : '' }}{{ b.behind > 0 ? ` ↓${b.behind}` : '' }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 text-[11px]" :style="{ color: t.textDim }">
        <span v-if="store.ahead > 0" class="font-mono">
          ↑{{ store.ahead }}
          <span :style="{ color: t.textFaint }">ahead</span>
        </span>
        <span v-if="store.behind > 0" class="font-mono">
          ↓{{ store.behind }}
          <span :style="{ color: t.textFaint }">behind</span>
        </span>
        <span v-if="store.hasConflict" :style="{ color: t.gitConflict }">· conflict</span>
        <span v-else-if="store.hasUncommitted" :style="{ color: t.warning }">· dirty</span>
        <span v-else :style="{ color: t.textDim }">· clean</span>
      </div>

      <div class="ml-auto">
        <GitOpsToolbar />
      </div>
    </div>

    <!-- Tab bar -->
    <div
      class="flex items-center px-3 gap-1 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="relative flex items-center gap-1.5 px-3 py-2 text-xs transition"
        :style="tabStyle(tab.id)"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" :size="11" />
        <span>{{ tab.label }}</span>
        <span
          v-if="tab.id === 'changes' && store.hasUncommitted"
          class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
          :style="{ background: store.hasConflict ? t.gitConflict : t.warning }"
        />
      </button>
    </div>

    <!-- Empty state for no-repo -->
    <div
      v-if="store.repoState === 'no-repo'"
      class="flex-1 flex flex-col items-center justify-center gap-3"
    >
      <FolderGit2 :size="40" :stroke-width="1.5" :style="{ color: t.textFaint }" />
      <div class="text-sm" :style="{ color: t.textDim }">Workspace chưa init Git</div>
      <button
        class="text-xs px-3 py-1.5 rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="store.initRepo()"
      >
        Initialize Git repository
      </button>
    </div>

    <!-- Changes tab -->
    <div v-else-if="activeTab === 'changes'" class="flex flex-1 overflow-hidden">
      <div
        class="flex-shrink-0 w-80 flex flex-col overflow-hidden"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <GitStatusList />
      </div>
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-hidden">
          <GitConflictResolver v-if="selectedConflictPath" :path="selectedConflictPath" />
          <GitDiffViewer v-else :diff="currentDiff" />
        </div>
        <GitCommitPanel />
      </div>
    </div>

    <!-- History tab -->
    <div v-else-if="activeTab === 'history'" class="flex flex-1 overflow-hidden">
      <div
        class="flex-shrink-0 w-96 flex flex-col overflow-hidden"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <GitHistoryList />
      </div>
      <div class="flex-1 overflow-hidden">
        <GitCommitDetail :detail="commitDetail" />
      </div>
    </div>

    <!-- Branches tab -->
    <div v-else-if="activeTab === 'branches'" class="flex flex-1 overflow-hidden">
      <div
        class="flex-shrink-0 w-96 flex flex-col overflow-hidden"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <GitBranchList />
      </div>
      <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
        <div class="text-xs">Click branch để checkout. Right-click cho thêm action.</div>
      </div>
    </div>

    <!-- Stash tab -->
    <div v-else-if="activeTab === 'stash'" class="flex flex-1 overflow-hidden">
      <div
        class="flex-shrink-0 w-96 flex flex-col overflow-hidden"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <GitStashList />
      </div>
      <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
        <div class="text-xs">Stash sẽ apply file vào working tree khi pop / apply.</div>
      </div>
    </div>

    <!-- Remotes tab -->
    <div v-else-if="activeTab === 'remotes'" class="flex flex-1 overflow-hidden">
      <div
        class="flex-shrink-0 w-96 flex flex-col overflow-hidden"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <GitRemoteList />
      </div>
      <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
        <div class="text-xs">Cấu hình add/remove remote chưa có trong v1.</div>
      </div>
    </div>

    <!-- Toast container -->
    <div
      v-if="store.toasts.length > 0"
      class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
    >
      <div
        v-for="toast in store.toasts"
        :key="toast.id"
        class="px-3 py-2 rounded text-xs shadow-lg"
        :style="toastStyle(toast.kind)"
      >
        {{ toast.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronDown,
  FolderGit2,
  GitBranch as GitBranchIcon,
  GitCommit as GitCommitIcon,
  History,
  Cloud,
  Archive,
} from 'lucide-vue-next'
import type { GitCommit, GitFileDiff } from '~/types'

const { t } = useTheme()
const store = useGitStore()

type GitTab = 'changes' | 'history' | 'branches' | 'stash' | 'remotes'

const activeTab = ref<GitTab>('changes')
const branchOpen = ref(false)
const branchHover = ref<string | null>(null)
const currentDiff = ref<GitFileDiff | null>(null)
const commitDetail = ref<{ commit: GitCommit; files: GitFileDiff[] } | null>(null)

const tabs = [
  { id: 'changes' as const, label: 'Changes', icon: GitCommitIcon },
  { id: 'history' as const, label: 'History', icon: History },
  { id: 'branches' as const, label: 'Branches', icon: GitBranchIcon },
  { id: 'stash' as const, label: 'Stash', icon: Archive },
  { id: 'remotes' as const, label: 'Remotes', icon: Cloud },
]

const localBranches = computed(() => store.branches.filter((b) => !b.isRemote))

const selectedConflictPath = computed(() => {
  const path = store.selectedFilePath
  if (!path) return null
  const file = store.statusFiles.find((f) => f.path === path)
  return file?.hasConflict ? path : null
})

const tabStyle = (id: GitTab) => {
  const active = activeTab.value === id
  return {
    background: 'transparent',
    color: active ? t.value.text : t.value.textDim,
    borderBottom: `2px solid ${active ? t.value.accent : 'transparent'}`,
    marginBottom: '-1px',
  }
}

const switchBranch = async (name: string, isCurrent: boolean) => {
  branchOpen.value = false
  if (isCurrent) return
  if (store.hasUncommitted) {
    store.toasts = [
      ...store.toasts,
      {
        id: `t-${Date.now()}`,
        text: 'Workspace dirty — chuyển sang tab Branches để chọn Stash & checkout',
        kind: 'info',
      },
    ]
    activeTab.value = 'branches'
    return
  }
  await store.checkoutBranch(name)
}

const toastStyle = (kind: 'info' | 'success' | 'error') => {
  if (kind === 'success') {
    return {
      background: t.value.infoBg,
      color: t.value.info,
      border: `1px solid ${t.value.infoBorder}`,
    }
  }
  if (kind === 'error') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  return {
    background: t.value.bgPanel,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
  }
}

// Reactively load diff for selected file in Changes tab.
watch(
  () => store.selectedFilePath,
  async (path) => {
    if (!path) {
      currentDiff.value = null
      return
    }
    currentDiff.value = await store.loadDiff(path)
  },
  { immediate: true },
)

// Reactively load commit detail in History tab.
watch(
  () => store.selectedCommitHash,
  async (hash) => {
    if (!hash) {
      commitDetail.value = null
      return
    }
    commitDetail.value = await store.loadCommit(hash)
  },
  { immediate: true },
)

// Bootstrap status on mount.
onMounted(() => {
  store.loadStatus()
  const first = store.commits[0]
  if (!store.selectedCommitHash && first) {
    store.selectCommit(first.hash)
  }
})

definePageMeta({ title: 'Git' })
</script>
