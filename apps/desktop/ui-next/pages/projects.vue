<template>
  <section class="page on" data-page="projects">
    <div class="md libwrap">
      <ProjectList :projects="PDATA" :selected="selected" @select="selected = $event" />
      <ProjectDetail v-if="current" :project="current" />
      <div v-else class="detail">
        <div class="empty">
          <div class="et">{{ t('projects.empty') }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PDATA } from '~/components/project/data'

// Projects — visual port of awog-prototype.html (data-page="projects", renderProj
// ~2283). Master-detail: ProjectList (left) + ProjectDetail (right). Static mock
// data from PDATA; select via local ref. Code-viewer / edit / new-project / delete
// overlays are deferred.
const { t } = useI18n()

const selected = ref<string | null>(PDATA[0]?.name ?? null)
const current = computed(() => PDATA.find((p) => p.name === selected.value) ?? null)
</script>
