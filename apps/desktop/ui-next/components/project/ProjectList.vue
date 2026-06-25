<template>
  <div class="list" style="flex: 0 0 240px">
    <div class="ltop">
      <div class="srch">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input v-model="query" :placeholder="t('projects.list.search')" />
      </div>
      <button class="iconbtn" :title="t('projects.list.new')" style="width: 32px; height: 32px">
        <Icon name="plus" />
      </button>
    </div>
    <div class="lscroll">
      <div
        v-for="p in filtered"
        :key="p.name"
        class="libli"
        :class="{ on: p.name === selected }"
        @click="emit('select', p.name)"
      >
        <div class="lrow">
          <span
            class="sdot"
            :class="{ pulse: p.status === 'active' }"
            :style="{ background: p.status === 'active' ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ p.name }}</span>
          <span class="tag" style="padding: 1px 6px">
            {{ t('projects.list.repoCount', { n: p.repos.length }) }}
          </span>
        </div>
        <div class="sub">
          <span class="mono" style="font-size: 0.8462rem; color: var(--textDim)">{{ p.path }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from './data'

// Left master list — faithful port of renderProj()'s list block (~2284): searchable
// project rows with a status dot, repo-count tag and mono path. Visual only.
const props = defineProps<{ projects: Project[]; selected: string | null }>()
const emit = defineEmits<{ (e: 'select', name: string): void }>()

const { t } = useI18n()

const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.projects
  return props.projects.filter((p) => p.name.toLowerCase().includes(q))
})
</script>
