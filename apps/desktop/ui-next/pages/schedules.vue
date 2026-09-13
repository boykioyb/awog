<template>
  <section class="page on" data-page="schedules">
    <LibraryView
      :items="schedules"
      :item-key="(s) => s.id"
      :search-text="searchTextOf"
      :placeholder="t('schedules.search')"
      show-new
      @new="openEditor(null)"
    >
      <template #row="{ item: s }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{ background: s.enabled ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ s.name }}</span>
          <span class="tag">{{ describeTrigger(s.trigger, t) }}</span>
          <span v-if="s.lastStatus" class="tag" :class="{ acc: s.lastStatus === 'ok' }">
            {{ t('schedules.status.' + s.lastStatus) }}
          </span>
        </div>
        <div class="sub">{{ nextLine(s) }}</div>
      </template>

      <template #detail="{ item: s }">
        <ScheduleDetail
          :schedule="s"
          @edit="openEditor(s)"
          @delete="pendingDelete = s"
          @toggle="store.toggleSchedule(s.id)"
          @run="onRunNow(s)"
          @open-session="(sid) => store.openRunSession(sid, s.name)"
        />
      </template>
    </LibraryView>

    <ScheduleEditor
      :open="editorOpen"
      :schedule="editTarget"
      @save="onSave"
      @cancel="editorOpen = false"
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
import { onMounted, ref } from 'vue'
import LibraryView from '~/components/library/LibraryView.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import ScheduleDetail from '~/components/schedule/ScheduleDetail.vue'
import ScheduleEditor from '~/components/schedule/ScheduleEditor.vue'
import { describeTrigger, formatWhen, searchTextOf } from '~/components/schedule/schedule-format'
import { useSchedulesStore, type Schedule, type ScheduleInput } from '~/stores/schedules'

const { t, locale } = useI18n()
const store = useSchedulesStore()
const { schedules } = storeToRefs(store)

const editorOpen = ref(false)
const editTarget = ref<Schedule | null>(null)
const pendingDelete = ref<Schedule | null>(null)

// The page's own toast queue is gone — notifications go to the app-wide one.
const { add: toast } = useToast()

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
