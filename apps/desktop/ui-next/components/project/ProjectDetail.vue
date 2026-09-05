<template>
  <div class="detail" style="position: relative">
    <div class="dh">
      <span
        class="rx"
        style="
          width: 26px;
          height: 26px;
          border-radius: var(--r-xs);
          background: var(--accentDim);
          color: var(--accent);
          margin-right: 8px;
        "
      >
        <Icon name="projects" style="width: 14px; height: 14px" />
      </span>
      <div class="dt">{{ project.name }}</div>
      <span style="flex: 1" />
      <!-- Management actions are hidden in compact (quick-view) mode — the modal is
           for peeking at info + issues/PRs, not editing. -->
      <template v-if="!compact">
        <button
          class="iconbtn"
          style="width: 28px; height: 28px"
          :title="t('projects.detail.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" style="width: 14px; height: 14px" />
        </button>
        <button
          class="iconbtn"
          style="width: 28px; height: 28px"
          :title="t('projects.detail.saveAsTemplate')"
          @click="emit('save-template')"
        >
          <Icon name="save" style="width: 14px; height: 14px" />
        </button>
        <button
          class="iconbtn"
          style="width: 28px; height: 28px"
          :title="t('projects.detail.installTemplate')"
          @click="emit('install-template')"
        >
          <Icon name="templates" style="width: 14px; height: 14px" />
        </button>
        <button
          class="iconbtn"
          style="width: 28px; height: 28px"
          :title="t('projects.detail.openWorkspace')"
          @click="emit('open-workspace')"
        >
          <Icon name="layers" style="width: 14px; height: 14px" />
        </button>
        <button
          class="btn pri sm"
          :title="t('projects.detail.openCode')"
          @click="emit('open-code')"
        >
          <Icon name="commands" />
          {{ t('projects.detail.openCode') }}
        </button>
      </template>
    </div>

    <div class="ptabs">
      <span class="ptab" :class="{ on: tab === 'overview' }" @click="setTab('overview')">
        {{ t('projects.tab.overview') }}
      </span>
      <template v-if="hasGh">
        <span class="ptab" :class="{ on: tab === 'issues' }" @click="setTab('issues')">
          {{ t('projects.tab.issues') }}
        </span>
        <span class="ptab" :class="{ on: tab === 'prs' }" @click="setTab('prs')">
          {{ t('projects.tab.prs') }}
        </span>
      </template>
      <span v-else class="fd" style="padding: 8px 12px">
        {{ t('projects.tab.notGithub') }}
      </span>
    </div>

    <div v-if="tab === 'overview'" class="projmain">
      <ProjectOverview
        :project="project"
        :view="view"
        :repos="overviewRepos"
        :compact="compact"
        @delete="emit('delete')"
        @open-llm="emit('open-llm')"
        @imported="(n) => emit('imported', n)"
      />
    </div>
    <!-- Issues + PR are two independent instances, lazily mounted on first visit
         and kept alive (v-show) so switching tabs never refetches — each holds its
         own list + filters. `ghRepos` drives the repo picker (multi-repo workspace).
         Both unmount when leaving for Overview / another project (visited resets). -->
    <template v-else>
      <ProjectGh
        v-if="visited.issues"
        v-show="tab === 'issues'"
        :project-id="project.id"
        kind="issue"
        :repos="ghRepos"
        :open-number="tab === 'issues' ? openNumber : null"
      />
      <ProjectGh
        v-if="visited.prs"
        v-show="tab === 'prs'"
        :project-id="project.id"
        kind="pr"
        :repos="ghRepos"
        :open-number="tab === 'prs' ? openNumber : null"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// Detail pane — header (icon / name / status / edit / save-as-template /
// install-template / open-code-workspace / Open code) + tabs (Overview / Issues
// / PR) + body. Binds the real Project entity + the derived overview view-model;
// GitHub tabs mount ProjectGh (live gh.* RPC) only when the remote is a GitHub
// repo. Edit / delete / LLM-defaults / template / open-code / open-workspace
// bubble to the page.
import { computed, ref, watch } from 'vue'
import ProjectGh from './ProjectGh.vue'
import ProjectOverview from './ProjectOverview.vue'
import type { ProjectRepo, ProjectView } from './data'
import { useProjectRepos } from '~/composables/useProjectRepos'
import { prefetchGhList } from '~/composables/useProjectGh'
import type { ProjectDeepLink } from '~/composables/useProjectModal'
import type { Project } from '~/types'

