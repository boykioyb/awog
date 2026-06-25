<template>
  <div class="gcommitpanel">
    <div class="gcph">
      <span class="gcplbl">{{ t('git.commit.header') }}</span>
      <span style="flex: 1" />
      <button class="gcpgen" :disabled="!stagedCount" @click="emit('generate')">
        <span aria-hidden="true">✨</span>
        {{ t('git.commit.generate') }}
      </button>
      <span class="gcpcount">{{ t('git.commit.filesStaged', { n: stagedCount }) }}</span>
    </div>
    <div class="gcpbody">
      <textarea
        class="ci gcpta"
        :value="msg"
        :placeholder="t('git.changes.commitPlaceholder')"
        @input="emit('update-msg', ($event.target as HTMLTextAreaElement).value)"
        @keydown.meta.enter="emit('commit')"
      />
    </div>
    <div class="gcpfoot">
      <button
        class="btn pri gcpcommit"
        :disabled="!stagedCount"
        :style="stagedCount ? undefined : 'opacity:.45;pointer-events:none'"
        @click="emit('commit')"
      >
        <Icon name="check" style="width: 14px; height: 14px" />
        {{
          stagedCount ? t('git.changes.commitCount', { n: stagedCount }) : t('git.changes.commit')
        }}
      </button>
      <button class="btn" :disabled="!commitsCount" @click="emit('amend')">
        {{ t('git.commit.amend') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Commit panel — lives in the detail pane below the diff (production layout).
// COMMIT MESSAGE header + Generate (AI) + "N files staged" + textarea + Commit/Amend.
defineProps<{
  msg: string
  stagedCount: number
  commitsCount: number
}>()

const emit = defineEmits<{
  (e: 'update-msg', value: string): void
  (e: 'commit'): void
  (e: 'amend'): void
  (e: 'generate'): void
}>()

const { t } = useI18n()
</script>
