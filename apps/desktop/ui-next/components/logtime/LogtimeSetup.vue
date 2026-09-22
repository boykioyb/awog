<template>
  <div class="ltset">
    <!-- 1 · Nguồn PMS: người dùng CHỌN nguồn nào Logtime được dùng, không dò hết
         mọi server MCP đang bật (ADR 0091 D-2). Năng lực dò bằng tools/list. -->
    <div class="ltsech">
      <span>{{ t('logtime.setup.sources') }}</span>
      <span class="ltmuted">{{ t('logtime.setup.sourcesHint') }}</span>
      <span class="ltsp" />
      <button class="btn" type="button" :disabled="store.busy" @click="store.loadCapabilities()">
        <Icon name="refresh" />
        {{ t('logtime.setup.rescan') }}
      </button>
    </div>

    <div v-if="store.capabilities.length === 0" class="ltnote">
      {{ t('logtime.setup.noSourcePicked') }}
    </div>

    <div v-for="cap in store.capabilities" :key="cap.sourceId" class="tile ltcard">
      <div class="ltcardh">
        <i class="ltdot" :style="{ background: cap.canPush ? 'var(--accent)' : 'var(--amber)' }" />
        <div class="ltcardhm">
          <div class="ltcardt">{{ cap.name }}</div>
          <div v-if="cap.url" class="ltcardu">{{ cap.url }}</div>
        </div>
        <span class="ltsp" />
        <span class="chip" :class="cap.canPush ? 'acc' : 'warn'">
          {{ cap.canPush ? t('logtime.setup.canPush') : t('logtime.setup.readOnly') }}
        </span>
        <button
          class="ltico"
          type="button"
          :title="t('logtime.setup.removeSource')"
          @click="removeSource(cap.sourceId)"
        >
          <Icon name="x" class="lticon" />
        </button>
      </div>
      <div class="ltcaps">
        <div
          v-for="c in CAPS"
          :key="c.tool"
          class="ltcap"
          :class="{ no: !cap.tools.includes(c.tool) }"
        >
          <Icon :name="cap.tools.includes(c.tool) ? 'check' : 'x'" class="ltcapic" />
          <span class="ltcapl">{{ t(c.label) }}</span>
          <span class="ltcapv">{{ c.tool }}</span>
        </div>
      </div>
      <div v-if="cap.error" class="ltwarn">{{ errorText(cap) }}</div>
      <div v-else-if="!cap.canPush" class="ltwarn">
        {{ t('logtime.setup.missingTools', { tools: cap.missing.join(', ') }) }}
      </div>
    </div>

    <div class="tile ltcard">
      <div class="ltmrow ltaddrow">
        <Icon name="plus" class="ltaddi" />
        <AppSelect
          v-if="addableSources.length > 0"
          :model-value="sourceDraft"
          :options="addableSources"
          :placeholder="t('logtime.setup.pickSourceToAdd')"
          :disabled="store.busy"
          width="260px"
          @update:model-value="onPickSource"
        />
        <span v-else-if="store.availableSources.length === 0" class="ltnote">
          {{ t('logtime.setup.noSources') }}
        </span>
        <span v-else class="ltnote">{{ t('logtime.setup.noMoreSources') }}</span>
      </div>
    </div>

    <!-- 2 · Dự án đang theo dõi: chỉ những dòng người dùng đã nối, KHÔNG đổ hết
         dự án của workspace ra. -->
    <div class="ltsech ltsech2">
      <span>{{ t('logtime.setup.links') }}</span>
      <span class="ltsp" />
      <span class="ltmuted">{{ t('logtime.setup.linksHint') }}</span>
    </div>

    <div class="tile ltcard">
      <div v-if="settings.links.length === 0" class="ltnote ltempty">
        {{ t('logtime.setup.noLinks') }}
      </div>
      <div v-for="link in settings.links" :key="link.projectKey" class="ltmrow">
        <span class="ltml">
          <i class="ltdot" :style="{ background: link.color || 'var(--textFaint)' }" />
          <span class="ltmname">{{ link.label || link.projectKey }}</span>
        </span>
        <Icon name="chev-right" class="ltarrow" />
        <span class="ltmsrc">{{ sourceName(link.sourceId) }}</span>
        <Icon name="chev-right" class="ltarrow" />
        <AppSelect
          :model-value="link.pmsProjectId"
          :options="pmsOptionsForSource(link.sourceId)"
          :placeholder="t('logtime.setup.pickProject')"
          width="180px"
          @update:model-value="(v: string) => setPmsProject(link, v)"
        />
        <span v-if="link.pmsProjectId" class="chip acc">
          <Icon name="check" />
          {{ t('logtime.setup.linked') }}
        </span>
        <span v-else class="chip warn">
          <Icon name="alert" />
          {{ t('logtime.setup.unlinked') }}
        </span>
        <span class="ltsp" />
        <button
          class="ltico"
          type="button"
          :title="t('logtime.setup.removeLink')"
          @click="removeLink(link.projectKey)"
        >
          <Icon name="trash" class="lticon" />
        </button>
        <!-- Nguồn hỏng ⇒ dropdown ở trên rỗng. Không nói gì thì người dùng tưởng
             PMS thật sự không có dự án nào. -->
        <div v-if="pmsError[link.sourceId]" class="ltwarn ltpmserr">
          {{ pmsError[link.sourceId] }}
        </div>
      </div>

      <!-- Thêm dự án: dự án AWOG → nguồn → dự án PMS. Chọn dự án PMS là bước cuối
           nên chốt luôn, không có nút Lưu riêng. -->
      <div class="ltmrow ltaddrow">
        <Icon name="plus" class="ltaddi" />
        <template v-if="projectOptions.length > 0">
          <AppSelect
            :model-value="newProjectKey"
            :options="projectOptions"
            :placeholder="t('logtime.setup.pickAwogProject')"
            width="200px"
            @update:model-value="(v: string) => (newProjectKey = v)"
          />
          <Icon name="chev-right" class="ltarrow" />
          <AppSelect
            :model-value="newSourceId"
            :options="sourceOptions"
            :placeholder="t('logtime.setup.pickSource')"
            width="170px"
            :disabled="!newProjectKey || sourceOptions.length === 0"
            @update:model-value="(v: string) => (newSourceId = v)"
          />
          <Icon name="chev-right" class="ltarrow" />
          <AppSelect
            :model-value="newPmsId"
            :options="newPmsOptions"
            :placeholder="t('logtime.setup.pickProject')"
            width="180px"
            :disabled="!newSourceId"
            @update:model-value="(v: string) => (newPmsId = v)"
          />
          <button
            v-if="newProjectKey"
            class="ltico"
            type="button"
            :title="t('logtime.setup.cancel')"
            @click="resetNew"
          >
            <Icon name="x" class="lticon" />
          </button>
          <div v-if="newSourceId && pmsError[newSourceId]" class="ltwarn ltpmserr">
            {{ pmsError[newSourceId] }}
          </div>
        </template>
        <span v-else class="ltnote">{{ addNote }}</span>
      </div>
    </div>

    <!-- 3 · Quy tắc ngày công — số ở đây là CẤU HÌNH, không phải chữ trong câu -->
    <div class="ltsech ltsech2">
      <span>{{ t('logtime.setup.rules') }}</span>
    </div>

    <div class="tile ltcard">
      <div class="ltopt">
        <div class="ltoptb">
          <div class="ltopt1">{{ t('logtime.setup.daily') }}</div>
          <div class="ltopt2">{{ t('logtime.setup.dailyHint') }}</div>
        </div>
        <div class="ltoptc">
          <div class="lthours">
            <button type="button" class="ltstep" aria-label="-" @click="bumpDaily(-0.5)">−</button>
            <span class="tnum">{{ fmt(dDaily) }}h</span>
            <button type="button" class="ltstep" aria-label="+" @click="bumpDaily(0.5)">+</button>
          </div>
        </div>
      </div>

      <div class="ltopt">
        <div class="ltoptb">
          <div class="ltopt1">{{ t('logtime.setup.round') }}</div>
          <div class="ltopt2">{{ t('logtime.setup.roundHint') }}</div>
        </div>
        <div class="ltoptc">
          <AppSelect
            :model-value="String(dRound)"
            :options="ROUND_OPTIONS"
            width="150px"
            @update:model-value="(v: string) => (dRound = Number(v))"
          />
        </div>
      </div>

      <div class="ltopt">
        <div class="ltoptb">
          <div class="ltopt1">{{ t('logtime.setup.remind') }}</div>
          <div class="ltopt2">{{ t('logtime.setup.remindHint') }}</div>
        </div>
        <div class="ltoptc">
          <input v-model="dRemindAt" class="lttime" type="time" />
          <button
            type="button"
            class="ltsw"
            :class="{ on: dRemindOn }"
            role="switch"
            :aria-checked="dRemindOn"
            @click="dRemindOn = !dRemindOn"
          />
        </div>
      </div>

      <!-- Nút lưu cho cả mục: các ô trên chỉ đổi NHÁP, chưa ghi tới khi bấm Lưu — để
           người dùng thấy rõ đã lưu (toast) chứ không đoán. -->
      <div class="ltsave">
        <span v-if="rulesDirty" class="ltsavehint">{{ t('logtime.setup.unsaved') }}</span>
        <span v-else class="ltsavehint ok">{{ t('logtime.setup.savedState') }}</span>
        <span class="ltsp" />
        <button
          type="button"
          class="btn pri"
          :disabled="!rulesDirty || store.busy"
          @click="saveRules"
        >
          {{ t('logtime.setup.save') }}
        </button>
      </div>
    </div>
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

