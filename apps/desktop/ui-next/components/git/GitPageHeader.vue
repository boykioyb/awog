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
        style="width: 12px; height: 12px"
        :style="currentProject?.color ? { color: currentProject.color } : undefined"
      />
      <span class="gtrunc" style="max-width: 150px">
        {{ currentProject?.name ?? t('git.header.noProject') }}
      </span>
      <span v-if="(currentProject?.dirty ?? 0) > 0" class="gbadge" :style="dirtyStyle">
        {{ currentProject?.dirty }}
      </span>
      <Icon name="chev" style="width: 11px; height: 11px" />
    </span>

    <span class="gsep" />

    <!-- Repo picker — only when project holds more than one repo -->
    <template v-if="repos.length > 1">
      <span
        class="chip chipbtn"
        :title="t('git.header.selectRepo')"
        @click.stop="toggle('repo', $event)"
      >
        <Icon name="fork" style="width: 12px; height: 12px; color: var(--textDim)" />
        <span class="gtrunc mono" style="max-width: 160px">{{ repo }}</span>
        <Icon name="chev" style="width: 11px; height: 11px" />
      </span>
      <span class="gsep" />
    </template>

    <!-- Branch picker -->
    <span
      class="chip chipbtn"
      :title="t('git.header.switchBranch')"
      @click.stop="toggle('branch', $event)"
    >
      <Icon name="branch" style="width: 12px; height: 12px" />
      <span class="gtrunc mono" style="max-width: 180px">{{ branch }}</span>
      <Icon name="chev" style="width: 11px; height: 11px" />
    </span>

    <span style="flex: 1" />

    <!-- Merge / rebase in progress -->
    <template v-if="isMerging || isRebasing">
      <button class="btn sm" :disabled="hasConflict" @click="emit('complete-merge')">
        {{ isRebasing ? t('git.header.continueRebase') : t('git.header.completeMerge') }}
      </button>
      <button class="btn sm gdanger" @click="emit('abort-merge')">
        {{ isRebasing ? t('git.header.abortRebase') : t('git.header.abortMerge') }}
      </button>
      <span class="gsep" />
    </template>

    <!-- Ops -->
    <button class="btn sm" @click="emit('fetch')">
      <Icon name="refresh" style="width: 13px; height: 13px" />
      {{ t('git.ops.fetch') }}
    </button>
    <button class="btn sm" @click="emit('pull')">
      {{ t('git.ops.pullWord') }}
      <span v-if="behind" class="mono" style="font-size: 0.8462rem">↓{{ behind }}</span>
    </button>
    <button class="btn pri sm" @click="emit('push')">
      {{ t('git.ops.pushWord') }}
      <span v-if="ahead" class="mono" style="font-size: 0.8462rem">↑{{ ahead }}</span>
    </button>

    <span class="gsep" />

    <button class="btn sm" :title="t('git.header.identity')" @click="emit('open-identity')">
      <Icon name="settings" style="width: 13px; height: 13px" />
    </button>

    <!-- Dropdowns (fixed-positioned so they escape the header's overflow) -->
    <div v-if="open === 'project'" class="smenu" :style="menuStyle" @click.stop>
      <div
        v-for="p in projects"
        :key="p.id"
        class="mi"
        style="align-items: flex-start"
        @click="pickProject(p.id)"
      >
        <Icon
          name="projects"
          style="width: 12px; height: 12px; margin-top: 2px"
          :style="p.color ? { color: p.color } : undefined"
        />
        <span style="flex: 1; min-width: 0">
          <span style="display: flex; align-items: center; gap: 6px">
            <span class="gtrunc" style="flex: 1">{{ p.name }}</span>
            <span v-if="(p.dirty ?? 0) > 0" class="gbadge" :style="dirtyStyle">{{ p.dirty }}</span>
          </span>
          <span
            class="mono"
            style="
              display: block;
              font-size: 0.8462rem;
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
    </div>

    <div v-if="open === 'repo'" class="smenu" :style="menuStyle" @click.stop>
      <div v-for="r in repos" :key="r" class="mi" @click="pickRepo(r)">
        <Icon name="fork" style="width: 12px; height: 12px; color: var(--textDim)" />
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
        <Icon name="search" style="width: 12px; height: 12px; color: var(--textDim)" />
        <input v-model="branchQuery" :placeholder="t('git.header.filterBranches')" />
      </div>
      <div class="gbranchlist">
        <div v-for="b in filteredBranches" :key="b.name" class="mi" @click="onSwitchBranch(b.name)">
          <Icon
            name="branch"
            style="width: 12px; height: 12px"
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
}>()

const emit = defineEmits<{
  (e: 'select-project', id: string): void
  (e: 'select-repo', repo: string): void
  (e: 'switch-branch', name: string): void
  (e: 'fetch'): void
  (e: 'pull'): void
  (e: 'push'): void
  (e: 'complete-merge'): void
  (e: 'abort-merge'): void
  (e: 'open-identity'): void
}>()

const { t } = useI18n()

type Picker = 'project' | 'repo' | 'branch' | null
const open = ref<Picker>(null)
const branchQuery = ref('')
const menuStyle = ref<Record<string, string>>({})

const dirtyStyle = {
  color: 'var(--amber)',
  background: 'var(--amberDim)',
  borderColor: 'var(--amberBorder)',
}

const currentProject = computed(() => props.projects.find((p) => p.id === props.currentProjectId))

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
}

function pickProject(id: string) {
  open.value = null
  emit('select-project', id)
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
