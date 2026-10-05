<template>
  <Teleport to="body">
    <div class="ovl on wsed-ovl" @click.self="emit('close')">
      <div
        class="wsed flex w-[1120px] max-w-[94vw] flex-col rounded-xl border border-border bg-popover"
        :class="{ full: edFull, 'h-[86vh]': !!item, 'max-h-[86vh]': !item }"
        role="dialog"
        aria-modal="true"
        @click.stop
      >
        <div class="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <span
            v-if="item"
            class="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-xs text-faint"
          >
            {{ item.id }}
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
            :title="item?.title"
          >
            {{ item ? item.title : t('sessions.workspace.group.newItem') }}
          </span>
          <!-- Roster ê-kíp → một dropdown duy nhất (thay wall pill cũ). Bấm
               member mở peek ngay trong modal, không nhảy sang tab Sessions.
               Mở dropdown là refresh usage rollup (lượt + token) của roster. -->
          <DropdownMenu v-if="item && roster.length" @update:open="onRosterOpen">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted"
              >
                <span class="flex -space-x-1.5">
                  <span
                    v-for="m in roster.slice(0, 3)"
                    :key="m.engineId ?? m.id"
                    class="grid size-4 place-items-center rounded-full text-[8px] font-semibold text-white ring-1 ring-popover"
                    :style="{ background: avatarColor(m) }"
                  >
                    {{ initial(m.title) }}
                  </span>
                </span>
                <span class="max-w-[160px] truncate">{{ rosterLabel }}</span>
                <ChevronDown class="size-3.5 text-dim" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-[300px]">
              <DropdownMenuLabel
                class="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-dim"
              >
                <span>{{ t('sessions.workspace.group.roster') }} · {{ roster.length }}</span>
                <!-- Tổng token cả ê-kíp — rollup lũy kế các phiên member,
                     nạp khi mở dropdown (memberStats). -->
                <span
                  v-if="rosterTotals.tokens"
                  class="normal-case tracking-normal text-faint"
                  :title="t('board.rosterTotals', { n: rosterTotals.turns })"
                >
                  {{ formatTokenCount(rosterTotals.tokens) }} tok
                </span>
              </DropdownMenuLabel>
              <div class="max-h-[280px] overflow-y-auto">
                <DropdownMenuItem
                  v-for="m in roster"
                  :key="m.engineId ?? m.id"
                  class="cursor-pointer gap-2"
                  @select="peek(m)"
                >
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
                    :style="{ background: avatarColor(m) }"
                  >
                    {{ initial(m.title) }}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs text-foreground">{{ m.title }}</span>
                    <!-- Rollup lũy kế của phiên member (sessions.costBreakdown):
                         số lượt đã chạy + tổng token. Chưa có lượt nào → giấu. -->
                    <span
                      v-if="m.engineId && memberStats[m.engineId]?.turns"
                      class="block truncate text-[10px] leading-4 text-faint"
                    >
                      {{ t('board.member.turns', { n: memberStats[m.engineId]!.turns }) }} ·
                      {{ formatTokenCount(memberStats[m.engineId]!.tokens) }} tok
                    </span>
                  </span>
                  <Crown v-if="m.engineId === runRoot" class="size-3 shrink-0 text-warning" />
                  <component
                    :is="statusIcon(m.status)"
                    class="mstat size-3.5 shrink-0"
                    :data-st="m.status"
                  />
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            v-if="item"
            variant="ghost"
            size="iconSm"
            :title="t('board.exportIssue')"
            :aria-label="t('board.exportIssue')"
            @click="exportIssue"
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            :title="
              edFull
                ? t('sessions.workspace.group.peek.unfull')
                : t('sessions.workspace.group.peek.full')
            "
            :aria-label="
              edFull
                ? t('sessions.workspace.group.peek.unfull')
                : t('sessions.workspace.group.peek.full')
            "
            @click="edFull = !edFull"
          >
            <Minimize2 v-if="edFull" />
            <Maximize2 v-else />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <X />
          </Button>
        </div>

        <!-- Breadcrumb cha — chỉ khi item là việc con: chuỗi tổ tiên (mỗi mắt
             click được) kết thúc bằng item hiện tại. Nhảy về cha trực tiếp
             không cần đóng modal tìm lại trên board. -->
        <div
          v-if="item && parentChain.length"
          class="flex min-w-0 items-center gap-1 border-b border-dashed border-border px-4 py-1.5"
        >
          <ArrowLeft class="size-3 shrink-0 text-faint" />
          <template v-for="p in parentChain" :key="p.id">
            <button
              type="button"
              class="flex min-w-0 items-center gap-1 text-[11px] text-dim transition-colors hover:text-primary"
              :title="`${t('board.parentUp')} — ${p.title}`"
              @click="emit('openItem', p.id)"
            >
              <component
                :is="typeIconOf(p)"
                class="size-3 shrink-0"
                :data-type="p.type ?? 'task'"
              />
              <span class="truncate">{{ p.title }}</span>
            </button>
            <ChevronRight class="size-3 shrink-0 text-faint" />
          </template>
          <span class="min-w-0 truncate text-[11px] font-medium text-foreground">
            {{ item.title }}
          </span>
        </div>

        <!-- Tab bar — chỉ mode SỬA: Trao đổi (thread) đứng ĐẦU vì thread là bề
             mặt làm việc chính của item; General (form+props) là metadata.
             Kênh ê-kíp của run đã trộn vào chính feed Trao đổi nên không còn
             tab Nhóm riêng. -->
        <div v-if="item" class="flex gap-1 border-b border-border px-4 pt-2">
          <button
            v-for="tb in tabs"
            :key="tb.k"
            type="button"
            class="rounded-t-md px-3.5 py-1.5 text-xs transition-colors"
            :class="
              tab === tb.k
                ? 'border border-b-0 border-border bg-popover font-medium text-foreground'
                : 'text-dim hover:text-foreground'
            "
            @click="tab = tb.k as typeof tab"
          >
            {{ tb.label }}
          </button>
        </div>

        <div class="wsed-main" :class="{ 'wsed-main-rel': item }">
          <!-- ═══ EDIT MODE ═══ -->
          <template v-if="item">
            <!-- Tab GENERAL — layout 9/3: cột trái nội dung (title, mô tả, việc
                 con, meta), cột phải xếp dọc toàn bộ selectbox thuộc tính
                 (trạng thái, giao, giai đoạn, loại, ưu tiên, mức độ, cha) +
                 Advanced. flex-1 lấp đầy chiều cao modal cố định. -->
            <div
              v-if="tab === 'gen'"
              class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
            >
              <div class="wsed-gen grid grid-cols-12 gap-4">
                <div class="col-span-9 flex min-w-0 flex-col gap-3">
                  <Input
                    ref="titleEl"
                    v-model="title"
                    class="font-medium"
                    :placeholder="t('sessions.workspace.group.field.title')"
                    maxlength="200"
                    @keydown.enter="save(false)"
                  />
                  <Textarea
                    v-model="desc"
                    class="min-h-[120px] flex-1 resize-y"
                    rows="8"
                    :placeholder="t('sessions.workspace.group.field.desc')"
                  />
                  <!-- Việc con của item (khuôn sub-issue): icon type + status +
                       title — click nhảy sang editor của item con. -->
                  <div v-if="childItems.length" class="flex flex-col gap-1.5">
                    <span class="text-xs text-muted-foreground">
                      {{ t('board.children') }} · {{ childItems.length }}
                    </span>
                    <button
                      v-for="c in childItems"
                      :key="c.id"
                      type="button"
                      class="flex min-w-0 items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent-wash"
                      @click="emit('openItem', c.id)"
                    >
                      <component
                        :is="typeIconOf(c)"
                        class="size-3.5 shrink-0"
                        :data-type="c.type ?? 'task'"
                      />
                      <span class="min-w-0 flex-1 truncate text-xs">{{ c.title }}</span>
                      <span class="shrink-0 text-[10px] text-dim">
                        {{ statusLabel(c.status) }}
                      </span>
                    </button>
                  </div>
                  <!-- Advanced — override LLM per-slot (collapse mặc định):
                       nằm cột trái cho rộng, không nén vào sidebar props. -->
                  <WorkspaceBoardAdvConfig
                    ref="advRef"
                    :assignee="assignee"
                    :project-id="projectSel"
                    :item="item"
                    :lead="lead"
                    :members="scopedMembers"
                    :signals="advSignals"
                  />
                  <div
                    class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-dashed border-border pt-2.5 text-[11px] text-faint"
                  >
                    <span>
                      {{ t('sessions.workspace.group.detailProject') }}:
                      <span class="text-dim">{{ projectName(item.projectId) }}</span>
                    </span>
                    <span v-if="item.mergedBranch" class="min-w-0 truncate">
                      {{ t('sessions.workspace.group.detailBranch') }}:
                      <span class="font-mono text-dim">{{ item.mergedBranch }}</span>
                    </span>
                    <span>
                      {{ t('sessions.workspace.group.detailCreated') }}:
                      <span class="text-dim">{{ fmtAt(item.createdAt) }}</span>
                    </span>
                    <span>
                      {{ t('sessions.workspace.group.detailUpdated') }}:
                      <span class="text-dim">{{ fmtAt(item.updatedAt) }}</span>
                    </span>
                  </div>
                </div>
                <!-- Sidebar phải: toàn bộ selectbox thuộc tính xếp dọc. -->
                <div class="col-span-3 flex min-w-0 flex-col gap-2.5">
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">
                      {{ t('sessions.workspace.group.field.status') }}
                    </span>
                    <AppSelect v-model="status" :options="statusOpts" width="100%" />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">
                      {{ t('sessions.workspace.group.field.assignee') }}
                    </span>
                    <AppSelect v-model="assignee" :options="assigneeOpts" width="100%" />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">
                      {{ t('sessions.workspace.group.fieldStage') }}
                    </span>
                    <Input
                      v-model="stageText"
                      type="number"
                      min="0"
                      step="1"
                      class="px-2"
                      placeholder="—"
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">{{ t('board.field.type') }}</span>
                    <AppSelect v-model="itemType" :options="typeOpts" width="100%" />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">
                      {{ t('board.field.priority') }}
                    </span>
                    <AppSelect v-model="priority" :options="prioOpts" width="100%" />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">
                      {{ t('board.field.severity') }}
                    </span>
                    <AppSelect v-model="severity" :options="sevOpts" width="100%" />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-muted-foreground">{{ t('board.field.parent') }}</span>
                    <AppSelect
                      v-model="parentId"
                      :options="parentOpts"
                      searchable
                      :empty-label="t('board.parent.none')"
                      width="100%"
                    />
                  </div>
                </div>
              </div>
            </div>
            <!-- Tab MEDIA: Media · links · docs của item — cùng section của tab
                 Info session, gom từ transcript assignee (+ member của run)
                 và comment thread. -->
            <div v-else-if="tab === 'media'" class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <WorkspaceInfoMedia :session="mediaSession" />
            </div>
            <!-- Tab DISCUSS: trao đổi nội bộ của ê-kíp VỀ đúng item này —
                 entry channel được tag itemId (member↔member bàn scope, lead
                 trả việc/eval của riêng item); cùng khuôn messenger của tab
                 Comment, composer broadcast tới cả nhóm và tự gắn tag item. -->
            <WorkspaceChannelThread
              v-else-if="tab === 'discuss' && runRoot"
              :project-id="item.projectId"
              :root-id="runRoot"
              :roster="roster"
              :item-id="item.id"
            />
            <!-- Tab COMMENT: thread messenger của item — chỉ comment của item. -->
            <WorkspaceBoardThread
              v-else
              :project-id="item.projectId"
              :item-id="item.id"
              :comments="item.comments ?? []"
              :assignee-session-id="item.assigneeSessionId ?? undefined"
            />
            <!-- Drawer chi tiết agent — trượt trong modal; `full` bung ra toàn
                 màn (fixed) để đọc transcript dài. -->
            <WorkspaceAgentPeek
              v-if="peekId"
              v-model:full="peekFull"
              :engine-id="peekId"
              @close="closePeek"
            />
          </template>

          <!-- ═══ CREATE MODE ═══ -->
          <div v-else class="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4">
            <!-- Toggle tạo thủ công / giao cho agent — chỉ có ở mode TẠO.
                 'agent' = assignee spec bắt buộc; mặc định đỗ item vào backlog
                 (spec chờ, không spawn), nút "Giao việc" phụ mới dispatch:
                 item todo + tin giao việc vào inbox của phiên đích khi Lưu. -->
            <Tabs
              v-if="!item"
              :model-value="mode"
              class="self-start"
              @update:model-value="(v) => (mode = v as typeof mode)"
            >
              <TabsList>
                <TabsTrigger value="manual" class="px-3 py-1 text-xs">
                  {{ t('board.mode.manual') }}
                </TabsTrigger>
                <TabsTrigger value="agent" class="gap-1.5 px-3 py-1 text-xs">
                  <Users />
                  {{ t('board.mode.agent') }}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div
              v-if="!item && mode === 'agent'"
              class="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground"
            >
              {{ t('board.agent.hint') }}
            </div>
            <!-- Agent mode: MỘT ô brief theo khuôn composer của session — @ để
                 tag agent/skill/wiki/file, `/` bung command, đính kèm ảnh/file
                 (chọn, dán, kéo-thả). Agent được dispatch tự chuẩn hoá title/desc
                 qua team_item_update sau khi đọc inbox. Manual mode giữ form
                 title+desc đầy đủ. -->
            <WorkspaceBoardComposer
              v-if="!item && mode === 'agent'"
              ref="briefComposer"
              v-model="brief"
              :project-id="projectSel"
              :attachments="pendingAtt"
              :disabled="busy"
              :placeholder="t('board.agent.briefPh')"
              @pick="fileInput?.click()"
              @add-att="att.addAtt"
              @add-files="att.addFiles"
              @remove-att="att.removeAtt"
              @submit="save(true)"
            />
            <template v-else>
              <!-- AI strip — chỉ mode tạo manual: brief → boards.draft điền
                   title/desc, model theo cấu hình AI authoring. -->
              <div v-if="!item" class="wsed-ai">
                <button
                  type="button"
                  class="wsed-aitoggle"
                  :class="{ on: aiOpen }"
                  @click="aiOpen = !aiOpen"
                >
                  <Sparkles class="wsed-aiicn" />
                  {{ t('board.ai.toggle') }}
                </button>
                <div v-if="aiOpen" class="wsed-aibody">
                  <Textarea
                    v-model="aiBrief"
                    rows="3"
                    class="resize-y"
                    :disabled="aiBusy"
                    :placeholder="t('board.ai.briefPh')"
                  />
                  <div class="wsed-airow">
                    <AiModelPicker width="200px" />
                    <Button size="sm" :disabled="aiBusy || !aiBrief.trim()" @click="runAiDraft">
                      <Sparkles v-if="!aiBusy" class="size-3.5" />
                      <RefreshCw v-else class="size-3.5 animate-spin" />
                      {{ aiBusy ? t('board.ai.drafting') : t('board.ai.go') }}
                    </Button>
                  </div>
                </div>
              </div>
              <Input
                ref="titleEl"
                v-model="title"
                class="font-medium"
                :placeholder="t('sessions.workspace.group.field.title')"
                maxlength="200"
                @keydown.enter="save(false)"
              />
              <Textarea
                v-model="desc"
                class="min-h-[120px] resize-y"
                rows="8"
                :placeholder="t('sessions.workspace.group.field.desc')"
              />
            </template>

            <!-- Props của create mode — cùng lưới 3 cột của tab General; agent
                 mode giấu status/stage (tạo mặc định vào backlog — chỉ nhịp
                 dispatch mới đặt todo; stage do lead xếp). -->
            <div class="grid grid-cols-3 gap-2.5">
              <div v-if="pickProject" class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {{ t('sessions.workspace.group.detailProject') }}
                </span>
                <AppSelect v-model="projectSel" :options="projectOpts" width="100%" />
              </div>
              <div v-if="mode !== 'agent'" class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {{ t('sessions.workspace.group.field.status') }}
                </span>
                <AppSelect v-model="status" :options="statusOpts" width="100%" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {{ t('sessions.workspace.group.field.assignee') }}
                  <template v-if="mode === 'agent'">*</template>
                </span>
                <AppSelect v-model="assignee" :options="assigneeOpts" width="100%" />
              </div>
              <div v-if="mode !== 'agent'" class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {{ t('sessions.workspace.group.fieldStage') }}
                </span>
                <Input
                  v-model="stageText"
                  type="number"
                  min="0"
                  step="1"
                  class="px-2"
                  placeholder="—"
                />
              </div>
            </div>

            <!-- Khuôn Jira — tạo mới cũng đặt được loại/ưu tiên/mức độ/cha
                 (epic do user khai, subtask gắn vào cha ngay từ đầu). -->
            <div class="grid grid-cols-4 gap-2.5">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{{ t('board.field.type') }}</span>
                <AppSelect v-model="itemType" :options="typeOpts" width="100%" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{{ t('board.field.priority') }}</span>
                <AppSelect v-model="priority" :options="prioOpts" width="100%" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{{ t('board.field.severity') }}</span>
                <AppSelect v-model="severity" :options="sevOpts" width="100%" />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{{ t('board.field.parent') }}</span>
                <AppSelect
                  v-model="parentId"
                  :options="parentOpts"
                  searchable
                  :empty-label="t('board.parent.none')"
                  width="100%"
                />
              </div>
            </div>

            <!-- Advanced — override LLM per-slot (collapse mặc định). -->
            <WorkspaceBoardAdvConfig
              ref="advRef"
              :assignee="assignee"
              :project-id="projectSel"
              :item="item"
              :lead="lead"
              :members="scopedMembers"
              :signals="advSignals"
            />
          </div>
          <!-- File picker ẩn cho menu `+` của composer brief (agent mode). -->
          <input ref="fileInput" type="file" multiple style="display: none" @change="onPick" />
        </div>

        <div class="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <Button
            v-if="item"
            variant="ghost"
            size="xs"
            class="text-destructive hover:bg-destructive/10 hover:text-destructive"
            :disabled="busy"
            @click="remove"
          >
            {{ t('sessions.workspace.group.deleteItem') }}
          </Button>
          <span class="flex-1" />
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('close')">
            {{ t('common.cancel') }}
          </Button>
          <!-- Agent mode: hai nhịp — CHÍNH = xếp backlog (giữ spec ref, spawn
               khi item được bốc khỏi backlog — tạo issue luôn rẻ, không tốn
               token), phụ = giao việc ngay (materialize → item todo + inbox). -->
          <Button
            v-if="!item && mode === 'agent'"
            variant="outline"
            size="sm"
            :disabled="busy || !canSave"
            @click="save(false)"
          >
            {{ t('board.agent.submit') }}
          </Button>
          <Button size="sm" :disabled="busy || !canSave" @click="save(!item && mode === 'agent')">
            {{
              item
                ? t('common.save')
                : mode === 'agent'
                  ? t('board.agent.backlog')
                  : t('common.create')
            }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Modal chi tiết một board item — kiểu messenger: header = id + TÊN ISSUE +
// dropdown thành viên (bấm member → WorkspaceAgentPeek xem đang làm gì ngay
// trong modal, không rời item). Hai tab: General (form + props một cột, không
// sidebar) và Trao đổi (WorkspaceBoardThread — tin agent trái, tin bạn phải,
// sự kiện giao/nhận việc ở giữa). Save gom các field thành một `boards.upsert`;
// comment post NGAY qua `boards.comment`. Mode tạo giữ layout một cột.
import {
  ArrowLeft,
  BookOpen,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CornerDownRight,
  Crown,
  Download,
  Hourglass,
  Layers,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  SquareCheck,
  Users,
  X,
} from 'lucide-vue-next'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useEscToClose } from '~/composables/useEscToClose'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { useComposerAttachments } from '~/composables/useComposerAttachments'
import { useBoardAtts } from '~/composables/useBoardAtts'
import { useSidecar, sidecarErrorText } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { provideMemberPeek } from '~/composables/useMemberPeek'
import { isAuthError } from '~/utils/auth-error'
import { exportSlug, saveTextFile } from '~/utils/export'
import { ghRefFromText, ghRefTitle, stripGhLinks } from '~/utils/gh-ref'
import AiModelPicker from '~/components/common/AiModelPicker.vue'
import { useAgentsStore } from '~/stores/agents'
import {
  ACTIVE_BOARD_STATUSES,
  isSpecAssignee,
  useBoardStore,
  type BoardItem,
  type BoardItemPriority,
  type BoardItemSeverity,
  type BoardItemStatus,
  type BoardItemType,
} from '~/stores/board'
import { useProjectsStore } from '~/stores/projects'
import { useTeamsStore } from '~/stores/teams'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import type {
  Session,
  SessionLlmOverride,
  SessionMessage,
  SessionStatus,
} from '~/composables/useSessionsData'
import { boardCommentToMessage } from '~/utils/board-comment-message'
import { formatTokenCount } from '~/utils/context-window'
import { provideFilePreview } from '~/composables/useFilePreview'
import { avatarHue, nameInitial } from '~/utils/avatar-hue'
import WorkspaceBoardComposer from './WorkspaceBoardComposer.vue'
import WorkspaceBoardAdvConfig from './WorkspaceBoardAdvConfig.vue'
import WorkspaceInfoMedia from './WorkspaceInfoMedia.vue'
import WorkspaceBoardThread from './WorkspaceBoardThread.vue'
import WorkspaceChannelThread from './WorkspaceChannelThread.vue'
import WorkspaceAgentPeek from './WorkspaceAgentPeek.vue'
import DropdownMenu from '~/components/ui/dropdown-menu/DropdownMenu.vue'
import DropdownMenuTrigger from '~/components/ui/dropdown-menu/DropdownMenuTrigger.vue'
import DropdownMenuContent from '~/components/ui/dropdown-menu/DropdownMenuContent.vue'
import DropdownMenuItem from '~/components/ui/dropdown-menu/DropdownMenuItem.vue'
import DropdownMenuLabel from '~/components/ui/dropdown-menu/DropdownMenuLabel.vue'

