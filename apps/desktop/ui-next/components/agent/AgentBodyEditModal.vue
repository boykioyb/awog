<template>
  <LibraryEntityModal
    :open="open"
    :title="t('agents.bodyEdit.title', { id: agent.id })"
    :lock-scrim="isGenerating"
    :width="540"
    @close="emit('cancel')"
  >
    <div class="abe">
      <div class="abe-hint">{{ t('agents.bodyEdit.hint') }}</div>

      <div v-if="!draft" class="abe-promptbox">
        <textarea
          v-model="prompt"
          class="abe-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('agents.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
        <!-- One-click: spec đầy đủ theo vai trò + lưu luôn — chạy nền, đóng
             modal được, xong/lỗi bắn toast. -->
        <div class="abe-quick">
          <button
            type="button"
            class="abe-quickbtn"
            :disabled="isGenerating"
            :title="t('agents.bodyEdit.fullSpecHint')"
            @click="onFullSpec"
          >
            <Icon name="sparkles" />
            {{ t('agents.bodyEdit.fullSpec') }}
          </button>
        </div>
      </div>

      <div v-if="error" class="abe-err">{{ error }}</div>
      <div v-else-if="notice" class="abe-notice">{{ notice }}</div>

      <div v-if="draft" class="abe-preview">
        <div class="abe-prow">
          <span class="mono abe-pname">{{ draft.name }}</span>
          <span v-if="draft.role" class="tag">{{ draft.role }}</span>
          <span v-if="draft.id" class="tag mono">{{ draft.id }}</span>
        </div>
        <div class="abe-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('agents.bodyEdit.proposed')"
          :content="draft.systemPrompt || t('agents.bodyEdit.emptyPrompt')"
        />

        <!-- Whitelists the model proposed (skills/tools catalogs were sent so
             every entry is a real pickable value). All ticked = apply as
             proposed; untick to exclude. Sections only render when the draft
             actually proposes a whitelist. -->
        <div v-if="draftSkills.length" class="abe-sug">
          <div class="abe-sugtitle">{{ t('agents.bodyEdit.suggestedSkills') }}</div>
          <div class="awp-list">
            <label
              v-for="sid in draftSkills"
              :key="sid"
              class="awp-row"
              :class="{ on: selSkills.has(sid) }"
            >
              <input
                type="checkbox"
                class="awp-cbx"
                :checked="selSkills.has(sid)"
                @change="toggleSkill(sid)"
              />
              <span class="awp-name">{{ skillName(sid) }}</span>
              <span class="awp-tier mono">{{ sid }}</span>
            </label>
          </div>
        </div>
        <div v-if="draftTools.length" class="abe-sug">
          <div class="abe-sugtitle">{{ t('agents.bodyEdit.suggestedTools') }}</div>
          <div class="awp-list">
            <label
              v-for="tl in draftTools"
              :key="tl"
              class="awp-row"
              :class="{ on: selTools.has(tl) }"
            >
              <input
                type="checkbox"
                class="awp-cbx"
                :checked="selTools.has(tl)"
                @change="toggleTool(tl)"
              />
              <span class="awp-name mono">{{ tl }}</span>
              <span class="awp-tier">{{ toolGroup(tl) }}</span>
            </label>
          </div>
        </div>

        <!-- Tinh chỉnh tiếp draft hiện tại — vòng lặp refine: draft mới bám
             theo kết quả đang xem (kể cả tick review), không quay về spec gốc. -->
        <div class="abe-promptbox">
          <textarea
            v-model="refinePrompt"
            class="abe-ta"
            rows="2"
            :disabled="isGenerating"
            :placeholder="t('agents.bodyEdit.refinePh')"
            @keydown.enter.exact.prevent="onRefine"
          />
          <div class="abe-quick">
            <button
              type="button"
              class="abe-quickbtn"
              :disabled="isGenerating || !refinePrompt.trim()"
              @click="onRefine"
            >
              <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
              {{ isGenerating ? t('agents.bodyEdit.generating') : t('agents.bodyEdit.refine') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <AiModelPicker width="190px" />
      <span class="abe-fspacer" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('agents.bodyEdit.regenerate') }}
      </Button>
      <Button
        v-if="!draft"
        :disabled="isGenerating || !prompt.trim()"
        variant="outline"
        :title="t('library.bgEdit.hint')"
        @click="onGenerateSave"
      >
        <Icon name="check" />
        {{ t('library.bgEdit.generateSave') }}
      </Button>
      <Button
        v-if="!draft"
        :disabled="isGenerating || !prompt.trim()"
        variant="default"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('agents.bodyEdit.generating') : t('agents.bodyEdit.generate') }}
      </Button>
      <Button v-else :disabled="!canApply" variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('agents.bodyEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven system-prompt edit — port of the old UI AgentBodyEditModal, using
// the one-shot `agents.generate` RPC with `currentAgent` (revise the existing
// agent). On a sidecar/account miss it falls back to a local "revision note"
// append so the UX stays usable offline. Apply preserves storage metadata
// (source/projectId) + MCP/restrictions — content (name/description/model/
// role/systemPrompt) comes from the model, and skills/tools whitelists come
// from the review checklists when the draft proposes them (the catalogs sent
// to the model contain only real pickable values, so suggestions are valid).
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AiModelPicker from '~/components/common/AiModelPicker.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useAgentsStore, type Agent, type AgentDraftResult } from '~/stores/agents'
import { useSettingsStore } from '~/stores/settings'
import { useSkillsStore } from '~/stores/skills'
import { useConnectionsStore } from '~/stores/connections'
import { TOOL_GROUPS } from '~/utils/tool-catalog'
import { startAiEditSave } from '~/composables/useAiEditSave'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  agent: Agent
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [agent: Agent]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useAgentsStore()
const settings = useSettingsStore()
const skillsStore = useSkillsStore()
const connections = useConnectionsStore()

type AgentDraft = AgentDraftResult

// Catalogs sent to agents.generate — the model may only pick from these, so a
// suggested whitelist is guaranteed valid. Skills: GLOBAL tier only (agents
// are global roles — project skills would no-op in sessions of other
// projects). Tools: the canonical catalog + one `mcp__<id>` wildcard row per
// connection — the same rows AgentToolsPicker renders.
const catalogSkills = computed(() =>
  skillsStore.skills.filter((s) => s.source === 'global').map((s) => ({ id: s.id, name: s.name })),
)
const catalogTools = computed(() => [
  ...TOOL_GROUPS.flatMap(([, tools]) => tools),
  ...connections.servers.map((s) => `mcp__${s.id}`),
])
const skillName = (id: string): string => catalogSkills.value.find((s) => s.id === id)?.name ?? id
const toolGroup = (id: string): string => {
  const g = TOOL_GROUPS.find(([, tools]) => tools.includes(id))
  if (g) return g[0]
  return connections.servers.find((s) => `mcp__${s.id}` === id)?.name ?? ''
}

const prompt = ref('')
const refinePrompt = ref('')
const draft = ref<AgentDraft | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

// Review sets for proposed whitelists — initialised from the draft, user
// unticks to reject an entry before Apply.
const selSkills = ref<Set<string>>(new Set())
const selTools = ref<Set<string>>(new Set())
const draftSkills = computed(() => draft.value?.skillIds ?? [])
const draftTools = computed(() => draft.value?.tools ?? [])
const toggleSel = (set: typeof selSkills, id: string): void => {
  const next = new Set(set.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  set.value = next
}
const toggleSkill = (id: string): void => toggleSel(selSkills, id)
const toggleTool = (id: string): void => toggleSel(selTools, id)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      draft.value = null
      error.value = null
      notice.value = null
    }
  },
)

