<template>
  <div ref="rootRef" class="relative inline-flex">
    <AppButton
      variant="ghost"
      size="xs"
      :active="open"
      :title="tr('session.msg.retry_model')"
      @click="open = !open"
    >
      <Sparkles :size="12" />
    </AppButton>
    <div
      v-if="open"
      class="absolute z-30 bottom-full mb-1 left-0 rounded-md py-1 max-h-72 overflow-y-auto"
      :style="{
        background: t.bgElevated,
        border: `1px solid ${t.border}`,
        boxShadow: `0 8px 24px ${t.shadow}`,
        minWidth: '200px',
      }"
    >
      <button
        v-for="m in availableModels"
        :key="m.id"
        type="button"
        class="w-full text-left px-3 py-1.5 text-[1em] flex items-center gap-2 transition"
        :style="{
          color: t.text,
          background: hover === m.id ? t.bgHover : 'transparent',
        }"
        @mouseenter="hover = m.id"
        @mouseleave="hover = null"
        @click="pick(m.id)"
      >
        <Check v-if="m.id === session.settings.modelId" :size="12" :style="{ color: t.accent }" />
        <span v-else class="inline-block flex-shrink-0" :style="{ width: '12px' }" />
        <span class="truncate">{{ m.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Sparkles } from 'lucide-vue-next'
import { ref, toRef, useTemplateRef } from 'vue'
import type { Session } from '~/types'

const props = defineProps<{
  session: Session
  agentMessageId: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const open = ref(false)
const hover = ref<string | null>(null)

const { availableModels } = useSessionModels(toRef(props, 'session'))

useClickOutside(rootRef, () => {
  open.value = false
})

const pick = (modelId: string) => {
  open.value = false
  void store.retryWithModel(props.agentMessageId, modelId)
}
</script>
