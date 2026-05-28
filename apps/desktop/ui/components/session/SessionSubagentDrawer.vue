<template>
  <Teleport to="body">
    <Transition name="drawer-slide">
      <div
        v-if="step"
        class="fixed inset-y-0 right-0 z-40 flex"
        :style="{ width: 'min(520px, 90vw)' }"
      >
        <div
          class="flex-1 flex flex-col shadow-2xl"
          :style="{ background: t.bgElevated, borderLeft: `1px solid ${t.border}` }"
          role="dialog"
          aria-modal="true"
        >
          <div
            class="px-4 py-3 flex items-center gap-2"
            :style="{ borderBottom: `1px solid ${t.border}` }"
          >
            <button
              type="button"
              class="p-1 rounded transition flex items-center"
              :style="{ color: t.textDim }"
              aria-label="Close"
              @click="onClose"
            >
              <ChevronRight :size="14" />
            </button>
            <div class="flex-1 min-w-0">
              <div class="text-[13px] font-semibold truncate" :style="{ color: t.text }">
                {{ step.label }}
              </div>
              <div v-if="step.target" class="text-[11px] truncate" :style="{ color: t.textDim }">
                {{ step.target }}
              </div>
            </div>
            <component
              :is="statusIcon"
              :size="14"
              :class="step.status === 'running' ? 'animate-pulse' : ''"
              :style="{ color: statusColor }"
            />
          </div>

          <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            <div v-if="promptText" class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider" :style="{ color: t.textDim }">
                Prompt
              </div>
              <details
                class="rounded text-[12px]"
                :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
              >
                <summary
                  class="px-2.5 py-1.5 cursor-pointer flex items-center gap-1.5 select-none"
                  :style="{ color: t.textDim }"
                >
                  <ChevronDown :size="11" />
                  {{ promptSnippet }}
                </summary>
                <pre
                  class="px-2.5 py-2 whitespace-pre-wrap break-words leading-relaxed"
                  :style="{ color: t.textMuted, maxHeight: '40vh', overflowY: 'auto' }"
                  >{{ promptText }}</pre
                >
              </details>
            </div>

            <div v-if="replyText" class="space-y-1">
              <div class="text-[10px] uppercase tracking-wider" :style="{ color: t.textDim }">
                Reply
              </div>
              <!-- eslint-disable vue/no-v-html — renderedReply qua renderMarkdown (marked html:false, escape HTML thô) -->
              <div
                class="awog-md text-[13px] rounded px-3 py-2.5"
                :style="{
                  color: t.text,
                  background: t.bgSubtle,
                  border: `1px solid ${t.border}`,
                  '--awog-accent': t.accent,
                }"
                v-html="renderedReply"
              />
              <!-- eslint-enable vue/no-v-html -->
            </div>

            <div
              v-else-if="step.status === 'running'"
              class="text-[11px] flex items-center gap-1.5"
              :style="{ color: t.textDim }"
            >
              <Activity :size="11" class="animate-pulse" />
              <span>Subagent running…</span>
            </div>

            <div
              v-if="!promptText && !replyText && step.status !== 'running'"
              class="text-[11px]"
              :style="{ color: t.textFaint }"
            >
              No payload captured for this step.
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-vue-next'
import { computed, onMounted, onUnmounted } from 'vue'
import { renderMarkdown } from '~/utils/markdown'

const { t } = useTheme()
const store = useSessionsStore()

// Pull the live step out of the store — when the underlying message's step
// transitions running → done, this re-evaluates and the reply panel populates.
const step = computed(() => store.activeSubagentStep)

const promptText = computed<string>(() => {
  // step.detail captures prompt while running. After tool_result it's replaced
  // with the reply — so promptText is only available mid-run for now. Acceptable
  // tradeoff: the drawer's main value at completion is the reply.
  const s = step.value
  if (!s || s.status === 'done' || s.status === 'error') return ''
  if (s.detail?.kind === 'text') return s.detail.content ?? ''
  return ''
})

const replyText = computed<string>(() => {
  const s = step.value
  if (!s) return ''
  if (s.status !== 'done' && s.status !== 'error') return ''
  if (s.detail?.kind === 'text') return s.detail.content ?? ''
  return ''
})

const promptSnippet = computed(() => {
  const txt = promptText.value
  if (!txt) return 'Prompt'
  const oneLine = txt.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine
})

const renderedReply = computed(() => renderMarkdown(replyText.value))

const statusIcon = computed(() => {
  if (step.value?.status === 'error') return AlertCircle
  if (step.value?.status === 'done') return CheckCircle2
  return Loader2
})

const statusColor = computed(() => {
  if (step.value?.status === 'error') return t.value.danger
  if (step.value?.status === 'done') return t.value.success
  return t.value.textDim
})

const onClose = () => store.closeSubagentDrawer()

// ESC closes the drawer. Captured globally because the body element may not
// have keyboard focus when the drawer slides in.
const onKey = (e: KeyboardEvent) => {
  if (!step.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  }
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<style scoped>
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