const canApply = computed(() => !!(draft.value?.id && draft.value.name && draft.value.description))

const resetDraft = () => {
  draft.value = null
  refinePrompt.value = ''
}

// One-click full spec — prompt đóng sẵn: viết lại systemPrompt thành spec
// senior đầy đủ theo vai trò + tự chọn skillIds/tools từ catalog (mọi đề
// xuất vẫn qua checklist trước khi áp). Giữ ngôn ngữ của spec hiện tại.
const FULL_SPEC_PROMPT =
  'Rewrite this agent’s systemPrompt as the COMPLETE senior-grade working spec for its role — every section the output contract lists (scope, goals, responsibilities, domain deep-dives, working method, decision principles, deliverables, boundaries, collaboration). Take the agent’s name/description/role as the source of truth for what it is. Also pick skillIds and tools from the catalogs that genuinely serve this role — leave them empty when nothing fits. Write in the same language as the current agent body/description.'

// currentAgent gửi kèm mỗi lần generate — mặc định spec đang lưu; refine
// override bằng draft + review ticks để vòng tinh chỉnh bám kết quả hiện tại.
const agentCurrent = () => ({
  id: props.agent.id,
  name: props.agent.name,
  description: props.agent.description,
  model: props.agent.model,
  systemPrompt: props.agent.systemPrompt,
  role: props.agent.role,
  mcpServerIds: props.agent.mcpServerIds,
  skillIds: props.agent.skillIds,
  repos: props.agent.repos,
  tools: props.agent.tools,
})

