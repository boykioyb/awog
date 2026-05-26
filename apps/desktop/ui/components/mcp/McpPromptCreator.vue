<template>
  <PromptCreatorPanel
    :anchor="anchor"
    headline="What MCP server do you want to add?"
    subheadline="Describe nó — mình sẽ điền sẵn config cho bạn"
    placeholder='e.g., "Filesystem read-only cho thư mục notes" hoặc "GitHub MCP để đọc issue"'
    generated-label="Generated MCP server"
    :has-draft="!!draft"
    :is-generating="isGenerating"
    :error="error"
    @submit="onSubmit"
    @cancel="emit('cancel')"
    @regenerate="onRegenerate"
  >
    <template #preview>
      <div
        v-if="draft"
        class="rounded-xl p-3"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[12px] font-mono" :style="{ color: t.text }">{{ draft.id }}</span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded uppercase"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            {{ draft.transport }}
          </span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded"
            :style="{ background: t.bgPanel, color: t.textMuted, border: `1px solid ${t.border}` }"
          >
            trust: {{ draft.trust }}
          </span>
        </div>
        <div class="text-[12px] mb-2" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>
        <div
          class="text-[10px] font-mono p-2 rounded"
          :style="{ background: t.bgPanel, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          <template v-if="draft.transport === 'stdio'">
            {{ draft.command }} {{ (draft.args ?? []).join(' ') }}
          </template>
          <template v-else>{{ draft.url }}</template>
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded"
        :style="{ color: t.textMuted }"
        @click="draft && emit('edit-manually', draft)"
      >
        <Sliders :size="11" />
        Edit details
      </button>
      <button
        class="text-[11px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...(draft as MCPServer) })"
      >
        <Save :size="11" />
        Save server
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, Sliders } from 'lucide-vue-next'
import type { MCPServer } from '~/types'
import type { McpDraft } from '~/composables/useMcpGenerator'

defineProps<{ anchor?: { top: number; left: number } | null }>()

const emit = defineEmits<{
  save: [server: MCPServer]
  'edit-manually': [draft: McpDraft]
  cancel: []
}>()

const { t } = useTheme()
const { draft, isGenerating, error, onSubmit, onRegenerate } =
  usePromptCreator<McpDraft>(useMcpGenerator())
</script>