const props = withDefaults(
  defineProps<{
    // null = mode TẠO mới (status backlog mặc định).
    item: BoardItem | null
    // Project đích mặc định — board unified có thể truyền '' và bật pickProject.
    projectId: string
    // Member + lead — option của picker "giao cho" (tự lọc theo project đích).
    members: Session[]
    // Optional — màn Board riêng (project-scope) không có khái niệm lead.
    lead?: Session
    // Cho phép đổi project đích khi TẠO item — chỉ màn Board riêng bật; cockpit
    // tạo item luôn thuộc project của nhóm.
    pickProject?: boolean
  }>(),
  { lead: undefined, pickProject: false },
)
const emit = defineEmits<{ close: []; openItem: [id: string] }>()

const { t } = useI18n()
const board = useBoardStore()
const projectsStore = useProjectsStore()
const teamsStore = useTeamsStore()
const sessionsStore = useSessionsStore()
const agentsStore = useAgentsStore()
const settingsStore = useSettingsStore()
const sc = useSidecar()
const toast = useToast()
const { openSettings } = useSettingsModal()
const { confirm } = useConfirm()
// Esc theo lớp: peek đang full → thu về drawer; peek drawer → đóng peek;
// modal đang full → thu về cỡ thường; cuối cùng mới đóng modal.
const peekId = ref('')
const peekFull = ref(false)
const edFull = ref(false)
function closePeek(): void {
  peekId.value = ''
  peekFull.value = false
}
useEscToClose(
  () => true,
  () => {
    if (peekFull.value) peekFull.value = false
    else if (peekId.value) closePeek()
    else if (edFull.value) edFull.value = false
    else emit('close')
  },
)