const runGenerate = async (text: string, currentOverride?: ReturnType<typeof agentCurrent>) => {
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  notice.value = null
  try {
    // Account + model theo cấu hình AI authoring (Settings → Models); accountId
    // prop chỉ là fallback khi resolver không ra account nào.
    const llm = settings.resolveAuthoringLlm()
    const accountId = llm.accountId ?? props.accountId
    if (!sc.available || !accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    const result = await store.generateAgent(
      text,
      accountId,
      currentOverride ?? agentCurrent(),
      llm.modelId,
      {
        skills: catalogSkills.value,
        tools: catalogTools.value,
      },
    )
    draft.value = result.draft
    // Catalog skills bị provider chặn → retry đã bỏ danh sách, draft không có
    // gợi ý skills — báo nhẹ để user hiểu vì sao section trống.
    notice.value = result.catalogDropped ? t('agents.bodyEdit.catalogDropped') : null
    // Proposed whitelists start fully ticked — untick = reject that entry.
    selSkills.value = new Set(result.draft.skillIds ?? [])
    selTools.value = new Set(result.draft.tools ?? [])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onGenerate = () => runGenerate(prompt.value.trim())

// Generate + apply + save chạy NỀN (nút "Spec đầy đủ" và "Sửa + lưu"): chụp
// agent + catalog lúc bấm, đóng modal ngay, toast khi xong/lỗi. Whitelist đề
// xuất được áp nguyên vẹn — chế độ này bỏ qua bước review tick.
const runBackgroundSave = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed || isGenerating.value) return
  const llm = settings.resolveAuthoringLlm()
  const accountId = llm.accountId ?? props.accountId
  if (!sc.available || !accountId) {
    error.value = t('common.aiUnavailable')
    return
  }
  const agent = props.agent
  const current = agentCurrent()
  const cats = { skills: [...catalogSkills.value], tools: [...catalogTools.value] }
  emit('cancel')
  startAiEditSave({
    key: `agent-${agent.id}`,
    name: agent.name || agent.id,
    task: async () => {
      const { draft: d, catalogDropped } = await store.generateAgent(
        trimmed,
        accountId,
        current,
        llm.modelId,
        cats,
      )
      if (!d.id || !d.name || !d.description) {
        throw new Error('Model returned an incomplete draft')
      }
      await store.saveAgent(applyDraft(agent, d, new Set(d.skillIds ?? []), new Set(d.tools ?? [])))
      return catalogDropped ? t('agents.bodyEdit.catalogDropped') : undefined
    },
  })
}
const onFullSpec = () => runBackgroundSave(FULL_SPEC_PROMPT)
const onGenerateSave = () => runBackgroundSave(prompt.value)

// Tinh chỉnh draft đang xem: model revise TRÊN draft (whitelist = các tick
// hiện tại của user), không quay về spec gốc — vòng lặp "làm lại từng chút".
const onRefine = () => {
  const text = refinePrompt.value.trim()
  const d = draft.value
  if (!text || !d) return
  void runGenerate(text, {
    id: d.id ?? props.agent.id,
    name: d.name,
    description: d.description,
    model: d.model,
    systemPrompt: d.systemPrompt,
    role: d.role,
    mcpServerIds: props.agent.mcpServerIds,
    skillIds: [...selSkills.value],
    repos: props.agent.repos,
    tools: [...selTools.value],
  })
  refinePrompt.value = ''
}

// Merge draft vào agent `base`: giữ storage metadata + per-agent restrictions;
// content từ model; whitelist theo review set truyền vào (apply trong modal =
// các tick hiện tại, chạy nền = toàn bộ đề xuất của draft). `base` là tham số
// riêng thay vì props.agent vì nhánh nền gọi sau khi modal đã unmount.
const applyDraft = (base: Agent, d: AgentDraft, selS: Set<string>, selT: Set<string>): Agent => {
  // Preserve storage metadata + per-agent restrictions; content from the model.
  const updated: Agent = {
    id: base.id,
    source: base.source,
    name: d.name,
    description: d.description,
    provider: base.provider,
    model: d.model || base.model,
    systemPrompt: d.systemPrompt,
    role: d.role,
  }
  if (base.projectId) updated.projectId = base.projectId
  if (base.accountId) updated.accountId = base.accountId
  if (base.mcpServerIds && base.mcpServerIds.length > 0) {
    updated.mcpServerIds = [...base.mcpServerIds]
  }
  // Skills/tools whitelists: when the draft proposed a list (model could only
  // pick from the sent catalog) the REVIEW SET wins — the user unticked entries
  // they rejected; unticking all clears the whitelist (omitted = unrestricted).
  // An empty draft list keeps the stored value rather than wiping it.
  if (d.skillIds && d.skillIds.length > 0) {
    if (selS.size > 0) updated.skillIds = [...selS]
  } else if (base.skillIds && base.skillIds.length > 0) {
    updated.skillIds = [...base.skillIds]
  }
  if (d.tools && d.tools.length > 0) {
    if (selT.size > 0) updated.tools = [...selT]
  } else if (base.tools && base.tools.length > 0) {
    updated.tools = [...base.tools]
  }
  const repos = d.repos?.length ? d.repos : base.repos
  if (repos && repos.length > 0) updated.repos = [...repos]
  return updated
}

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  emit('apply', applyDraft(props.agent, d, selSkills.value, selTools.value))
}
</script>

<style scoped>
.abe {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.abe-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: var(--lh-md);
}
.abe-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
}
.abe-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  font-family: var(--sans);
}
.abe-quick {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}
.abe-quickbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  color: var(--accent);
  cursor: pointer;
  transition: background 0.12s;
}
.abe-quickbtn:hover:not(:disabled) {
  background: var(--accentDim);
}
.abe-quickbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.abe-quickbtn .icn {
  width: 12px;
  height: 12px;
}
.abe-fspacer {
  flex: 1;
}
.abe-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.abe-notice {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.abe-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.abe-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.abe-pname {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--text);
}
.abe-pdesc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.abe-sug {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.abe-sugtitle {
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.spin {
  animation: abe-spin 0.9s linear infinite;
}
@keyframes abe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
