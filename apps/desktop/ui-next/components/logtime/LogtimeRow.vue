<template>
  <!-- Grid có vùng đặt tên: giờ và ghi chú không bao giờ đè lên nhau dù panel hẹp
       cỡ nào (ở dưới 720px hàng tự xếp thành 3 tầng). Thẻ nền `bg-sidebar` (trắng ở
       theme sáng, màu card ở theme tối) — dòng đã đẩy PMS giữ cùng nền vì trạng thái
       đã có chip riêng; dòng đang sửa nhấc lên khỏi nền để mắt bám đúng dòng. -->
  <div
    class="grid grid-cols-[136px_minmax(0,1fr)_auto_auto_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border px-3 py-2.5 [grid-template-areas:'pj_nt_hr_st_ops'] max-[720px]:grid-cols-[minmax(0,1fr)_auto_auto] max-[720px]:gap-y-2 max-[720px]:[grid-template-areas:'pj_hr_ops'_'nt_nt_nt'_'st_st_st']"
    :class="[
      editing ? 'border-selected-border bg-muted' : 'bg-sidebar',
      { 'opacity-72': entry.status === 'locked' },
    ]"
  >
    <span class="flex min-w-0 items-center gap-2 [grid-area:pj]">
      <!-- Màu chấm là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style. -->
      <i class="size-2 shrink-0 rounded-full" :style="{ background: color }" />
      <b class="truncate text-sm font-semibold">{{ labelOf(entry.projectKey) }}</b>
    </span>

    <span ref="noteCellRef" class="min-w-0 [grid-area:nt]">
      <span v-if="editing" class="flex min-w-0 items-center gap-1">
        <Input
          ref="noteEl"
          v-model="draftNote"
          :placeholder="t('logtime.form.note')"
          class="h-auto bg-muted px-2 py-1 text-base focus-visible:border-selected-border"
          @keydown.enter.prevent="save"
          @keydown.esc.prevent="cancel"
        />
        <!-- Mở popover textarea + Sửa bằng AI (note dài không xem/sửa nổi trong ô một dòng). -->
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6.5 text-faint shrink-0"
          :title="t('logtime.form.expandNote')"
          @click="notePopOpen = true"
        >
          <Icon name="edit" />
        </Button>
      </span>
      <template v-else>
        <!-- `block` bắt buộc: span inline thì truncate (overflow/ellipsis) không áp
             dụng — thiếu là chữ tràn đè lên cột giờ. -->
        <span class="block truncate text-base">{{ entry.note }}</span>
        <span class="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-faint">
          <a
            v-if="issueUrl"
            class="inline-flex min-w-0 max-w-[60%] items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0 hover:text-foreground"
            :href="issueUrl"
            target="_blank"
            rel="noopener"
            :title="t('logtime.row.openIssue', { n: entry.task?.issue ?? 0 })"
          >
            <Icon name="link" />
            <span class="truncate">#{{ entry.task?.issue }} {{ entry.task?.title }}</span>
          </a>
          <span
            v-else-if="entry.task?.id"
            class="inline-flex min-w-0 max-w-[60%] items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0"
          >
            <Icon name="link" />
            <span class="truncate">{{ entry.task?.title }}</span>
          </span>
          <span class="shrink-0 whitespace-nowrap">{{ sourceNameOf(entry.projectKey) }}</span>
        </span>
      </template>
    </span>

    <span class="min-w-11.5 text-right text-base font-semibold [grid-area:hr] max-[720px]:min-w-0">
      <Input
        v-if="editing"
        v-model="draftHours"
        inputmode="decimal"
        class="h-auto bg-muted px-2 py-1 text-base focus-visible:border-selected-border w-18 text-right tabular-nums"
        @keydown.enter.prevent="save"
        @keydown.esc.prevent="cancel"
      />
      <template v-else>{{ fmt(entry.hours) }}h</template>
    </span>

    <span class="justify-self-start [grid-area:st]">
      <Badge
        v-if="entry.status === 'posted'"
        variant="outline"
        class="rounded-sm border-primary/40 bg-primary/10 text-primary"
      >
        <Icon name="check" />
        {{ t('logtime.status.posted') }}
      </Badge>
      <Badge
        v-else-if="entry.status === 'locked'"
        variant="outline"
        class="rounded-sm border-warning/40 text-warning"
      >
        <Icon name="shield" />
        {{ t('logtime.status.locked') }}
      </Badge>
      <Badge
        v-else-if="!canPush"
        variant="outline"
        class="rounded-sm border-destructive/40 text-destructive"
      >
        <Icon name="alert" />
        {{ t('logtime.status.unlinked') }}
      </Badge>
      <Badge v-else variant="outline" class="rounded-sm text-muted-foreground">
        {{ t('logtime.status.draft') }}
      </Badge>
    </span>

    <span class="flex gap-0.5 justify-self-end [grid-area:ops]">
      <template v-if="editing">
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6.5 text-faint hover:bg-selected hover:text-primary"
          :title="t('common.save')"
          @click="save"
        >
          <Icon name="check" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6.5 text-faint"
          :title="t('common.cancel')"
          @click="cancel"
        >
          <Icon name="x" />
        </Button>
      </template>
      <template v-else>
        <Button
          v-if="entry.status !== 'locked'"
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6.5 text-faint"
          :title="t('common.edit')"
          @click="startEdit"
        >
          <Icon name="edit" />
        </Button>
        <Button
          v-if="entry.status !== 'locked'"
          type="button"
          variant="ghost"
          size="iconSm"
          class="size-6.5 text-faint hover:bg-destructive/10 hover:text-destructive"
          :title="t('common.delete')"
          @click="emit('remove')"
        >
          <Icon name="trash" />
        </Button>
      </template>
    </span>

    <!-- Popover sửa note (dùng chung với form). `source-ref-id` = nguồn của dòng (nếu
         dòng đến từ một gợi ý) để "Sửa bằng AI" đọc digest phiên. -->
    <LogtimeNotePopover
      v-model="draftNote"
      v-model:open="notePopOpen"
      :anchor="noteCellRef"
      :project-key="entry.projectKey"
      :issue="entry.task?.issue"
      :source-ref-id="entry.sourceRefId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import type { LogtimeEntry } from '~/stores/logtime'