// ── Draft fields ──
const busy = ref(false)
// Ref trỏ vào component Input — nó expose focus() ở instance (không phải $el).
const titleEl = ref<{ focus?: () => void } | null>(null)
const title = ref(props.item?.title ?? '')
const desc = ref(props.item?.desc ?? '')
const status = ref<BoardItemStatus>(props.item?.status ?? 'backlog')
// 'user' = sentinel NGƯỜI DÙNG (không phải sessionId); '' = chưa giao.
// Item chờ spec (assigneeRef) hiện spec đó trong select — sessionId thắng khi
// item đã materialize.
const assignee = ref<string>(props.item?.assigneeSessionId ?? props.item?.assigneeRef ?? '')
// Stage là số nguyên ≥0 hoặc trống (= null ⇒ item không thuộc đợt nào).
const stageText = ref<string>(props.item?.stage != null ? String(props.item.stage) : '')
// Khuôn Jira: loại việc (mặc định 'task'), ưu tiên ('' = không đặt — đọc như
// medium khi filter), mức độ ('' = không đặt), và item CHA của cây sub-issue
// ('' = cấp trên). parentId null khi save = gỡ khỏi cha.
const itemType = ref<BoardItemType>(props.item?.type ?? 'task')
const priority = ref<BoardItemPriority | ''>(props.item?.priority ?? '')
const severity = ref<BoardItemSeverity | ''>(props.item?.severity ?? '')
// Tín hiệu cho nút "tối ưu model" của Advanced — create mode item=null nên
// chấm từ giá trị form đang gõ; edit mode refs đã hydrate từ item nên cùng
// một nguồn sự thật.
const advSignals = computed(() => ({
  type: itemType.value,
  priority: priority.value,
  severity: severity.value,
  desc: desc.value,
}))
const parentId = ref<string>(props.item?.parentId ?? '')
// Project đích — edit mode cố định theo item; create mode đổi được khi
// pickProject (board unified không ngầm một project duy nhất).
const projectSel = ref<string>(props.item?.projectId ?? props.projectId)

