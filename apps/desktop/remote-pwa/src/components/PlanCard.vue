<script setup lang="ts">
import { computed } from 'vue'
import { approvePlan, rejectPlan } from '../store'
import type { SessionStep } from '../types'

const props = defineProps<{ step: SessionStep }>()

const pending = computed(() => (props.step.planStatus ?? 'pending') === 'pending')
const body = computed(() => props.step.planMarkdown || (props.step.planItems ?? []).join('\n'))
</script>

<template>
  <div class="plan" :class="{ resolved: !pending }">
    <div class="head">
      <span class="badge plan-badge">Kế hoạch</span>
      <span v-if="step.planStatus === 'approved'" class="tag ok">Đã duyệt</span>
      <span v-else-if="step.planStatus === 'rejected'" class="tag no">Đã từ chối</span>
    </div>

    <div v-if="body" class="body">{{ body }}</div>
    <p v-if="step.planRationale" class="rationale muted">{{ step.planRationale }}</p>

    <div v-if="pending" class="actions">
      <button class="btn btn-accent" @click="approvePlan(step)">Duyệt &amp; chạy</button>
      <button class="btn" @click="rejectPlan(step)">Từ chối</button>
    </div>
  </div>
</template>

<style scoped>
.plan {
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin: 6px 0 12px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}
.plan.resolved {
  border-color: var(--border);
  background: var(--surface);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.plan-badge {
  background: color-mix(in srgb, var(--accent) 24%, transparent);
  color: var(--accent);
}
.tag {
  font-size: 12px;
  font-weight: 600;
}
.tag.ok {
  color: var(--accent);
}
.tag.no {
  color: var(--text-dim);
}
.body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  margin-bottom: 8px;
}
.rationale {
  font-size: 13px;
  margin: 0 0 8px;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions .btn {
  flex: 1;
  min-height: 42px;
}
</style>
