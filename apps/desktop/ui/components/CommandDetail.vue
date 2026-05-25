<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Slash :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-mono font-semibold" :style="{ color: t.text }">
            /{{ command.name }}
          </h1>
          <span
            class="text-[11px] px-1.5 py-0.5 rounded"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ command.type }}
          </span>
          <span
            v-if="command.system"
            class="text-[10px] uppercase px-1.5 py-0.5 rounded"
            :style="{
              background: t.infoBg,
              color: t.info,
              border: `1px solid ${t.infoBorder}`,
            }"
          >
            system
          </span>
        </div>
        <div class="text-[12px] leading-relaxed" :style="{ color: t.textMuted }">
          {{ command.description }}
        </div>
        <div v-if="command.aliases.length > 0" class="flex flex-wrap gap-1 mt-2">
          <span
            v-for="a in command.aliases"
            :key="a"
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgInput,
              color: t.textDim,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ a }}
          </span>
        </div>
      </div>
      <div v-if="!command.system" class="flex items-center gap-1 flex-shrink-0">
        <button
          class="px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @click="emit('edit')"
        >
          <Edit3 :size="11" />
          Edit
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <!-- Scope -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      <KeyValueCard label="Scope" :value="command.scope" />
      <KeyValueCard v-if="command.timeoutMs" label="Timeout" :value="`${command.timeoutMs}ms`" />
    </div>

    <!-- Arguments -->
    <Section :title="`Arguments · ${command.args.length}`">
      <div v-if="command.args.length === 0" class="text-[11px]" :style="{ color: t.textFaint }">
        Không có argument.
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="arg in command.args"
          :key="arg.name"
          class="flex items-start gap-2.5 p-2.5 rounded"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[12px] font-mono" :style="{ color: t.text }">{{ arg.name }}</span>
              <span
                class="text-[9px] uppercase px-1 rounded"
                :style="{
                  background: t.bgInput,
                  color: t.textDim,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ arg.type }}
              </span>
              <span v-if="arg.required" class="text-[9px] uppercase" :style="{ color: t.danger }">
                required
              </span>
            </div>
            <div class="text-[11px] mt-0.5" :style="{ color: t.textMuted }">
              {{ arg.description }}
            </div>
            <div
              v-if="arg.default"
              class="text-[10px] mt-0.5 font-mono"
              :style="{ color: t.textFaint }"
            >
              default: {{ arg.default }}
            </div>
          </div>
        </div>
      </div>
    </Section>

    <!-- Body -->
    <Section :title="bodyLabel">
      <pre
        class="text-[11px] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          margin: 0,
        }"
        >{{ command.body }}</pre
      >
    </Section>

    <!-- Try it preview -->
    <Section title="Picker preview">
      <div
        class="rounded overflow-hidden"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <div
          class="px-3 py-2 flex items-center gap-2 text-[12px]"
          :style="{ background: t.bgInput }"
        >
          <Slash :size="11" :style="{ color: t.textDim }" />
          <span class="font-mono" :style="{ color: t.text }">{{ command.name }}</span>
          <span
            v-for="arg in command.args"
            :key="arg.name"
            class="font-mono"
            :style="{ color: t.textDim }"
          >
            &lt;{{ arg.name }}{{ arg.required ? '' : '?' }}&gt;
          </span>
        </div>
        <div class="px-3 py-2 text-[11px]" :style="{ color: t.textMuted }">
          {{ command.description }}
        </div>
      </div>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { Slash, Edit3, Trash2 } from 'lucide-vue-next'
import type { SlashCommand } from '~/types'

const props = defineProps<{ command: SlashCommand }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { t } = useTheme()

const bodyLabel = computed<string>(() => {
  switch (props.command.type) {
    case 'prompt':
      return 'Prompt template'
    case 'agent-switch':
      return 'Target agent'
    case 'shell':
      return 'Shell command'
    case 'workflow':
      return 'Workflow ID'
    default:
      return 'Body'
  }
})
</script>
