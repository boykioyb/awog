<template>
  <!-- Lề ngang của riêng vùng này: trang không đệm (hai dải full-bleed của tab Ngày cần
       chạy hết bề ngang), nên mỗi vùng con tự lấy lề. -->
  <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 pb-4.5">
    <!-- 1 · Nguồn PMS: người dùng CHỌN nguồn nào Logtime được dùng, không dò hết
         mọi server MCP đang bật (ADR 0091 D-2). Năng lực dò bằng tools/list. -->
    <div class="flex items-center gap-2 text-xs font-semibold text-dim">
      <span>{{ t('logtime.setup.sources') }}</span>
      <span class="font-normal">{{ t('logtime.setup.sourcesHint') }}</span>
      <span class="flex-1" />
      <Button
        type="button"
        :disabled="store.busy"
        variant="outline"
        @click="store.loadCapabilities()"
      >
        <Icon name="refresh" />
        {{ t('logtime.setup.rescan') }}
      </Button>
    </div>

    <div v-if="store.capabilities.length === 0" class="text-sm text-dim">
      {{ t('logtime.setup.noSourcePicked') }}
    </div>

    <Card v-for="cap in store.capabilities" :key="cap.sourceId" class="gap-2 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <i
          class="size-2 shrink-0 rounded-full"
          :class="cap.canPush ? 'bg-primary' : 'bg-warning'"
        />
        <div class="min-w-0">
          <div class="text-base font-semibold">{{ cap.name }}</div>
          <!-- URL endpoint, người dùng copy được ⇒ mono hợp lệ. -->
          <div v-if="cap.url" class="font-mono text-xs break-all text-dim">{{ cap.url }}</div>
        </div>
        <span class="flex-1" />
        <Badge
          variant="outline"
          :class="
            cap.canPush
              ? 'rounded-sm border-primary/40 bg-primary/10 text-primary'
              : 'rounded-sm border-warning/40 text-warning'
          "
        >
          {{ cap.canPush ? t('logtime.setup.canPush') : t('logtime.setup.readOnly') }}
        </Badge>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 shrink-0 text-dim hover:text-destructive"
          type="button"
          :title="t('logtime.setup.removeSource')"
          @click="removeSource(cap.sourceId)"
        >
          <Icon name="x" />
        </Button>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5">
        <div
          v-for="c in CAPS"
          :key="c.tool"
          class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md border bg-muted px-2 py-1.5"
          :class="{ 'opacity-60': !cap.tools.includes(c.tool) }"
        >
          <Icon
            :name="cap.tools.includes(c.tool) ? 'check' : 'x'"
            class="row-span-2 size-3.5"
            :class="cap.tools.includes(c.tool) ? 'text-primary' : 'text-destructive'"
          />
          <span class="truncate text-sm">{{ t(c.label) }}</span>
          <!-- Tên tool MCP là hợp đồng, copy được ⇒ mono hợp lệ. -->
          <span class="truncate font-mono text-xs text-faint">{{ c.tool }}</span>
        </div>
      </div>
      <div
        v-if="cap.error"
        class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground"
      >
        {{ errorText(cap) }}
      </div>
      <div
        v-else-if="!cap.canPush"
        class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground"
      >
        {{ t('logtime.setup.missingTools', { tools: cap.missing.join(', ') }) }}
      </div>
    </Card>

    <Card class="gap-2 p-4">
      <div class="flex flex-wrap items-center gap-2 border-t py-2 first:border-t-0">
        <Icon name="plus" class="size-3.5 shrink-0 text-dim" />
        <AppSelect
          v-if="addableSources.length > 0"
          :model-value="sourceDraft"
          :options="addableSources"
          :placeholder="t('logtime.setup.pickSourceToAdd')"
          :disabled="store.busy"
          width="260px"
          @update:model-value="onPickSource"
        />
        <span v-else-if="store.availableSources.length === 0" class="text-sm text-dim">
          {{ t('logtime.setup.noSources') }}
        </span>
        <span v-else class="text-sm text-dim">{{ t('logtime.setup.noMoreSources') }}</span>
      </div>
    </Card>

    <!-- 2 · Dự án đang theo dõi: chỉ những dòng người dùng đã nối, KHÔNG đổ hết
         dự án của workspace ra. -->
    <div class="flex items-center gap-2 text-xs font-semibold text-dim mt-2">
      <span>{{ t('logtime.setup.links') }}</span>
      <span class="flex-1" />
      <span class="font-normal">{{ t('logtime.setup.linksHint') }}</span>
    </div>

    <Card class="gap-2 p-4">
      <div v-if="settings.links.length === 0" class="py-2 text-sm text-dim">
        {{ t('logtime.setup.noLinks') }}
      </div>
      <div
        v-for="link in settings.links"
        :key="link.projectKey"
        class="flex flex-wrap items-center gap-2 border-t py-2 first:border-t-0"
      >
        <span class="flex min-w-0 shrink-0 grow-0 basis-42 items-center gap-2 text-sm font-medium">
          <!-- Màu chấm là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style;
               chưa đặt màu thì chấm mờ. -->
          <i
            class="size-2 shrink-0 rounded-full"
            :class="{ 'bg-faint': !link.color }"
            :style="link.color ? { background: link.color } : undefined"
          />
          <span class="truncate">{{ link.label || link.projectKey }}</span>
        </span>
        <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
        <span class="max-w-42.5 truncate text-sm text-muted-foreground">
          {{ sourceName(link.sourceId) }}
        </span>
        <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
        <AppSelect
          :model-value="link.pmsProjectId"
          :options="pmsOptionsForSource(link.sourceId)"
          :placeholder="t('logtime.setup.pickProject')"
          width="180px"
          @update:model-value="(v: string) => setPmsProject(link, v)"
        />
        <Badge
          v-if="link.pmsProjectId"
          variant="outline"
          class="rounded-sm border-primary/40 bg-primary/10 text-primary"
        >
          <Icon name="check" />
          {{ t('logtime.setup.linked') }}
        </Badge>
        <Badge v-else variant="outline" class="rounded-sm border-warning/40 text-warning">
          <Icon name="alert" />
          {{ t('logtime.setup.unlinked') }}
        </Badge>
        <span class="flex-1" />
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 shrink-0 text-dim hover:text-destructive"
          type="button"
          :title="t('logtime.setup.removeLink')"
          @click="removeLink(link.projectKey)"
        >
          <Icon name="trash" />
        </Button>
        <!-- Nguồn hỏng ⇒ dropdown ở trên rỗng. Không nói gì thì người dùng tưởng
             PMS thật sự không có dự án nào. Khối lỗi nằm trong hàng flex-wrap; ép nó
             xuống dòng riêng (basis-full) thay vì chen vào giữa các ô chọn. -->
        <div
          v-if="pmsError[link.sourceId]"
          class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground shrink-0 grow basis-full"
        >
          {{ pmsError[link.sourceId] }}
        </div>
      </div>

      <!-- Thêm dự án: dự án AWOG → nguồn → dự án PMS. Chọn dự án PMS là bước cuối
           nên chốt luôn, không có nút Lưu riêng. -->
      <div class="flex flex-wrap items-center gap-2 border-t py-2 first:border-t-0">
        <Icon name="plus" class="size-3.5 shrink-0 text-dim" />
        <template v-if="projectOptions.length > 0">
          <AppSelect
            :model-value="newProjectKey"
            :options="projectOptions"
            :placeholder="t('logtime.setup.pickAwogProject')"
            width="200px"
            @update:model-value="(v: string) => (newProjectKey = v)"
          />
          <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
          <AppSelect
            :model-value="newSourceId"
            :options="sourceOptions"
            :placeholder="t('logtime.setup.pickSource')"
            width="170px"
            :disabled="!newProjectKey || sourceOptions.length === 0"
            @update:model-value="(v: string) => (newSourceId = v)"
          />
          <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
          <AppSelect
            :model-value="newPmsId"
            :options="newPmsOptions"
            :placeholder="t('logtime.setup.pickProject')"
            width="180px"
            :disabled="!newSourceId"
            @update:model-value="(v: string) => (newPmsId = v)"
          />
          <Button
            v-if="newProjectKey"
            variant="ghost"
            size="iconSm"
            class="size-6 shrink-0 text-dim hover:text-destructive"
            type="button"
            :title="t('logtime.setup.cancel')"
            @click="resetNew"
          >
            <Icon name="x" />
          </Button>
          <div
            v-if="newSourceId && pmsError[newSourceId]"
            class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground shrink-0 grow basis-full"
          >
            {{ pmsError[newSourceId] }}
          </div>
        </template>
        <span v-else class="text-sm text-dim">{{ addNote }}</span>
      </div>
    </Card>

    <!-- 3 · Quy tắc ngày công — số ở đây là CẤU HÌNH, không phải chữ trong câu -->
    <div class="flex items-center gap-2 text-xs font-semibold text-dim mt-2">
      <span>{{ t('logtime.setup.rules') }}</span>
    </div>

    <Card class="gap-2 p-4">
      <div class="flex items-start gap-3 border-t py-3 first:border-t-0">
        <div class="min-w-0 flex-1">
          <div class="text-base font-medium">{{ t('logtime.setup.daily') }}</div>
          <div class="mt-0.5 text-xs text-dim">{{ t('logtime.setup.dailyHint') }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <div class="flex items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-sm">
            <Button
              type="button"
              variant="outline"
              class="size-5.5 p-0 font-normal text-muted-foreground hover:border-input hover:text-foreground"
              aria-label="-"
              @click="bumpDaily(-0.5)"
            >
              −
            </Button>
            <span class="tabular-nums">{{ fmt(dDaily) }}h</span>
            <Button
              type="button"
              variant="outline"
              class="size-5.5 p-0 font-normal text-muted-foreground hover:border-input hover:text-foreground"
              aria-label="+"
              @click="bumpDaily(0.5)"
            >
              +
            </Button>
          </div>
        </div>
      </div>

      <div class="flex items-start gap-3 border-t py-3 first:border-t-0">
        <div class="min-w-0 flex-1">
          <div class="text-base font-medium">{{ t('logtime.setup.round') }}</div>
          <div class="mt-0.5 text-xs text-dim">{{ t('logtime.setup.roundHint') }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <AppSelect
            :model-value="String(dRound)"
            :options="ROUND_OPTIONS"
            width="150px"
            @update:model-value="(v: string) => (dRound = Number(v))"
          />
        </div>
      </div>

      <div class="flex items-start gap-3 border-t py-3 first:border-t-0">
        <div class="min-w-0 flex-1">
          <div class="text-base font-medium">{{ t('logtime.setup.remind') }}</div>
          <div class="mt-0.5 text-xs text-dim">{{ t('logtime.setup.remindHint') }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Input v-model="dRemindAt" type="time" class="w-auto bg-muted tabular-nums" />
          <Switch v-model:checked="dRemindOn" />
        </div>
      </div>

      <!-- Nút lưu cho cả mục: các ô trên chỉ đổi NHÁP, chưa ghi tới khi bấm Lưu — để
           người dùng thấy rõ đã lưu (toast) chứ không đoán. -->
      <div class="mt-1 flex items-center gap-2.5 border-t pt-3">
        <span v-if="rulesDirty" class="text-xs text-warning">
          {{ t('logtime.setup.unsaved') }}
        </span>
        <span v-else class="text-xs text-faint">{{ t('logtime.setup.savedState') }}</span>
        <span class="flex-1" />
        <Button
          type="button"
          :disabled="!rulesDirty || store.busy"
          variant="default"
          @click="saveRules"
        >
          {{ t('logtime.setup.save') }}
        </Button>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
// Thiết lập Logtime (ADR 0091): nguồn PMS ĐƯỢC CHỌN + dự án ĐANG THEO DÕI + quy
// tắc ngày công. Mọi danh sách ở đây là thứ người dùng tự thêm, không phải bản
// kê toàn bộ nguồn MCP / dự án của workspace.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import { useProjectsStore } from '~/stores/projects'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { LogtimeLink, LogtimeSourceCapability, PmsOption } from '~/stores/logtime'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const { add: toast } = useToast()
const { store, settings, fmt } = useLogtimeManager()
const projects = useProjectsStore()

// Toast kết quả một lần ghi. Thành công/thất bại đều nói ra — trước đây đổi thiết lập
// mà không có phản hồi nên không biết đã lưu chưa.
function notify(ok: boolean, okKey: string): void {
  toast({
    color: ok ? 'success' : 'error',
    title: ok ? t(okKey) : t('logtime.setup.saveFailed'),
  })
}

// Bảng năng lực — nhãn ở i18n, tên tool là hợp đồng nên để nguyên văn.
const CAPS = [
  { label: 'logtime.cap.listProjects', tool: 'worklog_list_projects' },
  { label: 'logtime.cap.listTasks', tool: 'worklog_list_tasks' },
  { label: 'logtime.cap.create', tool: 'worklog_create' },
  { label: 'logtime.cap.update', tool: 'worklog_update' },
  { label: 'logtime.cap.remove', tool: 'worklog_delete' },
  { label: 'logtime.cap.list', tool: 'worklog_list' },
  { label: 'logtime.cap.get', tool: 'worklog_get' },
] as const

const ROUND_OPTIONS: AppSelectOption[] = [
  { label: '0.25h', value: '0.25' },
  { label: '0.5h', value: '0.5' },
  { label: '1h', value: '1' },
]

// Danh sách dự án PMS theo từng nguồn, nạp lười khi nguồn được dùng tới.
//
// CHỈ ghi vào đây khi nạp THÀNH CÔNG. Trước đây hàm nạp kiểm `if (cache[sourceId])`,
// mà `[]` là truthy — nên một lần PMS lỗi là entry rỗng đó khoá luôn nguồn cho tới
// khi reload trang, và người dùng chỉ thấy một dropdown trống không lời giải thích.
const pmsProjects = ref<Record<string, PmsOption[]>>({})

// Lý do nạp hỏng, theo từng nguồn — đã dịch sẵn để template không phải gọi t() với
// giá trị có thể undefined.
const pmsError = ref<Record<string, string>>({})

// Chặn hai lời gọi trùng cho cùng một nguồn (onMounted và watcher có thể cùng bắn).
// Chỉ sống trong RAM nên không cần reactive.
const pmsLoading = new Set<string>()

const newProjectKey = ref('')
const newSourceId = ref('')
const newPmsId = ref('')
const sourceDraft = ref('')

// Nguồn MCP đang bật mà CHƯA thuộc phạm vi Logtime — nguồn đã chọn đã có thẻ ở
// trên rồi, hiện lại trong ô chọn chỉ tổ rối.
const addableSources = computed<AppSelectOption[]>(() => {
  const chosen = new Set(settings.value.sourceIds)
  return store.availableSources
    .filter((s) => !chosen.has(s.id))
    .map((s) => ({ label: s.name, value: s.id }))
})

const sourceOptions = computed<AppSelectOption[]>(() =>
  store.capabilities.map((c) => ({
    label: c.name,
    value: c.sourceId,
    disabled: !c.canPush,
  })),
)

// Dự án AWOG chưa theo dõi — dự án đã có dòng ở trên không cần xuất hiện lại.
const projectOptions = computed<AppSelectOption[]>(() => {
  const linked = new Set(settings.value.links.map((l) => l.projectKey))
  return projects.projects
    .filter((p) => !linked.has(p.id))
    .map((p) => ({ label: p.name, value: p.id }))
})

const newPmsOptions = computed<AppSelectOption[]>(() => pmsOptionsForSource(newSourceId.value))

// Hết dòng để thêm thì phải nói ĐÚNG lý do: workspace rỗng khác với đã theo dõi hết.
// "Mọi dự án AWOG đều đã được theo dõi" trên một workspace trống là câu sai.
const addNote = computed<string>(() =>
  projects.projects.length === 0 ? t('logtime.setup.noProjects') : t('logtime.setup.allLinked'),
)

const sourceName = (sourceId: string): string =>
  store.capabilities.find((c) => c.sourceId === sourceId)?.name ?? sourceId

function pmsOptionsForSource(sourceId: string): AppSelectOption[] {
  if (!sourceId) return []
  return (pmsProjects.value[sourceId] ?? []).map((p) => ({ label: p.label, value: p.value }))
}

// Sidecar trả mã lý do bằng tiếng Anh cố định; dịch ở đây để người dùng đọc được.
// Mã lạ thì hiện nguyên văn thay vì nuốt — một nguồn chết mà không nói vì sao thì
// người dùng chỉ còn cách đoán.
function errorText(cap: LogtimeSourceCapability): string {
  if (cap.error === 'source not found') return t('logtime.setup.errSourceGone')
  if (cap.error === 'not an MCP source') return t('logtime.setup.errNotMcp')
  if (cap.error === 'source is disabled') return t('logtime.setup.errDisabled')
  return cap.error ?? ''
}

// Nạp danh sách dự án PMS của một nguồn, cache lại CHỈ khi thành công. Hỏng thì ghi
// lý do vào `pmsError` và KHÔNG cache, để lần sau (mở lại tab, dò lại tool, đổi
// nguồn) còn thử lại được.
async function ensureProjects(sourceId: string): Promise<void> {
  if (!sourceId) return
  // Ngoài vỏ Electron (`sc.available` false) thì store trả `null` mà KHÔNG đặt
  // `lastError` — đi tiếp sẽ dựng một hộp lỗi với lý do rỗng. Không có gì để báo
  // thì đừng báo.
  if (!store.available) return
  if (pmsProjects.value[sourceId] !== undefined) return
  if (pmsLoading.has(sourceId)) return
  pmsLoading.add(sourceId)
  try {
    const list = await store.listProjects(sourceId)
    if (list === null) {
      pmsError.value[sourceId] = t('logtime.setup.pmsLoadFailed', { error: store.lastError })
      return
    }
    pmsProjects.value[sourceId] = list
    delete pmsError.value[sourceId]
  } finally {
    pmsLoading.delete(sourceId)
  }
}

// Chọn một nguồn trong ô "Thêm nguồn" là thêm luôn — đây là hành động một bước chứ
// không phải form, nên chọn xong trả ô về placeholder để thêm được nguồn kế tiếp.
async function onPickSource(id: string): Promise<void> {
  if (!id) return
  sourceDraft.value = id
  notify(await store.addSource(id), 'logtime.setup.sourceAdded')
  sourceDraft.value = ''
}

function resetNew(): void {
  newProjectKey.value = ''
  newSourceId.value = ''
  newPmsId.value = ''
}

// owner/repo lấy từ git remote — chỉ dùng để dựng link issue, không tham gia lời
// gọi PMS. Hỗ trợ cả dạng ssh và https.
function repoOf(remote: string): string | undefined {
  const m = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote ?? '')
  return m?.[1]
}

// Chọn dự án PMS là bước CUỐI của form thêm nên chốt luôn, không cần nút Lưu.
async function commitNew(): Promise<void> {
  const project = projects.projects.find((p) => p.id === newProjectKey.value)
  const sourceId = newSourceId.value
  const pmsProjectId = newPmsId.value
  if (!project || !sourceId || !pmsProjectId) return
  const name = (pmsProjects.value[sourceId] ?? []).find((p) => p.value === pmsProjectId)
  const repo = repoOf(project.gitRemote)
  const ok = await store.saveLink({
    projectKey: project.id,
    label: project.name,
    sourceId,
    pmsProjectId,
    ...(name ? { pmsProjectName: name.label } : {}),
    ...(repo ? { githubRepo: repo } : {}),
    ...(project.color ? { color: project.color } : {}),
  })
  notify(ok, 'logtime.setup.linkSaved')
  if (ok) resetNew()
}

async function setPmsProject(link: LogtimeLink, pmsProjectId: string): Promise<void> {
  const found = (pmsProjects.value[link.sourceId] ?? []).find((p) => p.value === pmsProjectId)
  const ok = await store.saveLink(
    found ? { ...link, pmsProjectId, pmsProjectName: found.label } : { ...link, pmsProjectId },
  )
  notify(ok, 'logtime.setup.linkSaved')
}

// Gỡ dự án / nguồn — template gọi qua đây (thay vì store trực tiếp) để có toast.
async function removeLink(projectKey: string): Promise<void> {
  notify(await store.removeLink(projectKey), 'logtime.setup.linkRemoved')
}

async function removeSource(sourceId: string): Promise<void> {
  notify(await store.removeSource(sourceId), 'logtime.setup.sourceRemoved')
}

// Mục "Quy tắc ngày công" nay là NHÁP — đổi ở đây chỉ sửa các ref dưới, chưa ghi tới
// khi bấm Lưu. Đồng bộ lại nháp khi settings đổi từ NGOÀI (agent/đồng bộ) mà người dùng
// chưa sửa dở (rulesDirty=false) — sửa dở thì giữ nguyên để không nuốt mất thao tác.
const dDaily = ref(settings.value.dailyHours)
const dRound = ref(settings.value.roundStep)
const dRemindAt = ref(settings.value.remindAt)
const dRemindOn = ref(settings.value.remindEnabled)

const rulesDirty = computed(
  () =>
    dDaily.value !== settings.value.dailyHours ||
    dRound.value !== settings.value.roundStep ||
    dRemindAt.value !== settings.value.remindAt ||
    dRemindOn.value !== settings.value.remindEnabled,
)

watch(settings, (s) => {
  if (rulesDirty.value) return
  dDaily.value = s.dailyHours
  dRound.value = s.roundStep
  dRemindAt.value = s.remindAt
  dRemindOn.value = s.remindEnabled
})

function bumpDaily(delta: number): void {
  dDaily.value = Math.min(24, Math.max(0, Math.round((dDaily.value + delta) * 4) / 4))
}

async function saveRules(): Promise<void> {
  const ok = await store.saveSettings({
    dailyHours: dDaily.value,
    roundStep: dRound.value,
    remindAt: dRemindAt.value || '17:30',
    remindEnabled: dRemindOn.value,
  })
  notify(ok, 'logtime.setup.saved')
}

onMounted(() => {
  void projects.hydrate()
  for (const link of settings.value.links) void ensureProjects(link.sourceId)
})

// Nguồn mới dò xong → nạp danh sách dự án của những nguồn đã được nối.
watch(
  () => store.capabilities.length,
  () => {
    for (const link of settings.value.links) void ensureProjects(link.sourceId)
  },
)

watch(newSourceId, (id) => {
  newPmsId.value = ''
  void ensureProjects(id)
})

watch(newPmsId, (id) => {
  if (id) void commitNew()
})
</script>
