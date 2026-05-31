<template>
  <div
    v-if="pending"
    class="rounded-md text-[1em]"
    :style="{
      background: t.warningBg,
      border: `1px solid ${t.warningBorder}`,
    }"
    @keydown.escape.stop="onDeny"
  >
    <div
      class="px-3 py-2 flex items-center gap-2"
      :style="{ borderBottom: `1px solid ${t.warningBorder}` }"
    >
      <ShieldQuestion :size="13" :style="{ color: t.warning }" />
      <div class="font-semibold" :style="{ color: t.text }">Permission required</div>
      <div
        class="ml-auto inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[1em]"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
      >
        {{ pending.toolName }}
      </div>
    </div>

    <div class="px-3 py-2.5 space-y-2">
      <div class="leading-relaxed" :style="{ color: t.text }">
        {{ promptSentence }}
      </div>

      <div
        v-if="pending.blockedPath"
        class="text-[1em] flex items-center gap-1.5 px-2 py-1.5 rounded"
        :style="{
          background: t.warningBg,
          color: t.warning,
          border: `1px solid ${t.warningBorder}`,
        }"
      >
        <FolderX :size="11" />
        <span class="font-mono truncate">{{ pending.blockedPath }}</span>
      </div>

      <div
        v-if="primaryTarget"
        class="text-[1em] flex items-center gap-1.5 px-2 py-1.5 rounded font-mono"
        :style="{ background: t.bgSubtle, color: t.text, border: `1px solid ${t.border}` }"
      >
        <component :is="targetIcon" :size="11" :style="{ color: t.textDim }" />
        <span class="truncate">{{ primaryTarget }}</span>
      </div>

      <details
        v-if="hasMoreInput"
        class="text-[1em] rounded"
        :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
      >
        <summary
          class="px-2 py-1 cursor-pointer flex items-center gap-1.5 select-none"
          :style="{ color: t.textDim }"
        >
          <ChevronRight :size="10" />
          Tool input
        </summary>
        <pre
          class="px-2 py-1.5 font-mono leading-relaxed whitespace-pre-wrap break-all"
          :style="{ color: t.textMuted, maxHeight: '160px', overflowY: 'auto' }"
          >{{ formattedInput }}</pre
        >
      </details>

      <div v-if="pending.decisionReason" class="text-[1em]" :style="{ color: t.textFaint }">
        {{ pending.decisionReason }}
      </div>
    </div>

    <div
      class="px-3 py-2 flex items-center justify-end gap-1.5"
      :style="{ borderTop: `1px solid ${t.warningBorder}` }"
    >
      <button
        type="button"
        class="px-2.5 py-1 rounded transition"
        :style="{
          background: 'transparent',
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="onDeny"
      >
        Deny (Esc)
      </button>
      <button
        v-if="pending.hasSuggestions"
        type="button"
        class="px-2.5 py-1 rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.borderStrong}`,
        }"
        @click="onAlwaysAllow"
      >
        Always allow
      </button>
      <button
        type="button"
        class="px-2.5 py-1 rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="onAllow"
      >
        Allow
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, FileText, FolderX, Search, ShieldQuestion, Terminal } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  messageId: string
}>()

const { t } = useTheme()
const store = useSessionsStore()

// Show only when the open permission request belongs to THIS message bubble.
// SessionMessageList renders one instance per agent message and lets v-if pick
// the active one — cheaper than mounting a global dialog and tracking position.
const pending = computed(() => {
  const p = store.pendingPermission
  if (!p) return null
  return p.messageId === props.messageId ? p : null
})

const promptSentence = computed(() => {
  if (pending.value?.promptSentence) return pending.value.promptSentence
  if (pending.value?.displayName) return `Allow ${pending.value.displayName}?`
  if (pending.value?.toolName) return `Allow ${pending.value.toolName}?`
  return 'Allow this tool action?'
})

const primaryTarget = computed<string | null>(() => {
  const input = pending.value?.input
  if (!input) return null
  const cmd = input.command
  if (typeof cmd === 'string' && cmd.length > 0) return cmd
  const fp = input.file_path
  if (typeof fp === 'string' && fp.length > 0) return fp
  const { path } = input
  if (typeof path === 'string' && path.length > 0) return path
  const { pattern } = input
  if (typeof pattern === 'string' && pattern.length > 0) return pattern
  const { url } = input
  if (typeof url === 'string' && url.length > 0) return url
  const { query } = input
  if (typeof query === 'string' && query.length > 0) return query
  return null
})

const targetIcon = computed(() => {
  const name = pending.value?.toolName
  if (name === 'Bash') return Terminal
  if (name === 'Glob' || name === 'Grep' || name === 'WebSearch') return Search
  return FileText
})

const hasMoreInput = computed(() => {
  const input = pending.value?.input
  if (!input) return false
  const keys = Object.keys(input)
  if (keys.length === 0) return false
  if (keys.length === 1) return false
  return true
})

const formattedInput = computed(() => {
  const input = pending.value?.input
  if (!input) return ''
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
})

const onAllow = () => {
  store.resolvePermission('allow').catch(() => {})
}
const onAlwaysAllow = () => {
  store.resolvePermission('allow', { alwaysAllow: true }).catch(() => {})
}
const onDeny = () => {
  store.resolvePermission('deny').catch(() => {})
}

// Global ESC: only the active card (whose `pending` is non-null) should react.
const onGlobalKey = (e: KeyboardEvent) => {
  if (!pending.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onDeny()
  }
}
onMounted(() => document.addEventListener('keydown', onGlobalKey))
onUnmounted(() => document.removeEventListener('keydown', onGlobalKey))
</script>
