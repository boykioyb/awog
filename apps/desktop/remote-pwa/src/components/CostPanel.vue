<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { gateway } from '../gateway'
import { turnDoneSignal } from '../store'
import { errMsg, formatCost, formatTokens } from '../util'
import type { SessionCostBreakdown } from '../types'

const props = defineProps<{ sessionId: string }>()

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<SessionCostBreakdown | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await gateway.request<SessionCostBreakdown>('sessions.costBreakdown', {
      sessionId: props.sessionId,
    })
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => turnDoneSignal.value, load)
watch(() => props.sessionId, load)
</script>

<template>
  <div class="cost">
    <div v-if="error" class="state danger">{{ error }}</div>
    <div v-else-if="loading && !data" class="state"><span class="spin" /> Đang tải…</div>
    <template v-else-if="data">
      <div class="totals">
        <div class="stat">
          <span class="v accent">{{ formatCost(data.total.costUsd) }}</span>
          <span class="k muted">Tổng chi phí</span>
        </div>
        <div class="stat">
          <span class="v">{{ formatTokens(data.total.totalTokens) }}</span>
          <span class="k muted">Tokens</span>
        </div>
        <div class="stat">
          <span class="v">{{ data.total.turns }}</span>
          <span class="k muted">Lượt</span>
        </div>
      </div>

      <p v-if="data.hasUnpriced" class="warn">
        Một số lượt không có bảng giá — tổng có thể thấp hơn thực tế.
      </p>

      <ul v-if="data.byDay.length" class="days">
        <li v-for="d in data.byDay" :key="d.date" class="day">
          <span class="date">{{ d.date }}</span>
          <span class="tok muted">{{ formatTokens(d.totalTokens) }}</span>
          <span class="amt">{{ formatCost(d.costUsd) }}</span>
        </li>
      </ul>
      <div v-else class="state muted">Chưa có chi phí.</div>
    </template>
  </div>
</template>

<style scoped>
.cost {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px 24px;
}
.state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 40px 0;
  color: var(--text-dim);
}
.state.danger {
  color: var(--danger);
}
.totals {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.stat {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 10px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat .v {
  font-size: 20px;
  font-weight: 700;
}
.stat .v.accent {
  color: var(--accent);
}
.stat .k {
  font-size: 12px;
}
.warn {
  font-size: 13px;
  color: var(--warn);
  margin: 0 0 12px;
}
.days {
  list-style: none;
  margin: 0;
  padding: 0;
}
.day {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
}
.date {
  flex: 1;
  font-family: var(--mono);
  font-size: 13px;
}
.tok {
  font-family: var(--mono);
  font-size: 12px;
}
.amt {
  font-weight: 600;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 13px;
}
</style>
