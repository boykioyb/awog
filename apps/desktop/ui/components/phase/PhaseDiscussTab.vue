<template>
  <div>
    <div class="text-[0.79em] mb-3 leading-relaxed" :style="{ color: t.textDim }">
      Send feedback or ask questions about this phase. To apply changes, use "Rerun from here".
    </div>
    <div
      v-if="run.messages.length === 0"
      class="text-[0.79em] py-4 text-center"
      :style="{ color: t.textFaint }"
    >
      No messages yet
    </div>
    <div v-else class="space-y-2 mb-3">
      <div v-for="(msg, i) in run.messages" :key="i" class="flex gap-2">
        <RoleBadge v-if="msg.role === 'agent'" :role="agent.role" size="sm" />
        <div
          v-else
          class="w-5 h-5 rounded flex items-center justify-center text-[0.64em] font-semibold flex-shrink-0"
          :style="{ background: t.accent, color: t.accentText }"
        >
          You
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 mb-0.5">
            <span class="text-[0.71em] font-medium" :style="{ color: t.text }">
              {{ msg.role === 'agent' ? agent.name : 'You' }}
            </span>
            <span class="text-[0.71em]" :style="{ color: t.textFaint }">{{ msg.at }}</span>
          </div>
          <div class="text-[0.86em] leading-relaxed" :style="{ color: t.textMuted }">
            {{ msg.text }}
          </div>
        </div>
      </div>
    </div>
    <div class="flex items-end gap-2">
      <textarea
        v-model="chatInput"
        :rows="2"
        placeholder="Ask a question or provide feedback..."
        class="flex-1 rounded px-2 py-1.5 text-[0.79em] resize-none"
        :style="{
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          color: t.text,
          outline: 'none',
        }"
        @keydown="onKey"
      />
      <button
        :disabled="!chatInput.trim()"
        class="p-2 rounded transition disabled:opacity-40"
        :style="{ background: t.accent, color: t.accentText }"
        @click="send"
      >
        <Send :size="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Send } from 'lucide-vue-next'
import type { Run, Agent } from '~/types'

defineProps<{
  run: Run
  agent: Agent
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const { t } = useTheme()

const chatInput = ref('')

const send = () => {
  if (!chatInput.value.trim()) return
  emit('send', chatInput.value)
  chatInput.value = ''
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>
