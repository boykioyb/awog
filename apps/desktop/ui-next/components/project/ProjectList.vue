<template>
  <div class="list" style="flex: 0 0 240px">
    <div class="ltop">
      <div class="srch">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input v-model="query" :placeholder="t('projects.list.search')" />
      </div>
      <button
        class="iconbtn"
        :title="t('projects.list.new')"
        style="width: 32px; height: 32px"
        @click="emit('new')"
      >
        <Icon name="plus" />
      </button>
    </div>
    <div class="lscroll">
      <div
        v-for="p in visible"
        :key="p.id"
        class="libli"
        :class="{ on: p.id === selectedId }"
        @click="emit('select', p.id)"
      >
        <div class="lrow">
          <span class="ttl">{{ p.name }}</span>
          <span class="tag" style="padding: 1px 6px">
            {{ p.language || t('projects.list.noLang') }}
          </span>
        </div>
        <div class="sub">
          <span class="mono" style="color: var(--textDim)">{{ p.path }}</span>
        </div>
      </div>
      <div v-if="!filtered.length" class="empty" style="padding: 28px">
        <div class="et">{{ query ? t('projects.list.noMatch') : t('projects.list.none') }}</div>
      </div>

      <LoadMoreSentinel v-if="hasMore" auto :remaining="remaining" @load="loadMore()" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Left master list — searchable project rows (status-less; the language tag +
// mono path). Binds the real Project entities; selection emits the project id.
import { computed, ref, watch } from 'vue'
import type { Project } from '~/types'

const props = defineProps<{ projects: Project[]; selectedId: string | null }>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'new'): void }>()

const { t } = useI18n()

const query = ref('')
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.projects
  return props.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  )
})

// Incremental render window — keeps the DOM small when many projects are linked.
const { visible, hasMore, remaining, loadMore, reset } = useLoadMore(() => filtered.value)
watch(query, () => reset())
</script>