import Input from '~/components/ui/input/Input.vue'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ entry: LogtimeEntry }>()
// `update` chỉ mang note + hours: đổi dự án của một dòng đã đẩy là làm nó lệch khỏi
// worklog bên PMS, mà ở đây không có gì đồng bộ lại. Cùng lý do với `editEntry`.
const emit = defineEmits<{
  (e: 'remove'): void
  (e: 'update', patch: { note?: string; hours?: number }): void
}>()

const { t } = useI18n()
const { store, fmt, labelOf, sourceNameOf, issueUrlOf, colorOf } = useLogtimeManager()

const issueUrl = computed(() => issueUrlOf(props.entry))
const canPush = computed(() => store.canPush(props.entry.projectKey))
const color = computed(() => colorOf(props.entry.projectKey))

// Chế độ sửa sống trong hàng: bấm bút thì hàng tự đổi thành ô nhập, cha chỉ nhận
// patch khi đã chốt — nên gõ dở rồi bỏ đi không để lại gì.
const editing = ref(false)
const draftNote = ref('')
const draftHours = ref('')
const noteEl = ref<HTMLInputElement | null>(null)
// Popover sửa note (dùng chung LogtimeNotePopover) — neo theo ô note của hàng.
const noteCellRef = ref<HTMLElement | null>(null)
const notePopOpen = ref(false)

function startEdit(): void {
  draftNote.value = props.entry.note
  draftHours.value = String(props.entry.hours)
  editing.value = true
  // Không focus thì người dùng phải bấm thêm một lần nữa vào ô vừa hiện.
  void nextTick(() => noteEl.value?.focus())
}

function cancel(): void {
  editing.value = false
  notePopOpen.value = false
}

function save(): void {
  const patch: { note?: string; hours?: number } = {}
  const note = draftNote.value.trim()
  if (note && note !== props.entry.note) patch.note = note
  const hours = Number(draftHours.value)
  if (Number.isFinite(hours) && hours > 0 && hours !== props.entry.hours) patch.hours = hours
  editing.value = false
  notePopOpen.value = false
  if (patch.note === undefined && patch.hours === undefined) return
  emit('update', patch)
}
</script>
