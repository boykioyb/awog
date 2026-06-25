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
      <span class="tag" :class="{ acc: project.status === 'active' }">
        {{ t(`projects.status.${project.status}`) }}
      </span>
      <button class="iconbtn" style="width: 28px; height: 28px" :title="t('projects.detail.edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button class="btn pri sm">
        <Icon name="commands" />
        {{ t('projects.detail.openCode') }}
      </button>
    </div>

    <div class="ptabs">
      <span class="ptab" :class="{ on: tab === 'overview' }" @click="setTab('overview')">
        {{ t('projects.tab.overview') }}
      </span>
      <template v-if="project.gh">
        <span class="ptab" :class="{ on: tab === 'issues' }" @click="setTab('issues')">
          {{ t('projects.tab.issues') }}
          <span class="ptn">{{ project.issues.length }}</span>
        </span>
        <span class="ptab" :class="{ on: tab === 'prs' }" @click="setTab('prs')">
          {{ t('projects.tab.prs') }}
          <span class="ptn">{{ project.prs.length }}</span>
        </span>
      </template>
      <span v-else class="fd" style="padding: 8px 12px">
        {{ t('projects.tab.notGithub') }}
      </span>
    </div>

    <div class="projmain">
      <ProjectOverview v-if="tab === 'overview'" :project="project" />
      <ProjectIssues
        v-else
        :project="project"
        :kind="tab === 'prs' ? 'pr' : 'issue'"
        @open="openItem"
      />
      <ProjectGhDrawer
        v-if="openItemData && tab !== 'overview'"
        :project="project"
        :item="openItemData"
        :kind="tab === 'prs' ? 'pr' : 'issue'"
        :width="drawerWidth"
        @close="itemId = null"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Project } from './data'

// Detail pane — port of renderProj()'s detail block (~2285–2290): header (icon /
// name / status tag / edit / Open code) + tabs (Overview / Issues / PR) + body,
// with the right-docked gh drawer when an issue/PR is opened. Edit / Open code /
// delete overlays are deferred.
const props = defineProps<{ project: Project }>()

const { t } = useI18n()

type Tab = 'overview' | 'issues' | 'prs'
const tab = ref<Tab>('overview')
const itemId = ref<number | null>(null)
const drawerWidth = 400

function setTab(next: Tab) {
  tab.value = next
  itemId.value = null
}

function openItem(n: number) {
  itemId.value = n
}

const openItemData = computed(() => {
  if (itemId.value === null) return null
  const pool = tab.value === 'prs' ? props.project.prs : props.project.issues
  return pool.find((x) => x.n === itemId.value) ?? null
})

// Reset tab + open item when the selected project changes (matches the prototype
// resetting PROJ.tab='overview' / PROJ.item=null on data-projsel).
watch(
  () => props.project.name,
  () => {
    tab.value = 'overview'
    itemId.value = null
  },
)
</script>
