<template>
  <div class="agd">
    <div class="dh">
      <span class="lav agd-av" :style="avatarStyle">{{ initials }}</span>
      <div class="dt">{{ agent.name }}</div>
      <span class="tag mono">{{ agent.id }}</span>
      <span class="tag" :class="{ acc: isProject }" :title="sourcePath">{{ sourceLabel }}</span>
      <span style="flex: 1" />
      <button class="iconbtn agd-act" :title="t('agents.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn agd-act"
        :title="t('agents.detail.duplicate')"
        @click="emit('duplicate')"
      >
        <Icon name="copy" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn agd-act agd-danger"
        :title="t('agents.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p v-if="agent.description" class="agd-desc">{{ agent.description }}</p>

      <div class="sech">{{ t('agents.detail.providerModel') }}</div>
      <div class="agd-chips">
        <span class="chip">{{ providerLabel }}</span>
        <span class="chip">{{ modelLabel }}</span>
        <span v-if="agent.role" class="chip">{{ agent.role }}</span>
        <span v-if="agent.accountId" class="chip mono">{{ agent.accountId }}</span>
      </div>

      <LibraryMarkdownBody
        :title="t('agents.detail.systemPrompt')"
        :content="agent.systemPrompt ?? ''"
        :empty-text="t('agents.detail.emptyPrompt')"
        allow-edit
        :edit-label="t('agents.detail.editPrompt')"
        :edit-title="t('agents.detail.editPromptTitle')"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />

      <template v-if="(agent.mcpServerIds ?? []).length > 0">
        <div class="sech">
          {{ t('agents.detail.connections', { n: (agent.mcpServerIds ?? []).length }) }}
        </div>
        <div class="agd-chips">
          <span
            v-for="id in agent.mcpServerIds"
            :key="id"
            class="chip mono"
            :style="{ color: 'var(--accent)', borderColor: 'var(--accentBorder)' }"
          >
            <Icon name="conn" style="width: 10px; height: 10px" />
            {{ mcpLabel(id) }}
          </span>
        </div>
        <div class="agd-hint">{{ t('agents.detail.connectionsHint') }}</div>
      </template>

      <template v-if="(agent.tools ?? []).length > 0">
        <div class="sech">{{ t('agents.detail.tools', { n: (agent.tools ?? []).length }) }}</div>
        <div class="agd-chips">
          <span
            v-for="tool in agent.tools"
            :key="tool"
            class="chip"
            :class="{ mono: tool.startsWith('mcp__') }"
            :style="
              tool.startsWith('mcp__')
                ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
                : undefined
            "
          >
            {{ tool }}
          </span>
        </div>
        <div class="agd-hint">{{ t('agents.detail.toolsHint') }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Agent detail pane — port of the old UI AgentDetail logic, rendered in
// prototype CSS (.dh header + .dscroll body, matching skills/connections detail
// markup). Header actions (edit / duplicate / delete) emit to the page;
// LibraryMarkdownBody renders the AGENT.md system prompt with an LLM-edit
// trigger. Provider/model/role/account chips + MCP whitelist + tools whitelist
// (mcp__* chips accent-styled).
import { computed, type CSSProperties } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { agentInitials, agentAvatar, providerDisplayName, modelDisplayName } from './agent-display'
import type { Agent } from '~/stores/agents'

const props = defineProps<{
  agent: Agent
  projects: { id: string; name: string; path?: string }[]
  mcpServers: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  edit: []
  duplicate: []
  delete: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useI18n()

const isProject = computed(() => props.agent.source === 'project')

const initials = computed(() => agentInitials(props.agent))

const avatarStyle = computed<CSSProperties>(() => {
  const av = agentAvatar(props.agent)
  return {
    background: av.bg,
    color: av.fg,
    width: '26px',
    height: '26px',
    borderRadius: '7px',
    fontSize: '0.7692rem',
    fontWeight: 600,
  }
})

const providerLabel = computed(() => providerDisplayName(props.agent.provider))
const modelLabel = computed(() => modelDisplayName(props.agent.model))

const sourceLabel = computed(() => {
  if (!isProject.value) return '~/.awog'
  const project = props.projects.find((p) => p.id === props.agent.projectId)
  return project?.name ?? props.agent.projectId ?? '.awog'
})

const sourcePath = computed(() => {
  if (props.agent.source === 'global') return `~/.awog/agents/${props.agent.id}.md`
  const project = props.projects.find((p) => p.id === props.agent.projectId)
  const base = project?.path ?? '<project>'
  return `${base}/.awog/agents/${props.agent.id}.md`
})

// Resolve display name from the connection list; fall back to the raw id when
// the referenced server is missing (deleted).
const mcpLabel = (id: string): string => props.mcpServers.find((s) => s.id === id)?.name ?? id
</script>

<style scoped>
.agd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.agd-av {
  border: 1px solid var(--border);
}
.agd-act {
  width: 28px;
  height: 28px;
}
.agd-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.agd-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0;
}
.agd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.agd-hint {
  font-size: 0.8462rem;
  color: var(--textDim);
  margin-top: 8px;
  line-height: 1.5;
}
</style>
