<template>
  <div class="dscroll">
    <div class="pstats">
      <div class="pstat">
        <div class="pv">{{ project.repos.length }}</div>
        <div class="pl2">{{ t('projects.overview.repos') }}</div>
      </div>
      <div class="pstat">
        <div class="pv">{{ project.agents.length }}</div>
        <div class="pl2">{{ t('projects.overview.agents') }}</div>
      </div>
      <div class="pstat">
        <div class="pv">{{ project.ses.length }}</div>
        <div class="pl2">{{ t('projects.overview.sessions') }}</div>
      </div>
      <template v-if="project.gh">
        <div class="pstat">
          <div class="pv" style="color: var(--green)">{{ openIssues }}</div>
          <div class="pl2">{{ t('projects.overview.openIssues') }}</div>
        </div>
        <div class="pstat">
          <div class="pv" style="color: var(--green)">{{ openPrs }}</div>
          <div class="pl2">{{ t('projects.overview.openPr') }}</div>
        </div>
      </template>
    </div>

    <div class="pcard">
      <div class="pcardh">
        <Icon name="git" style="width: 13px; height: 13px" />
        <span>{{ t('projects.overview.reposCard', { n: project.repos.length }) }}</span>
        <span v-if="totalDirty" class="gchip m" style="margin-left: auto">{{ totalDirty }} M</span>
        <span v-else class="gchip" style="margin-left: auto">
          {{ t('projects.overview.clean') }}
        </span>
        <span v-if="totalAhead" class="gchip a">↑{{ totalAhead }}</span>
      </div>
      <template v-if="project.repos.length">
        <div v-for="r in project.repos" :key="r.n" class="prepo">
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
        <span>{{ t('projects.overview.agentsCard', { n: project.agents.length }) }}</span>
      </div>
      <div class="pagents">
        <span v-for="a in project.agents" :key="a" class="pagent">
          <span class="pav" :style="{ color: agBadge(a)[0], background: avatarBg(agBadge(a)[0]) }">
            {{ agBadge(a)[1] }}
          </span>
          {{ a }}
        </span>
        <span v-if="!project.agents.length" class="fd">{{ t('projects.overview.dash') }}</span>
      </div>
    </div>

    <div class="pcols2">
      <div class="pcard">
        <div class="pcardh">
          <Icon name="sessions" style="width: 13px; height: 13px" />
          <span>{{ t('projects.overview.sessionsCard') }}</span>
        </div>
        <div
          v-for="s in project.ses"
          :key="s.t"
          class="rs"
          style="padding: 7px 0; border-top: 1px solid var(--border)"
        >
          <span class="si" style="background: var(--textFaint)" />
          <span class="st1">{{ s.t }}</span>
          <span class="sw">{{ s.w }}</span>
        </div>
        <div v-if="!project.ses.length" class="fd">{{ t('projects.overview.noSession') }}</div>
      </div>
      <div class="pcard">
        <div class="pcardh">
          <Icon name="tasks" style="width: 13px; height: 13px" />
          <span>{{ t('projects.overview.tasksCard') }}</span>
        </div>
        <div
          v-for="task in project.tasks"
          :key="task.t"
          class="rs"
          style="padding: 7px 0; border-top: 1px solid var(--border)"
        >
          <Icon name="tasks" style="width: 13px; height: 13px" />
          <span class="st1">{{ task.t }}</span>
          <span class="tag acc">{{ task.s }}</span>
        </div>
        <div v-if="!project.tasks.length" class="fd">{{ t('projects.overview.noTask') }}</div>
      </div>
    </div>

    <div class="pcard">
      <div class="pcardh">
        <Icon name="folder" style="width: 13px; height: 13px" />
        <span>{{ t('projects.overview.configCard') }}</span>
      </div>
      <div class="kvrow">
        <span class="kvk">{{ t('projects.overview.path') }}</span>
        <span class="kvv mono">{{ project.path }}</span>
      </div>
      <div class="kvrow">
        <span class="kvk">{{ t('projects.overview.remote') }}</span>
        <a
          v-if="project.gh"
          class="kvv link"
          :href="`https://github.com/${project.gh}`"
          target="_blank"
          rel="noopener"
        >
          <Icon name="git" style="width: 12px; height: 12px" />
          github.com/{{ project.gh }}
        </a>
        <span v-else class="kvv" style="color: var(--textDim)">
          {{ t('projects.overview.noRemote') }}
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
      <button class="btn sm" style="color: var(--danger)">
        <Icon name="trash" />
        {{ t('projects.overview.removeProject') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { agBadge } from './data'
import type { Project } from './data'

// Overview tab — port of overviewHtml() (~2226): metrics strip + Repos / Agents /
// Sessions / Tasks / Cấu hình cards. Static; mutations (delete/edit) are deferred.
const { t } = useI18n()
const props = defineProps<{ project: Project }>()

const TIERS = ['agents', 'skills', 'rules', 'workflows', 'commands', 'hooks'] as const

const totalDirty = computed(() => props.project.repos.reduce((a, r) => a + (r.dirty ?? 0), 0))
const totalAhead = computed(() => props.project.repos.reduce((a, r) => a + (r.ahead ?? 0), 0))
const openIssues = computed(() => props.project.issues.filter((i) => i.state === 'open').length)
const openPrs = computed(() => props.project.prs.filter((i) => i.state === 'open').length)

// agChip's color-mix(in srgb, <c> 16%, transparent) for the avatar background.
function avatarBg(color: string): string {
  return `color-mix(in srgb, ${color} 16%, transparent)`
}
</script>
