<template>
  <div class="dscroll">
    <div class="pstats">
      <div class="pstat">
        <div class="pv">{{ effRepos.length }}</div>
        <div class="pl2">{{ t('projects.overview.repos') }}</div>
      </div>
      <div class="pstat">
        <div class="pv">{{ view.agents.length }}</div>
        <div class="pl2">{{ t('projects.overview.agents') }}</div>
      </div>
      <div class="pstat">
        <div class="pv">{{ view.ses.length }}</div>
        <div class="pl2">{{ t('projects.overview.sessions') }}</div>
      </div>
      <div class="pstat">
        <div class="pv">{{ view.tasks.length }}</div>
        <div class="pl2">{{ t('projects.overview.tasksCard') }}</div>
      </div>
    </div>

    <div class="pcard">
      <div class="pcardh">
        <Icon name="git" style="width: 13px; height: 13px" />
        <span>{{ t('projects.overview.reposCard', { n: effRepos.length }) }}</span>
        <span v-if="totalDirty" class="gchip m" style="margin-left: auto">{{ totalDirty }} M</span>
        <span
          v-if="totalAhead"
          class="gchip a"
          :style="totalDirty ? undefined : { marginLeft: 'auto' }"
        >
          ↑{{ totalAhead }}
        </span>
      </div>
      <template v-if="effRepos.length">
        <div v-for="r in effRepos" :key="r.n" class="prepo">
          <span class="prepo-ic"><Icon name="git" style="width: 14px; height: 14px" /></span>
          <div style="min-width: 0">
            <div class="prepo-n">{{ r.n }}</div>
            <div v-if="r.br" class="prepo-br">
              <Icon name="branch" style="width: 11px; height: 11px" />
              {{ r.br }}
            </div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 6px">
            <span v-if="r.dirty" class="gchip m">{{ r.dirty }} M</span>
            <span v-if="r.ahead" class="gchip a">↑{{ r.ahead }}</span>
          </div>
        </div>
      </template>
      <div v-else class="fd">{{ t('projects.overview.noRepo') }}</div>
    </div>

    <div class="pcard">
      <div class="pcardh">
        <Icon name="agents" style="width: 13px; height: 13px" />
        <span>{{ t('projects.overview.agentsCard', { n: view.agents.length }) }}</span>
      </div>
      <div class="pagents">
        <span v-for="a in view.agents" :key="a" class="pagent">
          <span class="pav" :style="{ color: agBadge(a)[0], background: avatarBg(agBadge(a)[0]) }">
            {{ agBadge(a)[1] }}
          </span>
          {{ a }}
        </span>
        <span v-if="!view.agents.length" class="fd">{{ t('projects.overview.noAgent') }}</span>
      </div>
    </div>

    <div class="pcols2">
      <div class="pcard">
        <div class="pcardh">
          <Icon name="sessions" style="width: 13px; height: 13px" />
          <span>{{ t('projects.overview.sessionsCard') }}</span>
        </div>
        <div
          v-for="s in view.ses"
          :key="s.id"
          class="rs rs-link"
          style="padding: 7px 0; border-top: 1px solid var(--border); cursor: pointer"
          :title="t('projects.overview.openSession')"
          @click="openSession(s.id)"
        >
          <span class="si" style="background: var(--textFaint)" />
          <span class="st1">{{ s.t }}</span>
          <span class="sw">{{ s.w }}</span>
        </div>
        <div v-if="!view.ses.length" class="fd">{{ t('projects.overview.noSession') }}</div>
      </div>
      <div class="pcard">
        <div class="pcardh">
          <Icon name="tasks" style="width: 13px; height: 13px" />
          <span>{{ t('projects.overview.tasksCard') }}</span>
        </div>
        <div
          v-for="task in view.tasks"
          :key="task.t"
          class="rs"
          style="padding: 7px 0; border-top: 1px solid var(--border)"
        >
          <Icon name="tasks" style="width: 13px; height: 13px" />
          <span class="st1">{{ task.t }}</span>
          <span class="tag acc">{{ task.s }}</span>
        </div>
        <div v-if="!view.tasks.length" class="fd">{{ t('projects.overview.noTask') }}</div>
      </div>
    </div>

    <div class="pcard">
      <div class="pcardh">
        <Icon name="folder" style="width: 13px; height: 13px" />
        <span>{{ t('projects.overview.configCard') }}</span>
      </div>
      <div v-if="project.description" class="kvrow" style="align-items: flex-start">
        <span class="kvk">{{ t('projects.overview.description') }}</span>
        <span class="kvv">{{ project.description }}</span>
      </div>
      <div class="kvrow">
        <span class="kvk">{{ t('projects.overview.path') }}</span>
        <span class="kvv mono">{{ project.path }}</span>
      </div>
      <div v-if="project.language" class="kvrow">
        <span class="kvk">{{ t('projects.overview.language') }}</span>
        <span class="kvv">{{ project.language }}</span>
      </div>
      <div class="kvrow">
        <span class="kvk">{{ t('projects.overview.remote') }}</span>
        <a
          v-if="view.gh"
          class="kvv link"
          :href="`https://github.com/${view.gh}`"
          target="_blank"
          rel="noopener"
        >
          <Icon name="git" style="width: 12px; height: 12px" />
          github.com/{{ view.gh }}
        </a>
        <span v-else-if="project.gitRemote" class="kvv mono">{{ project.gitRemote }}</span>
        <span v-else class="kvv" style="color: var(--textDim)">
          {{ t('projects.overview.noRemote') }}
        </span>
      </div>
      <div class="kvrow">
        <span class="kvk">{{ t('projects.overview.llm') }}</span>
        <span class="kvv">
          <button v-if="!compact" class="btn sm" @click="emit('open-llm')">
            <Icon name="brain" />
            {{ llmLabel }}
          </button>
          <span v-else style="display: inline-flex; align-items: center; gap: 6px">
            <Icon name="brain" style="width: 12px; height: 12px" />
            {{ llmLabel }}
          </span>
        </span>
      </div>
      <div class="kvrow" style="align-items: flex-start">
        <span class="kvk">.awog/</span>
        <span class="kvv awtiers">
          <span
            v-for="d in TIERS"
            :key="d"
            class="chip"
            style="padding: 2px 8px; font-size: 0.8462rem"
          >
            {{ d }}/
          </span>
        </span>
      </div>
      <!-- Config-import assistant (ADR 0035): `.claude`/`.agents` are import sources,
           not live tiers — offer to copy them into `.awog`. Hidden in compact mode. -->
      <div v-if="(importable.length || justImported) && !compact" class="cfgimport">
        <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto" />
        <span v-if="importable.length">
          {{ t('projects.import.banner', { n: importable.length }) }}
        </span>
        <span v-else>{{ t('projects.import.done', { n: justImported }) }}</span>
        <span style="flex: 1" />
        <button v-if="importable.length" class="btn sm pri" :disabled="importing" @click="onImport">
          {{
            importing
              ? t('projects.import.importing')
              : t('projects.import.action', { n: importable.length })
          }}
        </button>
      </div>
    </div>

    <div v-if="!compact" style="display: flex; justify-content: flex-end; margin-top: 6px">
      <button class="btn sm" style="color: var(--danger)" @click="emit('delete')">
        <Icon name="trash" />
        {{ t('projects.overview.removeProject') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Overview tab — metrics strip + Repos / Agents / Sessions / Tasks / Config cards.
// Binds the derived ProjectView (live counts) for the cards and the real Project
// entity for the config block (description / path / language / remote / LLM).
// Edit / delete / LLM defaults are emitted up to the page-controller.
import { computed, ref } from 'vue'
import { agBadge, avatarBg, type ProjectRepo, type ProjectView } from './data'
import { modelDisplayName } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useConfigImport } from '~/composables/useConfigImport'
import { useProjectModal } from '~/composables/useProjectModal'
import type { Project } from '~/types'

// `compact` (quick-view modal): hide destructive / management controls (remove
// project, config-import banner, LLM-defaults button → static label) so the panel
// is view-only.
const props = defineProps<{
  project: Project
  view: ProjectView
  repos?: ProjectRepo[]
  compact?: boolean
}>()
const emit = defineEmits<{
  (e: 'delete'): void
  (e: 'open-llm'): void
  (e: 'imported', n: number): void
}>()

const { t } = useI18n()
const sessions = useSessionsStore()

// Importable `.claude`/`.agents` config for this project → the import banner.
const { importable, importing, importAll } = useConfigImport(() => props.project.id)
const justImported = ref(0)
async function onImport() {
  const n = await importAll()
  if (n <= 0) return
  justImported.value = n
  emit('imported', n)
  setTimeout(() => (justImported.value = 0), 5000)
}

// Discovered child repos (multi-repo workspace) when provided, else the entity's
// single repo. Drives the repo card + the "REPO" stat count.
const effRepos = computed<ProjectRepo[]>(() =>
  props.repos && props.repos.length ? props.repos : props.view.repos,
)

// Open a recent session from the overview — select it + jump to the Sessions page.
// Also dismiss the project quick-view modal when open (this component renders both
// on the /projects page and inside that modal); a no-op when the modal is closed.
const projectModal = useProjectModal()
function openSession(id: number) {
  sessions.setActive(id)
  projectModal.close()
  navigateTo('/sessions')
}

const TIERS = ['agents', 'skills', 'rules', 'workflows', 'commands', 'hooks'] as const

const totalDirty = computed(() => effRepos.value.reduce((a, r) => a + (r.dirty ?? 0), 0))
const totalAhead = computed(() => effRepos.value.reduce((a, r) => a + (r.ahead ?? 0), 0))

// LLM defaults summary chip: model name when set, else "App default".
const llmLabel = computed(() => {
  const ld = props.project.llmDefaults
  if (!ld) return t('projects.overview.llmAppDefault')
  return modelDisplayName(ld.modelId)
})
</script>

<style scoped>
.rs-link:hover .st1 {
  color: var(--accent);
}
/* Config-import banner row: amber heads-up + an Import action, full width under
   the .awog/ tier chips. */
.cfgimport {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 11px;
  border-radius: 9px;
  font-size: 0.9231rem;
  color: var(--amber);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
}
</style>