// Điều hướng cha↔con (openItem) đổi props.item NHƯNG modal không remount —
// hydrate lại toàn bộ draft kẻo form giữ dữ liệu của item trước.
watch(
  () => props.item?.id,
  () => {
    const it = props.item
    title.value = it?.title ?? ''
    desc.value = it?.desc ?? ''
    status.value = it?.status ?? 'backlog'
    assignee.value = it?.assigneeSessionId ?? it?.assigneeRef ?? ''
    stageText.value = it?.stage != null ? String(it.stage) : ''
    itemType.value = it?.type ?? 'task'
    priority.value = it?.priority ?? ''
    severity.value = it?.severity ?? ''
    parentId.value = it?.parentId ?? ''
    projectSel.value = it?.projectId ?? props.projectId
    tab.value = 'chat'
  },
)

// ── Roster ê-kíp của item (dropdown trên header) ──
// Assignee trỏ vào một phiên: là root của run (lead) khi nó mang link spec
// `teamId` HOẶC đã có member, hoặc member — leo `teamRunId` lên root. Phiên
// lẻ, sentinel 'user' và trống ⇒ roster một người (chính assignee) hoặc rỗng.
// `teamId` nhận diện gốc run spec TRƯỚC cả khi member đầu tiên materialize —
// mirror `runRootId` phía sidecar (sessions/run-root.ts), kẻo item vừa giao
// cho team mất luôn roster + bench options.
// Mở item vào thẳng tab Trao đổi — hành vi trao đổi/tiến độ là nội dung chính.
const tab = ref<'gen' | 'chat' | 'discuss' | 'media'>('chat')

const runRoot = computed(() => {
  const a = props.item?.assigneeSessionId
  if (!a || a === 'user') return ''
  const s = sessionsStore.sessions.find((x) => x.engineId === a)
  if (!s) return ''
  if (s.teamRunId) return s.teamRunId
  return s.teamId || sessionsStore.sessions.some((m) => m.teamRunId === a) ? a : ''
})

