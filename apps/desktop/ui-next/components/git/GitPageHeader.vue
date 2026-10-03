<template>
  <div class="gbar">
    <!-- Project picker -->
    <Button
      variant="outline"
      size="sm"
      class="gbar-pick"
      :title="t('git.header.selectProject')"
      @click.stop="toggle('project', $event)"
    >
      <Icon
        name="projects"
        class="size-3.5"
        :style="currentProject?.color ? { color: currentProject.color } : undefined"
      />
      <span class="gtrunc gchiplbl gchiplbl--project">
        {{ currentProject?.name ?? t('git.header.noProject') }}
      </span>
      <span
        v-if="(currentProject?.dirty ?? 0) > 0"
        class="rounded-sm bg-warning/15 px-1 font-mono text-[10px] leading-4 text-warning"
      >
        {{ currentProject?.dirty }}
      </span>
      <Icon name="chev" class="size-3.5" />
    </Button>

    <span v-if="!notARepo" class="gsep" />

    <!-- Repo picker — only when project holds more than one repo -->
    <template v-if="repos.length > 1 && !notARepo">
      <Button
        variant="outline"
        size="sm"
        class="gbar-pick"
        :title="t('git.header.selectRepo')"
        @click.stop="toggle('repo', $event)"
      >
        <Icon name="fork" class="size-3.5 text-muted-foreground" />
        <span class="gtrunc font-mono" style="max-width: 160px">{{ repo }}</span>
        <Icon name="chev" class="size-3.5" />
      </Button>
      <span class="gsep" />
    </template>

    <!-- Branch picker -->
    <Button
      v-if="!notARepo"
      variant="outline"
      size="sm"
      class="gbar-pick"
      :title="t('git.header.switchBranch')"
      @click.stop="toggle('branch', $event)"
    >
      <Icon name="branch" class="size-3.5" />
      <span class="gtrunc gchiplbl gchiplbl--branch font-mono">{{ branch }}</span>
      <Icon name="chev" class="size-3.5" />
    </Button>

    <span class="gspacer" />

    <!-- Repo ops — hidden when the workspace isn't a git repo (init empty state) -->
    <template v-if="!notARepo">
      <!-- Ops. While an op is in flight all three disable; the active one shows a
           spinner + progress and gains an attached cancel (✕) — grouped in .gop and
           edge-joined so "Push ✕" reads as one control, not a detached box. -->
      <span class="gop">
        <Button variant="outline" size="sm" :disabled="busy" @click="emit('fetch')">
          <span v-if="syncOp?.op === 'fetch'" class="gspin-ring" />
          <Icon v-else name="refresh" class="size-3.5" />
          {{ syncOp?.op === 'fetch' ? syncLabel : t('git.ops.fetch') }}
        </Button>
        <button
          v-if="syncOp?.op === 'fetch'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'fetch')"
        >
          <Icon name="x" class="size-3.5" />
        </button>
      </span>
      <span class="gop">
        <Button variant="outline" size="sm" :disabled="busy" @click="emit('pull')">
          <span v-if="syncOp?.op === 'pull'" class="gspin-ring" />
          {{ syncOp?.op === 'pull' ? syncLabel : t('git.ops.pullWord') }}
          <span v-if="!syncOp && behind" class="font-mono text-xs tabular-nums">↓{{ behind }}</span>
        </Button>
        <button
          v-if="syncOp?.op === 'pull'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'pull')"
        >
          <Icon name="x" class="size-3.5" />
        </button>
      </span>
      <span class="gop">
        <Button variant="outline" size="sm" class="gpush" :disabled="busy" @click="emit('push')">
          <span v-if="syncOp?.op === 'push'" class="gspin-ring" />
          {{ syncOp?.op === 'push' ? syncLabel : t('git.ops.pushWord') }}
          <span v-if="!syncOp && ahead" class="font-mono text-xs tabular-nums">↑{{ ahead }}</span>
        </Button>
        <button
          v-if="syncOp?.op === 'push'"
          class="gopx"
          :title="t('git.ops.cancel')"
          @click="emit('cancel', 'push')"
        >
          <Icon name="x" class="size-3.5" />
        </button>
      </span>

      <span class="gsep" />

      <!-- gh account used for fetch/pull/push (set in Project → Overview). Click
           opens the project so the account can be changed. -->
      <Button
        variant="outline"
        size="sm"
        class="gbar-pick"
        :title="t('git.header.ghAccountTitle')"
        @click.stop="emit('open-account')"
      >
        <Icon name="git" class="size-3.5 text-muted-foreground" />
        <span class="gtrunc gchiplbl gchiplbl--account">
          {{ ghAccount || t('git.header.ghAccountDefault') }}
        </span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-8 px-0"
        :title="t('git.header.identity')"
        :aria-label="t('git.header.identity')"
        @click="emit('open-identity')"
      >
        <Icon name="settings" class="size-3.5" />
      </Button>
    </template>

    <!-- Dropdowns (fixed-positioned so they escape the header's overflow) —
         reskinned to the shadcn popover shape; mechanics unchanged. -->
    <div
      v-if="open === 'project'"
      class="gmenu"
      :style="{ ...menuStyle, width: '340px', padding: '0' }"
      @click.stop
    >
      <div class="gmenu-filter">
        <Icon name="search" class="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref="projectSearch"
          v-model="projectQuery"
          unstyled
          :placeholder="t('git.header.filterProjects')"
          @keydown.enter.prevent="pickFirstProject"
          @keydown.esc.prevent="open = null"
        />
      </div>
      <div class="gmenu-list">
        <div
          v-for="p in filteredProjects"
          :key="p.id"
          class="gmi items-start"
          @click="pickProject(p.id)"
        >
          <Icon
            name="projects"
            class="mt-0.5 size-3.5 shrink-0"
            :style="p.color ? { color: p.color } : undefined"
          />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="gtrunc flex-1">{{ p.name }}</span>
              <span
                v-if="(p.dirty ?? 0) > 0"
                class="rounded-sm bg-warning/15 px-1 font-mono text-[10px] leading-4 text-warning"
              >
                {{ p.dirty }}
              </span>
            </span>
            <span class="block truncate font-mono text-xs text-muted-foreground">
              {{ p.path }}
            </span>
          </span>
          <Icon
            v-if="p.id === currentProjectId"
            name="check"
            class="size-3.5 shrink-0 self-center text-primary"
          />
        </div>
        <div
          v-if="!filteredProjects.length"
          class="px-2 py-6 text-center text-sm text-muted-foreground"
        >
          {{ projectQuery ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
        </div>
      </div>
    </div>

    <div v-if="open === 'repo'" class="gmenu" :style="menuStyle" @click.stop>
      <div v-for="r in repos" :key="r" class="gmi" @click="pickRepo(r)">
        <Icon name="fork" class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="gtrunc flex-1 font-mono">{{ r }}</span>
        <Icon v-if="r === repo" name="check" class="size-3.5 shrink-0 text-primary" />
      </div>
    </div>

    <div
      v-if="open === 'branch'"
      class="gmenu"
      :style="{ ...menuStyle, width: '260px', padding: '0' }"
      @click.stop
    >
      <div class="gmenu-filter">
        <Icon name="search" class="size-3.5 shrink-0 text-muted-foreground" />
        <Input v-model="branchQuery" unstyled :placeholder="t('git.header.filterBranches')" />
      </div>
      <div class="gmenu-list">
        <div
          v-for="b in filteredBranches"
          :key="b.name"
          class="gmi"
          @click="onSwitchBranch(b.name)"
        >
          <Icon
            name="branch"
            class="size-3.5 shrink-0"
            :style="b.current ? { color: 'var(--primary)' } : undefined"
          />
          <span
            class="gtrunc flex-1 font-mono"
            :style="b.current ? 'color:var(--primary)' : undefined"
          >
            {{ b.name }}
          </span>
          <Icon v-if="b.current" name="check" class="size-3.5 shrink-0 text-primary" />
        </div>
        <div
          v-if="!filteredBranches.length"
          class="px-2 py-6 text-center text-sm text-muted-foreground"
        >
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
import Button from '~/components/ui/button/Button.vue'
import type { BranchInfo, ProjectInfo } from './git-types'
import Input from '~/components/ui/input/Input.vue'

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

// Any remote-sync op in flight → disable all three buttons; the active one shows
// a spinner + localized progress label.
const busy = computed(() => props.syncOp !== null)
const syncLabel = computed(() => {
  const s = props.syncOp
  if (!s) return ''
  const base = t(`git.ops.${s.op}ing`)
  return s.pct != null ? `${base} ${s.pct}%` : base
})

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
/* Picker buttons (project/repo/branch/account) — outline buttons whose labels
   may ellipsize; the caps live in app-shell.css's container-query block (they
   must beat any inline max-width, so they can't move into the template). */
.gbar-pick {
  gap: 6px;
}

/* ── Op + cancel = one joined segment. The ✕ used to be a separate bordered
   button set off by the row's gap, so it floated detached beside Push. Each op
   is now grouped with its cancel and their edges are butted so "Push ✕" reads
   as one control. The row gap still separates Fetch / Pull / Push groups. ── */
.gop {
  display: inline-flex;
  align-items: stretch;
}
.gop:has(> .gopx) > :deep(button) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.gopx {
  display: grid;
  place-items: center;
  width: 26px;
  height: 32px;
  margin-left: -1px;
  border: 1px solid var(--input);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: transparent;
  color: var(--destructive);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.gopx:hover {
  background: color-mix(in oklab, var(--destructive) 10%, transparent);
}

/* In-flight fetch/pull/push spinner — vòng cung arc quanh, theo idiom proto
   (ring quay quanh icon tĩnh, không quay glyph). */
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

/* Filterable picker dropdowns — shadcn popover shape (popover bg, lg radius,
   hairline, md shadow). Fixed-positioned by the trigger's rect (see toggle()). */
.gmenu {
  position: fixed;
  z-index: 180;
  min-width: 168px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 4px;
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: var(--r-btn); /* rounded-lg */
  box-shadow: var(--shadow-md);
}
.gmenu-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.gmenu-filter input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--foreground);
}
.gmenu-filter input::placeholder {
  color: var(--muted-foreground);
}
.gmenu-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
}
.gmi {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r-sm); /* rounded-md */
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--popover-foreground);
  cursor: pointer;
}
.gmi:hover {
  background: var(--accent-wash);
}
</style>
