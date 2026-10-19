<template>
  <!-- hook-ok: `.list` — app-shell.css `.app.compact .list` biến cột thành drawer -->
  <div class="list flex flex-none basis-60 flex-col overflow-hidden border-r bg-sidebar">
    <div class="flex items-center gap-2 border-b p-3">
      <div class="relative flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input v-model="query" class="pl-9" :placeholder="t('projects.list.search')" />
      </div>
      <Button
        :title="t('projects.list.new')"
        :aria-label="t('projects.list.new')"
        variant="outline"
        size="iconMd"
        @click="emit('new')"
      >
        <Icon name="plus" />
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto px-3 py-2">
      <div
        v-for="p in visible"
        :key="p.id"
        class="mb-0.5 cursor-pointer rounded-md border px-3 py-2"
        :class="
          p.id === selectedId
            ? 'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--primary)]'
            : 'border-transparent hover:bg-accent'
        "
        @click="emit('select', p.id)"
      >
        <div class="flex items-center gap-2">
          <span
            class="min-w-0 flex-1 truncate text-base"
            :class="p.id === selectedId ? 'font-semibold text-foreground' : 'font-medium'"
          >
            {{ p.name }}
          </span>
          <Badge variant="outline" class="px-1.5 py-0 text-muted-foreground">
            {{ p.language || t('projects.list.noLang') }}
          </Badge>
        </div>
        <div class="mt-1 truncate text-xs text-dim">
          <!-- mono-ok: đường dẫn project -->
          <span class="font-mono">{{ p.path }}</span>
        </div>
      </div>
      <div v-if="!filtered.length" class="flex flex-col items-center p-7 text-center">
        <div class="text-lg text-muted-foreground">
          {{ query ? t('projects.list.noMatch') : t('projects.list.none') }}
        </div>
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
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
