<template>
  <section class="page on teampage" data-page="teams">
    <!-- ══ LIST — khuôn Multica squads-page (giống hệt Agents): CollectionHeader
         + toolbar (search · scope tabs có count · project picker · sort) +
         ListGrid (avatar+name/desc | Status | Access | Leader | Members stack |
         Last active | Runs | kebab). ══ -->
    <template v-if="!detail">
      <CollectionHeader
        icon="users"
        :title="t('teams.page.title')"
        :count="filteredTeams.length"
        :tagline="t('teams.page.tagline')"
      >
        <Button variant="outline" @click="chooserOpen = true">
          <Icon name="plus" class="size-3.5" />
          {{ t('teams.page.new') }}
        </Button>
      </CollectionHeader>

      <div class="tp-bar">
        <div class="relative">
          <Icon
            name="search"
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input v-model="query" :placeholder="t('teams.search')" class="w-72 pl-8" />
        </div>
        <!-- Scope — segmented tabs có count, cùng khuôn Agents/Multica. -->
        <Tabs :model-value="scope" @update:model-value="(v) => (scope = v as typeof scope)">
          <TabsList>
            <TabsTrigger value="global" class="h-[var(--ctrl-h-xs)] gap-1.5 px-3 text-xs">
              {{ t('teams.scopeGlobal') }}
              <span class="text-muted-foreground">{{ scopeCounts.global }}</span>
            </TabsTrigger>
            <TabsTrigger value="project" class="h-[var(--ctrl-h-xs)] gap-1.5 px-3 text-xs">
              {{ t('teams.scopeProject') }}
              <span class="text-muted-foreground">{{ scopeCounts.project }}</span>
            </TabsTrigger>
            <TabsTrigger value="all" class="h-[var(--ctrl-h-xs)] gap-1.5 px-3 text-xs">
              {{ t('teams.scope.all') }}
              <span class="text-muted-foreground">{{ scopeCounts.all }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <AppSelect
          v-if="scope === 'project'"
          v-model="scopeProjectSel"
          :options="scopeProjectOpts"
        />
        <span class="tp-flex" />
        <AppSelect v-model="sortBy" :options="sortOpts" />
      </div>

      <CollectionList v-if="filteredTeams.length" :cols="COLS">
        <template #head>
          <span>{{ t('teams.col.team') }}</span>
          <span>{{ t('teams.col.status') }}</span>
          <span>{{ t('teams.col.access') }}</span>
          <span>{{ t('teams.col.leader') }}</span>
          <span>{{ t('teams.col.members') }}</span>
          <span>{{ t('teams.col.lastActive') }}</span>
          <span class="tp-head-r">{{ t('teams.col.runs') }}</span>
          <span />
        </template>
        <div
          v-for="tm in filteredTeams"
          :key="teamsStore.teamKey(tm)"
          class="cl-row"
          @click="openDetail(tm)"
        >
          <div class="cl-cell tp-id">
            <span class="tp-avw">
              <EntityAvatar
                :name="tm.name"
                :seed="teamsStore.teamKey(tm)"
                variant="squad"
                size="md"
              />
              <span v-if="teamLive(tm)" class="tp-avdot" />
            </span>
            <div class="tp-idt">
              <span class="tp-name">{{ tm.name }}</span>
              <span v-if="tm.desc" class="tp-desc">{{ tm.desc }}</span>
            </div>
          </div>
          <div class="cl-cell">
            <span class="tp-st" :class="{ on: teamLive(tm) }">
              <span class="tp-std" />
              {{ teamLive(tm) ? t('teams.status.active') : t('teams.status.idle') }}
            </span>
          </div>
          <div class="cl-cell">{{ tierLabel(tm) }}</div>
          <div class="cl-cell">
            <template v-if="leadOf(tm)">
              <EntityAvatar :name="leadOf(tm)!.name" :seed="leadKeyOf(tm)" size="sm" />
              <span class="tp-celltext">{{ leadOf(tm)!.name }}</span>
            </template>
            <span v-else class="tp-none">—</span>
          </div>
          <div class="cl-cell">
            <span v-if="tm.members.length" class="tp-stack">
              <EntityAvatar
                v-for="m in tm.members.slice(0, 3)"
                :key="m.title"
                :name="agentName(m.agent) ?? m.title"
                :seed="m.agent ? agentKeyOf(m.agent) : m.title"
                size="sm"
              />
              <span v-if="tm.members.length > 3" class="tp-more">+{{ tm.members.length - 3 }}</span>
            </span>
            <span v-else class="tp-none">—</span>
          </div>
          <div class="cl-cell">{{ relTime(lastIsoOf(tm)) }}</div>
          <div class="cl-cell tp-runs">{{ runsFor(tm).length }}</div>
          <div class="cl-cell tp-kebab">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="iconSm" class="tp-kebab-btn" @click.stop>
                  <Icon name="dots" class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <!-- Không cần @click.stop — content teleport ra body nên click
                   trong menu không bubble về row (mở detail) bao giờ. -->
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem @click="openDetail(tm)">
                  <Icon name="external" />
                  {{ t('teams.detail.open') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="onRevise(tm)">
                  <Icon name="sparkles" />
                  {{ t('teams.aiRevise') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="exportTeam(tm)">
                  <Icon name="download" />
                  {{ t('teams.export') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  class="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  @click="onDelete(tm)"
                >
                  <Icon name="trash" />
                  {{ t('teams.deleteTitle') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollectionList>

      <div v-else class="tp-empty">
        <span class="tp-empty-ic"><Icon name="users" class="size-5" /></span>
        <div class="tp-empty-t">{{ t('teams.empty') }}</div>
        <div class="tp-empty-d">{{ t('teams.emptyDesc') }}</div>
        <Button @click="chooserOpen = true">
          <Icon name="plus" class="size-3.5" />
          {{ t('teams.page.new') }}
        </Button>
      </div>
    </template>

    <!-- ══ DETAIL — khuôn squad-detail-page: back header (Run + kebab) +
         pane tabs (Members | Instructions | Runs) + inspector rail
         (name/desc inline, leader, scope, timestamps). Một surface edit cho
         cả create lẫn update — dirty ⇒ thanh Save nổi trên đầu. ══ -->
    <template v-else>
      <header class="tpd-back">
        <Button variant="ghost" size="iconSm" :title="t('teams.detail.back')" @click="closeDetail">
          <Icon name="arrow-left" class="size-4" />
        </Button>
        <span class="tpd-back-t">
          {{ isNew ? t('teams.new') : draft.name || t('teams.page.title') }}
        </span>
        <span class="tpd-flex" />
        <Button variant="ghost" size="iconSm" :title="t('teams.aiRevise')" @click="openAi">
          <Icon name="sparkles" class="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="iconSm">
              <Icon name="dots" class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuItem @click="openAi">
              <Icon name="sparkles" />
              {{ t('teams.aiRevise') }}
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="isNew" @click="detail && exportTeam(detail)">
              <Icon name="download" />
              {{ t('teams.export') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              class="text-destructive focus:bg-destructive/10 focus:text-destructive"
              :disabled="isNew"
              @click="detail && onDelete(detail)"
            >
              <Icon name="trash" />
              {{ t('teams.deleteTitle') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <!-- Run = DropdownMenu chọn project đích (spec global chạy được trên
             mọi project + "không project"). -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button size="sm" :disabled="isNew || !canRun">
              <Icon name="play" class="size-3.5" />
              {{ t('teams.run') }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuItem
              v-for="p in projectsStore.projects"
              :key="p.id"
              @click="onRunProject(p.id)"
            >
              <Icon name="folder" />
              <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="projectsStore.projects.length" />
            <DropdownMenuItem @click="onRunProject('')">
              <Icon name="globe" />
              {{ t('teams.runLoose') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div v-if="dirty" class="tpd-dirty">
        <span>{{ t('teams.detail.unsaved') }}</span>
        <Button variant="ghost" size="sm" @click="resetDraft">{{ t('common.discard') }}</Button>
        <Button size="sm" :disabled="!canSave || saving" @click="saveDraft">
          {{ isNew ? t('common.create') : t('common.save') }}
        </Button>
      </div>

      <div class="tpd-body">
        <div class="tpd-main">
          <Tabs
            :model-value="detailTab"
            @update:model-value="(v) => (detailTab = v as typeof detailTab)"
          >
            <TabsList
              class="h-9 justify-start gap-0 rounded-none border-b border-border bg-transparent p-0"
            >
              <TabsTrigger
                v-for="tab in tabs"
                :key="tab.id"
                :value="tab.id"
                class="h-9 gap-1.5 rounded-none border-b-2 border-transparent px-3 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <Icon :name="tab.icon" class="size-3.5" />
                {{ tab.label }}
                <span v-if="tab.count != null" class="tpd-tabc">{{ tab.count }}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <!-- MEMBERS — lead (vương miện) + member rows: title + agent picker +
               set-leader + remove; "+ Thêm member". Khuôn members tab Multica. -->
          <div v-if="detailTab === 'members'" class="tpd-pane">
            <div class="tpd-mrow tp-lead">
              <Icon name="crown" class="tpd-crown" />
              <div class="tpd-mid">
                <div class="tpd-magent">
                  <AppSelect
                    v-model="draft.leadKey"
                    :options="leadOpts"
                    class="tpd-msel"
                    searchable
                    :search-placeholder="t('common.search')"
                    :placeholder="t('teams.leadNone')"
                  />
                  <span v-if="createAgents && !draft.leadKey" class="tpd-auto-chip">
                    <Icon name="sparkles" class="size-3" />
                    {{ t('teams.autoAgent') }}
                  </span>
                </div>
                <span class="tpd-role">{{ t('teams.detail.leadHint') }}</span>
              </div>
            </div>
            <div v-for="(m, i) in draft.members" :key="i" class="tpd-mrow">
              <EntityAvatar :name="m.title || '?'" :seed="m.agentKey || m.title" size="sm" />
              <div class="tpd-mid">
                <Input
                  v-model="m.title"
                  class="tpd-min"
                  :placeholder="t('teams.memberTitlePh')"
                  maxlength="80"
                />
                <div class="tpd-magent">
                  <AppSelect
                    v-model="m.agentKey"
                    :options="agentOpts"
                    class="tpd-msel"
                    searchable
                    :search-placeholder="t('common.search')"
                    :placeholder="t('teams.agentNone')"
                  />
                  <span v-if="createAgents && !m.agentKey" class="tpd-auto-chip">
                    <Icon name="sparkles" class="size-3" />
                    {{ t('teams.autoAgent') }}
                  </span>
                </div>
              </div>
              <Button
                v-if="m.agentKey"
                variant="ghost"
                size="iconSm"
                :title="t('teams.detail.makeLeader')"
                @click="makeLeader(m)"
              >
                <Icon name="crown" class="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="iconSm"
                :title="t('common.remove')"
                @click="draft.members.splice(i, 1)"
              >
                <Icon name="x" class="size-3.5" />
              </Button>
            </div>
            <Button
              variant="outline"
              class="tpd-add"
              @click="draft.members.push({ title: '', agentKey: '' })"
            >
              <Icon name="plus" class="size-3.5" />
              {{ t('teams.addMember') }}
            </Button>
            <!-- Option: member/lead chưa chọn agent → lưu team sẽ tạo AGENT.md
                 tương ứng cùng tầng rồi bind vào spec. -->
            <div class="tpd-autorow">
              <Switch v-model:checked="createAgents" />
              <div class="tpd-autotext">
                <span>{{ t('teams.autoCreateAgents') }}</span>
                <span class="tpd-autohint">{{ t('teams.autoCreateAgentsHint') }}</span>
              </div>
            </div>
          </div>

          <!-- INSTRUCTIONS — chỉ dẫn cấp đội, chỉ lead nhận (Multica). -->
          <div v-else-if="detailTab === 'instructions'" class="tpd-pane">
            <p class="tpd-hint">{{ t('teams.detail.instructionsHint') }}</p>
            <Textarea
              v-model="draft.instructions"
              rows="12"
              :placeholder="t('teams.detail.instructionsPh')"
            />
          </div>

          <!-- RUNS — các lần materialize đang sống của spec này. -->
          <div v-else class="tpd-pane">
            <div v-if="!detailRuns.length" class="tpd-pane-empty">
              {{ t('teams.detail.noRuns') }}
            </div>
            <button v-for="r in detailRuns" :key="r.root.id" class="tpd-run" @click="openRun(r)">
              <span class="tpd-dot" :style="{ background: runColor(r.root) }" />
              <span class="tpd-run-title">{{ r.root.title }}</span>
              <span class="tpd-run-proj">{{ runProject(r.root) }}</span>
              <span class="tpd-run-meta">{{ t('teams.runMembers', { n: r.members.length }) }}</span>
              <span class="tpd-run-meta">{{ runWhen(r.root) }}</span>
              <Icon name="chev" class="size-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        <!-- Inspector — name/desc inline edit + properties đọc (scope, leader,
             created/updated). Khuôn inspector 320px của squad-detail. -->
        <aside class="tpd-insp">
          <div class="tpd-avrow">
            <EntityAvatar
              :name="draft.name || '?'"
              :seed="draft.id || draft.name"
              variant="squad"
              size="lg"
            />
          </div>
          <Input
            v-model="draft.name"
            class="-ml-2 h-auto border-transparent bg-transparent px-2 py-1 text-base font-semibold tracking-tight shadow-none hover:border-input focus-visible:border-input"
            :placeholder="t('teams.namePh')"
            maxlength="120"
          />
          <Textarea
            v-model="draft.desc"
            class="-ml-2 mt-1 min-h-0 resize-y border-transparent bg-transparent px-2 py-1 text-xs leading-relaxed text-muted-foreground shadow-none hover:border-input focus-visible:border-input focus-visible:text-foreground"
            rows="2"
            :placeholder="t('teams.descPh')"
            maxlength="2000"
          />

          <div class="tpd-insp-h">{{ t('teams.detail.props') }}</div>
          <div class="tpd-prop">
            <span class="tpd-prop-l">{{ t('teams.fieldScope') }}</span>
            <AppSelect
              v-model="draft.scopeKey"
              :options="scopeOpts"
              :disabled="!isNew"
              style="min-width: 130px"
            />
          </div>
          <div class="tpd-prop">
            <span class="tpd-prop-l">{{ t('teams.col.members') }}</span>
            <span class="tpd-prop-v">{{ draft.members.length + (draft.leadKey ? 1 : 0) }}</span>
          </div>
          <div v-if="!isNew" class="tpd-prop">
            <span class="tpd-prop-l">{{ t('teams.col.created') }}</span>
            <span class="tpd-prop-v">{{ fmtDate(detail.createdAt) }}</span>
          </div>
          <div v-if="!isNew" class="tpd-prop">
            <span class="tpd-prop-l">{{ t('teams.detail.updated') }}</span>
            <span class="tpd-prop-v">{{ fmtDate(detail.updatedAt) }}</span>
          </div>
          <div v-if="!isNew" class="tpd-prop">
            <span class="tpd-prop-l">ID</span>
            <span class="tpd-prop-v mono">{{ detail.id }}</span>
          </div>
        </aside>
      </div>
    </template>

    <!-- Chọn đường tạo: Start blank | Build with AI. -->
    <CreateChooser
      :open="chooserOpen"
      :title="t('teams.create.title')"
      :blank-desc="t('teams.create.blankDesc')"
      :ai-desc="t('teams.create.aiDesc')"
      @close="chooserOpen = false"
      @blank="onCreateBlank"
      @ai="openAi"
    />

    <!-- AI brief modal — create (draft mới) hoặc revise (kèm current spec). -->
    <LibraryEntityModal
      :open="aiOpen"
      :title="isNew || !detail ? t('teams.aiDraft') : t('teams.aiRevise')"
      :width="480"
      @close="aiOpen = false"
    >
      <div class="tpai">
        <p class="tpd-hint">{{ t('teams.aiHint') }}</p>
        <Textarea
          v-model="aiBrief"
          rows="4"
          :disabled="aiBusy"
          :placeholder="t('teams.aiBriefPh')"
        />
      </div>
      <template #footer>
        <AiModelPicker width="190px" />
        <span class="flex-1" />
        <Button variant="outline" @click="aiOpen = false">{{ t('common.cancel') }}</Button>
        <Button :disabled="aiBusy || !aiBrief.trim()" @click="runDraft">
          <Icon
            :name="aiBusy ? 'refresh' : 'sparkles'"
            class="size-3.5"
            :class="{ spin: aiBusy }"
          />
          {{ aiBusy ? t('teams.aiDrafting') : t('teams.aiGo') }}
        </Button>
      </template>
    </LibraryEntityModal>
  </section>
</template>

<script setup lang="ts">
// Teams — redesign theo khuôn Multica squads: list-grid 2-line (leader +
// members stack + runs + tier + created) → detail page (tabs Members /
// Instructions / Runs + inspector rail name-desc-properties). Detail chính
// là surface edit dùng chung cho create (isNew) lẫn update — dirty bar Save.
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '~/components/Icon.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Switch from '~/components/ui/switch/Switch.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import AiModelPicker from '~/components/common/AiModelPicker.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import CollectionHeader from '~/components/collection/CollectionHeader.vue'
import CollectionList from '~/components/collection/CollectionList.vue'
import CreateChooser from '~/components/collection/CreateChooser.vue'
import EntityAvatar from '~/components/collection/EntityAvatar.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useI18n } from '~/composables/useI18n'
import { useRelTime } from '~/composables/useRelTime'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { useToast } from '~/composables/useToast'
import { isAuthError } from '~/utils/auth-error'
import { exportSlug, saveTextFile } from '~/utils/export'
import { useAgentsStore } from '~/stores/agents'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import { dispatchRunSettings } from '~/composables/useProjectLlmDefaults'
import { useTeamsStore, type TeamSpec } from '~/stores/teams'
import { sidecarErrorText } from '~/composables/useSidecar'
import type { Session, SessionAgentRef } from '~/composables/useSessionsData'
import { STATUS_COLOR } from '~/composables/useSessionsData'

const { t } = useI18n()
const { confirm } = useConfirm()
const toast = useToast()
const { openSettings } = useSettingsModal()
const teamsStore = useTeamsStore()
const sessions = useSessionsStore()
const projectsStore = useProjectsStore()
const agentsStore = useAgentsStore()
const settings = useSettingsStore()

// ── Agent ref ↔ select key ──────────────────────────────────────────────────
const agentKeyOf = (r: SessionAgentRef): string =>
  `${r.source ?? 'global'}|${r.projectId ?? ''}|${r.id}`
const agentRefOf = (key: string): SessionAgentRef | undefined => {
  if (!key) return undefined
  const [source, projectId, id] = key.split('|')
  if (!id) return undefined
  const ref: SessionAgentRef = { id }
  if (source === 'project') {
    ref.source = 'project'
    if (projectId) ref.projectId = projectId
  } else if (source === 'global') {
    ref.source = 'global'
  }
  return ref
}

const agentByKey = (key: string) => {
  const r = agentRefOf(key)
  if (!r) return null
  return (
    agentsStore.agents.find(
      (a) =>
        a.id === r.id &&
        a.source === (r.source ?? 'global') &&
        (r.source !== 'project' || a.projectId === r.projectId),
    ) ?? null
  )
}
const agentName = (r?: SessionAgentRef): string | null =>
  r ? (agentByKey(agentKeyOf(r))?.name ?? r.id) : null

// ── List state — segmented scope + sort, cùng ngữ pháp trang Agents ──────────
const query = ref('')
const chooserOpen = ref(false)
// Scope = "danh sách team của ngữ cảnh X": global (~/.awog/teams) | project
// (spec của scopeProject + global chưa bị shadow cùng id) | all.
const scope = ref<'global' | 'project' | 'all'>('global')
const scopeProject = ref('')
const scopeProjectSel = computed({
  get: () => scopeProject.value || projectsStore.projects[0]?.id || '',
  set: (v: string) => {
    scopeProject.value = v
  },
})
const effProject = computed(() => scopeProjectSel.value)
const scopeProjectOpts = computed<AppSelectOption[]>(() =>
  projectsStore.projects.map((p) => ({ value: p.id, label: p.name })),
)
const sortBy = ref<'lastActive' | 'name' | 'members' | 'runs'>('lastActive')
const sortOpts = computed<AppSelectOption[]>(() => [
  { value: 'lastActive', label: t('teams.sort.lastActive') },
  { value: 'name', label: t('teams.sort.name') },
  { value: 'members', label: t('teams.sort.members') },
  { value: 'runs', label: t('teams.sort.runs') },
])

const COLS = 'minmax(220px,1fr) 104px 110px 150px 130px 110px 60px 32px'

// Spec project cùng id đè spec global trong scope project (giống rule agents).
const shadowedIds = computed(
  () =>
    new Set(
      teamsStore.teams
        .filter((tm) => tm.source === 'project' && tm.projectId === effProject.value)
        .map((tm) => tm.id),
    ),
)
const inScope = (tm: TeamSpec): boolean => {
  if (scope.value === 'all') return true
  if (scope.value === 'global') return tm.source !== 'project'
  if (tm.source === 'project') return tm.projectId === effProject.value
  return !shadowedIds.value.has(tm.id)
}
const scopeCounts = computed(() => ({
  global: teamsStore.teams.filter((tm) => tm.source !== 'project').length,
  project: teamsStore.teams.filter(
    (tm) =>
      (tm.source === 'project' && tm.projectId === effProject.value) ||
      (tm.source !== 'project' && !shadowedIds.value.has(tm.id)),
  ).length,
  all: teamsStore.teams.length,
}))

const filteredTeams = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = teamsStore.teams.filter((tm) => {
    if (!inScope(tm)) return false
    if (!q) return true
    return (
      tm.name.toLowerCase().includes(q) ||
      (tm.desc ?? '').toLowerCase().includes(q) ||
      (tm.lead?.id ?? '').includes(q) ||
      tm.members.some((m) => m.title.toLowerCase().includes(q) || m.agent?.id.includes(q))
    )
  })
  const key = sortBy.value
  return [...list].sort((x, y) => {
    if (key === 'name') return x.name.localeCompare(y.name)
    if (key === 'members') return y.members.length - x.members.length
    if (key === 'runs') return runsFor(y).length - runsFor(x).length
    // lastActive — run mới nhất lên đầu, chưa chạy xuống cuối theo tên.
    const ax = lastIsoOf(x)
    const ay = lastIsoOf(y)
    if (!ax && !ay) return x.name.localeCompare(y.name)
    if (!ax) return 1
    if (!ay) return -1
    return ay.localeCompare(ax)
  })
})

const tierLabel = (tm: TeamSpec): string =>
  tm.source === 'project'
    ? (projectsStore.projectById(tm.projectId ?? '')?.name ?? t('teams.scopeProject'))
    : t('teams.scopeGlobal')

const leadOf = (tm: TeamSpec) => (tm.lead ? agentByKey(agentKeyOf(tm.lead)) : null)
const leadKeyOf = (tm: TeamSpec) => (tm.lead ? agentKeyOf(tm.lead) : '')

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

// ── Runs đang sống — root = session có teamId của spec, không teamRunId ──
type LiveRun = { root: Session; members: Session[] }
function runsFor(tm: TeamSpec): LiveRun[] {
  const roots = sessions.sessions.filter((s) => s.teamId === tm.id && !s.teamRunId)
  return roots
    .map((root) => ({
      root,
      members: sessions.sessions.filter((s) => s.teamRunId === root.engineId),
    }))
    .sort((a, b) => (b.root.createdAt ?? '').localeCompare(a.root.createdAt ?? ''))
}
const runColor = (s: Session): string => STATUS_COLOR[s.status] ?? 'var(--muted-foreground)'
const runProject = (s: Session): string =>
  s.project ? (projectsStore.projectById(s.project)?.name ?? s.project) : t('teams.runLoose')
const runWhen = (s: Session): string => fmtDate(s.createdAt ?? '')

const LIVE_ST = new Set(['streaming', 'awaiting'])
const liveSession = (s: Session): boolean => LIVE_ST.has(s.status)
// Team "Active" = có ít nhất một run đang sống (root hoặc member đang chạy).
const teamLive = (tm: TeamSpec): boolean =>
  runsFor(tm).some((r) => liveSession(r.root) || r.members.some(liveSession))
// Last active = mốc mới nhất trên mọi session của mọi run — chưa chạy thì
// rỗng (hiện "Chưa hoạt động", sort xuống cuối).
function lastIsoOf(tm: TeamSpec): string {
  let best = ''
  for (const r of runsFor(tm)) {
    for (const s of [r.root, ...r.members]) {
      const iso = s.updatedAt ?? s.createdAt ?? ''
      if (iso > best) best = iso
    }
  }
  return best
}
const relTime = useRelTime()

// ── Detail (create + update một surface) ────────────────────────────────────
type MemberRow = { title: string; agentKey: string }
type Draft = {
  id: string
  name: string
  desc: string
  instructions: string
  leadKey: string
  members: MemberRow[]
  scopeKey: string
}
const detail = ref<TeamSpec | null>(null) // null → create mode kèm draft trắng
const isNew = ref(false)
const draft = ref<Draft>({
  id: '',
  name: '',
  desc: '',
  instructions: '',
  leadKey: '',
  members: [],
  scopeKey: 'global',
})
const detailTab = ref<'members' | 'instructions' | 'runs'>('members')

function draftFromSpec(tm: TeamSpec): Draft {
  return {
    id: tm.id,
    name: tm.name,
    desc: tm.desc ?? '',
    instructions: tm.instructions ?? '',
    leadKey: tm.lead ? agentKeyOf(tm.lead) : '',
    members: tm.members.map((m) => ({
      title: m.title,
      agentKey: m.agent ? agentKeyOf(m.agent) : '',
    })),
    scopeKey: tm.source === 'project' ? (tm.projectId ?? 'project') : 'global',
  }
}
function openDetail(tm: TeamSpec): void {
  detail.value = tm
  isNew.value = false
  draft.value = draftFromSpec(tm)
  detailTab.value = 'members'
  // Store là snapshot last-writer-wins — mở lại detail cùng project không kích
  // watch(rosterProject), nên chủ động nạp lại roster cho đúng ngữ cảnh.
  ensureRoster()
}
function openNew(prefill?: Partial<TeamSpec>): void {
  detail.value = {
    id: '',
    name: prefill?.name ?? '',
    ...(prefill?.desc ? { desc: prefill.desc } : {}),
    ...(prefill?.instructions ? { instructions: prefill.instructions } : {}),
    ...(prefill?.lead ? { lead: prefill.lead } : {}),
    members: prefill?.members ?? [],
    createdAt: '',
    updatedAt: '',
    source: 'global',
  }
  isNew.value = true
  draft.value = {
    id: '',
    name: prefill?.name ?? '',
    desc: prefill?.desc ?? '',
    instructions: prefill?.instructions ?? '',
    leadKey: prefill?.lead ? agentKeyOf(prefill.lead) : '',
    members: (prefill?.members ?? []).map((m) => ({
      title: m.title,
      agentKey: m.agent ? agentKeyOf(m.agent) : '',
    })),
    scopeKey: 'global',
  }
  detailTab.value = 'members'
}
function closeDetail(): void {
  detail.value = null
  isNew.value = false
}

const dirty = computed(() => {
  if (isNew.value) return true
  const tm = detail.value
  if (!tm) return false
  return JSON.stringify(draftFromSpec(tm)) !== JSON.stringify(draft.value)
})
const canSave = computed(
  () => draft.value.name.trim().length > 0 && draft.value.members.every((m) => m.title.trim()),
)
const saving = ref(false)

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'team'

// Option "tạo agents tương ứng": member/lead chưa bind agent → lưu team sẽ
// tạo AGENT.md mới (global) rồi bind ngược vào. Save-time option, không
// phải field của TeamSpec.
const createAgents = ref(true)

// Tạo một agent cho vai trò `title` ở tầng GLOBAL; trả agentKey để bind vào
// draft. Agent là file MỚI hoàn toàn — id namespaced theo team
// (`{team}-{role}`) nên không bao giờ trùng/đè agent đang có. Lỗi từng agent
// không chặn save — member giữ trống.
async function autoCreateAgent(title: string): Promise<string> {
  const teamSlug = slugify(draft.value.name.trim() || 'team').slice(0, 24)
  const roleSlug = slugify(title).slice(0, 36)
  const base = `${teamSlug}-${roleSlug}`.slice(0, 60)
  const taken = new Set(agentsStore.agents.filter((a) => a.source === 'global').map((a) => a.id))
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`.slice(0, 64)
  const teamName = draft.value.name.trim() || 'team'
  try {
    const agent = await agentsStore.saveAgent({
      id,
      source: 'global',
      name: title.slice(0, 120),
      description: `${title} — member of the ${teamName} team`.slice(0, 300),
      provider: settings.defaults.provider,
      model: settings.defaults.modelId,
      systemPrompt: `You are **${title}** on the **${teamName}** team.\n\n- Take work assigned to you via the team lead or board items.\n- Follow the repository's coding conventions; verify your changes before reporting done.`,
      role: title.slice(0, 80),
    })
    return agentKeyOf({
      id: agent.id,
      source: agent.source,
      ...(agent.projectId ? { projectId: agent.projectId } : {}),
    })
  } catch (err) {
    console.warn('[teams] auto-create agent failed', err)
    return ''
  }
}

async function saveDraft(): Promise<void> {
  if (!canSave.value || saving.value) return
  saving.value = true
  try {
    const isProject = draft.value.scopeKey !== 'global'
    // Option: member/lead trống agent → tạo AGENT.md GLOBAL (agents là role
    // chung — không còn tầng project) rồi bind ngược vào draft trước upsert.
    let created = 0
    if (createAgents.value) {
      // Roster global tươi trước khi đặt id — tránh đè AGENT.md đang có nếu
      // snapshot trong store còn đang load.
      await agentsStore.loadAgents([])
      for (const m of draft.value.members) {
        if (!m.title.trim() || m.agentKey) continue
        // Sequential — agent vừa tạo vào store ngay nên vòng sau thấy id đã dùng.
        const key = await autoCreateAgent(m.title.trim())
        if (key) {
          m.agentKey = key
          created++
        }
      }
      if (!draft.value.leadKey) {
        const key = await autoCreateAgent(`${draft.value.name.trim() || 'Team'} Lead`)
        if (key) {
          draft.value.leadKey = key
          created++
        }
      }
    }
    let id = detail.value?.id || draft.value.id
    if (!id) {
      id = `team-${slugify(draft.value.name)}`
      // Tránh đè spec cùng id khác tầng — đuôi số khi trùng.
      let n = 2
      const taken = new Set(teamsStore.teams.map((tm) => tm.id))
      while (taken.has(id)) id = `team-${slugify(draft.value.name)}-${n++}`
    }
    const spec: Partial<TeamSpec> & { id: string; name: string } = {
      id,
      name: draft.value.name.trim(),
      desc: draft.value.desc.trim(),
      instructions: draft.value.instructions.trim(),
      members: draft.value.members
        .filter((m) => m.title.trim())
        .map((m) => ({
          title: m.title.trim(),
          ...(agentRefOf(m.agentKey) ? { agent: agentRefOf(m.agentKey)! } : {}),
        })),
      source: isProject ? 'project' : 'global',
      ...(isProject ? { projectId: draft.value.scopeKey } : {}),
      ...(agentRefOf(draft.value.leadKey) ? { lead: agentRefOf(draft.value.leadKey)! } : {}),
    }
    const ok = await teamsStore.upsert(spec)
    if (!ok) {
      toast.add({ title: t('teams.saveFailed'), color: 'error' })
      return
    }
    // Detail giờ trỏ vào spec vừa lưu — detail.value refresh từ store.
    const saved = teamsStore.teamByKey(
      teamsStore.teamKey({ id, source: spec.source, projectId: spec.projectId }),
    )
    if (saved) {
      detail.value = saved
      isNew.value = false
      draft.value = draftFromSpec(saved)
    }
    toast.add({ title: t('teams.saved'), color: 'success' })
    if (created > 0) {
      toast.add({ title: t('teams.agentsCreated', { n: created }), color: 'info' })
    }
  } finally {
    saving.value = false
  }
}
function resetDraft(): void {
  if (isNew.value) closeDetail()
  else if (detail.value) draft.value = draftFromSpec(detail.value)
}
function makeLeader(m: MemberRow): void {
  if (!m.agentKey) return
  draft.value.leadKey = m.agentKey
}

// ── Tabs ────────────────────────────────────────────────────────────────────
const detailRuns = computed<LiveRun[]>(() => (detail.value?.id ? runsFor(detail.value) : []))
const tabs = computed(() => [
  {
    id: 'members' as const,
    label: t('teams.detail.tabMembers'),
    icon: 'users',
    count: draft.value.members.length + (draft.value.leadKey ? 1 : 0),
  },
  { id: 'instructions' as const, label: t('teams.detail.tabInstructions'), icon: 'file' },
  ...(isNew.value
    ? []
    : [
        {
          id: 'runs' as const,
          label: t('teams.runs'),
          icon: 'play',
          count: detailRuns.value.length,
        },
      ]),
])

// ── Scope options (create only — spec đã lưu không đổi tầng) ────────────────
const scopeOpts = computed<AppSelectOption[]>(() => [
  { value: 'global', label: t('teams.scopeGlobal') },
  ...projectsStore.projects.map((p) => ({ value: p.id, label: p.name })),
])

// ── Agent pickers ───────────────────────────────────────────────────────────
// Roster ngữ cảnh: chỉ global + project liên quan (project của team đang sửa;
// khi đang duyệt list thì theo project scope đang chọn). KHÔNG nạp agent của
// mọi project — roster đưa vào draft RPC + picker phải gọn và đúng ngữ cảnh.
const rosterProject = computed(() => {
  if (detail.value) return draft.value.scopeKey === 'global' ? '' : draft.value.scopeKey
  return effProject.value
})
const rosterAgents = computed(() =>
  agentsStore.agents.filter((a) => a.source !== 'project' || a.projectId === rosterProject.value),
)
function ensureRoster(): void {
  void agentsStore.loadAgents(rosterProject.value ? [rosterProject.value] : [])
}
// Keys đang bind trong draft (lead + members) — để phủ option "missing" khi ref
// lỏng (agent bị xoá / chưa migrate) thay vì picker trắng trơn.
const boundKeys = computed<Set<string>>(() => {
  const keys = new Set<string>()
  if (draft.value?.leadKey) keys.add(draft.value.leadKey)
  for (const m of draft.value?.members ?? []) {
    if (m.agentKey) keys.add(m.agentKey)
  }
  return keys
})

const agentOpts = computed<AppSelectOption[]>(() => {
  const roster: AppSelectOption[] = rosterAgents.value.map((a) => ({
    value: agentKeyOf({
      id: a.id,
      source: a.source,
      ...(a.projectId ? { projectId: a.projectId } : {}),
    }),
    label: `${a.name}${a.source === 'project' ? ` · ${a.projectId}` : ''}`,
  }))
  const known = new Set(roster.map((o) => o.value))
  // Ref lỏng (agent không còn trong roster): hiện id + cờ missing, disabled để
  // member khác không bind nhầm — hàng đang bind vẫn thấy label thay vì trắng.
  const dangling: AppSelectOption[] = [...boundKeys.value]
    .filter((k) => k && !known.has(k))
    .map((k) => ({
      value: k,
      label: t('teams.agentMissing', { id: k.split('|').pop() ?? k }),
      disabled: true,
    }))
  return [{ value: '', label: t('teams.agentNone') }, ...roster, ...dangling]
})
const leadOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('teams.leadNone') },
  ...agentOpts.value.slice(1),
])

// ── AI draft / revise ────────────────────────────────────────────────────────
const aiOpen = ref(false)
const aiBrief = ref('')
const aiBusy = ref(false)
function openAi(): void {
  chooserOpen.value = false
  aiBrief.value = ''
  aiOpen.value = true
}
// Kebab list → "Chỉnh bằng AI": mở detail của team đó rồi bật box revise.
function onRevise(tm: TeamSpec): void {
  openDetail(tm)
  openAi()
}
async function runDraft(): Promise<void> {
  if (aiBusy.value || !aiBrief.value.trim()) return
  aiBusy.value = true
  try {
    const res = await teamsStore.draft({
      brief: aiBrief.value.trim(),
      ...(!isNew.value && detail.value
        ? {
            current: {
              name: draft.value.name,
              ...(draft.value.desc.trim() ? { desc: draft.value.desc.trim() } : {}),
              ...(draft.value.instructions.trim()
                ? { instructions: draft.value.instructions.trim() }
                : {}),
              ...(agentRefOf(draft.value.leadKey)
                ? { lead: agentRefOf(draft.value.leadKey)! }
                : {}),
              members: draft.value.members
                .filter((m) => m.title.trim())
                .map((m) => ({
                  title: m.title.trim(),
                  ...(agentRefOf(m.agentKey) ? { agent: agentRefOf(m.agentKey)! } : {}),
                })),
            },
          }
        : {}),
      agents: rosterAgents.value.map((a) => ({
        id: a.id,
        name: a.name,
        // Mô tả dài chỉ phình payload — sidecar vốn cắt 120 ký tự khi render roster.
        ...(a.description ? { description: a.description.slice(0, 240) } : {}),
        source: a.source,
        ...(a.projectId ? { projectId: a.projectId } : {}),
      })),
      // Model/account theo cấu hình AI authoring (Settings → Models) — rỗng
      // thì resolver trả session defaults.
      settings: settings.resolveAuthoringLlm(),
    })
    if (!res?.name) {
      toast.add({ title: t('teams.aiFailed'), color: 'error' })
      return
    }
    if (isNew.value || !detail.value) {
      // Create mode — mở detail với prefill của draft.
      openNew(res)
    } else {
      // Revise — áp vào draft, user duyệt rồi Save.
      draft.value.name = res.name
      if (res.desc !== undefined) draft.value.desc = res.desc ?? ''
      if (res.instructions !== undefined) draft.value.instructions = res.instructions ?? ''
      draft.value.leadKey = res.lead ? agentKeyOf(res.lead) : draft.value.leadKey
      if (res.members) {
        draft.value.members = res.members.map((m) => ({
          title: m.title,
          agentKey: m.agent ? agentKeyOf(m.agent) : '',
        }))
      }
    }
    aiOpen.value = false
  } catch (err) {
    // Lỗi credential (token hết hạn/bị rotate) → toast kèm action mở thẳng
    // Settings → Models & Keys để re-auth, thay vì dead-end "AI draft failed".
    const msg = err instanceof Error ? err.message : String(err)
    toast.add({
      title: t('teams.aiFailed'),
      description: msg,
      color: 'error',
      ...(isAuthError(err)
        ? {
            duration: 0,
            actions: [
              {
                label: t('common.openSettings'),
                icon: 'settings',
                onClick: () => openSettings('models'),
              },
            ],
          }
        : {}),
    })
  } finally {
    aiBusy.value = false
  }
}

// ── Create chooser ───────────────────────────────────────────────────────────
function onCreateBlank(): void {
  chooserOpen.value = false
  openNew()
}

// ── Run — DropdownMenu chọn project đích rồi materialize cây phiên. ────────
const canRun = computed(() => !!detail.value && !isNew.value)
async function onRunProject(projectId: string): Promise<void> {
  const tm = detail.value
  if (!tm || isNew.value) return
  try {
    // Settings hiệu dụng của project đích — run chạy đúng account/provider
    // mà project ghim trong llmDefaults (spec lead/member ghim thì stomp
    // per-turn qua boundAgent).
    const res = await teamsStore.run(tm, projectId || null, dispatchRunSettings(projectId))
    if (!res?.rootId) {
      toast.add({ title: t('teams.runFailed'), color: 'error' })
      return
    }
    await sessions.openByEngineId(res.rootId)
    void navigateTo(`/sessions?id=${encodeURIComponent(res.rootId)}`)
  } catch (err) {
    toast.add({
      title: t('teams.runFailed'),
      description: sidecarErrorText(err),
      color: 'error',
    })
  }
}
function openRun(r: LiveRun): void {
  void sessions.openByEngineId(r.root.engineId ?? '')
  void navigateTo(`/sessions?id=${encodeURIComponent(r.root.engineId ?? '')}`)
}

// ── Delete (kebab list + detail dùng chung) ────────────────────────────────
async function onDelete(tm: TeamSpec): Promise<void> {
  const ok = await confirm({
    title: t('teams.deleteTitle'),
    description: t('teams.deleteDesc', { name: tm.name }),
    kind: 'danger',
  })
  if (ok) {
    await teamsStore.remove(tm.id, tm.source ?? 'global', tm.projectId)
    if (detail.value?.id === tm.id) closeDetail()
  }
}

// Export team spec ra JSON (portable — import/reuse ở project khác bằng tay).
async function exportTeam(tm: TeamSpec): Promise<void> {
  try {
    const name = await saveTextFile(
      `awog-team-${exportSlug(tm.name || tm.id)}.json`,
      JSON.stringify(
        { kind: 'awog-team', exportedAt: new Date().toISOString(), team: tm },
        null,
        2,
      ),
      [{ name: 'JSON', extensions: ['json'] }],
    )
    if (name) toast.add({ title: t('teams.exportDone', { name }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('teams.exportFailed'), description: String(err), color: 'error' })
  }
}

// ── Hydrate ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  if (!projectsStore.loaded) await projectsStore.hydrate()
  await teamsStore.load(projectsStore.projects.map((p) => p.id))
  ensureRoster()
})
// Roster agent theo ngữ cảnh project — đổi project (scope tab / team đang sửa)
// thì nạp lại đúng tier đó thay vì giữ snapshot tổng.
watch(rosterProject, () => ensureRoster())
// Project vừa link thêm ⇒ nạp spec/team của nó (khuôn board unified).
watch(
  () => projectsStore.projects.map((p) => p.id).join(','),
  async () => {
    await teamsStore.load(projectsStore.projects.map((p) => p.id))
  },
)
</script>

<style scoped>
.teampage.page {
  flex-direction: column;
}
/* ── Toolbar ── */
.tp-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.tp-flex {
  flex: 1;
}
/* ── Identity cell + members stack ── */
.tp-id {
  gap: 10px;
}
/* Chấm "live" đè góc avatar — khuôn status overlay của Multica. */
.tp-avw {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
}
.tp-avdot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--success);
  border: 2px solid var(--background);
}
/* Status cell: dot + label (Active xanh / Idle muted). */
.tp-st {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
}
.tp-std {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted-foreground);
}
.tp-st.on {
  color: var(--success);
}
.tp-st.on .tp-std {
  background: var(--success);
}
/* Runs — cột số căn phải. */
.tp-runs {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}
.tp-head-r {
  text-align: right;
}
.tp-idt {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tp-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-desc {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-celltext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-none {
  color: var(--muted-foreground);
}
.tp-stack {
  display: inline-flex;
  align-items: center;
}
.tp-stack :deep(.eav) {
  margin-left: -6px;
  border: 2px solid var(--background);
}
.tp-stack :deep(.eav:first-child) {
  margin-left: 0;
}
.tp-more {
  margin-left: 4px;
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
.tp-kebab {
  justify-content: flex-end;
}
.tp-kebab .tp-kebab-btn {
  opacity: 0;
  transition: opacity 0.1s ease;
}
.cl-row:hover .tp-kebab .tp-kebab-btn,
.tp-kebab .tp-kebab-btn:focus-visible {
  opacity: 1;
}

/* ── Empty ── */
.tp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.tp-empty-ic {
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
.tp-empty-t {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--foreground);
}
.tp-empty-d {
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  margin-bottom: 8px;
  max-width: 420px;
  text-align: center;
}

/* ── Detail chrome ── */
.tpd-back {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 48px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
}
.tpd-back-t {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpd-flex {
  flex: 1;
}
.tpd-dirty {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 20px;
  flex: 0 0 auto;
  background: var(--secondary);
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-xs);
  color: var(--secondary-foreground);
}
.tpd-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.tpd-main {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  padding: 16px 24px 24px;
}
.tpd-tabc {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  background: var(--muted);
  border-radius: var(--r-pill);
  padding: 0 6px;
}
.tpd-pane {
  padding-top: 16px;
}
.tpd-hint {
  margin: 0 0 10px;
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
.tpd-pane-empty {
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  padding: 24px 0;
  text-align: center;
}

/* ── Members tab ── */
.tpd-mrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.tpd-mrow.tp-lead {
  padding-bottom: 12px;
}
.tpd-crown {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--warning);
  flex: 0 0 auto;
}
.tpd-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Input primitive đã mang border/radius/focus — đây chỉ là sizing; chiều cao
   giữ mặc định h-9 để bằng AppSelect đứng cạnh trong cùng hàng member. */
.tpd-min {
  flex: 1;
  min-width: 140px;
}
.tpd-role {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
/* "Thêm member" — outline dashed full-width, override trên Button. */
.tpd-add {
  width: 100%;
  margin-top: 12px;
  border-style: dashed;
  color: var(--muted-foreground);
}
.tpd-add:hover {
  color: var(--foreground);
}
/* Agent picker + chip "tự tạo" trong cùng hàng member. */
.tpd-magent {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tpd-msel {
  flex: 1;
  min-width: 0;
}
.tpd-auto-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  color: var(--accent, var(--primary));
  white-space: nowrap;
}
/* Option "tự tạo agent" — switch + label/hint dưới danh sách member. */
.tpd-autorow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.tpd-autotext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-sm);
}
.tpd-autohint {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}

/* ── Runs tab ── */
.tpd-run {
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
.tpd-run:hover {
  background: var(--accent-wash);
}
.tpd-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.tpd-run-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpd-run-proj,
.tpd-run-meta {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  flex: 0 0 auto;
}

/* ── Inspector ── */
.tpd-insp {
  flex: 0 0 280px;
  border-left: 1px solid var(--border);
  padding: 16px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.tpd-avrow {
  margin-bottom: 10px;
}
.tpd-insp-h {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted-foreground);
  margin: 6px 0 4px;
}
.tpd-prop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
}
.tpd-prop-l {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
}
.tpd-prop-v {
  font-size: var(--fs-xs);
  color: var(--foreground);
  text-align: right;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpd-prop-v.mono {
  font-family: var(--code); /* mono-ok: hiển thị team id (identifier). */
}

/* ── AI brief modal ── */
.tpai {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
@media (max-width: 860px) {
  .tpd-body {
    flex-direction: column;
  }
  .tpd-insp {
    flex: 0 0 auto;
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
</style>
<style>
/* Spin cho icon refresh khi AI đang dựng — cùng khuôn AgentBodyEditModal. */
.spin {
  animation: tpspin 0.9s linear infinite;
}
@keyframes tpspin {
  to {
    transform: rotate(360deg);
  }
}
</style>
