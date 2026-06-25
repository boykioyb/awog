<template>
  <div class="detail" style="position: relative">
    <div class="dh">
      <span
        class="rx"
        style="
          width: 26px;
          height: 26px;
          border-radius: 7px;
          background: var(--accentDim);
          color: var(--accent);
          margin-right: 8px;
        "
      >
        <Icon name="projects" style="width: 14px; height: 14px" />
      </span>
      <div class="dt">{{ project.name }}</div>
      <span style="flex: 1" />
      <span class="tag" :class="{ acc: view.status === 'active' }">
        {{ t(`projects.status.${view.status}`) }}
      </span>
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
      <button class="btn pri sm" :title="t('projects.detail.openCode')" @click="emit('open-code')">
        <Icon name="commands" />
        {{ t('projects.detail.openCode') }}
      </button>
    </div>

    <div class="ptabs">
      <span class="ptab" :class="{ on: tab === 'overview' }" @click="setTab('overview')">
        {{ t('projects.tab.overview') }}
      </span>
      <template v-if="view.gh">
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
        @delete="emit('delete')"
        @open-llm="emit('open-llm')"
      />
    </div>
    <ProjectGh v-else :project-id="project.id" :kind="tab === 'prs' ? 'pr' : 'issue'" />
  </div>
</template>

<script setup lang="ts">
// Detail pane — header (icon / name / status / edit / save-as-template /
// install-template / open-code-workspace / Open code) + tabs (Overview / Issues
// / PR) + body. Binds the real Project entity + the derived overview view-model;
// GitHub tabs mount ProjectGh (live gh.* RPC) only when the remote is a GitHub
// repo. Edit / delete / LLM-defaults / template / open-code / open-workspace
// bubble to the page.
import { ref, watch } from 'vue'
import ProjectGh from './ProjectGh.vue'
import ProjectOverview from './ProjectOverview.vue'
import type { ProjectView } from './data'
import type { Project } from '~/types'

const props = defineProps<{ project: Project; view: ProjectView }>()
const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'open-llm'): void
  (e: 'open-code'): void
  (e: 'open-workspace'): void
  (e: 'save-template'): void
  (e: 'install-template'): void
}>()

const { t } = useI18n()

type Tab = 'overview' | 'issues' | 'prs'
const tab = ref<Tab>('overview')

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
watch(
  () => props.view.gh,
  (gh) => {
    if (!gh && tab.value !== 'overview') tab.value = 'overview'
  },
)
</script>
