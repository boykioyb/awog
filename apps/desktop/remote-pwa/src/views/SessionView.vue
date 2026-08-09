<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { activeTurnIds, cancelTurn, closeSession, current, sendMessage, steer } from '../store'
import { keyboardInset } from '../viewport'
import {
  RESPONSE_STYLES,
  THINKING_LABELS,
  accountLabel,
  modelName,
  projectName,
} from '../catalog'
import MessageItem from '../components/MessageItem.vue'
import PermissionCard from '../components/PermissionCard.vue'
import Composer from '../components/Composer.vue'
import DiffPanel from '../components/DiffPanel.vue'
import CostPanel from '../components/CostPanel.vue'
import TodoBanner from '../components/TodoBanner.vue'
import BackgroundChips from '../components/BackgroundChips.vue'
import SessionMenuSheet from '../components/SessionMenuSheet.vue'
import type { ComposerMode } from '../store'
import type { SessionAttachment } from '../types'

type Tab = 'chat' | 'diff' | 'cost'
const tab = ref<Tab>('chat')
const menuOpen = ref(false)

const cur = computed(() => current.value)
const hasProject = computed(() => !!cur.value?.projectId)
// A turn counts as running when we're streaming it OR the engine reports one in
// flight (we may have reconnected mid-turn, before any chunk arrived).
const streaming = computed(
  () => !!cur.value && (!!cur.value.streamingId || activeTurnIds.value.has(cur.value.id)),
)
const pending = computed(() => cur.value?.pending ?? [])
// Header subtitle: where it runs. The model/account/effort/style live in the
// config bar below, where they are one tap from being changed.
const subtitle = computed(() =>
  cur.value?.projectId ? projectName(cur.value.projectId) : '',
)

const styleLabel = (id: string): string =>
  RESPONSE_STYLES.flatMap((g) => g.rows).find((r) => r.id === id)?.label ?? id

// The desktop keeps model · account · effort · style as always-visible status
// chips; on a phone they'd never fit, so this is one summary row that opens the
// same config sheet.
const configChips = computed<string[]>(() => {
  const s = cur.value?.settings
  if (!s) return []
  return [
    modelName(s.modelId),
    accountLabel(s.provider, s.accountId),
    THINKING_LABELS[s.level] ?? s.level,
    styleLabel(s.responseStyle || 'Default'),
  ]
})
const scroller = ref<HTMLElement | null>(null)

function setMode(mode: ComposerMode): void {
  if (cur.value) cur.value.mode = mode
}

function onSend(text: string, attachments: SessionAttachment[]): void {
  sendMessage(text, attachments)
}

function scrollToEnd(): void {
  void nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// The keyboard shrinks the transcript from the bottom — follow it down so the
// newest message doesn't slide out of view as the composer rises.
watch(keyboardInset, () => {
  if (tab.value === 'chat') scrollToEnd()
})

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
    if (tab.value === 'chat') scrollToEnd()
  },
)
</script>

<template>
  <div v-if="cur" class="session">
    <header class="head">
      <button class="back" title="Quay lại" @click="closeSession">‹</button>
      <button class="titlebox" @click="menuOpen = true">
        <span class="title">{{ cur.title || 'Session' }}</span>
        <span v-if="subtitle" class="sub muted">{{ subtitle }}</span>
      </button>
      <button class="menu" title="Tuỳ chọn" @click="menuOpen = true">⋯</button>
    </header>

    <nav class="tabs">
      <button :class="{ on: tab === 'chat' }" @click="tab = 'chat'">Chat</button>
      <button v-if="hasProject" :class="{ on: tab === 'diff' }" @click="tab = 'diff'">Diff</button>
      <button :class="{ on: tab === 'cost' }" @click="tab = 'cost'">Cost</button>
    </nav>

    <TodoBanner v-if="tab === 'chat'" />

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

    <template v-if="tab === 'chat'">
      <button v-if="configChips.length" class="cfgbar" @click="menuOpen = true">
        <span v-for="(c, i) in configChips" :key="i" class="cfg">{{ c }}</span>
        <span class="cfg-edit">Đổi</span>
      </button>

      <div v-if="pending.length" class="queued">
        <span class="qdot" />
        <span class="qtxt">{{ pending.length }} tin nhắn đang chờ lượt hiện tại</span>
      </div>
      <BackgroundChips />
      <Composer
        :streaming="streaming"
        :mode="cur.mode"
        @send="onSend"
        @steer="steer"
        @stop="cancelTurn"
        @update:mode="setMode"
      />
    </template>

    <SessionMenuSheet :open="menuOpen" @close="menuOpen = false" />
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
  gap: 4px;
  /* Fixed rows in a flex column must not absorb the transcript's overflow. */
  flex: 0 0 auto;
  padding: 6px 8px;
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
.titlebox {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 4px 2px;
  text-align: left;
}
.title {
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 20px;
}
.tabs {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
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
.cfgbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  width: 100%;
  padding: 7px 12px;
  border: none;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  text-align: left;
}
.cfgbar:active {
  background: var(--surface);
}
.cfg {
  flex: 0 0 auto;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}
.cfg-edit {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
}
.queued {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--warn);
}
.qdot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
  flex-shrink: 0;
}
.qtxt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
