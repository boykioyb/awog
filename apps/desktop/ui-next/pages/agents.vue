<template>
  <!-- relative: neo cho thanh bulk nổi đáy. -->
  <section class="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-page="agents">
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

      <div class="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <div class="relative">
          <Icon
            name="search"
            class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input v-model="query" :placeholder="t('agents.search')" class="w-72 pl-8" />
        </div>
        <span class="flex-1" />
        <AppSelect v-model="teamFilter" class="min-w-37.5" :options="teamFilterOpts" />
        <AppSelect v-model="sortBy" class="min-w-37.5" :options="sortOpts" />
      </div>

      <CollectionList v-if="filteredAgents.length" :cols="COLS">
        <template #head>
          <span class="flex items-center justify-center p-0" @click.stop>
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
          <span class="text-right">{{ t('agents.col.runs') }}</span>
          <span />
        </template>
        <div
          v-for="a in filteredAgents"
          :key="agentKey(a)"
          class="cl-row group"
          :class="{ 'bg-selected': selected.has(agentKey(a)) }"
          @click="openDetail(a)"
        >
          <div class="cl-cell justify-center p-0" @click.stop>
            <AppCheckbox :checked="selected.has(agentKey(a))" @update:checked="toggleAgent(a)" />
          </div>
          <div class="cl-cell gap-2.5">
            <span class="relative inline-flex shrink-0">
              <EntityAvatar :name="a.name" :seed="agentKey(a)" size="md" />
              <!-- Chấm "live" đè góc avatar; viền màu nền hàng để chấm "cắt" avatar. -->
              <span
                v-if="isLive(a)"
                class="absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-background bg-success"
              />
            </span>
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium text-foreground">{{ a.name }}</span>
              <span v-if="a.description" class="truncate text-xs text-muted-foreground">
                {{ a.description }}
              </span>
            </div>
          </div>
          <div class="cl-cell">
            <span
              class="inline-flex items-center gap-1.5 text-sm"
              :class="isLive(a) ? 'text-success' : 'text-muted-foreground'"
            >
              <span class="size-2 rounded-full bg-current" />
              {{ isLive(a) ? t('agents.status.active') : t('agents.status.idle') }}
            </span>
          </div>
          <div class="cl-cell">
            {{ providerDisplayName(a.provider) }} · {{ modelDisplayName(a.model) }}
          </div>
          <div class="cl-cell">{{ relTime(statsFor(a).lastIso) }}</div>
          <div class="cl-cell justify-end tabular-nums">{{ statsFor(a).sessions }}</div>
          <div class="cl-cell justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <!-- Kebab chỉ hiện khi hover hàng / focus / menu đang mở. -->
                <Button
                  variant="ghost"
                  size="iconSm"
                  class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  @click.stop
                >
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

      <div v-else class="flex flex-1 flex-col items-center justify-center gap-2">
        <span
          class="mb-1 inline-flex size-11 items-center justify-center rounded-lg border bg-muted text-muted-foreground"
        >
          <Icon name="bot" class="size-5" />
        </span>
        <div class="text-base font-semibold text-foreground">{{ t('agents.empty.title') }}</div>
        <div class="mb-2 text-sm text-muted-foreground">{{ t('agents.empty.desc') }}</div>
        <Button @click="chooserOpen = true">
          <Icon name="plus" class="size-3.5" />
          {{ t('agents.page.new') }}
        </Button>
      </div>

      <!-- Bulk bar — nổi đáy khi có tick chọn: export .zip / xoá hàng loạt. -->
      <div
        v-if="selected.size"
        class="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-lg"
      >
        <span class="pr-1 text-sm font-semibold text-foreground">
          {{ t('agents.bulk.selected', { n: selected.size }) }}
        </span>
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
      <header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('agents.detail.back')"
          @click="detailKey = null"
        >
          <Icon name="arrow-left" class="size-4" />
        </Button>
        <span class="text-sm font-semibold text-foreground">{{ t('agents.page.title') }}</span>

        <span class="flex-1" />
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

      <div class="flex min-h-0 flex-auto max-[860px]:flex-col">
        <div class="min-w-0 flex-auto overflow-y-auto px-6 py-5 [scrollbar-width:thin]">
          <div class="flex items-start gap-3.5">
            <EntityAvatar :name="detail.name" :seed="agentKey(detail)" size="lg" />
            <div class="min-w-0 flex-1">
              <div
                class="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-foreground"
              >
                {{ detail.name }}
                <!-- font-mono: id agent là định danh người dùng gõ lại (mono-ok). -->
                <Badge variant="outline" class="font-mono text-muted-foreground">
                  {{ detail.id }}
                </Badge>
                <Badge
                  v-if="detail.role"
                  variant="outline"
                  class="border-primary/40 bg-primary/10 text-primary"
                >
                  {{ detail.role }}
                </Badge>
              </div>
              <div v-if="detail.description" class="mt-1 text-sm text-muted-foreground">
                {{ detail.description }}
              </div>
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
                <span
                  v-if="tab.count != null"
                  class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground"
                >
                  {{ tab.count }}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <!-- Instructions = systemPrompt (AGENT.md body). Nút "Chỉnh bằng AI"
               nằm trong header của markdown body (allow-edit) — chung một hàng
               với Render/Raw + Copy, không còn hàng riêng trống trải. -->
          <!-- hook-ok: `.lmb-head` là class gốc của LibraryMarkdownBody — bỏ mt để không
               thành dải trống to dưới đường tab. -->
          <div v-if="detailTab === 'instructions'" class="pt-4 [&_.lmb-head]:mt-0">
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
          <div v-else-if="detailTab === 'skills'" class="pt-4">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <span class="text-xs text-muted-foreground tabular-nums">{{ skillsState }}</span>
              <span v-if="patching" class="text-xs text-muted-foreground tabular-nums">
                {{ t('common.saving') }}
              </span>
            </div>
            <AgentSkillsPicker
              :model-value="wlVal('skillIds')"
              :skills="skills"
              @update:model-value="(v) => patchAgent({ skillIds: v })"
            />
          </div>

          <div v-else-if="detailTab === 'tools'" class="pt-4">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <span class="text-xs text-muted-foreground tabular-nums">{{ toolsState }}</span>
              <span v-if="patching" class="text-xs text-muted-foreground tabular-nums">
                {{ t('common.saving') }}
              </span>
            </div>
            <AgentToolsPicker
              :model-value="wlVal('tools')"
              :servers="mcpServers"
              @update:model-value="(v) => patchAgent({ tools: v })"
            />
          </div>

          <div v-else-if="detailTab === 'connections'" class="pt-4">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <span class="text-xs text-muted-foreground tabular-nums">{{ connectionsState }}</span>
              <span v-if="patching" class="text-xs text-muted-foreground tabular-nums">
                {{ t('common.saving') }}
              </span>
            </div>
            <AgentConnectionsPicker
              :model-value="wlVal('mcpServerIds')"
              :servers="mcpServers"
              @update:model-value="(v) => patchAgent({ mcpServerIds: v })"
            />
          </div>

          <div v-else-if="detailTab === 'repos'" class="pt-4">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <span class="text-xs text-muted-foreground tabular-nums">{{ reposState }}</span>
              <span v-if="patching" class="text-xs text-muted-foreground tabular-nums">
                {{ t('common.saving') }}
              </span>
            </div>
            <AgentReposPicker
              :model-value="wlVal('repos')"
              :projects="projectListWithPath"
              @update:model-value="(v) => patchAgent({ repos: v })"
            />
          </div>

          <!-- Sessions — "session nằm sau agent": mọi phiên đang bind vai này -->
          <div v-else class="pt-4">
            <Input
              v-if="agentSessions.length > 4"
              v-model="sessionQ"
              :placeholder="t('common.search')"
              class="mb-2.5 w-70"
            />
            <div
              v-if="!filteredSessions.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{ t('agents.detail.noSessions') }}
            </div>
            <Button
              v-for="s in filteredSessions"
              :key="s.id"
              variant="ghost"
              class="mb-0.5 h-auto w-full justify-start gap-2.5 px-2.5 py-2 text-left font-normal text-foreground [&_svg]:size-3.5"
              @click="openSession(s)"
            >
              <span class="size-2 shrink-0 rounded-full" :class="statusDot(s)" />
              <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ projectName(s.project) }}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ s.when }}</span>
              <Icon name="chev" class="text-muted-foreground" />
            </Button>
          </div>
        </div>

        <!-- Inspector rail phải (khuôn Multica); cửa sổ hẹp → xuống dưới pane chính. -->
        <aside
          class="w-70 shrink-0 overflow-y-auto border-l py-4 [scrollbar-width:thin] max-[860px]:w-auto max-[860px]:border-t max-[860px]:border-l-0"
        >
          <div class="px-4 pb-2 text-xs font-medium text-muted-foreground">
            {{ t('agents.detail.props') }}
          </div>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="openEditor(detail)"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.detail.provider') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ providerDisplayName(detail.provider) }}
            </span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="openEditor(detail)"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.detail.model') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ modelDisplayName(detail.model) }}
            </span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="openEditor(detail)"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.detail.role') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ detail.role || '—' }}
            </span>
          </Button>
          <!-- Whitelist props jump to their detail tab (editable inline);
               scalar props still open the full editor. -->
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="detailTab = 'skills'"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.editor.skills') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ skillsState }}
            </span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="detailTab = 'tools'"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.detail.tools') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ toolsState }}
            </span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="detailTab = 'connections'"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.detail.connections') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ connectionsState }}
            </span>
          </Button>
          <Button
            variant="ghost"
            class="h-auto w-full justify-between gap-2 rounded-none px-4 py-1.5 font-normal"
            @click="detailTab = 'repos'"
          >
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ t('agents.editor.repos') }}
            </span>
            <span class="min-w-0 truncate text-right text-xs text-foreground">
              {{ reposState }}
            </span>
          </Button>
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
import { PROVIDER_DISPLAY, type Session } from '~/composables/useSessionsData'
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

// Chấm trạng thái phiên — class màu ngữ nghĩa (cùng ý nghĩa với STATUS_COLOR ở
// useSessionsData, nhưng ở dạng utility thay cho var màu inline).
const STATUS_DOT: Record<Session['status'], string> = {
  idle: 'bg-faint',
  streaming: 'bg-primary',
  awaiting: 'bg-warning',
  done: 'bg-success',
  error: 'bg-destructive',
}
const statusDot = (s: Session): string => STATUS_DOT[s.status] ?? 'bg-muted-foreground'

function openSession(s: Session): void {
  void sessionsStore.openByEngineId(s.engineId ?? '')
  void navigateTo(`/workbench?id=${encodeURIComponent(s.engineId ?? '')}`)
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
    void navigateTo(`/workbench?id=${encodeURIComponent(res.sessionId)}`)
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
