<template>
  <span class="sb-wrap">
    <button
      class="sb-item"
      :title="t('statusbar.branch.title')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="branch" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="sb-branch">{{ branch ?? t('statusbar.branch.none') }}</span>
      <span v-if="dirtyCount" class="sb-badge">{{ dirtyCount }}</span>
      <!-- Working-tree diff-stat, only when there is something to show. -->
      <span v-if="stat" class="sb-stat tnum" :title="t('statusbar.diffStat.title')">
        <span v-if="stat.add" class="sb-add">+{{ stat.add }}</span>
        <span v-if="stat.del" class="sb-del">−{{ stat.del }}</span>
      </span>
    </button>

    <template v-if="open">
      <div class="sb-backdrop" @click="open = false" />
      <div class="smenu sb-menu" @click.stop>
        <div class="sb-menu-hd">{{ t('statusbar.branch.switch') }}</div>
        <!-- Only the branch list scrolls; the "Open Git Manager" action below is
             frozen so it stays reachable no matter how many branches there are. -->
        <div class="sb-menu-scroll">
          <div v-if="loading" class="sb-menu-hint">{{ t('statusbar.branch.loading') }}</div>
          <div v-else-if="!localBranches.length" class="sb-menu-hint">
            {{ t('statusbar.branch.empty') }}
          </div>
          <button
            v-for="b in localBranches"
            :key="b"
            class="mi"
            :disabled="switching"
            @click="pick(b)"
          >
            <span class="sb-mi-name">{{ b }}</span>
            <Icon
              v-if="b === branch"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </button>
        </div>
        <div class="sb-menu-foot">
          <div class="sb-menu-sep" />
          <!-- Only meaningful inside a repo: no branch → no PR. -->
          <button v-if="branch" class="mi" @click="createPr">
            <Icon name="merge" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('statusbar.branch.createPr') }}
          </button>
          <button class="mi" @click="openGit">
            <Icon name="git" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('statusbar.branch.openGit') }}
          </button>
        </div>
      </div>
    </template>
  </span>
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

<style scoped>
.sb-wrap {
  position: relative;
  display: inline-flex;
}
.sb-branch {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Diff-stat: digits, not code — tabular figures (.tnum) keep them from jittering
   as the counts change, without the terminal look of a mono font. */
.sb-stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.sb-add {
  color: var(--add);
}
.sb-del {
  color: var(--del);
}
/* Quick-switch list opens UPWARD (the bar is pinned to the window bottom). Override
   the global `.smenu` fixed/z so it anchors above the chip. A flex column with a
   capped height: header + frozen footer stay put while only the branch list scrolls
   (override the global `.smenu { overflow-y: auto }` so the whole menu doesn't scroll). */
.sb-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  z-index: 95;
  max-height: min(50vh, 360px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Only the branch list scrolls. */
.sb-menu-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
/* Frozen footer: the separator + "Open Git Manager" action pinned at the bottom. */
.sb-menu-foot {
  flex: 0 0 auto;
}
.sb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
}
.sb-menu-hd {
  flex: 0 0 auto;
  padding: 4px 10px 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.sb-menu-hint {
  padding: 6px 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.sb-menu-sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
.mi {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
}
.mi:disabled {
  opacity: 0.6;
  cursor: default;
}
.sb-mi-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
