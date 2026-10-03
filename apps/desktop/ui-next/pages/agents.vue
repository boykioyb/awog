<template>
  <section class="page on agentspage" data-page="agents">
    <!-- ══ LIST — khuôn Multica agents-page: CollectionHeader (icon + title +
         count + tagline + New) / toolbar (search + tier filter) / ListGrid
         64px two-line identity rows / kebab menu. ══ -->
    <template v-if="!detail">
      <CollectionHeader
        icon="bot"
        :title="t('agents.page.title')"
        :count="filteredAgents.length"
        :tagline="t('agents.page.tagline')"
      >
        <Button variant="outline" @click="chooserOpen = true">
          <Icon name="plus" class="size-3.5" />
          {{ t('agents.page.new') }}
        </Button>
      </CollectionHeader>

      <div class="agt-bar">
        <div class="relative">
          <Icon
            name="search"
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input v-model="query" :placeholder="t('agents.search')" class="w-72 pl-8" />
        </div>
        <span class="agt-flex" />
        <AppSelect v-model="teamFilter" :options="teamFilterOpts" />
        <AppSelect v-model="sortBy" :options="sortOpts" />
      </div>

      <CollectionList v-if="filteredAgents.length" :cols="COLS">
        <template #head>
          <span class="agt-checkhead" @click.stop>
            <AppCheckbox
              :checked="allFilteredSelected"
              :indeterminate="selected.size > 0 && !allFilteredSelected"
              @update:checked="toggleAllFiltered"
            />
          </span>
          <span>{{ t('agents.col.agent') }}</span>
          <span>{{ t('agents.col.status') }}</span>
          <span>{{ t('agents.col.runtime') }}</span>
          <span>{{ t('agents.col.lastActive') }}</span>
          <span class="agt-head-r">{{ t('agents.col.runs') }}</span>
          <span />
        </template>
        <div
          v-for="a in filteredAgents"
          :key="agentKey(a)"
          class="cl-row"
          :class="{ 'cl-row-sel': selected.has(agentKey(a)) }"
          @click="openDetail(a)"
        >
          <div class="cl-cell agt-check" @click.stop>
            <AppCheckbox :checked="selected.has(agentKey(a))" @update:checked="toggleAgent(a)" />
          </div>
          <div class="cl-cell agt-id">
            <span class="agt-avw">
              <EntityAvatar :name="a.name" :seed="agentKey(a)" size="md" />
              <span v-if="isLive(a)" class="agt-avdot" />
            </span>
            <div class="agt-idt">
              <span class="agt-name">{{ a.name }}</span>
              <span v-if="a.description" class="agt-desc">{{ a.description }}</span>
            </div>
          </div>
          <div class="cl-cell">
            <span class="agt-st" :class="{ on: isLive(a) }">
              <span class="agt-std" />
              {{ isLive(a) ? t('agents.status.active') : t('agents.status.idle') }}
            </span>
          </div>
          <div class="cl-cell">
            {{ providerDisplayName(a.provider) }} · {{ modelDisplayName(a.model) }}
          </div>
          <div class="cl-cell">{{ relTime(statsFor(a).lastIso) }}</div>
          <div class="cl-cell agt-runs">{{ statsFor(a).sessions }}</div>
          <div class="cl-cell agt-kebab">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="iconSm" class="agt-kebab-btn" @click.stop>
                  <Icon name="dots" class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @click="openEditor(a)">
                  <Icon name="edit" class="size-3.5" />
                  {{ t('agents.detail.edit') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="openBodyEdit(a)">
                  <Icon name="sparkles" class="size-3.5" />
                  {{ t('agents.detail.editPrompt') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="onDuplicate(a)">
                  <Icon name="copy" class="size-3.5" />
                  {{ t('agents.detail.duplicate') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="exportAgent(a)">
                  <Icon name="download" class="size-3.5" />
                  {{ t('agents.detail.export') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="askDelete(a)"
                >
                  <Icon name="trash" class="size-3.5" />
                  {{ t('agents.detail.delete') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollectionList>

      <div v-else class="agt-empty">
        <span class="agt-empty-ic"><Icon name="bot" class="size-5" /></span>
        <div class="agt-empty-t">{{ t('agents.empty.title') }}</div>
        <div class="agt-empty-d">{{ t('agents.empty.desc') }}</div>
        <Button @click="chooserOpen = true">
          <Icon name="plus" class="size-3.5" />
          {{ t('agents.page.new') }}
        </Button>
      </div>

      <!-- Bulk bar — nổi đáy khi có tick chọn: export .zip / xoá hàng loạt. -->
      <div v-if="selected.size" class="agt-bulk">
        <span class="agt-bulk-n">{{ t('agents.bulk.selected', { n: selected.size }) }}</span>
        <!-- Set model — action-dropdown (mỗi chọn = một lần áp cho mọi agent
             đang tick). Cùng khuôn bulk bar của Board: Button sm + DropdownMenu
             nên mọi control trong bar đều h-8, không nhô chiều cao. -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" :disabled="bulkBusy || !bulkModelOpts.length">
              <Icon name="sparkles" class="size-3.5" />
              {{ t('agents.bulk.setModel') }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" class="max-h-72 overflow-y-auto">
            <DropdownMenuItem
              v-for="opt in bulkModelOpts"
              :key="opt.value"
              :disabled="opt.disabled"
              @click="bulkSetModel(opt.value)"
            >
              {{ opt.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" :disabled="bulkBusy" @click="exportSelected">
          <Icon name="download" class="size-3.5" />
          {{ t('agents.bulk.exportZip') }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="text-destructive"
          :disabled="bulkBusy"
          @click="bulkDelete"
        >
          <Icon name="trash" class="size-3.5" />
          {{ t('agents.bulk.delete') }}
        </Button>
        <Button variant="ghost" size="iconSm" :title="t('common.clear')" @click="selected.clear()">
          <Icon name="x" class="size-3.5" />
        </Button>
      </div>
    </template>

    <!-- ══ DETAIL — khuôn agent-detail-page: back header + pane (tabs:
         Instructions | Sessions) + inspector rail phải (properties). ══ -->
    <template v-else>
      <header class="agd-back">
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('agents.detail.back')"
          @click="detailKey = null"
        >
          <Icon name="arrow-left" class="size-4" />
        </Button>
        <span class="agd-back-t">{{ t('agents.page.title') }}</span>

        <span class="agd-flex" />
        <!-- Trò chuyện: materialize agent thành phiên chat thật (agents.run) —
             chat tự do (không project) kiểu trợ lý cá nhân, hoặc trong một
             project để có workspace context. -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button size="sm" :disabled="chatBusy">
              <Icon name="message" class="size-3.5" />
              {{ t('agents.detail.chat') }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuItem @click="chatWithAgent(null)">
              <Icon name="message" class="size-3.5" />
              {{ t('agents.detail.chatFree') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="projects.length" />
            <DropdownMenuItem v-for="p in projects" :key="p.id" @click="chatWithAgent(p.id)">
              <Icon name="folder" class="size-3.5" />
              {{ p.name }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" @click="openEditor(detail)">
          <Icon name="edit" class="size-3.5" />
          {{ t('agents.detail.edit') }}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="iconSm">
              <Icon name="dots" class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="openEditor(detail)">
              <Icon name="edit" class="size-3.5" />
              {{ t('agents.detail.edit') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="openBodyEdit(detail)">
              <Icon name="sparkles" class="size-3.5" />
              {{ t('agents.detail.editPrompt') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="onDuplicate(detail)">
              <Icon name="copy" class="size-3.5" />
              {{ t('agents.detail.duplicate') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="exportAgent(detail)">
              <Icon name="download" class="size-3.5" />
              {{ t('agents.detail.export') }}
            </DropdownMenuItem>
            <DropdownMenuItem
              class="text-destructive focus:text-destructive"
              @click="askDelete(detail)"
            >
              <Icon name="trash" class="size-3.5" />
              {{ t('agents.detail.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div class="agd-body">
        <div class="agd-main">
          <div class="agd-hero">
            <EntityAvatar :name="detail.name" :seed="agentKey(detail)" size="lg" />
            <div class="agd-hero-t">
              <div class="agd-name">
                {{ detail.name }}
                <span class="tag mono">{{ detail.id }}</span>
                <span v-if="detail.role" class="tag acc">{{ detail.role }}</span>
              </div>
              <div v-if="detail.description" class="agd-desc">{{ detail.description }}</div>
            </div>
          </div>

          <Tabs
            class="mt-5"
            :model-value="detailTab"
            @update:model-value="(v) => (detailTab = v as typeof detailTab)"
          >
            <!-- flex + -mx-6/px-6 + p-0: inline-flex mặc định co theo content
                 nên border-b đứt ngắn; flex stretch + margin âm kéo line chạy
                 hết qua padding .agd-main; p-0 bắt buộc — p-1 của base class
                 đẩy trigger lên 4px khiến underline active tách khỏi hairline
                 của list (thành 2 vạch song song). -->
            <TabsList
              class="-mx-6 flex h-9 justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 px-6"
            >
              <TabsTrigger
                v-for="tab in detailTabs"
                :key="tab.id"
                :value="tab.id"
                class="h-9 gap-1.5 rounded-none border-b-2 border-transparent px-3 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Icon :name="tab.icon" class="size-3.5" />
                {{ tab.label }}
                <span v-if="tab.count != null" class="agd-tabc">{{ tab.count }}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <!-- Instructions = systemPrompt (AGENT.md body). Nút "Chỉnh bằng AI"
               nằm trong header của markdown body (allow-edit) — chung một hàng
               với Render/Raw + Copy, không còn hàng riêng trống trải. -->
          <div v-if="detailTab === 'instructions'" class="agd-pane">
            <LibraryMarkdownBody
              :title="t('agents.detail.tabInstructions')"
              :content="detail.systemPrompt"
              allow-edit
              :edit-label="t('agents.detail.editPrompt')"
              :edit-title="t('agents.detail.editPromptTitle')"
              @edit-body="openBodyEdit(detail)"
            />
          </div>

          <!-- Whitelist tabs — same pickers AgentEditor uses, persisted inline
               per toggle via patchAgent → agents.upsert. -->
          <div v-else-if="detailTab === 'skills'" class="agd-pane">
            <div class="agd-wl-head">
              <span class="agd-wl-state">{{ skillsState }}</span>
              <span v-if="patching" class="agd-wl-state">{{ t('common.saving') }}</span>
            </div>
            <AgentSkillsPicker
              :model-value="wlVal('skillIds')"
              :skills="skills"
              @update:model-value="(v) => patchAgent({ skillIds: v })"
            />
          </div>

          <div v-else-if="detailTab === 'tools'" class="agd-pane">
            <div class="agd-wl-head">
              <span class="agd-wl-state">{{ toolsState }}</span>
              <span v-if="patching" class="agd-wl-state">{{ t('common.saving') }}</span>
            </div>
            <AgentToolsPicker
              :model-value="wlVal('tools')"
              :servers="mcpServers"
              @update:model-value="(v) => patchAgent({ tools: v })"
            />
          </div>

          <div v-else-if="detailTab === 'connections'" class="agd-pane">
            <div class="agd-wl-head">
              <span class="agd-wl-state">{{ connectionsState }}</span>
              <span v-if="patching" class="agd-wl-state">{{ t('common.saving') }}</span>
            </div>
            <AgentConnectionsPicker
              :model-value="wlVal('mcpServerIds')"
              :servers="mcpServers"
              @update:model-value="(v) => patchAgent({ mcpServerIds: v })"
            />
          </div>

          <div v-else-if="detailTab === 'repos'" class="agd-pane">
            <div class="agd-wl-head">
              <span class="agd-wl-state">{{ reposState }}</span>
              <span v-if="patching" class="agd-wl-state">{{ t('common.saving') }}</span>
            </div>
            <AgentReposPicker
              :model-value="wlVal('repos')"
              :projects="projectListWithPath"
              @update:model-value="(v) => patchAgent({ repos: v })"
            />
          </div>

          <!-- Sessions — "session nằm sau agent": mọi phiên đang bind vai này -->
          <div v-else class="agd-pane">
            <Input
              v-if="agentSessions.length > 4"
              v-model="sessionQ"
              :placeholder="t('common.search')"
              class="agd-ses-q"
            />
            <div v-if="!filteredSessions.length" class="agd-pane-empty">
              {{ t('agents.detail.noSessions') }}
            </div>
            <button
              v-for="s in filteredSessions"
              :key="s.id"
              class="agd-run"
              @click="openSession(s)"
            >
              <span class="agd-run-dot" :style="{ background: statusColor(s) }" />
              <span class="agd-run-title">{{ s.title }}</span>
              <span class="agd-run-proj">{{ projectName(s.project) }}</span>
              <span class="agd-run-when">{{ s.when }}</span>
              <Icon name="chev" class="size-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <aside class="agd-insp">
          <div class="agd-insp-h">{{ t('agents.detail.props') }}</div>
          <button class="agd-prop" @click="openEditor(detail)">
            <span class="agd-prop-l">{{ t('agents.detail.provider') }}</span>
            <span class="agd-prop-v">{{ providerDisplayName(detail.provider) }}</span>
          </button>
          <button class="agd-prop" @click="openEditor(detail)">
            <span class="agd-prop-l">{{ t('agents.detail.model') }}</span>
            <span class="agd-prop-v">{{ modelDisplayName(detail.model) }}</span>
          </button>
          <button class="agd-prop" @click="openEditor(detail)">
            <span class="agd-prop-l">{{ t('agents.detail.role') }}</span>
            <span class="agd-prop-v">{{ detail.role || '—' }}</span>
          </button>
          <!-- Whitelist props jump to their detail tab (editable inline);
               scalar props still open the full editor. -->
          <button class="agd-prop" @click="detailTab = 'skills'">
            <span class="agd-prop-l">{{ t('agents.editor.skills') }}</span>
            <span class="agd-prop-v">{{ skillsState }}</span>
          </button>
          <button class="agd-prop" @click="detailTab = 'tools'">
            <span class="agd-prop-l">{{ t('agents.detail.tools') }}</span>
            <span class="agd-prop-v">{{ toolsState }}</span>
          </button>
          <button class="agd-prop" @click="detailTab = 'connections'">
            <span class="agd-prop-l">{{ t('agents.detail.connections') }}</span>
            <span class="agd-prop-v">{{ connectionsState }}</span>
          </button>
          <button class="agd-prop" @click="detailTab = 'repos'">
            <span class="agd-prop-l">{{ t('agents.editor.repos') }}</span>
            <span class="agd-prop-v">{{ reposState }}</span>
          </button>
        </aside>
      </div>
    </template>

    <!-- Chọn đường tạo: Start blank | Build with AI (Multica new-agent). -->
    <CreateChooser
      :open="chooserOpen"
      :title="t('agents.create.title')"
      :blank-desc="t('agents.create.blankDesc')"
      :ai-desc="t('agents.create.aiDesc')"
      @close="chooserOpen = false"
      @blank="onCreateBlank"
      @ai="onCreateAi"
    />

    <!-- create (chat-driven AGENT.md authoring) -->
    <AgentPromptCreator
      :open="creatorOpen"
      :account="account"
      @close="onCreatorClose"
      @turn="onCreatorTurn"
      @manual="onCreateBlank"
    />

    <!-- edit (form) -->
    <AgentEditor
      :open="editorOpen"
      :agent="editTarget"
      :projects="projectListWithPath"
      :mcp-servers="mcpServers"
      :skills="skills"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- edit system prompt (LLM revise) -->
    <AgentBodyEditModal
      v-if="bodyEditTarget"
      :open="bodyEditOpen"
      :agent="bodyEditTarget"
      :account-id="accountId"
      @apply="onApplyBodyEdit"
      @cancel="closeBodyEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('agents.delete')"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </section>
</template>

<script setup lang="ts">
// Agents — redesign theo khuôn Multica: list-grid hai dòng (avatar + name +
// desc, cột Model/Role/Sessions/Last active/Tier/kebab) → detail page
// (back header + tab Instructions/Sessions + inspector rail properties).
// Logic CRUD/creator/body-edit vẫn sống ở useAgentsPage — page chỉ đổi shell.
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '~/components/Icon.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import AppCheckbox from '~/components/common/AppCheckbox.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import AgentBodyEditModal from '~/components/agent/AgentBodyEditModal.vue'
import AgentConnectionsPicker from '~/components/agent/AgentConnectionsPicker.vue'
import AgentEditor from '~/components/agent/AgentEditor.vue'
import AgentPromptCreator from '~/components/agent/AgentPromptCreator.vue'
import AgentReposPicker from '~/components/agent/AgentReposPicker.vue'
import AgentSkillsPicker from '~/components/agent/AgentSkillsPicker.vue'
import AgentToolsPicker from '~/components/agent/AgentToolsPicker.vue'
import CollectionHeader from '~/components/collection/CollectionHeader.vue'
import CollectionList from '~/components/collection/CollectionList.vue'
import CreateChooser from '~/components/collection/CreateChooser.vue'
import EntityAvatar from '~/components/collection/EntityAvatar.vue'
import { modelDisplayName, providerDisplayName } from '~/components/agent/agent-display'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useAgentsPage } from '~/composables/useAgentsPage'
import { useConfirm } from '~/composables/useConfirm'
import { useI18n } from '~/composables/useI18n'
import { dispatchRunSettings } from '~/composables/useProjectLlmDefaults'
import { useToast } from '~/composables/useToast'
import { useAgentsStore } from '~/stores/agents'
import { useSettingsStore, type ProviderName } from '~/stores/settings'
import { providerModelsShown } from '~/composables/useProviderModels'
import { saveTextFile, saveZipFile } from '~/utils/export'
import { useProjects } from '~/composables/useProjects'
import { useRelTime } from '~/composables/useRelTime'
import { useSessionsStore } from '~/stores/sessions'
import { useTeamsStore } from '~/stores/teams'
import { PROVIDER_DISPLAY, STATUS_COLOR, type Session } from '~/composables/useSessionsData'
import { sidecarErrorText } from '~/composables/useSidecar'
import type { Agent } from '~/stores/agents'

const { t } = useI18n()
const { projects, projectPath, projectName } = useProjects()
const sessionsStore = useSessionsStore()

const {
  agents,
  agentKey,
  account,
  accountId,
  mcpServers,
  skills,
  creatorOpen,
  openCreator,
  openCreateForm,
  onCreatorTurn,
  onCreatorClose,
  editorOpen,
  editTarget,
  openEditor,
  closeEditor,
  onSave,
  bodyEditOpen,
  bodyEditTarget,
  openBodyEdit,
  closeBodyEdit,
  onApplyBodyEdit,
  onDuplicate,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
} = useAgentsPage()

// ── List: search + sort ─────────────────────────────────────────────────────
// Agents are global roles — one flat roster, no scope/tier split. Legacy
// project-tier agents still list here (flat) so nothing vanishes silently.
const query = ref('')
const chooserOpen = ref(false)
const sortBy = ref<'lastActive' | 'name' | 'runs'>('lastActive')
const sortOpts = computed<AppSelectOption[]>(() => [
  { value: 'lastActive', label: t('agents.sort.lastActive') },
  { value: 'name', label: t('agents.sort.name') },
  { value: 'runs', label: t('agents.sort.runs') },
])

// ── Team filter ─────────────────────────────────────────────────────────────
// Membership lấy từ TeamSpec bền (lead + members[].agent), so khớp bằng cùng
// khoá tổng hợp `source|projectId|id` của agentKey — ref của spec có thể
// thiếu `source` (mặc định global) nên normalize hai phía giống nhau.
const teamsStore = useTeamsStore()
const TEAM_NONE = '__none__'
const teamFilter = ref('')

const refKey = (r: { id: string; source?: 'global' | 'project'; projectId?: string }): string =>
  `${r.source ?? 'global'}|${r.projectId ?? ''}|${r.id}`

// teamKey → tập agentKey của mọi member + lead.
const teamMemberKeys = computed(() => {
  const map = new Map<string, Set<string>>()
  for (const team of teamsStore.teams) {
    const keys = new Set<string>()
    if (team.lead) keys.add(refKey(team.lead))
    for (const m of team.members) if (m.agent) keys.add(refKey(m.agent))
    map.set(teamsStore.teamKey(team), keys)
  }
  return map
})

const inNoTeam = (a: Agent): boolean => {
  const k = agentKey(a)
  for (const keys of teamMemberKeys.value.values()) if (keys.has(k)) return false
  return true
}

const teamFilterOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('agents.filter.teamAll') },
  { value: TEAM_NONE, label: t('agents.filter.teamNone') },
  ...teamsStore.teams.map((team) => ({
    value: teamsStore.teamKey(team),
    label:
      (team.source ?? 'global') === 'project'
        ? `${team.name} · ${projectName(team.projectId ?? '')}`
        : team.name,
  })),
])

// Team bị xoá trong lúc filter đang chọn nó → về "tất cả" thay vì giữ value mồ côi.
watch(teamFilterOpts, (opts) => {
  if (teamFilter.value && !opts.some((o) => o.value === teamFilter.value)) teamFilter.value = ''
})

// Teams chỉ phục vụ filter — nạp cùng roster projectIds như trang teams.
const loadTeams = (): void => {
  void teamsStore.load(projects.value.map((p) => p.id))
}
onMounted(loadTeams)
watch(() => projects.value.map((p) => p.id).join(','), loadTeams)

const filteredAgents = computed(() => {
  const q = query.value.trim().toLowerCase()
  const tf = teamFilter.value
  const memberSet = tf && tf !== TEAM_NONE ? teamMemberKeys.value.get(tf) : null
  const list = agents.value.filter((a) => {
    if (tf === TEAM_NONE && !inNoTeam(a)) return false
    if (memberSet && !memberSet.has(agentKey(a))) return false
    if (!q) return true
    return (
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      (a.role ?? '').toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q)
    )
  })
  const key = sortBy.value
  return [...list].sort((x, y) => {
    if (key === 'name') return x.name.localeCompare(y.name)
    if (key === 'runs') return statsFor(y).sessions - statsFor(x).sessions
    // lastActive — mới nhất lên đầu, chưa chạy (rỗng) xuống cuối.
    const ax = statsFor(x).lastIso
    const ay = statsFor(y).lastIso
    if (!ax && !ay) return x.name.localeCompare(y.name)
    if (!ax) return 1
    if (!ay) return -1
    return ay.localeCompare(ax)
  })
})

const COLS = '28px minmax(260px,1fr) 104px 190px 116px 64px 32px'

// ── Bulk selection + export ──────────────────────────────────────────────────
// Tick nhiều agent → export .zip (raw AGENT.md qua agents.export) hoặc xoá
// hàng loạt. Export lẻ (kebab) lưu thẳng file .md.
const agentsStore = useAgentsStore()
const toast = useToast()
const confirm = useConfirm().confirm
const selected = ref(new Set<string>())
const bulkBusy = ref(false)

const allFilteredSelected = computed(
  () =>
    filteredAgents.value.length > 0 &&
    filteredAgents.value.every((a) => selected.value.has(agentKey(a))),
)

function toggleAgent(a: Agent): void {
  const k = agentKey(a)
  const next = new Set(selected.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selected.value = next
}

function toggleAllFiltered(): void {
  const next = new Set(selected.value)
  if (allFilteredSelected.value) {
    for (const a of filteredAgents.value) next.delete(agentKey(a))
  } else {
    for (const a of filteredAgents.value) next.add(agentKey(a))
  }
  selected.value = next
}

async function exportAgent(a: Agent): Promise<void> {
  try {
    const [file] = await agentsStore.exportAgents([
      { id: a.id, source: a.source, projectId: a.projectId },
    ])
    if (!file) throw new Error('no file')
    const name = await saveTextFile(file.name, file.content, [
      { name: 'Markdown', extensions: ['md'] },
    ])
    if (name) toast.add({ title: t('agents.exportDone', { name }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('agents.exportFailed'), description: String(err), color: 'error' })
  }
}

async function exportSelected(): Promise<void> {
  const list = agents.value.filter((a) => selected.value.has(agentKey(a)))
  if (!list.length) return
  bulkBusy.value = true
  try {
    const files = await agentsStore.exportAgents(
      list.map((a) => ({ id: a.id, source: a.source, projectId: a.projectId })),
    )
    const name = await saveZipFile(`awog-agents-${files.length}.zip`, files)
    if (name) toast.add({ title: t('agents.exportDone', { name }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('agents.exportFailed'), description: String(err), color: 'error' })
  } finally {
    bulkBusy.value = false
  }
}

async function bulkDelete(): Promise<void> {
  const list = agents.value.filter((a) => selected.value.has(agentKey(a)))
  if (!list.length) return
  const ok = await confirm({
    title: t('agents.bulk.deleteTitle', { n: list.length }),
    description: t('agents.bulk.deleteDesc', { n: list.length }),
    kind: 'danger',
  })
  if (!ok) return
  bulkBusy.value = true
  try {
    for (const a of list) {
      await agentsStore.deleteAgent(a.id, a.source, a.projectId)
    }
    selected.value = new Set()
    toast.add({ title: t('agents.bulk.deleteDone', { n: list.length }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('agents.bulk.deleteFailed'), description: String(err), color: 'error' })
  } finally {
    bulkBusy.value = false
  }
}

// Bulk edit — đổi provider+model cho mọi agent đang tick. Options = catalog
// của các provider đã connect (khuôn AiModelPicker, nhưng không có "Auto" —
// bulk edit phải chọn model cụ thể).
const settingsStore = useSettingsStore()
const bulkModelOpts = computed<AppSelectOption[]>(() => {
  const opts: AppSelectOption[] = []
  for (const p of ['anthropic', 'openai', 'google'] as ProviderName[]) {
    if (!settingsStore.providers[p]?.accounts?.length) continue
    for (const m of providerModelsShown(p)) {
      opts.push({ value: `${p}|${m.id}`, label: `${PROVIDER_DISPLAY[p]} · ${m.name}` })
    }
  }
  return opts
})

async function bulkSetModel(v: string): Promise<void> {
  const [provider, model] = v.split('|')
  if (!provider || !model) return
  const list = agents.value.filter((a) => selected.value.has(agentKey(a)))
  if (!list.length) return
  bulkBusy.value = true
  try {
    for (const a of list) {
      await agentsStore.saveAgent({ ...a, provider: provider as ProviderName, model })
    }
    selected.value = new Set()
    toast.add({
      title: t('agents.bulk.setModelDone', { n: list.length, model }),
      color: 'success',
    })
  } catch (err) {
    toast.add({ title: t('agents.bulk.setModelFailed'), description: String(err), color: 'error' })
  } finally {
    bulkBusy.value = false
  }
}

// Agent bị xoá/đổi key bên ngoài → rơi khỏi selection để bar không đếm ma.
watch(agents, (list) => {
  const keys = new Set(list.map((a) => agentKey(a)))
  const pruned = new Set([...selected.value].filter((k) => keys.has(k)))
  if (pruned.size !== selected.value.size) selected.value = pruned
})

// Session gắn vào agent (vai thật) — "session nằm sau agent". Khớp cả
// source/projectId để hai tầng cùng id không đếm lẫn nhau.
const sessionsOf = (a: Agent): Session[] =>
  sessionsStore.sessions.filter(
    (s) =>
      s.agent?.id === a.id &&
      (s.agent.source ?? 'global') === a.source &&
      (a.source !== 'project' || s.agent.projectId === a.projectId),
  )

function statsFor(a: Agent): { sessions: number; lastIso: string } {
  const list = sessionsOf(a)
  const last = list
    .map((s) => s.updatedAt ?? s.createdAt ?? '')
    .filter(Boolean)
    .sort()
    .pop()
  return { sessions: list.length, lastIso: last ?? '' }
}

// "Online" của Multica = agent đang có phiên sống (streaming/awaiting).
const isLive = (a: Agent): boolean =>
  sessionsOf(a).some((s) => s.status === 'streaming' || s.status === 'awaiting')

// Cột Last active dạng relative ("5 phút trước" / "Chưa hoạt động").
const relTime = useRelTime()

// ── Detail view ─────────────────────────────────────────────────────────────
// detail resolves through the store by key — a save (modal or inline whitelist
// toggle) re-renders the pane with the fresh object, a delete drops back to the
// list automatically.
const detailKey = ref<string | null>(null)
const detail = computed<Agent | null>(() =>
  detailKey.value ? (agentsStore.agentByKey(detailKey.value) ?? null) : null,
)
type DetailTab = 'instructions' | 'skills' | 'tools' | 'connections' | 'repos' | 'sessions'
const detailTab = ref<DetailTab>('instructions')

function openDetail(a: Agent): void {
  detailKey.value = agentKey(a)
  detailTab.value = 'instructions'
  wlOverlay.value = {}
  sessionQ.value = ''
}

// Inline whitelist edit — the same pickers AgentEditor uses, bound to the
// agent: each toggle persists via agents.upsert. `undefined` = unrestricted
// (skills/tools/repos) or inherit session (connections); the serializer drops
// empty lists, so emitting undefined keeps both semantics identical.
//
// Optimistic overlay: pickers are store-bound, so without it a checkbox would
// revert visually until the upsert lands. Overlay fields shadow `detail` while
// the save queue drains; saves are serialized so rapid ticks can't overwrite
// each other (each save sends the CURRENT full overlay — last write wins).
const wlOverlay = ref<Partial<Agent>>({})
const patching = ref(false)
let patchSeq: Promise<void> = Promise.resolve()

/** Picker binding — overlay value shadows the store while a patch is in flight. */
type WlField = 'skillIds' | 'tools' | 'mcpServerIds' | 'repos'
const wlVal = (k: WlField): string[] | undefined =>
  k in wlOverlay.value ? wlOverlay.value[k] : detail.value?.[k]

function patchAgent(patch: Partial<Agent>): void {
  if (!detail.value) return
  Object.assign(wlOverlay.value, patch)
  patching.value = true
  patchSeq = patchSeq.then(async () => {
    const cur = detail.value
    if (!cur) return
    const sent = { ...wlOverlay.value }
    try {
      await agentsStore.saveAgent({ ...cur, ...sent })
      // Drop only the fields just persisted — a newer patch may already have
      // re-overlaid a different value for the same key (identity check).
      const o = { ...wlOverlay.value }
      for (const k of Object.keys(sent) as (keyof Agent)[]) {
        if (o[k] === sent[k]) delete o[k]
      }
      wlOverlay.value = o
    } catch (err) {
      wlOverlay.value = {}
      console.error('[agents] inline patch failed', err)
      toast.add({
        title: t('agents.detail.patchFailed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
    } finally {
      patching.value = false
    }
  })
}

const agentSessions = computed<Session[]>(() => {
  const a = detail.value
  return a ? sessionsOf(a) : []
})

// Sessions tab search — filter by title / project / engine id.
const sessionQ = ref('')
const filteredSessions = computed<Session[]>(() => {
  const needle = sessionQ.value.trim().toLowerCase()
  if (!needle) return agentSessions.value
  return agentSessions.value.filter(
    (s) =>
      s.title.toLowerCase().includes(needle) ||
      projectName(s.project).toLowerCase().includes(needle) ||
      (s.engineId ?? '').toLowerCase().includes(needle),
  )
})

// Whitelist state labels — shown in the tab pane header + inspector rows.
const skillsState = computed(() =>
  detail.value?.skillIds?.length
    ? t('agents.editor.skillsAllowed', { n: detail.value.skillIds.length })
    : t('agents.editor.skillsAll'),
)
const toolsState = computed(() =>
  detail.value?.tools?.length
    ? t('agents.detail.toolsN', { n: detail.value.tools.length })
    : t('agents.detail.toolsAll'),
)
const connectionsState = computed(() =>
  detail.value?.mcpServerIds?.length
    ? t('agents.detail.connectionsN', { n: detail.value.mcpServerIds.length })
    : t('agents.detail.connectionsAll'),
)
const reposState = computed(() =>
  detail.value?.repos?.length
    ? t('agents.editor.reposAllowed', { n: detail.value.repos.length })
    : t('agents.editor.reposAll'),
)

const detailTabs = computed(() => {
  const a = detail.value
  return [
    { id: 'instructions' as const, label: t('agents.detail.tabInstructions'), icon: 'file' },
    {
      id: 'skills' as const,
      label: t('agents.editor.skills'),
      icon: 'skills',
      count: a?.skillIds?.length || undefined,
    },
    {
      id: 'tools' as const,
      label: t('agents.editor.tools'),
      icon: 'zap',
      count: a?.tools?.length || undefined,
    },
    {
      id: 'connections' as const,
      label: t('agents.editor.connections'),
      icon: 'conn',
      count: a?.mcpServerIds?.length || undefined,
    },
    {
      id: 'repos' as const,
      label: t('agents.editor.repos'),
      icon: 'git',
      count: a?.repos?.length || undefined,
    },
    {
      id: 'sessions' as const,
      label: t('agents.detail.tabSessions'),
      icon: 'sessions',
      count: agentSessions.value.length,
    },
  ]
})

const statusColor = (s: Session): string => STATUS_COLOR[s.status] ?? 'var(--muted-foreground)'

function openSession(s: Session): void {
  void sessionsStore.openByEngineId(s.engineId ?? '')
  void navigateTo(`/sessions?id=${encodeURIComponent(s.engineId ?? '')}`)
}

// ── Chat with agent — materialize spec thành phiên chat thật (agents.run) ──
// Provider/model/account lấy theo CẤU HÌNH CỦA AGENT (đó là điểm của các field
// đó); thiếu thì fallback session defaults. projectId null = chat tự do kiểu
// trợ lý cá nhân, không gắn workspace.
const chatBusy = ref(false)
async function chatWithAgent(projectId: string | null): Promise<void> {
  const a = detail.value
  if (!a || chatBusy.value) return
  chatBusy.value = true
  try {
    // Spec ghim provider/model/account thắng; field trống → theo project
    // llmDefaults → global (dispatchRunSettings — cùng merge với board/teams
    // nên agent không ghim account sẽ chạy account mà project đích đã ghim).
    const res = await agentsStore.runAgent(
      a,
      projectId,
      dispatchRunSettings(projectId, {
        provider: a.provider,
        model: a.model,
        accountId: a.accountId,
      }),
    )
    if (!res?.sessionId) return
    void sessionsStore.openByEngineId(res.sessionId)
    void navigateTo(`/sessions?id=${encodeURIComponent(res.sessionId)}`)
  } catch (err) {
    toast.add({
      title: t('agents.detail.chatFailed'),
      description: sidecarErrorText(err),
      color: 'error',
    })
  } finally {
    chatBusy.value = false
  }
}

// ── Create chooser ───────────────────────────────────────────────────────────
function onCreateBlank(): void {
  chooserOpen.value = false
  creatorOpen.value = false
  openCreateForm()
}
function onCreateAi(): void {
  chooserOpen.value = false
  openCreator()
}

// Project list enriched with the on-disk path (for tier hints in editor/detail).
const projectListWithPath = computed(() =>
  projects.value.map((p) => ({ id: p.id, name: p.name, path: projectPath(p.id) ?? undefined })),
)
</script>

<style scoped>
.agentspage.page {
  flex-direction: column;
  position: relative; /* neo cho .agt-bulk nổi đáy */
}
/* ── Toolbar (search + filter) ── */
.agt-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.agt-flex {
  flex: 1;
}
.agt-bar :deep(.appselect) {
  min-width: 150px;
}

/* ── Identity cell: avatar + name/desc hai dòng (64px row) ── */
.agt-id {
  gap: 10px;
}
/* Chấm "live" đè góc avatar — Multica agents-page overlay. */
.agt-avw {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
}
.agt-avdot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--success);
  /* Viền khớp nền row (--background của CollectionList) để chấm "cắt" avatar. */
  border: 2px solid var(--background);
}
/* Status cell: dot + label (Active accent / Idle muted). */
.agt-st {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
}
.agt-std {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted-foreground);
}
.agt-st.on {
  color: var(--success);
}
.agt-st.on .agt-std {
  background: var(--success);
}
/* Runs — cột số căn phải (khuôn bảng Multica). */
.agt-runs {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}
.agt-head-r {
  text-align: right;
}
.agt-idt {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.agt-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agt-desc {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agt-kebab {
  justify-content: flex-end;
}
.agt-kebab .agt-kebab-btn {
  opacity: 0;
  transition: opacity 0.1s ease;
}
.cl-row:hover .agt-kebab .agt-kebab-btn,
.agt-kebab .agt-kebab-btn:focus-visible {
  opacity: 1;
}
/* Checkbox col + hàng được chọn */
.agt-check,
.agt-checkhead {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.cl-row-sel {
  background: var(--accent-wash);
}
/* Bulk bar nổi — đáy giữa. */
.agt-bulk {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--popover);
  box-shadow: var(--shadow-lg);
}
.agt-bulk-n {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--foreground);
  padding-right: 4px;
}

/* ── Empty state ── */
.agt-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.agt-empty-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--muted-foreground);
  margin-bottom: 4px;
}
.agt-empty-t {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--foreground);
}
.agt-empty-d {
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  margin-bottom: 8px;
}

/* ── Detail: back header ── */
.agd-back {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 48px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.agd-back-t {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--foreground);
}
.agd-flex {
  flex: 1;
}

/* ── Detail body: main pane + inspector rail ── */
.agd-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.agd-main {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  padding: 20px 24px;
}
.agd-hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.agd-hero-t {
  min-width: 0;
  flex: 1;
}
.agd-name {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--foreground);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.agd-desc {
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  line-height: var(--lh-sm);
}
.agd-tabc {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  background: var(--muted);
  border-radius: var(--r-pill);
  padding: 0 6px;
}
.agd-pane {
  padding-top: 16px;
}
/* Instructions pane: markdown body's own header has margin-top 20px — kết hợp
   với pane padding thành một dải trống to dưới tab line. Xoá cho pane này. */
.agd-pane :deep(.lmb-head) {
  margin-top: 0;
}
/* Whitelist tab pane — full pane width; state line mirrors the inspector
   value (all / {n} allowed / inherit). */
.agd-wl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.agd-wl-state {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.agd-ses-q {
  width: 280px;
  margin-bottom: 10px;
}
.agd-pane-empty {
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  padding: 24px 0;
  text-align: center;
}
.agd-run {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 2px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  color: var(--foreground);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  cursor: pointer;
  text-align: left;
}
.agd-run:hover {
  background: var(--accent-wash);
}
.agd-run-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.agd-run-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agd-run-proj,
.agd-run-when {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  flex: 0 0 auto;
}

/* ── Inspector rail (khuôn 300px phải của Multica) ── */
.agd-insp {
  flex: 0 0 280px;
  border-left: 1px solid var(--border);
  padding: 16px 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.agd-insp-h {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted-foreground);
  padding: 0 16px 8px;
}
.agd-prop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 16px;
  background: none;
  border: none;
  font-family: var(--sans);
  text-align: left;
  cursor: default;
}
button.agd-prop {
  cursor: pointer;
}
button.agd-prop:hover {
  background: var(--accent-wash);
}
.agd-prop-l {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  flex: 0 0 auto;
}
.agd-prop-v {
  font-size: var(--fs-xs);
  color: var(--foreground);
  text-align: right;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 860px) {
  .agd-body {
    flex-direction: column;
  }
  .agd-insp {
    flex: 0 0 auto;
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
</style>
