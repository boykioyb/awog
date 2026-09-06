<template>
  <div class="gbar">
    <!-- Project picker -->
    <span
      class="chip chipbtn"
      :title="t('git.header.selectProject')"
      @click.stop="toggle('project', $event)"
    >
      <Icon
        name="projects"
        style="width: var(--icon-xs); height: var(--icon-xs)"
        :style="currentProject?.color ? { color: currentProject.color } : undefined"
      />
      <span class="gtrunc" style="max-width: 150px">
        {{ currentProject?.name ?? t('git.header.noProject') }}
      </span>
      <span v-if="(currentProject?.dirty ?? 0) > 0" class="gbadge" :style="dirtyStyle">
        {{ currentProject?.dirty }}
      </span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </span>

    <span v-if="!notARepo" class="gsep" />

    <!-- Repo picker — only when project holds more than one repo -->
    <template v-if="repos.length > 1 && !notARepo">
      <span
        class="chip chipbtn"
        :title="t('git.header.selectRepo')"
        @click.stop="toggle('repo', $event)"
      >
        <Icon
          name="fork"
          style="width: var(--icon-xs); height: var(--icon-xs); color: var(--textDim)"
        />
        <span class="gtrunc mono" style="max-width: 160px">{{ repo }}</span>
        <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <span class="gsep" />
    </template>

    <!-- Branch picker -->
    <span
      v-if="!notARepo"
      class="chip chipbtn"
      :title="t('git.header.switchBranch')"
      @click.stop="toggle('branch', $event)"
    >
      <Icon name="branch" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="gtrunc mono" style="max-width: 180px">{{ branch }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </span>

    <span style="flex: 1" />

    <!-- Repo ops — hidden when the workspace isn't a git repo (init empty state) -->
    <template v-if="!notARepo">
      <!-- Merge / rebase in progress -->
      <template v-if="isMerging || isRebasing">
        <span class="gconflicthint" :class="{ ready: !hasConflict }">
          {{
            hasConflict
              ? t('git.conflict.banner.resolve', { count: conflictedCount, action: completeLabel })
              : t('git.conflict.banner.ready', { action: completeLabel })
          }}
        </span>
        <button class="btn sm" :disabled="hasConflict" @click="emit('complete-merge')">
          {{ completeLabel }}
        </button>
        <button class="btn sm gdanger" @click="emit('abort-merge')">
          {{ isRebasing ? t('git.header.abortRebase') : t('git.header.abortMerge') }}
        </button>
        <span class="gsep" />
      </template>

      <!-- Ops. While an op is in flight all three disable; the active one shows a
           spinner + progress and gains an attached cancel (✕) — grouped in .gop and
           edge-joined so "Push ✕" reads as one control, not a detached box. -->
      <span class="gop">
        <button class="btn sm" :disabled="busy" @click="emit('fetch')">
          <span v-if="syncOp?.op === 'fetch'" class="gspin-ring" />
          <Icon v-else name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ syncOp?.op === 'fetch' ? syncLabel : t('git.ops.fetch') }}
        </button>
        <button
          v-if="syncOp?.op === 'fetch'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'fetch')"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </span>
      <span class="gop">
        <button class="btn sm" :disabled="busy" @click="emit('pull')">
          <span v-if="syncOp?.op === 'pull'" class="gspin-ring" />
          {{ syncOp?.op === 'pull' ? syncLabel : t('git.ops.pullWord') }}
          <span v-if="!syncOp && behind" class="mono" style="font-size: var(--fs-xs)">
            ↓{{ behind }}
          </span>
        </button>
        <button
          v-if="syncOp?.op === 'pull'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'pull')"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </span>
      <span class="gop">
        <button class="btn pri sm" :disabled="busy" @click="emit('push')">
          <span v-if="syncOp?.op === 'push'" class="gspin-ring" />
          {{ syncOp?.op === 'push' ? syncLabel : t('git.ops.pushWord') }}
          <span v-if="!syncOp && ahead" class="mono" style="font-size: var(--fs-xs)">
            ↑{{ ahead }}
          </span>
        </button>
        <button
          v-if="syncOp?.op === 'push'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'push')"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </span>

      <span class="gsep" />

      <!-- gh account used for fetch/pull/push (set in Project → Overview). Click
           opens the project so the account can be changed. -->
      <button
        class="chip chipbtn"
        :title="t('git.header.ghAccountTitle')"
        @click.stop="emit('open-account')"
      >
        <Icon
          name="git"
          style="width: var(--icon-xs); height: var(--icon-xs); color: var(--textDim)"
        />
        <span class="gtrunc" style="max-width: 120px">
          {{ ghAccount || t('git.header.ghAccountDefault') }}
        </span>
      </button>

      <button class="btn sm gicon" :title="t('git.header.identity')" @click="emit('open-identity')">
        <Icon name="settings" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </template>

    <!-- Dropdowns (fixed-positioned so they escape the header's overflow) -->
    <div
      v-if="open === 'project'"
      class="smenu"
      :style="{ ...menuStyle, width: '340px', padding: '0' }"
      @click.stop
    >
      <div class="gbranchfilter">
        <Icon
          name="search"
          style="width: var(--icon-xs); height: var(--icon-xs); color: var(--textDim)"
        />
        <input
          ref="projectSearch"
          v-model="projectQuery"
          :placeholder="t('git.header.filterProjects')"
          @keydown.enter.prevent="pickFirstProject"
          @keydown.esc.prevent="open = null"
        />
      </div>
      <div class="gbranchlist">
        <div
          v-for="p in filteredProjects"
          :key="p.id"
          class="mi"
          style="align-items: flex-start"
          @click="pickProject(p.id)"
        >
          <Icon
            name="projects"
            style="width: var(--icon-xs); height: var(--icon-xs); margin-top: 2px"
            :style="p.color ? { color: p.color } : undefined"
          />
          <span style="flex: 1; min-width: 0">
            <span style="display: flex; align-items: center; gap: 6px">
              <span class="gtrunc" style="flex: 1">{{ p.name }}</span>
              <span v-if="(p.dirty ?? 0) > 0" class="gbadge" :style="dirtyStyle">
                {{ p.dirty }}
              </span>
            </span>
            <span
              class="mono"
              style="
                display: block;
                font-size: var(--fs-xs);
                color: var(--textDim);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              "
            >
              {{ p.path }}
            </span>
          </span>
          <span v-if="p.id === currentProjectId" class="ck">✓</span>
        </div>
        <div v-if="!filteredProjects.length" class="gsecempty">
          {{ projectQuery ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
        </div>
      </div>
    </div>

    <div v-if="open === 'repo'" class="smenu" :style="menuStyle" @click.stop>
      <div v-for="r in repos" :key="r" class="mi" @click="pickRepo(r)">
        <Icon
          name="fork"
          style="width: var(--icon-xs); height: var(--icon-xs); color: var(--textDim)"
        />
        <span class="gtrunc mono" style="flex: 1">{{ r }}</span>
        <span v-if="r === repo" class="ck">✓</span>
      </div>
    </div>

    <div
      v-if="open === 'branch'"
      class="smenu"
      :style="{ ...menuStyle, width: '260px', padding: '0' }"
      @click.stop
    >
      <div class="gbranchfilter">
        <Icon
          name="search"
          style="width: var(--icon-xs); height: var(--icon-xs); color: var(--textDim)"
        />
        <input v-model="branchQuery" :placeholder="t('git.header.filterBranches')" />
      </div>
      <div class="gbranchlist">
        <div v-for="b in filteredBranches" :key="b.name" class="mi" @click="onSwitchBranch(b.name)">
          <Icon
            name="branch"
            style="width: var(--icon-xs); height: var(--icon-xs)"
            :style="b.current ? { color: 'var(--accent)' } : undefined"
          />
          <span class="gtrunc mono" :style="b.current ? 'flex:1;color:var(--accent)' : 'flex:1'">
            {{ b.name }}
          </span>
          <span v-if="b.current" class="ck">✓</span>
        </div>
        <div v-if="!filteredBranches.length" class="gsecempty">
          {{ branchQuery ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Git page header — project / repo / branch pickers + merge-rebase state + ops
// (fetch / pull / push). Mirrors production GitPageHeader.vue (ops live in the
// header at the top of the main pane, not a full-width bar). Dropdowns are
// fixed-positioned (anchored to their trigger) so the header's overflow-x:auto
// doesn't clip them.
import type { BranchInfo, ProjectInfo } from './git-types'

// In-flight remote-sync op (mirrors the git store's `syncOp`). Drives the busy
// state + live progress on the fetch/pull/push buttons.
type SyncOp = { op: 'fetch' | 'pull' | 'push'; phase: string; pct: number | null }

const props = defineProps<{
  projects: ProjectInfo[]
  currentProjectId: string
  repos: string[]
  repo: string
  branch: string
  branches: BranchInfo[]
  ahead: number
  behind: number
  isMerging: boolean
  isRebasing: boolean
  hasConflict: boolean
  // Number of files still conflicted — interpolated into the merge/rebase banner.
  conflictedCount: number
  notARepo: boolean
  syncOp: SyncOp | null
  // The gh account fetch/pull/push authenticate as ('' = the default identity).
  ghAccount: string
}>()

const emit = defineEmits<{
  (e: 'select-project', id: string): void
  (e: 'select-repo', repo: string): void
  (e: 'switch-branch', name: string): void
  (e: 'fetch'): void
  (e: 'pull'): void
  (e: 'push'): void
  (e: 'cancel', op: 'fetch' | 'pull' | 'push'): void
  (e: 'complete-merge'): void
  (e: 'abort-merge'): void
  (e: 'open-identity'): void
  (e: 'open-account'): void
}>()

const { t } = useI18n()

type Picker = 'project' | 'repo' | 'branch' | null
const open = ref<Picker>(null)
const branchQuery = ref('')
const projectQuery = ref('')
const menuStyle = ref<Record<string, string>>({})
const projectSearch = useTemplateRef<HTMLInputElement>('projectSearch')

const dirtyStyle = {
  color: 'var(--amber)',
  background: 'var(--amberDim)',
  borderColor: 'var(--amberBorder)',
}

// Any remote-sync op in flight → disable all three buttons; the active one shows
// a spinner + localized progress label.
const busy = computed(() => props.syncOp !== null)
const syncLabel = computed(() => {
  const s = props.syncOp
  if (!s) return ''
  const base = t(`git.ops.${s.op}ing`)
  return s.pct != null ? `${base} ${s.pct}%` : base
})

// Label of the finalise action, reused by the banner text and the button so both
// stay in sync with the merge vs rebase variant.
const completeLabel = computed(() =>
  props.isRebasing ? t('git.header.continueRebase') : t('git.header.completeMerge'),
)

const currentProject = computed(() => props.projects.find((p) => p.id === props.currentProjectId))

// Project picker filter — matches name or path (case-insensitive).
const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase()
  if (!q) return props.projects
  return props.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  )
})

const localBranches = computed(() => props.branches.filter((b) => !b.remote))
const filteredBranches = computed(() => {
  const q = branchQuery.value.trim().toLowerCase()
  if (!q) return localBranches.value
  return localBranches.value.filter((b) => b.name.toLowerCase().includes(q))
})

function toggle(p: Exclude<Picker, null>, ev: MouseEvent) {
  if (open.value === p) {
    open.value = null
    return
  }
  const el = ev.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  menuStyle.value = { top: `${r.bottom + 4}px`, left: `${r.left}px` }
  open.value = p
  if (p === 'branch') branchQuery.value = ''
  if (p === 'project') {
    projectQuery.value = ''
    void nextTick(() => projectSearch.value?.focus())
  }
}

function pickProject(id: string) {
  open.value = null
  emit('select-project', id)
}

// Enter in the search field selects the first match — quick keyboard jump.
function pickFirstProject() {
  const first = filteredProjects.value[0]
  if (first) pickProject(first.id)
}

function pickRepo(r: string) {
  open.value = null
  emit('select-repo', r)
}

function onSwitchBranch(name: string) {
  open.value = null
  emit('switch-branch', name)
}

const onDocClick = () => {
  open.value = null
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
/* Merge/rebase banner instruction — danger tone while conflicts remain, muted
   once resolved. No hex: colors from prototype.css theme vars. */
.gconflicthint {
  color: var(--danger);
  margin-right: 6px;
  white-space: nowrap;
}
.gconflicthint.ready {
  color: var(--textDim);
}

/* ── Toolbar controls share one height + radius so the row reads as a single
   system. Before, pickers (.chip, 3px padding) sat next to ops (.btn.sm, 5px
   padding) at visibly different heights ("cái to cái nhỏ"). ── */
.gbar .btn,
.gbar .chip {
  height: 28px;
  border-radius: var(--r-xs);
}
.gbar .btn.sm {
  padding: 0 10px;
}
.gbar .chip {
  padding: 0 10px;
}
/* Icon-only toolbar buttons (identity settings) → square + centered. */
.gbar .gicon {
  width: 28px;
  padding: 0;
  justify-content: center;
}

/* ── Op + cancel = one joined segment. The ✕ used to be a separate bordered
   button set off by the row's 9px gap, so it floated detached beside Push. Each
   op is now grouped with its cancel and their edges are butted so "Push ✕" reads
   as one control. The 9px row gap still separates Fetch / Pull / Push groups. ── */
.gop {
  display: inline-flex;
  align-items: stretch;
}
.gop:has(> .gopx) > .btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.gopx {
  display: grid;
  place-items: center;
  width: 26px;
  height: 28px;
  margin-left: -1px;
  border: 1px solid var(--border);
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.gopx:hover {
  background: var(--dangerBg);
  border-color: var(--dangerBorder);
}

/* In-flight fetch/pull/push spinner. A clean CSS arc (3/4 ring in the button's own
   currentColor) reads as a proper loading spinner — the old rotating "refresh"
   glyph looked wobbly/loose. Only transform animates (GPU, no reflow). */
.gspin-ring {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  opacity: 0.9;
  animation: gspin 0.6s linear infinite;
}
@keyframes gspin {
  to {
    transform: rotate(360deg);
  }
}
/* Reduced motion: no spin, but keep a static arc so "working" is still shown. */
@media (prefers-reduced-motion: reduce) {
  .gspin-ring {
    animation: none;
  }
}
</style>
