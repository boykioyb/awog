<script setup lang="ts">
import { computed } from 'vue'
import { resolvePermission } from '../store'
import type { PermissionRequestPayload } from '../types'

const props = defineProps<{ req: PermissionRequestPayload }>()

const title = computed(() => props.req.displayName || props.req.toolName)

// Full tool parameters, verbatim (P1: show everything, no second confirm). Values
// are rendered as compact JSON so the user sees exactly what the tool will run.
const params = computed<{ key: string; value: string }[]>(() => {
  const input = props.req.input ?? {}
  return Object.entries(input).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }))
})
</script>

<template>
  <div class="perm">
    <div class="head">
      <span class="badge perm-badge">Cần duyệt</span>
      <span class="tool">{{ title }}</span>
    </div>

    <p v-if="req.promptSentence" class="sentence">{{ req.promptSentence }}</p>

    <div v-if="params.length" class="params">
      <div v-for="p in params" :key="p.key" class="param">
        <span class="k">{{ p.key }}</span>
        <pre class="v">{{ p.value }}</pre>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-accent" @click="resolvePermission('allow')">Cho phép</button>
      <button class="btn btn-danger" @click="resolvePermission('deny')">Từ chối</button>
    </div>
  </div>
</template>

<style scoped>
.perm {
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin: 6px 0 14px;
  background: color-mix(in srgb, var(--warn) 8%, var(--surface));
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.perm-badge {
  background: color-mix(in srgb, var(--warn) 24%, transparent);
  color: var(--warn);
}
.tool {
  font-weight: 600;
  font-family: var(--mono);
  font-size: 13px;
}
.sentence {
  margin: 0 0 8px;
  font-size: 14px;
}
.params {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.param {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.k {
  font-size: 12px;
  color: var(--text-dim);
  font-family: var(--mono);
}
.v {
  margin: 0;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions .btn {
  flex: 1;
  min-height: 44px;
}
</style>
