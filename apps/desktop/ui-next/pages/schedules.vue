<template>
  <section class="flex min-w-0 flex-1 overflow-hidden" data-page="schedules">
    <LibraryView
      :items="schedules"
      :item-key="(s) => s.id"
      :search-text="searchTextOf"
      :placeholder="t('schedules.search')"
      show-new
      @new="openEditor(null)"
    >
      <template #row="{ item: s }">
        <!-- Dòng 1 chỉ chấm + tên: tên không bao giờ bị badge ép về 0 khi list hẹp
             (badge chung dòng từng làm tên biến mất). Badge + giờ chạy kế xuống dòng 2. -->
        <div class="flex items-center gap-2">
          <span
            class="size-2 flex-none rounded-full"
            :class="s.enabled ? 'bg-primary' : 'bg-faint'"
          />
          <span class="min-w-0 flex-1 truncate text-base font-medium">{{ s.name }}</span>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1.5 pl-4 text-sm text-muted-foreground">
          <Badge v-if="s.proposedBy" variant="outline" :class="['whitespace-nowrap', BADGE_ACC]">
            {{ t('schedules.state.proposed') }}
          </Badge>
          <Badge variant="outline" class="whitespace-nowrap text-muted-foreground">
            {{ describeTrigger(s.trigger, t) }}
          </Badge>
          <Badge
            v-if="s.lastStatus"
            variant="outline"
            class="whitespace-nowrap"
            :class="s.lastStatus === 'ok' ? BADGE_ACC : 'text-muted-foreground'"
          >
            {{ t('schedules.status.' + s.lastStatus) }}
          </Badge>
          <span class="min-w-0 truncate">{{ nextLine(s) }}</span>
        </div>
      </template>

      <template #detail="{ item: s }">
        <ScheduleDetail
          :schedule="s"
          @edit="openEditor(s)"
          @delete="pendingDelete = s"
          @toggle="s.proposedBy ? openEditor(s) : store.toggleSchedule(s.id)"
          @run="onRunNow(s)"
          @open-session="(sid) => store.openRunSession(sid, s.name)"
          @open-run="(runId) => (openRun = { scheduleId: s.id, runId })"
        />
      </template>
    </LibraryView>

    <ScheduleEditor
      :open="editorOpen"
      :schedule="editTarget"
      @save="onSave"
      @cancel="editorOpen = false"
    />

    <ScheduleRunModal
      v-if="openRunSchedule"
      :open="!!openRun"
      :schedule="openRunSchedule"
      :run-id="openRun?.runId ?? null"
      @close="openRun = null"
      @open-session="(sid) => store.openRunSession(sid, openRunSchedule!.name)"
    />

    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('schedules.delete')"
      :description="pendingDelete ? t('schedules.deleteBody', { name: pendingDelete.name }) : ''"
      @confirm="onDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>

<script setup lang="ts">
// Scheduled Runs (ADR 0082) — danh sách lịch + form + "Chạy ngay" + lịch sử.
//
// Bộ đếm giờ KHÔNG ở đây: nó nằm ở Electron main và bấm cò qua sidecar, nên
// trang này chạy hay không chạy cũng không ảnh hưởng tới lịch. Trang chỉ đọc
// store và làm CRUD.
import { computed, onMounted, ref } from 'vue'
import LibraryView from '~/components/library/LibraryView.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import ScheduleDetail from '~/components/schedule/ScheduleDetail.vue'
import ScheduleEditor from '~/components/schedule/ScheduleEditor.vue'
import ScheduleRunModal from '~/components/schedule/ScheduleRunModal.vue'
import { describeTrigger, formatWhen, searchTextOf } from '~/components/schedule/schedule-format'
import { useSchedulesStore, type Schedule, type ScheduleInput } from '~/stores/schedules'
import Badge from '~/components/ui/badge/Badge.vue'

const { t, locale } = useI18n()
const store = useSchedulesStore()
const { schedules } = storeToRefs(store)

const editorOpen = ref(false)
const editTarget = ref<Schedule | null>(null)
const pendingDelete = ref<Schedule | null>(null)

// Badge nhấn màu brand (đề xuất của agent, lượt chạy gần nhất OK) — cùng kiểu badge tier
// project ở trang Skills.
const BADGE_ACC = 'border-primary/40 bg-primary/10 text-primary'

// The page's own toast queue is gone — notifications go to the app-wide one.
const { add: toast } = useToast()
// Lượt chạy đang mở trong modal chi tiết. Lịch tra lại từ store theo id để modal thấy
// lượt đang chạy cập nhật (store nạp lại theo `schedules.changed`).
const openRun = ref<{ scheduleId: string; runId: string } | null>(null)
const openRunSchedule = computed(
  () => schedules.value.find((x) => x.id === openRun.value?.scheduleId) ?? null,
)

onMounted(() => void store.loadSchedules())

function openEditor(s: Schedule | null): void {
  editTarget.value = s
  editorOpen.value = true
}

// Dòng phụ của mỗi hàng: mốc kế tiếp (hoặc "chưa hẹn" khi lịch đang tắt).
function nextLine(s: Schedule): string {
  if (!s.enabled || !s.nextRunAt) return t('schedules.next.never')
  return `${t('schedules.next')}: ${formatWhen(s.nextRunAt, locale.value)}`
}

async function onSave(input: ScheduleInput): Promise<void> {
  try {
    await store.saveSchedule(input)
    editorOpen.value = false
    toast({ title: t('schedules.toast.saved'), color: 'success' })
  } catch (err) {
    toast({
      title: err instanceof Error ? err.message : t('schedules.toast.failed'),
      color: 'error',
    })
  }
}

async function onDelete(): Promise<void> {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  await store.removeSchedule(target.id)
  toast({ title: t('schedules.toast.deleted'), color: 'success' })
}

async function onRunNow(s: Schedule): Promise<void> {
  try {
    const run = await store.runNow(s.id)
    if (run?.status === 'skipped') toast({ title: t('schedules.toast.skipped'), color: 'warning' })
    else toast({ title: t('schedules.toast.started'), color: 'success' })
  } catch (err) {
    toast({
      title: err instanceof Error ? err.message : t('schedules.toast.failed'),
      color: 'error',
    })
  }
}
</script>
