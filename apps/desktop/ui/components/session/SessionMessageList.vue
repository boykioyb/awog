<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
    <div v-for="msg in messages" :key="msg.id">
      <div
        v-if="msg.role === 'system'"
        class="text-center text-[10px] uppercase tracking-wider"
        :style="{ color: t.textDim }"
      >
        ── {{ msg.text }} · {{ msg.at }} ──
      </div>

      <div v-else>
        <div v-if="msg.role === 'user'" class="flex flex-col items-end gap-1.5">
          <div
            v-if="msg.text"
            class="rounded-2xl px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
            :style="{
              background: t.bgElevated,
              color: t.text,
              border: `1px solid ${t.border}`,
              maxWidth: '78%',
            }"
          >
            <template v-for="(seg, i) in tokenizeMessage(msg.text)" :key="i">
              <span
                v-if="seg.kind === 'token'"
                :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
              >
                {{ seg.text }}
              </span>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <div
            v-if="msg.attachments?.length"
            class="flex flex-wrap gap-1.5 justify-end"
            :style="{ maxWidth: '78%' }"
          >
            <template v-for="att in msg.attachments" :key="att.id">
              <button
                v-if="att.type === 'image' && att.url"
                type="button"
                class="rounded-md overflow-hidden relative group transition"
                :style="{
                  width: '160px',
                  height: '100px',
                  border: `1px solid ${t.border}`,
                  background: t.bgSubtle,
                }"
                :title="`View ${att.name}${att.size ? ` · ${att.size}` : ''}`"
                @click="emit('openAttachment', att)"
              >
                <img
                  :src="att.url"
                  :alt="att.name"
                  class="w-full h-full object-cover"
                  draggable="false"
                />
                <div
                  class="absolute inset-x-0 bottom-0 px-2 py-1 flex items-center gap-1"
                  :style="{
                    background: t.overlay,
                    backdropFilter: 'blur(4px)',
                  }"
                >
                  <span
                    class="text-[10px] font-mono truncate flex-1 text-left"
                    :style="{ color: t.onAccent }"
                  >
                    {{ att.name }}
                  </span>
                  <Maximize2 :size="10" :style="{ color: t.onAccent, flexShrink: 0 }" />
                </div>
              </button>
              <button
                v-else
                type="button"
                class="rounded-md flex items-center gap-2.5 px-3 text-left transition"
                :style="{
                  height: '44px',
                  minWidth: '180px',
                  maxWidth: '260px',
                  background: t.bgSubtle,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  cursor: att.preview ? 'pointer' : 'default',
                  opacity: att.preview ? 1 : 0.85,
                }"
                :disabled="!att.preview"
                :title="
                  att.preview
                    ? `View ${att.name}${att.size ? ` · ${att.size}` : ''}`
                    : `${att.name}${att.size ? ` · ${att.size}` : ''}`
                "
                @click="emit('openAttachment', att)"
              >
                <component
                  :is="fileIconFor(att.name).icon"
                  :size="18"
                  class="flex-shrink-0"
                  :style="{ color: fileIconFor(att.name).color }"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[12px] truncate" :style="{ color: t.text }">
                    {{ att.name }}
                  </div>
                  <div
                    class="text-[10px] truncate flex items-center gap-1.5"
                    :style="{ color: t.textFaint }"
                  >
                    <span :style="{ color: fileIconFor(att.name).color, fontWeight: 500 }">
                      {{ fileIconFor(att.name).label }}
                    </span>
                    <span v-if="att.size">· {{ att.size }}</span>
                  </div>
                </div>
              </button>
            </template>
          </div>
          <div v-if="msg.modeAtSend" class="text-[9px]" :style="{ color: t.textFaint }">
            · sent in {{ msg.modeAtSend }} mode
          </div>
        </div>

        <div v-if="msg.role === 'agent'" class="text-[13px] leading-relaxed">
          <div v-if="msg.text" class="whitespace-pre-wrap" :style="{ color: t.text }">
            <template v-for="(seg, i) in tokenizeMessage(msg.text)" :key="i">
              <span
                v-if="seg.kind === 'token'"
                :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
              >
                {{ seg.text }}
              </span>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>

          <div v-if="msg.steps?.length" :class="msg.text ? 'mt-2 space-y-1' : 'space-y-1'">
            <StepItem v-for="step in msg.steps" :key="step.id" :step="step" />
          </div>

          <div v-if="msg.artifacts?.length" class="mt-2 space-y-1.5">
            <div
              v-for="art in msg.artifacts"
              :key="art.name"
              class="rounded"
              :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
            >
              <div
                class="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]"
                :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
              >
                <FileText :size="11" :style="{ color: t.textDim }" />
                <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
              </div>
              <pre
                v-if="art.preview"
                class="text-[11px] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
                :style="{ color: t.textMuted, maxHeight: '160px' }"
                >{{ art.preview }}</pre
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-for="agentId in pendingAgentIds"
      :key="`pending-${agentId}`"
      class="flex gap-1.5 items-center"
    >
      <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
      <span class="text-[11px]" :style="{ color: t.textDim }">
        {{ agentName(agentId) }} đang phản hồi...
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, FileText, Maximize2 } from 'lucide-vue-next'
import { ref, watch, nextTick } from 'vue'
import type { SessionAttachment, SessionMessage, SessionTokenKind } from '~/types'
import { fileIconFor } from '~/utils/file-icon'
import { tokenizeMessage } from '~/utils/tokenize'

const props = defineProps<{
  messages: SessionMessage[]
  pendingAgentIds: string[]
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const workspace = useWorkspaceStore()

const scrollRef = ref<HTMLElement | null>(null)

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  },
)
</script>
