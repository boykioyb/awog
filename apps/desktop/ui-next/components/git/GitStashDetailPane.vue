<template>
  <div class="flex-1 overflow-auto p-6">
    <div v-if="!stash" class="py-1.5 pr-2.5 pl-7 text-sm text-muted-foreground italic">
      {{ t('git.sidebar.empty') }}
    </div>
    <div v-else class="max-w-140">
      <div class="mb-3.5 flex items-center gap-2 px-3 py-2.5">
        <Icon name="clip" class="size-4.5 text-primary" />
        <!-- mono-ok: ref stash -->
        <span class="font-mono text-primary">{{ stash.ref }}</span>
        <span class="text-dim">{{ t('git.stash.onBranch', { branch: stash.branch }) }}</span>
      </div>
      <div class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs">
        <div class="whitespace-pre-wrap text-foreground">{{ stash.m }}</div>
        <div class="mt-2 text-xs text-faint">{{ stash.w }}</div>
        <div class="mt-4 flex items-center gap-2">
          <Button size="sm" @click="emit('pop', stash.index)">
            {{ t('git.stash.pop') }}
          </Button>
          <Button variant="outline" size="sm" @click="emit('apply', stash.index)">
            {{ t('git.stash.apply') }}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="ml-auto"
            @click="emit('drop', stash.index)"
          >
            {{ t('git.stash.drop') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Stash detail pane — message + pop/apply/drop. Mirrors production GitStashDetailPane.vue.
import Button from '~/components/ui/button/Button.vue'
import type { Stash } from './git-types'

const props = defineProps<{ index: number; stashes: Stash[] }>()

const emit = defineEmits<{
  (e: 'pop', index: number): void
  (e: 'apply', index: number): void
  (e: 'drop', index: number): void
}>()

const { t } = useI18n()
const stash = computed(() => props.stashes.find((s) => s.index === props.index))
</script>