// ── Tab Media ────────────────────────────────────────────────────────────
// Phiên TỔNG HỢP cho index "Media · links · docs": comment của item (attachment
// đi vào text dạng "- name: /abs/path", link cũng nằm trong text) + transcript
// thật của assignee — và khi assignee là LEAD của run thì gom luôn member, vì
// work thật (file viết, link fetch) nằm ở transcript member chứ không phải lead.
const mediaSession = computed<Session>(() => {
  const it = props.item
  const msgs: SessionMessage[] = (it?.comments ?? []).map(boardCommentToMessage)
  let status: SessionStatus = 'idle'
  const sid = it?.assigneeSessionId
  if (sid && sid !== 'user') {
    const s = sessionsStore.sessions.find((x) => x.engineId === sid)
    if (s) {
      status = s.status
      msgs.push(...(s.msgs ?? []))
      for (const m of sessionsStore.sessions) {
        if (m.teamRunId === s.engineId) msgs.push(...(m.msgs ?? []))
      }
    }
  }
  return {
    id: -1,
    title: it?.title ?? '',
    project: it?.projectId ?? props.projectId,
    model: '',
    account: '',
    style: '',
    status,
    when: '',
    msgs,
  }
})
// File link trong thread/media của item resolve theo PROJECT của item — editor
// có thể mở ngoài cây SessionDetail (trang Teams) nên tự khai provider riêng;
// khi đứng trong SessionDetail thì ghi đè đúng project của item.
provideFilePreview(() => props.item?.projectId ?? props.projectId, mediaSession)
const runLead = computed(() =>
  runRoot.value ? sessionsStore.sessions.find((s) => s.engineId === runRoot.value) : undefined,
)
const runMembers = computed(() =>
  runRoot.value ? sessionsStore.sessions.filter((s) => s.teamRunId === runRoot.value) : [],
)
// Gốc run để resolve bench (member spec chưa có phiên): edit mode lấy run của
// assignee; create mode trong cockpit lấy lead/member được truyền xuống.
const benchRootId = computed(
  () =>
    runRoot.value ||
    props.lead?.engineId ||
    props.members.find((m) => m.teamRunId)?.teamRunId ||
    '',
)
// Team spec của run — khoá `source|projectId|id` (session cũ thiếu teamSource
// thì dò global trước rồi project của gốc, y hệt loadRunTeam phía sidecar).
const runTeamSpec = computed(() => {
  const root = sessionsStore.sessions.find((s) => s.engineId === benchRootId.value)
  if (!root?.teamId) return undefined
  const exact = root.teamSource
    ? teamsStore.teamByKey(
        `${root.teamSource}|${root.teamSource === 'project' ? (root.teamProjectId ?? '') : ''}|${root.teamId}`,
      )
    : undefined
  return (
    exact ??
    teamsStore.teamByKey(`global||${root.teamId}`) ??
    (root.project ? teamsStore.teamByKey(`project|${root.project}|${root.teamId}`) : undefined)
  )
})
// "Bench" — member spec chưa có phiên sống trong run (mirror liveMemberSession
// của sidecar: agent.id khớp là nhận diện mạnh, title làm fallback). Chọn một
// option này ghi `member:<runId>|<title>` vào assigneeRef/assignee — spawn lười
// khi item vào cột sống qua sessions.materializeMember.
const benchOpts = computed<AppSelectOption[]>(() => {
  const team = runTeamSpec.value
  const rootId = benchRootId.value
  if (!team || !rootId) return []
  const live = sessionsStore.sessions.filter((s) => s.teamRunId === rootId)
  return team.members
    .filter(
      (m) => !live.some((s) => (m.agent?.id && s.agent?.id === m.agent.id) || s.title === m.title),
    )
    .map((m) => ({
      value: `member:${rootId}|${m.title}`,
      label: `◌ ${m.title} · ${t('sessions.workspace.group.bench')}`,
    }))
})
// Roster: lead đứng đầu rồi members; assignee phiên lẻ (không run) cũng vào —
// peek "đang làm gì" vẫn mở được cho agent đơn.
const roster = computed<Session[]>(() => {
  if (runLead.value) return [runLead.value, ...runMembers.value]
  const a = props.item?.assigneeSessionId
  const s = a && a !== 'user' ? sessionsStore.sessions.find((x) => x.engineId === a) : undefined
  return s ? [s] : []
})
const rosterLabel = computed(() => {
  const lead = roster.value[0]
  return runRoot.value && lead ? `${lead.title} · ${roster.value.length}` : (lead?.title ?? '')
})
// Usage rollup của từng phiên trong roster (sessions.costBreakdown: lượt đã
// chạy + tổng token lũy kế). Nạp lười khi user MỞ dropdown roster — mỗi phiên
// một đọc JSONL nên không gọi vô cớ; throttle 15s để mở-đóng nhanh không nạp
// lại mà số vẫn tươi giữa các lần xem.
const memberStats = ref<Record<string, { turns: number; tokens: number }>>({})
let statsAt = 0
async function refreshMemberStats(): Promise<void> {
  const now = Date.now()
  if (now - statsAt < 15_000) return
  const ids = roster.value.map((m) => m.engineId).filter((x): x is string => !!x)
  if (!ids.length) return
  statsAt = now
  const rows = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await sc.request<{
          total: { turns: number; totalTokens: number }
        }>('sessions.costBreakdown', { sessionId: id })
        return [id, { turns: r.total.turns, tokens: r.total.totalTokens }] as const
      } catch {
        return null // phiên lỗi/thiếu → giữ số cũ (hoặc không hiện dòng stats)
      }
    }),
  )
  const next: typeof memberStats.value = {}
  for (const r of rows) if (r) next[r[0]] = r[1]
  memberStats.value = next
}
function onRosterOpen(open: boolean): void {
  if (open) void refreshMemberStats()
}
// Tổng lượt + token cả roster — hiện ở header dropdown khi đã có rollup của
// ít nhất một phiên (member chưa chạy lượt nào góp 0, không cần chờ đủ cả).
const rosterTotals = computed(() => {
  let turns = 0
  let tokens = 0
  for (const s of Object.values(memberStats.value)) {
    turns += s.turns
    tokens += s.tokens
  }
  return { turns, tokens }
})
// Tab bar: Comment đứng đầu (thread của item); Discuss chỉ hiện khi item đang
// trong tay một RUN — trao đổi nội bộ của ê-kíp VỀ đúng item này (badge đếm
// entry trong scope tag — chính nó + cây con, thẻ chính lẫn phụ), tách khỏi
// comment của user ↔ assignee.
const tabs = computed(() => {
  const list: { k: 'gen' | 'chat' | 'discuss' | 'media'; label: string }[] = [
    {
      k: 'chat',
      label: `${t('sessions.workspace.group.tabChat')} · ${(props.item?.comments ?? []).length}`,
    },
  ]
  if (runRoot.value && props.item) {
    const item = props.item
    const scope = board.itemTagScope(item.projectId, item.id)
    const n = board
      .channelFor(runRoot.value)
      .filter((e) => board.entryInScope(e, scope, item.projectId, runRoot.value)).length
    list.push({ k: 'discuss', label: `${t('sessions.workspace.group.discuss')} · ${n}` })
  }
  list.push(
    { k: 'media', label: t('sessions.workspace.group.tabMedia') },
    { k: 'gen', label: t('sessions.workspace.group.tabGeneral') },
  )
  return list
})
function peek(m: Session): void {
  if (m.engineId) peekId.value = m.engineId
}
// Bấm chip @mention trong thread → mở drawer phiên của member đó (chip do
// SessionMarkdownHtml bọc). Handle đến dạng slug (composer chèn agentHandle)
// hoặc title nguyên văn — khớp cả hai; không ai sống khớp thì báo nhẹ thay vì
// im lặng nuốt click.
provideMemberPeek((handle) => {
  const h = handle.toLowerCase()
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-')
  const m = roster.value.find((s) => slug(s.title) === h || s.title.toLowerCase() === h)
  if (m?.engineId) {
    peekId.value = m.engineId
    return
  }
  toast.add({
    title: t('sessions.workspace.group.peek.noLive', { name: handle }),
    color: 'info',
    duration: 2500,
  })
})

const initial = nameInitial
const avatarColor = (m: Session): string => avatarHue(m.engineId ?? String(m.id))

// Icon trạng thái member trong dropdown — animation sống trong CSS .mstat.
const STATUS_ICONS: Record<SessionStatus, unknown> = {
  streaming: LoaderCircle,
  awaiting: Hourglass,
  done: CircleCheck,
  error: CircleAlert,
  idle: CircleDashed,
}
const statusIcon = (st: SessionStatus | undefined): unknown => STATUS_ICONS[st ?? 'idle']

// Mode TẠO: 'manual' = item thường; 'agent' = assignee spec bắt buộc, mặc định
// xếp backlog (spec chờ), nút dispatch mới đặt todo + tin giao việc vào inbox
// phiên đích khi Lưu (một modal, hai nhịp xài).
// Agent mode: MỘT ô brief — agent được dispatch sẽ tự chuẩn hoá title/desc
// của item (team_item_update). Title tạm = dòng đầu của brief.
const brief = ref('')
// Composer của ô brief: đính kèm (pick/paste/drag-drop) sống trong
// useComposerAttachments — cùng composable mà SessionDetail dùng, nên phân loại
// image/PDF/text/path-ref không trôi khỏi bản chính.
const att = useComposerAttachments()
const pendingAtt = att.pending
const fileInput = ref<HTMLInputElement | null>(null)
const briefComposer = ref<{ focus: () => void; expanded: () => string } | null>(null)
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) att.addFiles(input.files)
  input.value = ''
}
// Title tạm của item = dòng đầu brief (trần 140 như contract team_item_create)
// — phiên agent sẽ viết lại cho đúng sau khi đọc inbox. Brief mở đầu bằng
// `/cmd args` được bung sang body trước khi rút dòng đầu làm title. Brief có
// link github.com/…/issues|pull/<n> ⇒ title theo quy ước `#<n>_IS:`/`#<n>_PR:`
// (utils/gh-ref), phần desc là phần dòng đầu còn lại sau khi gỡ URL.
const briefTitle = computed(() => {
  const src = (briefComposer.value?.expanded() ?? brief.value).trim()
  const ref = ghRefFromText(src)
  const first = (src.split('\n')[0] ?? '').trim()
  if (ref) {
    return ghRefTitle(ref, stripGhLinks(first)).slice(0, 140)
  }
  return first.slice(0, 140)
})
const mode = ref<'manual' | 'agent'>('manual')
// AI draft strip (mode manual, tạo mới): brief → boards.draft điền title/desc.
// Model/account theo cấu hình AI authoring của Settings → Models.
const aiOpen = ref(false)
const aiBrief = ref('')
const aiBusy = ref(false)
watch(mode, (m) => {
  if (m === 'agent') {
    // Assignee của mode manual là sessionId — không hợp lệ ở agent mode,
    // reset để user chọn spec (agent:<key> / team:<key>). Status giữ nguyên:
    // agent mode mặc định đỗ backlog, không còn ngầm dispatch.
    if (!assignee.value.startsWith('agent:') && !assignee.value.startsWith('team:')) {
      assignee.value = ''
    }
  }
})

