<template>
  <!-- verify step: connection-test banner (running / connected / failed) -->
  <div v-if="isVerify" class="lcp-verify" :class="verifyClass">
    <Icon :name="verifyIcon" :class="{ spin: state === 'running' }" class="lcp-verify-ic" />
    <div class="lcp-verify-body">
      <div class="lcp-verify-title">{{ verifyTitle }}</div>
      <pre v-if="stderr.length" class="lcp-verify-pre">{{ stderr.join('\n') }}</pre>
    </div>
  </div>

  <!-- ordinary tool step: zap + label -->
  <div v-else class="lcp-step">
    <Icon name="zap" style="width: 11px; height: 11px" />
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
  if (state.value === 'running') return 'run'
  return ok.value ? 'ok' : 'err'
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

<style scoped>
.lcp-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  color: var(--textDim);
}
.lcp-verify {
  display: flex;
  gap: 9px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.lcp-verify.ok {
  border-color: var(--accentBorder);
  color: var(--accent);
}
.lcp-verify.err {
  border-color: var(--dangerBorder);
  color: var(--danger);
}
.lcp-verify-ic {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  margin-top: 1px;
}
.lcp-verify-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lcp-verify-title {
  font-weight: 600;
}
.lcp-verify-pre {
  margin: 0;
  max-height: 140px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  /* mono-ok: verification command output */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.spin {
  animation: lcp-row-spin 0.9s linear infinite;
}
@keyframes lcp-row-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