// `compact` (quick-view modal): hide management chrome (header actions + Overview's
// destructive / config-import controls) so the panel is view-only.
const props = withDefaults(
  defineProps<{
    project: Project
    view: ProjectView
    compact?: boolean
    // Open straight on a GitHub tab / thread (a notification toast). Null = the
    // normal Overview-first behaviour.
    deepLink?: ProjectDeepLink | null
  }>(),
  {
    compact: false,
    deepLink: null,
  },
)
const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'open-llm'): void
  (e: 'open-code'): void
  (e: 'open-workspace'): void
  (e: 'save-template'): void
  (e: 'install-template'): void
  (e: 'imported', n: number): void
}>()

const { t } = useI18n()

// Discover the project's git repos (multi-repo workspace). `ghRepos` are the ones
// with a GitHub remote — they drive the Issues/PR tab visibility + repo picker.
const { repos, ghRepos } = useProjectRepos(
  () => props.project.id,
  () => props.project.path,
)

// Show Issues/PR when the entity remote is GitHub (immediate) OR discovery found a
// GitHub child repo (multi-repo workspace, resolves async).
const hasGh = computed(() => !!props.view.gh || ghRepos.value.length > 0)

// Repos for the Overview card — discovered child repos (workspace) when available,
// else the entity-derived single repo. Mapped to the card's ProjectRepo shape.
const overviewRepos = computed<ProjectRepo[]>(() => {
  if (!repos.value.length) return props.view.repos
  return repos.value.map((r) => {
    const o: ProjectRepo = { n: r.relativePath === '.' ? r.name : r.relativePath, br: r.branch }
    if (r.ghSlug) o.gh = r.ghSlug
    if (r.dirty > 0) o.dirty = r.dirty
    return o
  })
})

// Warm both GH lists as soon as a GitHub project's detail opens, while the user
// is still reading Overview — clicking Issues / Pull Requests then paints from
// cache instead of a skeleton. Idle-scheduled so it never competes with the
// detail's own render; the prefetcher skips lists that are already fresh, and
// the tab joins an in-flight warm-up rather than spawning gh a second time.
watch(
  [() => props.project.id, () => ghRepos.value[0]?.relativePath],
  ([projectId, relativePath]) => {
    if (!projectId || !hasGh.value) return
    const repoPath = relativePath && relativePath !== '.' ? relativePath : undefined
    const warm = (): void => {
      void prefetchGhList({ projectId, kind: 'issue', ...(repoPath ? { repoPath } : {}) })
      void prefetchGhList({ projectId, kind: 'pr', ...(repoPath ? { repoPath } : {}) })
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 1500 })
    else setTimeout(warm, 250)
  },
  { immediate: true },
)

type Tab = 'overview' | 'issues' | 'prs'
const tab = ref<Tab>('overview')

// Which GH tabs have been opened this visit — gates lazy mount (so a tab fetches
// only once opened) while v-show keeps the mounted instance for instant switching.
// Reset when leaving the GH area so re-entering re-pulls fresh.
const visited = ref<{ issues: boolean; prs: boolean }>({ issues: false, prs: false })
watch(tab, (t) => {
  if (t === 'issues') visited.value.issues = true
  else if (t === 'prs') visited.value.prs = true
  else {
    visited.value.issues = false
    visited.value.prs = false
  }
})

function setTab(next: Tab) {
  tab.value = next
}

// Reset to overview when the selected project changes (or its remote drops the
// GitHub tabs out from under the current selection).
watch(
  () => props.project.id,
  () => {
    tab.value = 'overview'
  },
)
watch(hasGh, (has) => {
  if (!has && tab.value !== 'overview') tab.value = 'overview'
})

// Deep link (GitHub notification toast): jump to its tab + hand the thread number
// down. Keyed on `token`, not the value, so re-clicking the same notification
// re-applies it. Declared LAST on purpose: switching project resets the tab to
// Overview above, and this must win when both fire in the same tick.
const openNumber = ref<number | null>(null)
watch(
  () => props.deepLink?.token ?? null,
  () => {
    const link = props.deepLink
    if (!link) {
      openNumber.value = null
      return
    }
    tab.value = link.tab
    visited.value[link.tab] = true
    openNumber.value = link.ghNumber
  },
  { immediate: true, flush: 'post' },
)
</script>
