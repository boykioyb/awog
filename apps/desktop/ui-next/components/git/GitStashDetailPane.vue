<template>
  <div class="gdetailpane">
    <div v-if="!stash" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
    <div v-else style="max-width: 560px">
      <div class="gdph">
        <Icon name="clip" style="width: 18px; height: 18px; color: var(--accent)" />
        <span class="mono" style="color: var(--accent)">{{ stash.ref }}</span>
        <span style="color: var(--textDim)">
          {{ t('git.stash.onBranch', { branch: stash.branch }) }}
        </span>
      </div>
      <div class="gcard">
        <div style="white-space: pre-wrap; color: var(--text)">{{ stash.m }}</div>
        <div style="margin-top: 8px; color: var(--textFaint); font-size: 0.8462rem">
          {{ stash.w }}
        </div>
        <div class="gdpactions">
          <button class="btn pri sm" @click="emit('pop', stash.index)">
            {{ t('git.stash.pop') }}
          </button>
          <button class="btn sm" @click="emit('apply', stash.index)">
            {{ t('git.stash.apply') }}
          </button>
          <button
            class="btn sm gdanger"
            style="margin-left: auto"
            @click="emit('drop', stash.index)"
          >
            {{ t('git.stash.drop') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Stash detail pane — message + pop/apply/drop. Mirrors production GitStashDetailPane.vue.
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
