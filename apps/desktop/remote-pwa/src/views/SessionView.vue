<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { closeSession, current, sendMessage } from '../store'
import MessageItem from '../components/MessageItem.vue'
import PermissionCard from '../components/PermissionCard.vue'
import Composer from '../components/Composer.vue'
import DiffPanel from '../components/DiffPanel.vue'
import CostPanel from '../components/CostPanel.vue'

type Tab = 'chat' | 'diff' | 'cost'
const tab = ref<Tab>('chat')

const cur = computed(() => current.value)
const hasProject = computed(() => !!cur.value?.projectId)
const scroller = ref<HTMLElement | null>(null)

// Auto-scroll to the newest content while streaming (only when the Chat tab is up).
watch(
  () => {
    const c = cur.value
    if (!c) return 0
    const last = c.messages[c.messages.length - 1]
    const lastBlock = last?.blocks[last.blocks.length - 1]
    const tail = lastBlock && lastBlock.kind === 'text' ? lastBlock.text.length : 0
    return c.messages.length * 1e6 + tail + (c.permission ? 1 : 0)
  },
  () => {
    if (tab.value !== 'chat') return
    void nextTick(() => {
      const el = scroller.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)
</script>

<template>
  <div v-if="cur" class="session">
    <header class="head">
      <button class="back" title="Quay lại" @click="closeSession">‹</button>
      <span class="title">{{ cur.title || 'Session' }}</span>
    </header>

    <nav class="tabs">
      <button :class="{ on: tab === 'chat' }" @click="tab = 'chat'">Chat</button>
      <button v-if="hasProject" :class="{ on: tab === 'diff' }" @click="tab = 'diff'">Diff</button>
      <button :class="{ on: tab === 'cost' }" @click="tab = 'cost'">Cost</button>
    </nav>

    <div v-show="tab === 'chat'" ref="scroller" class="body">
      <div v-if="cur.loading" class="state"><span class="spin" /> Đang tải transcript…</div>
      <div v-else-if="cur.error" class="state danger">{{ cur.error }}</div>
      <template v-else>
        <MessageItem v-for="m in cur.messages" :key="m.id" :message="m" />
        <PermissionCard v-if="cur.permission" :req="cur.permission" />
      </template>
    </div>

    <DiffPanel v-if="tab === 'diff' && cur.projectId" :project-id="cur.projectId" />
    <CostPanel v-if="tab === 'cost'" :session-id="cur.id" />

    <Composer v-if="tab === 'chat'" @send="sendMessage" />
  </div>
</template>

<style scoped>
.session {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.back {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 26px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 13px;
  font-weight: 500;
}
.tabs button.on {
  color: var(--accent);
  border-color: var(--accent);
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px 20px;
  -webkit-overflow-scrolling: touch;
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
</style>
