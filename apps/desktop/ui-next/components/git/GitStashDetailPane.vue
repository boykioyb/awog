<template>
  <div class="gdetailpane">
    <div v-if="!stash" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
    <div v-else style="max-width: 560px">
      <div class="gdph">
        <Icon name="clip" class="size-[18px] text-primary" />
        <span class="mono text-primary">{{ stash.ref }}</span>
        <span class="text-dim">{{ t('git.stash.onBranch', { branch: stash.branch }) }}</span>
      </div>
      <div class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm">
        <div class="whitespace-pre-wrap text-foreground">{{ stash.m }}</div>
        <div class="mt-2 text-xs text-faint">{{ stash.w }}</div>
        <div class="gdpactions">
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
