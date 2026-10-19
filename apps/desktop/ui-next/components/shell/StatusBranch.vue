<template>
  <!-- Popover (portal ra <body>, mở LÊN trên vì thanh ghim ở đáy cửa sổ). -->
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <StatusChip :title="t('statusbar.branch.title')">
        <Icon name="branch" />
        <span class="max-w-45 truncate">{{ branch ?? t('statusbar.branch.none') }}</span>
        <Badge
          v-if="dirtyCount"
          class="h-3.5 min-w-4 justify-center border-transparent bg-selected px-1 py-0 font-semibold text-primary tabular-nums"
        >
          {{ dirtyCount }}
        </Badge>
        <!-- Working-tree diff-stat, only when there is something to show. Chữ số,
             không phải code — tabular-nums giữ số khỏi nhảy, không cần font mono. -->
        <span
          v-if="stat"
          class="inline-flex items-center gap-1 tabular-nums"
          :title="t('statusbar.diffStat.title')"
        >
          <span v-if="stat.add" class="text-diff-add">+{{ stat.add }}</span>
          <span v-if="stat.del" class="text-diff-del">−{{ stat.del }}</span>
        </span>
      </StatusChip>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      align="end"
      :side-offset="8"
      class="flex max-h-[min(50vh,360px)] w-64 flex-col p-1"
    >
      <div class="shrink-0 px-2 pt-1 pb-1.5 text-sm text-faint">
        {{ t('statusbar.branch.switch') }}
      </div>
      <!-- Only the branch list scrolls; the "Open Git Manager" action below is
           frozen so it stays reachable no matter how many branches there are. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="loading" class="px-2 py-1.5 text-sm text-faint">
          {{ t('statusbar.branch.loading') }}
        </div>
        <div v-else-if="!localBranches.length" class="px-2 py-1.5 text-sm text-faint">
          {{ t('statusbar.branch.empty') }}
        </div>
        <Button
          v-for="b in localBranches"
          :key="b"
          variant="ghost"
          size="sm"
          class="w-full justify-start font-normal"
          :disabled="switching"
          @click="pick(b)"
        >
          <span class="min-w-0 truncate">{{ b }}</span>
          <Icon v-if="b === branch" name="check" class="ml-auto text-primary" />
        </Button>
      </div>
      <Separator class="my-1" />
      <!-- Only meaningful inside a repo: no branch → no PR. -->
      <Button
        v-if="branch"
        variant="ghost"
        size="sm"
        class="w-full shrink-0 justify-start font-normal"
        @click="createPr"
      >
        <Icon name="merge" />
        {{ t('statusbar.branch.createPr') }}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="w-full shrink-0 justify-start font-normal"
        @click="openGit"
      >
        <Icon name="git" />
        {{ t('statusbar.branch.openGit') }}
      </Button>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
// Branch chip + quick-switch popover for the status bar (VSCode-style): shows the
// active session's current branch and its working-tree diff-stat (+N −M), click pops
// a local-branch list (click → checkout) plus "Create pull request…" / "Open Git
// Manager…" escapes to the full modals. Dirty-file count badges the chip. Branch
// state comes from useSessionBranch (decoupled from the global git store); the modals
// are the shared useGitModal / usePrSummaryModal — the PR flow used to be reachable
// only from the Git Manager's branch context menu.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()

const { branch, localBranches, loading, switching, checkout } = useSessionBranch(
  () => props.session.project,
)
const { dirtyCount } = useGitDirtyCount(() => props.session.project)
const gitModal = useGitModal()
const prModal = usePrSummaryModal()

const open = ref(false)

function pick(name: string) {
  void checkout(name)
  open.value = false
}
function openGit() {
  gitModal.open(props.session.project)
  open.value = false
}
function createPr() {
  // head = null → the PR summary modal targets the current branch.
  prModal.open(props.session.project ?? null, null)
  open.value = false
}

// ── Diff-stat (+N −M) ────────────────────────────────────────────────────────
// Summed from the two diffs git already exposes — unstaged + staged — because
// git.status carries file entries only (its additions/deletions fields are never
// filled). No new RPC. UNTRACKED files are not counted: `git diff` does not see
// them and one --no-index call per new file is too much for a status-bar chip.
// Null (chip shows nothing) when there is no project / no repo / no change.
const sc = useSidecar()
const api = useGitApi()
const { root } = useWorkspaceData(() => props.session.project)
const stat = ref<{ add: number; del: number } | null>(null)

async function loadStat(): Promise<void> {
  if (!root.value || !sc.available) {
    stat.value = null
    return
  }
  const workspaceRoot = root.value
  try {
    const [unstaged, staged] = await Promise.all([
      api.diff({ kind: 'workingTree', workspaceRoot }),
      api.diff({ kind: 'staged', workspaceRoot }),
    ])
    let add = 0
    let del = 0
    for (const file of [...unstaged.files, ...staged.files]) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind === 'add') add += 1
          else if (line.kind === 'del') del += 1
        }
      }
    }
    stat.value = add || del ? { add, del } : null
  } catch {
    // No repo / bridge down / any failure → no stat rather than a thrown chip.
    stat.value = null
  }
}

watch(root, () => void loadStat(), { immediate: true })

// Debounced refresh on the sidecar's git watcher, same cadence as the dirty count.
let unlisten: UnlistenFn | null = null
let timer: ReturnType<typeof setTimeout> | null = null
onMounted(async () => {
  if (!sc.available) return
  try {
    unlisten = await sc.onEvent((evt) => {
      if (evt.type !== 'git:status:changed') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void loadStat()
      }, 200)
    })
  } catch {
    unlisten = null
  }
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (unlisten) unlisten()
})
</script>