const agentMode = computed(() => !props.item && mode.value === 'agent')
// Đổi project đích ⇒ nạp lại roster agent của tier đó (picker lọc theo
// projectSel — roster lỗi project khác chỉ làm nhiễu).
watch(projectSel, (p) => void agentsStore.loadAgents(p ? [p] : []))
const canSave = computed(() => {
  if (!projectSel.value) return false
  if (agentMode.value) {
    // Brief + một thực thể bền (agent/team spec) — ''/user/sessionId trần
    // đều không hợp lệ ở mode này.
    return (
      !!brief.value.trim() &&
      (assignee.value.startsWith('agent:') || assignee.value.startsWith('team:'))
    )
  }
  return !!title.value.trim()
})

// Draft bằng AI — điền title/desc từ brief, giữ nguyên mọi field khác. Auth
// fail → toast kèm action mở Settings (khuôn pages/teams.vue runDraft).
async function runAiDraft(): Promise<void> {
  if (aiBusy.value || !aiBrief.value.trim() || !projectSel.value) return
  aiBusy.value = true
  try {
    const draft = await board.draftItem({
      projectId: projectSel.value,
      brief: aiBrief.value.trim(),
      // Revise khi form đã có nội dung — model giữ phần brief không nhắc tới.
      ...(title.value.trim() || desc.value.trim()
        ? { current: { title: title.value, desc: desc.value } }
        : {}),
      settings: settingsStore.resolveAuthoringLlm(),
    })
    if (draft.title) title.value = draft.title
    if (draft.desc !== undefined) desc.value = draft.desc
    aiOpen.value = false
    aiBrief.value = ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    toast.add({
      title: t('board.ai.failed'),
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

const projectName = (id: string): string => projectsStore.projectById(id)?.name ?? id
const projectOpts = computed<AppSelectOption[]>(() =>
  projectsStore.projects.map((p) => ({ value: p.id, label: p.name })),
)

// Picker "giao cho" chỉ nên liệt kê session của project đích — giao item của
// project A cho session project B là dữ liệu lệch pha. Rỗng khi chưa chọn
// project (create mode) ⇒ liệt kê hết.
const scopedMembers = computed(() =>
  props.members.filter((m) => !projectSel.value || m.project === projectSel.value),
)

const STATUSES: BoardItemStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'changes',
  'blocked',
  'done',
  'cancelled',
]
const camel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const statusLabel = (s: BoardItemStatus): string => t(`sessions.workspace.group.st.${camel(s)}`)
const statusOpts = computed<AppSelectOption[]>(() =>
  STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
)

// Khuôn Jira — options cho type/priority/severity/cha. '' = "không đặt"
// (priority/severity) và "cấp trên" (parent).
const typeOpts = computed<AppSelectOption[]>(() =>
  (['epic', 'story', 'task', 'subtask', 'bug'] as const).map((v) => ({
    value: v,
    label: t(`board.type.${v}`),
  })),
)
const prioOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.prio.none') },
  ...(['urgent', 'high', 'medium', 'low'] as const).map((v) => ({
    value: v,
    label: t(`board.prio.${v}`),
  })),
])
const sevOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.sev.none') },
  ...(['blocker', 'major', 'minor', 'trivial'] as const).map((v) => ({
    value: v,
    label: t(`board.sev.${v}`),
  })),
])
// Ứng viên làm cha: mọi item cùng project TRỪ chính mình và cả nhánh con của
// mình (chọn con làm cha = vòng). Store vẫn kiểm lại ở checkParentLink — đây
// chỉ là không cho user chọn cái chắc chắn sai.
const parentOpts = computed<AppSelectOption[]>(() => {
  const all = board.itemsFor(projectSel.value)
  const blocked = new Set<string>()
  const selfId = props.item?.id
  if (selfId) {
    const queue = [selfId]
    while (queue.length) {
      const cur = queue.shift()!
      blocked.add(cur)
      for (const c of all) {
        if (c.parentId === cur && !blocked.has(c.id)) queue.push(c.id)
      }
    }
  }
  const out: AppSelectOption[] = [{ value: '', label: t('board.parent.none') }]
  for (const it of all) {
    if (blocked.has(it.id)) continue
    const tag = it.type && it.type !== 'task' ? `[${t(`board.type.${it.type}`)}] ` : ''
    out.push({ value: it.id, label: `${tag}${it.title}` })
  }
  return out
})

// Icon theo loại item (dùng chung cho breadcrumb cha lẫn list việc con) —
// cùng bảng màu/glyph của card ngoài board.
const TYPE_ICON_OF: Record<BoardItemType, unknown> = {
  epic: Layers,
  story: BookOpen,
  task: SquareCheck,
  subtask: CornerDownRight,
  bug: Bug,
}
const typeIconOf = (it: BoardItem): unknown => TYPE_ICON_OF[it.type ?? 'task']

// Việc con (cây sub-issue): item nào trỏ parentId vào item đang mở — render
// trong tab General, click nhảy sang editor của item con (emit openItem).
const childItems = computed<BoardItem[]>(() => {
  const id = props.item?.id
  if (!id) return []
  return board.itemsFor(props.item!.projectId).filter((c) => c.parentId === id)
})

// Chuỗi tổ tiên (gốc → … → cha trực tiếp) cho breadcrumb đầu modal — leo
// parentId qua itemById (item có thể bị filter giấu ngoài board), chặn vòng
// đề phòng dữ liệu sửa tay.
const parentChain = computed<BoardItem[]>(() => {
  const out: BoardItem[] = []
  const seen = new Set<string>()
  let cur = props.item?.parentId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const p = board.itemById(cur)
    if (!p) break
    out.unshift(p)
    cur = p.parentId
  }
  return out
})

// "Giao cho" — nguồn tuỳ mode:
//   manual: chưa ai · Bạn · lead · member sessions đang sống (giao cho người
//           đang chạy) + spec (backlog = xếp chờ, status sống = spawn ngay).
//   agent : AGENT SPECS + TEAM SPECS — thực thể BỀN (khuôn Multica: giao việc
//           cho agent/team chứ không giao cho session). "Giao việc" spawn ngay
//           → item todo; "Xếp vào backlog" giữ spec ref, spawn khi item bị kéo
//           ra cột sống (board.applyStatus). Agent của project đích shadow
//           global trùng id (Claude Code semantics).
// Options spec (agent/team BỀN) — dùng chung cho agent mode lẫn form thường:
// spec ở backlog nghĩa là "xếp chờ", còn khi status sống thì save materialize
// ngay (xem save). Agent của project đích shadow global trùng id.
const specAssigneeOpts = computed<AppSelectOption[]>(() => {
  const out: AppSelectOption[] = []
  const projectIds = new Set(
    agentsStore.agents
      .filter((a) => a.source === 'project' && a.projectId === projectSel.value)
      .map((a) => a.id),
  )
  const usable = agentsStore.agents.filter((a) =>
    a.source === 'project' ? a.projectId === projectSel.value : !projectIds.has(a.id),
  )
  for (const a of usable) {
    const tier =
      a.source === 'project' ? projectName(a.projectId ?? '') : t('agents.tierLabel.global')
    out.push({ value: `agent:${agentsStore.agentKey(a)}`, label: `⚡ ${a.name} · ${tier}` })
  }
  for (const team of teamsStore.teams) {
    out.push({
      value: `team:${teamsStore.teamKey(team)}`,
      label: `⛁ ${team.name} · ${t('nav.teams').toLowerCase()}`,
    })
  }
  return out
})

