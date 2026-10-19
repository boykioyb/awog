<template>
  <!-- verify step: connection-test banner (running / connected / failed) -->
  <div
    v-if="isVerify"
    class="flex gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
    :class="verifyClass"
  >
    <Icon
      :name="verifyIcon"
      :class="{ 'animate-spin': state === 'running' }"
      class="mt-px size-3.5 flex-none"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="font-semibold">{{ verifyTitle }}</div>
      <!-- mono-ok: output lệnh kiểm tra kết nối -->
      <pre
        v-if="stderr.length"
        class="m-0 max-h-35 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-dim"
        >{{ stderr.join('\n') }}</pre
      >
    </div>
  </div>

  <!-- ordinary tool step: zap + label -->
  <div v-else class="flex items-center gap-1.5 text-xs text-dim tabular-nums">
    <Icon name="zap" class="size-3" />
    <span>{{ step.label ?? step.id }}</span>
  </div>
</template>

<script setup lang="ts">
// One step row inside LibraryCreatorPanel. Most steps are a plain zap + label,
// but the MCP installer's auto-verify emits a step with `kind: 'verify'` that we
// render as a live connection-test banner (running → connected/failed with tool
// count or stderr). Shared by the panel's persisted + streaming step loops.
import { computed } from 'vue'
import type { CreatorStep } from '~/composables/usePromptCreator'

const props = defineProps<{ step: CreatorStep }>()

const { t } = useI18n()

const isVerify = computed(() => props.step.kind === 'verify')
const state = computed<'running' | 'done'>(() =>
  props.step.state === 'running' ? 'running' : 'done',
)
const ok = computed(() => props.step.ok === true)
const toolCount = computed(() =>
  typeof props.step.toolCount === 'number' ? props.step.toolCount : 0,
)
const resourceCount = computed(() =>
  typeof props.step.resourceCount === 'number' ? props.step.resourceCount : 0,
)
const error = computed(() => (typeof props.step.error === 'string' ? props.step.error : ''))
const stderr = computed<string[]>(() =>
  Array.isArray(props.step.stderr)
    ? props.step.stderr.filter((l): l is string => typeof l === 'string')
    : error.value
      ? [error.value]
      : [],
)

const verifyClass = computed(() => {
  if (state.value === 'running') return 'border-border text-muted-foreground'
  return ok.value ? 'border-selected-border text-primary' : 'border-destructive/40 text-destructive'
})
const verifyIcon = computed(() => {
  if (state.value === 'running') return 'refresh'
  return ok.value ? 'check' : 'alert'
})
const verifyTitle = computed(() => {
  if (state.value === 'running') return t('library.creator.verify.running')
  if (ok.value)
    return t('library.creator.verify.ok', {
      tools: toolCount.value,
      resources: resourceCount.value,
    })
  return t('library.creator.verify.fail')
})
</script>
