<template>
  <div class="dscroll">
    <div class="pstats">
      <div class="pstat">
        <div class="pv">{{ view.repos.length }}</div>
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
        <span>{{ t('projects.overview.reposCard', { n: view.repos.length }) }}</span>
        <span v-if="totalDirty" class="gchip m" style="margin-left: auto">{{ totalDirty }} M</span>
        <span v-else-if="view.repos.length" class="gchip" style="margin-left: auto">
          {{ t('projects.overview.clean') }}
        </span>
        <span v-if="totalAhead" class="gchip a">↑{{ totalAhead }}</span>
      </div>
      <template v-if="view.repos.length">
        <div v-for="r in view.repos" :key="r.n" class="prepo">
          <span class="prepo-ic"><Icon name="git" style="width: 14px; height: 14px" /></span>
          <div style="min-width: 0">
            <div class="prepo-n">{{ r.n }}</div>
            <div class="prepo-br">
              <Icon name="branch" style="width: 11px; height: 11px" />
              {{ r.br }}
            </div>
          </div>
          <div style="margin-left: auto; display: flex; gap: 6px">
            <span v-if="r.dirty" class="gchip m">{{ r.dirty }} M</span>
            <span v-else class="gchip">{{ t('projects.overview.clean') }}</span>
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
          :key="s.t"
          class="rs"
          style="padding: 7px 0; border-top: 1px solid var(--border)"
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
          <button class="btn sm" @click="emit('open-llm')">
            <Icon name="brain" />
            {{ llmLabel }}
          </button>
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
    </div>

    <div style="display: flex; justify-content: flex-end; margin-top: 6px">
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
import { computed } from 'vue'
import { agBadge, avatarBg, type ProjectView } from './data'
import { modelDisplayName } from '~/composables/useSessionsMock'
import type { Project } from '~/types'

const props = defineProps<{ project: Project; view: ProjectView }>()
const emit = defineEmits<{ (e: 'delete'): void; (e: 'open-llm'): void }>()

const { t } = useI18n()

const TIERS = ['agents', 'skills', 'rules', 'workflows', 'commands', 'hooks'] as const

const totalDirty = computed(() => props.view.repos.reduce((a, r) => a + (r.dirty ?? 0), 0))
const totalAhead = computed(() => props.view.repos.reduce((a, r) => a + (r.ahead ?? 0), 0))

// LLM defaults summary chip: model name when set, else "App default".
const llmLabel = computed(() => {
  const ld = props.project.llmDefaults
  if (!ld) return t('projects.overview.llmAppDefault')
  return modelDisplayName(ld.modelId)
})
</script>