const assigneeOpts = computed<AppSelectOption[]>(() => {
  if (agentMode.value) {
    const out = [...specAssigneeOpts.value]
    // Giá trị hiện tại lạc hậu vẫn hiện đọc được thay vì trống.
    if (assignee.value && !out.some((o) => o.value === assignee.value)) {
      out.push({ value: assignee.value, label: assignee.value })
    }
    return out
  }
  const out: AppSelectOption[] = [
    { value: '', label: t('sessions.workspace.group.assigneeNone') },
    { value: 'user', label: t('sessions.workspace.group.assigneeUser') },
  ]
  if (props.lead?.engineId) {
    out.push({
      value: props.lead.engineId,
      label: `${props.lead.title} · ${t('sessions.workspace.group.lead')}`,
    })
  }
  for (const m of scopedMembers.value) {
    if (!m.engineId) continue
    out.push({ value: m.engineId, label: m.title })
  }
  // Spec cũng xếp được ở form thường: chọn spec + status backlog ⇒ item chờ;
  // spec + status sống ⇒ materialize ngay khi lưu (giống agent mode). Bench =
  // member của RUN đang sống chưa có phiên — spawn lười đúng một cái khi giao.
  out.push(...specAssigneeOpts.value, ...benchOpts.value)
  if (assignee.value && !out.some((o) => o.value === assignee.value)) {
    out.push({ value: assignee.value, label: assignee.value })
  }
  return out
})

// Ref tới phần Advanced (override LLM per-slot) — component tự chứa
// rows/config; editor chỉ lấy map đã lọc để ghi + áp lên phiên sống sau save.
const advRef = ref<{
  configForSave: () => Record<string, SessionLlmOverride> | null
  applyLive: (item: BoardItem) => Promise<void>
} | null>(null)

const fmtAt = (iso: string): string => new Date(iso).toLocaleString()

// Đính kèm → {project}/.awog/board-att/<itemId>/ + dòng tham chiếu — logic
// chung ở useBoardAtts (thread comment dùng cùng).
const boardAtts = useBoardAtts()
const materializeAtts = (itemId: string): Promise<string[]> =>
  boardAtts.materialize(pendingAtt.value, projectSel.value, itemId)

async function save(toBacklog = false): Promise<void> {
  if (busy.value || !canSave.value) return
  busy.value = true
  try {
    // Status của lần ghi: agent mode có hai nhịp — MẶC ĐỊNH "Xếp vào backlog"
    // (đỗ spec chờ bốc) và nút phụ "Giao việc" (todo, spawn ngay). Form thường
    // theo ô status.
    const targetStatus: BoardItemStatus = agentMode.value
      ? toBacklog
        ? 'backlog'
        : 'todo'
      : status.value
    // Agent mode: title = dòng đầu brief (agent tự chuẩn hoá lại qua
    // team_item_update), desc = brief. Nhịp backlog dùng brief ĐÃ bung slash
    // vì không có tin inbox — desc là nơi duy nhất gánh nội dung.
    const finalTitle = agentMode.value ? briefTitle.value : title.value.trim()
    const finalDesc = agentMode.value
      ? toBacklog
        ? briefComposer.value?.expanded().trim() || brief.value.trim()
        : brief.value.trim()
      : desc.value.trim()

    // 'agent:'/'team:' = SPEC chờ materialize — KHÔNG BAO GIỜ ghi thẳng vào
    // assigneeSessionId (zod SESSION_ID_RE chặn). Status sống ⇒ materialize
    // ngay (board.materializeRef → sessionId, giống dispatch); backlog ⇒ giữ
    // trong assigneeRef, spawn khi item bị kéo ra cột sống (board.applyStatus).
    let assigneeId = assignee.value
    let assigneeRef: string | null = null
    // Override LLM per-slot (Advanced) — map đã lọc theo slot của assignee
    // hiện tại; component không mount (không slot nào) ⇒ giữ/gỡ theo hiện
    // trạng item thay vì phá config cũ.
    const advCfg = advRef.value?.configForSave()
    try {
      if (isSpecAssignee(assigneeId)) {
        if (ACTIVE_BOARD_STATUSES.has(targetStatus)) {
          assigneeId = await board.materializeRef(
            assigneeId,
            projectSel.value,
            finalTitle || undefined,
            props.item?.id,
            advCfg ?? undefined,
          )
        } else {
          assigneeRef = assigneeId
          assigneeId = ''
        }
      }
    } catch (err) {
      // materialize fail → báo message thật (lý do nằm trong
      // SidecarError.data.message, xem sidecarErrorText).
      toast.add({
        title: t('board.agent.runFailed'),
        description: sidecarErrorText(err),
        color: 'error',
      })
      return
    }

    const patch: Parameters<typeof board.upsertItem>[1] = {
      title: finalTitle,
      status: targetStatus,
      // '' (chưa giao) gửi null để sidecar XOÁ assignee — bỏ field thì patch
      // merge sẽ giữ người nhận cũ. assigneeRef cùng luật (null = gỡ spec
      // chờ). Stage: trống ⇒ gỡ khỏi đợt.
      assigneeSessionId: assigneeId || null,
      assigneeRef,
      // Advanced có mount (assignee resolve ra slot) ⇒ ghi map đã lọc — null =
      // gỡ hẳn override cũ. Component không mount ⇒ undefined = không đụng.
      ...(advCfg !== undefined ? { assigneeConfig: advCfg } : {}),
      stage:
        agentMode.value || stageText.value === ''
          ? null
          : Math.max(0, Math.floor(Number(stageText.value) || 0)),
      // Khuôn Jira — type luôn có giá trị; priority/severity '' = "không đặt"
      // gửi null để sidecar XOÁ nhãn cũ (vắng field = giữ nguyên). Cha '' =
      // cấp trên → null gỡ liên kết; item mới chưa có parentId nên null vô
      // hại (store bỏ qua parentId rỗng lúc tạo).
      type: itemType.value,
      priority: priority.value || null,
      severity: severity.value || null,
      parentId: parentId.value || null,
    }
    if (finalDesc) patch.desc = finalDesc
    if (props.item?.id) patch.id = props.item.id
    const res = await board.upsertItem(projectSel.value, patch)
    if (res === null) return

    // Override Advanced áp NGAY lên các phiên sống của người nhận — lúc này
    // res.assigneeSessionId là phiên cuối (vừa materialize hoặc vốn đã sống):
    // đổi account khi hết token có hiệu lực tức thì, không chờ lượt mới.
    await advRef.value?.applyLive(res)

    // Nhịp xếp backlog: đính kèm ghi vào .awog/board-att/<id>/ rồi vá desc —
    // không có tin inbox ở nhịp này nên desc là nơi duy nhất chứa đường dẫn
    // file; khi bốc việc, tin wake của boards.upsert dẫn agent đọc team_item_get.
    if (assigneeRef && res.id) {
      const attLines = await materializeAtts(res.id)
      if (attLines.length) {
        await board.upsertItem(projectSel.value, {
          id: res.id,
          title: res.title,
          desc: [finalDesc, t('board.agent.attachHead'), ...attLines].filter(Boolean).join('\n\n'),
        })
      }
      att.clear()
      if (!props.item) {
        toast.add({ title: t('board.agent.queuedDone', { title: res.title }), color: 'success' })
      }
      emit('close')
      return
    }
    // Mode 'agent': xếp tin giao việc vào inbox phiên đích — tham chiếu item id
    // để nó gọi team_item_get lấy đủ ngữ cảnh + tự chuẩn hoá title/desc qua
    // team_item_update. Tin chờ giao theo cơ chế nhóm (auto-deliver / user
    // bấm giao), UI không tự mở lượt tốn token.
    if (agentMode.value && assigneeId && res.id) {
      // Đính kèm: inbox chỉ mang text nên file/ảnh được materialize vào
      // {project}/.awog/board-att/<itemId>/ và tham chiếu bằng đường dẫn tuyệt
      // đối — agent đọc qua Read. File đã có `path` (kéo/chọn từ đĩa) giữ
      // nguyên tham chiếu gốc, không chép lại.
      const attLines = await materializeAtts(res.id)
      const text = [
        t('board.agent.msgAssign', { id: res.id, title: res.title }),
        // Slash `/cmd args` trong brief bung thành body command — cùng luật
        // buildOutgoing của composer session.
        briefComposer.value?.expanded().trim() || brief.value.trim(),
        ...(attLines.length ? [t('board.agent.attachHead'), ...attLines] : []),
        t('board.agent.msgDone'),
      ]
        .filter(Boolean)
        .join('\n\n')
      void sc
        .request('sessions.postMessage', { sessionId: assigneeId, text })
        .catch((err: unknown) => console.warn('[board] agent wake failed', err))
      att.clear()
    }
    emit('close')
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!props.item || busy.value) return
  const ok = await confirm({
    title: t('sessions.workspace.group.deleteItem'),
    // Item có assignee ⇒ xoá item là dừng + xoá luôn phiên đang làm — nói rõ
    // trước khi user xác nhận (không phải mỗi title).
    description: props.item.assigneeSessionId
      ? t('sessions.workspace.group.deleteItemWithSession', { title: props.item.title })
      : props.item.title,
  })
  if (!ok) return
  busy.value = true
  try {
    if (await board.deleteItem(props.projectId, props.item.id)) emit('close')
  } finally {
    busy.value = false
  }
}

