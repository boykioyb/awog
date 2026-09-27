<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Ellipsis } from 'lucide-vue-next'
import {
  activeTurnIds,
  cancelTurn,
  current,
  navPop,
  pendingLabel,
  sendMessage,
  steer,
} from '../store'
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
import FilesPanel from '../components/FilesPanel.vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import CostPanel from '../components/CostPanel.vue'
import TodoBanner from '../components/TodoBanner.vue'
import BackgroundChips from '../components/BackgroundChips.vue'
import NavBar from '../components/NavBar.vue'
import SessionMenuSheet from '../components/SessionMenuSheet.vue'
import type { AgentMode, SessionAttachment } from '../types'

type Tab = 'chat' | 'diff' | 'files' | 'term' | 'cost'
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
// composer context row, one tap from the same config sheet.
const subtitle = computed(() =>
  cur.value?.projectId ? projectName(cur.value.projectId) : '',
)

const styleLabel = (id: string): string =>
  RESPONSE_STYLES.flatMap((g) => g.rows).find((r) => r.id === id)?.label ?? id

// The desktop keeps model · account · effort · style as always-visible status
// chips; on a phone they're one scrollable strip in the composer that opens the
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

function setMode(mode: AgentMode): void {
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
    <NavBar
      :title="cur.title || 'Session'"
      :subtitle="subtitle"
      back
      @back="navPop"
      @title="menuOpen = true"
    >
      <template #trailing>
        <button
          class="navbtn"
          title="Tuỳ chọn"
          aria-label="Tuỳ chọn session"
          @click="menuOpen = true"
        >
          <Ellipsis class="icn-lg" />
        </button>
      </template>
    </NavBar>

    <div class="seg" role="tablist" aria-label="Nội dung session">
      <button
        role="tab"
        :aria-selected="tab === 'chat'"
        :class="{ on: tab === 'chat' }"
        @click="tab = 'chat'"
      >
        Chat
      </button>
      <button
        v-if="hasProject"
        role="tab"
        :aria-selected="tab === 'diff'"
        :class="{ on: tab === 'diff' }"
        @click="tab = 'diff'"
      >
        Diff
      </button>
      <button
        v-if="hasProject"
        role="tab"
        :aria-selected="tab === 'files'"
        :class="{ on: tab === 'files' }"
        @click="tab = 'files'"
      >
        Tệp
      </button>
      <button
        v-if="hasProject"
        role="tab"
        :aria-selected="tab === 'term'"
        :class="{ on: tab === 'term' }"
        @click="tab = 'term'"
      >
        Term
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'cost'"
        :class="{ on: tab === 'cost' }"
        @click="tab = 'cost'"
      >
        Cost
      </button>
    </div>

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
    <FilesPanel v-if="tab === 'files' && cur.projectId" :project-id="cur.projectId" />
    <TerminalPanel
      v-if="tab === 'term' && cur.projectId"
      :session-id="cur.id"
      :project-id="cur.projectId"
    />
    <CostPanel v-if="tab === 'cost'" :session-id="cur.id" />

    <template v-if="tab === 'chat'">
      <div v-if="pending.length" class="queued">
        <span class="qdot" />
        <span class="qtxt">{{ pendingLabel }}</span>
      </div>
      <BackgroundChips />
      <Composer
        :streaming="streaming"
        :mode="cur.mode"
        :config="configChips"
        @send="onSend"
        @steer="steer"
        @stop="cancelTurn"
        @update:mode="setMode"
        @open-menu="menuOpen = true"
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
/* iOS segmented control — replaces the pill tabs. The buttons are deliberately
   36px inside a padded track: HIG's own segmented control is ~32pt and the hit
   target is the full-width segment, not a lone 44px circle. */
.seg {
  flex: 0 0 auto;
  display: flex;
  gap: 0;
  margin: 8px 14px 8px;
  padding: 3px;
  background: var(--surface-2);
  border-radius: var(--r-btn);
}
.seg button {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: calc(var(--r-btn) - 3px);
  background: transparent;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  padding: 0 10px;
  transition:
    background 0.15s,
    color 0.15s;
}
.seg button.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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
.queued {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
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
