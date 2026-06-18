<template>
  <BaseModal :open="open" :title="tr('project.llm.title')" size="sm" @close="emit('close')">
    <div class="px-4 py-4 space-y-4">
      <p class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
        {{ tr('project.llm.subtitle') }}
      </p>

      <!-- Provider -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.provider') }}
        </label>
        <AppSelect
          :model-value="draft.provider"
          @update:model-value="(v) => setProvider(v as ProviderName)"
        >
          <option v-for="p in providers" :key="p" :value="p">
            {{ PROVIDER_LABEL[p]
            }}{{ isProviderConnected(p) ? '' : ` — ${tr('project.llm.not_connected')}` }}
          </option>
        </AppSelect>
      </div>

      <!-- Account -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.account') }}
        </label>
        <AppSelect
          :model-value="draft.accountId ?? ''"
          @update:model-value="(v) => setAccount(v ? String(v) : undefined)"
        >
          <option value="">{{ tr('project.llm.follow_active') }}</option>
          <option v-for="acc in accounts" :key="acc.id" :value="acc.id">
            {{ acc.label }}{{ acc.account?.email ? ` (${acc.account.email})` : '' }}
          </option>
        </AppSelect>
      </div>

      <!-- Model -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.model') }}
        </label>
        <AppSelect :model-value="draft.modelId" @update:model-value="(v) => setModel(String(v))">
          <option v-for="m in availableModels" :key="m.id" :value="m.id">
            {{ m.label }} · {{ m.tier }}
          </option>
        </AppSelect>
      </div>

      <!-- Effort -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.effort') }}
        </label>
        <AppSelect
          :model-value="draft.level"
          :disabled="!currentModel?.supportsThinking"
          @update:model-value="(v) => setLevel(v as ThinkingLevel)"
        >
          <option v-for="lv in availableLevels" :key="lv" :value="lv">
            {{ LEVEL_LABEL[lv] }}
          </option>
        </AppSelect>
      </div>

      <!-- Response style (ADR 0046) — new sessions start in this style. -->
      <div class="space-y-1.5">
        <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
          {{ tr('project.llm.style') }}
        </label>
        <AppSelect
          :model-value="draft.responseStyle ?? ''"
          @update:model-value="(v) => setResponseStyle(v ? String(v) : undefined)"
        >
          <option value="">💬 {{ tr('project.llm.style_normal') }}</option>
          <optgroup
            v-for="g in RESPONSE_STYLE_GROUPS"
            :key="g.key"
            :label="`${g.emoji} ${g.label}`"
          >
            <option v-for="s in g.styles" :key="s.id" :value="s.id">
              {{ s.emoji }} {{ s.name }}
            </option>
          </optgroup>
        </AppSelect>
        <button
          type="button"
          class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] rounded-md transition"
          :style="{ color: t.text, border: `1px solid ${t.border}` }"
          @click="setNoMarkdown(!draft.responseStyleNoMarkdown)"
        >
          <span
            class="inline-flex items-center justify-center w-4 h-4 rounded-sm flex-shrink-0"
            :style="{
              background: draft.responseStyleNoMarkdown ? t.accent : 'transparent',
              border: `1px solid ${draft.responseStyleNoMarkdown ? t.accent : t.border}`,
            }"
          >
            <Check
              v-if="draft.responseStyleNoMarkdown"
              :size="9"
              :style="{ color: t.accentText }"
            />
          </span>
          <span class="flex-1">{{ tr('project.llm.no_markdown') }}</span>
        </button>
      </div>

      <!-- MCP servers — whitelist new sessions opt into. -->
      <div v-if="mcpEnabledServers.length > 0" class="space-y-1.5">
        <div class="flex items-center gap-2">
          <label class="text-[1em] uppercase tracking-wider flex-1" :style="{ color: t.textDim }">
            {{ tr('project.llm.mcp') }}
          </label>
          <button
            v-if="isMcpCustomized"
            class="text-[1em] hover:underline"
            :style="{ color: t.textDim }"
            @click="resetMcp"
          >
            {{ tr('project.llm.mcp_reset') }}
          </button>
        </div>
        <div class="rounded-md overflow-hidden" :style="{ border: `1px solid ${t.border}` }">
          <button
            v-for="srv in mcpEnabledServers"
            :key="srv.id"
            type="button"
            class="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-[1em] transition"
            :style="{ color: t.text }"
            @click="toggleMcp(srv.id)"
          >
            <span
              class="inline-flex items-center justify-center w-4 h-4 rounded-sm flex-shrink-0"
              :style="{
                background: isMcpActive(srv.id) ? t.accent : 'transparent',
                border: `1px solid ${isMcpActive(srv.id) ? t.accent : t.border}`,
              }"
            >
              <Check v-if="isMcpActive(srv.id)" :size="9" :style="{ color: t.accentText }" />
            </span>
            <div class="flex-1 min-w-0">
              <div class="truncate" :style="{ color: t.text }">{{ srv.name }}</div>
              <div class="text-[1em] font-mono truncate" :style="{ color: t.textDim }">
                {{ srv.id }}
                <span v-if="srv.tools.length > 0">· {{ srv.tools.length }} tools</span>
              </div>
            </div>
          </button>
        </div>
        <p class="text-[1em]" :style="{ color: t.textDim }">
          {{ isMcpCustomized ? tr('project.llm.mcp_custom') : tr('project.llm.mcp_default') }}
        </p>
      </div>
    </div>

    <template #footer>
      <AppButton v-if="hasCustomDefaults" variant="ghost" class="mr-auto" @click="onReset">
        {{ tr('project.llm.reset') }}
      </AppButton>
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton :disabled="saving" @click="onSave">
        {{ tr('common.save') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Check } from 'lucide-vue-next'
import type { ProviderName, ThinkingLevel } from '~/types'
import { LEVEL_LABEL, PROVIDER_LABEL } from '~/utils/models'
import { RESPONSE_STYLE_GROUPS } from '~/utils/response-styles'

const props = defineProps<{
  open: boolean
  projectId: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const {
  draft,
  providers,
  accounts,
  availableModels,
  availableLevels,
  currentModel,
  isProviderConnected,
  hasCustomDefaults,
  mcpEnabledServers,
  isMcpCustomized,
  isMcpActive,
  toggleMcp,
  resetMcp,
  setProvider,
  setAccount,
  setModel,
  setLevel,
  setResponseStyle,
  setNoMarkdown,
  save,
  resetToAppDefault,
} = useProjectLlmDefaults(
  () => props.projectId,
  () => props.open,
)

const saving = ref(false)

const onSave = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await save()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}

const onReset = async () => {
  if (saving.value) return
  saving.value = true
  try {
    await resetToAppDefault()
    emit('saved')
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>