// Export issue đơn ra file .md — title + status + desc + comments, định dạng
// đọc được ngay (khác JSON của board export — đây là artifact để share/đọc).
async function exportIssue(): Promise<void> {
  const it = props.item
  if (!it) return
  const lines = [
    `# ${it.title}`,
    '',
    `- id: ${it.id}`,
    `- project: ${projectName(it.projectId)} (${it.projectId})`,
    `- status: ${statusLabel(it.status)}`,
    ...(it.assigneeSessionId ? [`- assignee: ${it.assigneeSessionId}`] : []),
    `- updated: ${it.updatedAt}`,
  ]
  if (it.desc?.trim()) lines.push('', it.desc.trim())
  const comments = (it.comments ?? []).filter((c) => c.text?.trim())
  if (comments.length) {
    lines.push('', '---', '', `### ${t('sessions.workspace.group.comments')}`)
    for (const c of comments) {
      lines.push('', `**${c.fromTitle}** · ${c.at}`, '', c.text.trim())
    }
  }
  try {
    const name = await saveTextFile(
      `awog-issue-${exportSlug(it.title, it.id)}.md`,
      lines.join('\n'),
      [{ name: 'Markdown', extensions: ['md'] }],
    )
    if (name) toast.add({ title: t('board.exportDone', { name }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('board.exportFailed'), description: String(err), color: 'error' })
  }
}

onMounted(async () => {
  // Manual mode focus ô title; agent mode composer tự focus textarea của nó.
  titleEl.value?.focus?.()
  if (!projectsStore.loaded) await projectsStore.hydrate()
  const ids = projectsStore.projects.map((p) => p.id)
  // Team specs: list nhỏ — nạp hết một lần. Agent roster: chỉ global + project
  // đích của item (picker đã filter theo projectSel); đổi project nạp lại.
  if (!teamsStore.loaded) void teamsStore.load(ids)
  void agentsStore.loadAgents(projectSel.value ? [projectSel.value] : [])
})
</script>

<style scoped>
/* Overlay .ovl.on của prototype.css đã flex + dim; căn GIỮA thay vì 13vh. */
.wsed-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 160;
}
/* Elevation — layout-only scoped rules; every color/edge lives in the
   template's token utilities. */
.wsed {
  box-shadow: var(--shadow-lg);
}
/* Chế độ toàn màn — nút ⤢ trên header: bung gần hết viewport (giữ lề 12px +
   overlay mờ bên dưới). max-h/max-w của class utility bị đè tại đây. */
.wsed.full {
  width: calc(100vw - 24px);
  max-width: none;
  max-height: none;
  height: calc(100vh - 24px);
  border-radius: var(--r-lg, 12px);
}
.wsed-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Edit mode: drawer WorkspaceAgentPeek neo absolute vào cạnh phải của vùng
   body (dưới tab bar), không phải cả modal. */
.wsed-main-rel {
  position: relative;
  overflow: hidden;
}

/* Icon trạng thái trong member dropdown — màu theo token status; streaming
   xoay chậm, awaiting pulse nhẹ (kiểu "đang làm việc" thay vì chữ). */
.mstat {
  color: var(--textFaint);
}
.mstat[data-st='streaming'] {
  color: var(--accent);
  animation: mstat-spin 1.6s linear infinite;
}
.mstat[data-st='awaiting'] {
  color: var(--amber);
  animation: mstat-pulse 1.6s ease-in-out infinite;
}
.mstat[data-st='error'] {
  color: var(--danger);
}
@keyframes mstat-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes mstat-pulse {
  50% {
    opacity: 0.35;
  }
}

/* AI draft strip — viền dashed như hint agent-mode, toggle là ghost link. */
.wsed-ai {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wsed-aitoggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  font-size: 11.5px;
  color: var(--textMuted);
  cursor: pointer;
  transition:
    color var(--fast) ease,
    border-color var(--fast) ease;
}
.wsed-aitoggle:hover,
.wsed-aitoggle.on {
  color: var(--text);
  border-color: var(--accent);
}
.wsed-aiicn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.wsed-aibody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--r-btn);
}
.wsed-airow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* Màu icon loại item (breadcrumb cha + list việc con) — cùng palette
   .wsb-ticon của card ngoài board. */
.wsed [data-type='epic'] {
  color: var(--violet);
}
.wsed [data-type='story'] {
  color: var(--success);
}
.wsed [data-type='task'] {
  color: var(--info);
}
.wsed [data-type='subtask'] {
  color: var(--muted-foreground);
}
.wsed [data-type='bug'] {
  color: var(--destructive);
}

/* Màn hẹp: lưới props 3 cột co về một cột; lưới khuôn Jira 4 cột co đôi. */
@media (max-width: 640px) {
  .wsed .grid-cols-3 {
    grid-template-columns: 1fr;
  }
  .wsed .grid-cols-4 {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Màn hẹp: layout General 9/3 xếp chồng — sidebar props xuống dưới nội dung. */
@media (max-width: 900px) {
  .wsed-gen {
    grid-template-columns: 1fr;
  }
  .wsed-gen > * {
    grid-column: 1 / -1;
  }
}
</style>