<style scoped>
.ltset {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  /* Lề ngang của riêng vùng này: `.ltpage` không còn đệm (hai dải full-bleed của tab
     Ngày cần chạy hết bề ngang), nên mỗi vùng con tự lấy `--padX`. */
  padding: 0 var(--padX) 18px;
}
.ltsech {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.ltsech2 {
  margin-top: 8px;
}
.ltsp {
  flex: 1;
}
.ltmuted {
  font-weight: 400;
}
.ltcard {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ltcardh {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.ltcardhm {
  min-width: 0;
}
.ltcardt {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.ltcardu {
  font-family: var(--code); /* mono-ok: URL endpoint, người dùng copy được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  word-break: break-all;
}
.ltdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ltcaps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
}
.ltcap {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0 8px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
  padding: 7px 9px;
  min-width: 0;
}
.ltcap.no {
  opacity: 0.6;
}
.ltcapic {
  grid-row: span 2;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}
.ltcap.no .ltcapic {
  color: var(--danger);
}
.ltcapl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltcapv {
  font-family: var(--code); /* mono-ok: tên tool MCP là hợp đồng, copy được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltwarn {
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  border-radius: var(--r-btn);
  padding: 9px 11px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.ltnote {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
/* Khối lỗi nằm trong hàng flex-wrap của `.ltmrow`; ép nó xuống dòng riêng thay vì
   chen vào giữa các ô chọn. */
.ltpmserr {
  flex: 1 0 100%;
}
.ltempty {
  padding: 9px 0;
}
.ltmrow {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 9px 0;
  border-top: 1px solid var(--border);
}
.ltmrow:first-child {
  border-top: 0;
}
.ltml {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 168px;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
}
.ltmname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltmsrc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltarrow {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}
.ltaddrow {
  gap: 7px;
}
.ltaddi {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
  flex: 0 0 auto;
}
.ltico {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ltico:hover {
  background: var(--bgHover);
  color: var(--danger);
}
.lticon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.ltopt {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 0;
  border-top: 1px solid var(--border);
}
.ltopt:first-child {
  border-top: 0;
}
/* Hàng lưu của mục quy tắc: nhắc trạng thái + nút Lưu. */
.ltsave {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px solid var(--border);
}
.ltsavehint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}
.ltsavehint.ok {
  color: var(--textFaint);
}
.ltoptb {
  flex: 1;
  min-width: 0;
}
.ltopt1 {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
}
.ltopt2 {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  margin-top: 3px;
}
.ltoptc {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.lthours {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 4px 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltstep {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textMuted);
  cursor: pointer;
  font-family: inherit;
}
.ltstep:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.lttime {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 5px 8px;
  font-variant-numeric: tabular-nums;
}
.ltsw {
  width: 38px;
  height: 22px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--bgActive);
  position: relative;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
  flex: 0 0 auto;
}
.ltsw::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bgPanel);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur) var(--ease);
}
.ltsw.on {
  background: var(--accent);
  border-color: transparent;
}
.ltsw.on::after {
  transform: translateX(16px);
}
</style>
