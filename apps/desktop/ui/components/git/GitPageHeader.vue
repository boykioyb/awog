<template>
  <Card variant="flat" class="relative flex flex-shrink-0 items-center gap-3 px-3 py-2">
    <!-- Project selector -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button :class="[triggerClass, 'max-w-[200px]']">
          <FolderGit2
            :size="12"
            class="flex-shrink-0"
            :style="currentProject?.color ? { color: currentProject.color } : undefined"
          />
          <span class="truncate font-medium">{{ currentProject?.name ?? 'No project' }}</span>
          <Badge v-if="currentDirtyCount > 0" variant="warning" size="sm" class="font-mono">
            {{ currentDirtyCount }}
          </Badge>
          <ChevronDown :size="10" class="flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="min-w-[260px]">
        <DropdownMenuItem
          v-for="p in projects"
          :key="p.id"
          class="items-start"
          @select="onSelectProject(p.id)"
        >
          <FolderGit2
            :size="12"
            class="mt-0.5 flex-shrink-0"
            :style="p.color ? { color: p.color } : undefined"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{{ p.name }}</span>
              <Badge
                v-if="(dirtyCountByProject[p.id] ?? 0) > 0"
                variant="warning"
                size="sm"
                class="font-mono"
              >
                {{ dirtyCountByProject[p.id] }}
              </Badge>
              <Check
                v-if="p.id === selectedProjectId"
                :size="11"
                class="flex-shrink-0 text-primary"
              />
            </div>
            <div class="truncate font-mono text-[12px] text-muted-foreground">{{ p.path }}</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Separator orientation="vertical" class="h-4" />

    <!-- Repo selector — only when the project holds more than one git repo -->
    <template v-if="repos.length > 1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            :class="[triggerClass, 'min-w-0 max-w-[220px]']"
            :title="currentRepoLabel || tr('git.header.repo_select')"
          >
            <GitFork :size="12" class="flex-shrink-0 text-muted-foreground" />
            <span class="truncate font-mono">{{ currentRepoLabel }}</span>
            <ChevronDown :size="10" class="flex-shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-[260px]">
          <DropdownMenuItem v-for="r in repos" :key="r.path" @select="onSelectRepo(r.path)">
            <GitFork :size="12" class="flex-shrink-0 text-muted-foreground" />
            <span class="flex-1 truncate font-mono">{{ repoLabel(r) }}</span>
            <Check
              v-if="r.path === selectedRepoPath"
              :size="11"
              class="flex-shrink-0 text-primary"
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" class="h-4" />
    </template>

    <Popover v-model:open="branchOpen">
      <PopoverTrigger as-child>
        <button :class="[triggerClass, 'max-w-[200px]']">
          <GitBranchIcon :size="12" class="flex-shrink-0" />
          <span class="truncate font-mono">{{ currentBranch }}</span>
          <ChevronDown :size="10" class="flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent class="flex max-h-[min(70vh,440px)] w-[260px] flex-col p-0">
        <div class="flex-shrink-0 border-b border-border p-2">
          <SearchInput v-model="branchQuery" placeholder="Filter branches…" autofocus />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <GitBranchTree
            :rows="branchRows"
            :collapsed-folders="collapsedBranchFolders"
            hide-actions
            @toggle-folder="toggleBranchFolder"
            @checkout="onSwitchBranch"
          />
          <div
            v-if="branchRows.length === 0"
            class="px-3 py-4 text-center text-[1em] text-muted-foreground"
          >
            {{ branchQuery ? 'No matching branches' : 'No branches' }}
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <div class="ml-auto flex items-center gap-2">
      <template v-if="isMerging || isRebasing">
        <AppButton
          size="sm"
          :disabled="hasConflict"
          :title="completeTitle"
          @click="emit('complete-merge')"
        >
          {{ isRebasing ? tr('git.header.continue_rebase') : tr('git.header.complete_merge') }}
        </AppButton>
        <AppButton
          variant="ghostDanger"
          size="sm"
          :title="isRebasing ? tr('git.header.abort_rebase') : tr('git.header.abort_merge')"
          @click="emit('request-abort-merge')"
        >
          {{ isRebasing ? tr('git.header.abort_rebase') : tr('git.header.abort_merge') }}
        </AppButton>
        <Separator orientation="vertical" class="h-4" />
      </template>
      <GitOpsToolbar />
    </div>

    <!-- Floating progress strip — anchored to header bottom border so it
         doesn't push the toolbar wider while pull/push/fetch run. -->
    <GitOpsProgressStrip />
  </Card>
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
import { Card } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Separator } from '~/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'

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

const { t: tr } = useI18n()

// Shared "select trigger" look for the project / repo / branch pickers.
const triggerClass =
  'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-transparent px-2 text-[1em] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-accent'

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

const onSelectProject = (id: string) => emit('select-project', id)

const onSelectRepo = (path: string) => emit('select-repo', path)

const onSwitchBranch = (name: string, isCurrent: boolean) => {
  branchOpen.value = false
  emit('switch-branch', name, isCurrent)
}

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
