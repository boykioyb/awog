<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <span
        class="grid size-6.5 flex-none place-items-center rounded-md border text-xs font-semibold"
        :style="avatarStyle"
      >
        {{ initials }}
      </span>
      <div class="min-w-0 truncate text-lg font-semibold">{{ agent.name }}</div>
      <!-- mono-ok: id agent -->
      <Badge variant="outline" class="font-mono text-muted-foreground">{{ agent.id }}</Badge>
      <Badge
        variant="outline"
        :class="isProject ? 'border-primary/45 bg-primary/8 text-primary' : 'text-muted-foreground'"
        :title="sourcePath"
      >
        {{ sourceLabel }}
      </Badge>
      <span class="flex-1" />
      <Button
        :title="t('agents.detail.edit')"
        variant="outline"
        size="iconSm"
        @click="emit('edit')"
      >
        <Icon name="edit" />
      </Button>
      <Button
        :title="t('agents.detail.duplicate')"
        variant="outline"
        size="iconSm"
        @click="emit('duplicate')"
      >
        <Icon name="copy" />
      </Button>
      <Button
        :title="t('agents.detail.delete')"
        class="hover:border-destructive hover:text-destructive"
        variant="outline"
        size="iconSm"
        @click="emit('delete')"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto p-5.5">
      <p v-if="agent.description" class="m-0 text-base leading-(--lh-prose) text-muted-foreground">
        {{ agent.description }}
      </p>

      <div :class="SECH">{{ t('agents.detail.providerModel') }}</div>
      <div class="flex flex-wrap gap-1.5">
        <Badge variant="outline" :class="CHIP">{{ providerLabel }}</Badge>
        <Badge variant="outline" :class="CHIP">{{ modelLabel }}</Badge>
        <Badge v-if="agent.role" variant="outline" :class="CHIP">{{ agent.role }}</Badge>
        <!-- mono-ok: id account -->
        <Badge v-if="agent.accountId" variant="outline" :class="[CHIP, 'font-mono']">
          {{ agent.accountId }}
        </Badge>
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
        <div :class="SECH">
          {{ t('agents.detail.connections', { n: (agent.mcpServerIds ?? []).length }) }}
        </div>
        <div class="flex flex-wrap gap-1.5">
          <!-- mono-ok: tên server MCP -->
          <Badge
            v-for="id in agent.mcpServerIds"
            :key="id"
            variant="outline"
            :class="[CHIP_ACCENT, 'font-mono']"
          >
            <Icon name="conn" />
            {{ mcpLabel(id) }}
          </Badge>
        </div>
        <div class="mt-2 text-xs text-dim">{{ t('agents.detail.connectionsHint') }}</div>
      </template>

      <template v-if="(agent.tools ?? []).length > 0">
        <div :class="SECH">{{ t('agents.detail.tools', { n: (agent.tools ?? []).length }) }}</div>
        <div class="flex flex-wrap gap-1.5">
          <!-- mono-ok: tên tool mcp__… -->
          <Badge
            v-for="tool in agent.tools"
            :key="tool"
            variant="outline"
            :class="tool.startsWith('mcp__') ? [CHIP_ACCENT, 'font-mono'] : CHIP"
          >
            {{ tool }}
          </Badge>
        </div>
        <div class="mt-2 text-xs text-dim">{{ t('agents.detail.toolsHint') }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Agent detail pane — port of the old UI AgentDetail logic: header cố định +
// thân cuộn, cùng bố cục với detail của skills/connections. Header actions (edit / duplicate / delete) emit to the page;
// LibraryMarkdownBody renders the AGENT.md system prompt with an LLM-edit
// trigger. Provider/model/role/account chips + MCP whitelist + tools whitelist
// (mcp__* chips accent-styled).
import { computed, type CSSProperties } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { agentInitials, agentAvatar, providerDisplayName, modelDisplayName } from './agent-display'
import type { Agent } from '~/stores/agents'
import Button from '~/components/ui/button/Button.vue'

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
  // Màu avatar là dữ liệu (băm theo agent), không phải token theme.
  return { background: av.bg, color: av.fg }
})

// Nhãn nhóm + chip của thân detail.
const SECH = 'mb-2 mt-5 text-xs font-semibold text-dim first:mt-0'
const CHIP = 'text-muted-foreground'
const CHIP_ACCENT = 'border-selected-border text-primary'

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
