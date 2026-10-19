<template>
  <!-- Cột tháng và khung ngày dán liền nhau, không có khe: bản phác để chúng chung một
       đường viền dọc. -->
  <div class="flex min-h-0 flex-1">
    <LogtimeMonthColumn />

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Tiêu đề ngày. "Kéo từ PMS" và "Chép hôm qua" thuộc về đây: chúng là việc
           soạn công của ngày, còn thanh dưới chỉ để chốt đẩy. Ba khung con (tiêu đề,
           thân, thanh xác nhận) tự lo lề ngang chứ không nhận từ cha: tiêu đề và thanh
           xác nhận là hai DẢI full-bleed mà đường kẻ của chúng phải chạy hết bề ngang. -->
      <div class="flex min-h-12.5 shrink-0 flex-wrap items-center gap-2 border-b px-6 py-2">
        <span class="flex min-w-0 flex-col gap-0.5">
          <b class="text-lg font-semibold">{{ longDateOf(date) }}</b>
          <span class="text-xs text-dim">{{ dayMeta }}</span>
        </span>
        <span class="flex-1" />
        <Button
          type="button"
          :disabled="store.busy"
          class="shrink-0"
          variant="outline"
          @click="pullRange"
        >
          <Icon name="refresh" />
          {{ t('logtime.action.pull') }}
        </Button>
        <Button
          type="button"
          :disabled="!hasYesterday"
          class="shrink-0"
          variant="outline"
          @click="copyYesterday"
        >
          <Icon name="copy" />
          {{ t('logtime.action.copy') }}
        </Button>
        <!-- Chỉ đọc: mở báo cáo của ngày để chép ra ngoài. Không gửi gì lên PMS. -->
        <Button
          type="button"
          :disabled="entries.length === 0"
          class="shrink-0"
          variant="outline"
          @click="openReport"
        >
          <Icon name="file" />
          {{ t('logtime.report.open') }}
        </Button>
      </div>

      <!-- Nội dung ngày (cuộn) + cột phải "Hôm nay bạn đã làm", dán liền nhau như bản
           phác: hàng ngang chiếm hết chiều cao còn lại (overflow-hidden để hai con tự lo
           cuộn), thanh xác nhận nằm DƯỚI nó nên luôn thấy. Panel ≤1120px thì xếp dọc và
           cuộn cả khối một mạch thay vì hai vùng cuộn riêng (cột phải tự xuống dưới). -->
      <div
        class="flex min-h-0 flex-1 overflow-hidden max-[1120px]:flex-col max-[1120px]:overflow-y-auto"
      >
        <div
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 pt-3.5 pb-4.5 max-[1120px]:flex-none max-[1120px]:overflow-visible"
        >
          <!-- Ngân sách ngày. Khoảng cách giữa các khối là margin của TỪNG khối, không
               phải `gap` của cha: bản phác đặt mỗi chỗ một khoảng khác nhau. -->
          <Card class="mb-4 gap-0 px-3.5 py-3">
            <div class="mb-3 flex flex-wrap items-baseline gap-2">
              <span class="text-2xl font-semibold tracking-tight tabular-nums">
                {{ fmt(total) }}
              </span>
              <span class="text-base tabular-nums text-dim">
                / {{ fmt(budget) }} {{ t('logtime.hoursUnit') }}
              </span>
              <span class="flex-1" />
              <!-- Ba trạng thái: vượt mức (đỏ) · đủ (accent) · thiếu (vàng) — gộp "vượt"
                   vào "thiếu" là làm hai thứ trông giống nhau. -->
              <Badge variant="outline" class="rounded-sm" :class="budgetTagClass">
                {{ budgetTag }}
              </Badge>
            </div>
            <!-- Màu đoạn là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style. -->
            <div class="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
              <i
                v-for="seg in segments"
                :key="seg.key"
                class="block h-3 transition-[width] duration-300"
                :style="{ width: `${seg.pct}%`, background: seg.color }"
              />
            </div>
            <div class="mt-1.5 flex justify-between text-xs tabular-nums text-faint">
              <span v-for="tick in ticks" :key="tick">{{ tick }}</span>
            </div>
            <div
              class="mt-3 flex flex-wrap gap-x-3.5 gap-y-2.5 text-xs text-dim *:inline-flex *:items-center *:gap-1.5"
            >
              <span v-for="seg in segments" :key="seg.key">
                <i class="size-2 shrink-0 rounded-full" :style="{ background: seg.color }" />
                {{ labelOf(seg.key) }}
                <!-- Số giờ là SỐ LIỆU PHỤ của nhãn dự án, không phải nhãn — bản phác để
                   nó mờ và đều nét, không in đậm. -->
                <span class="tabular-nums text-faint">
                  {{ fmt(seg.hours) }}{{ t('logtime.hoursShort') }}
                </span>
              </span>
              <span v-if="segments.length === 0" class="text-sm text-faint">
                {{ t('logtime.day.empty') }}
              </span>
            </div>
          </Card>

          <!-- Dòng công -->
          <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-dim">
            <span>{{ t('logtime.day.rows') }}</span>
            <!-- Ai đó ngoài màn này vừa ghi (phiên chat qua tool logtime_*, hoặc đồng bộ
               PMS). Danh sách đã tự nạp lại nhờ sự kiện `logtime.changed`; chip chỉ để
               người dùng không giật mình vì con số tự đổi. -->
            <Badge
              v-if="remoteNote"
              variant="outline"
              class="rounded-sm border-primary/40 bg-primary/10 text-primary"
            >
              <Icon name="zap" />
              {{ remoteNote }}
            </Badge>
            <span class="flex-1" />
            <span class="font-normal">
              {{ t('logtime.day.roundHint', { step: fmt(settings.roundStep) }) }}
            </span>
          </div>

          <div class="flex flex-col gap-2">
            <LogtimeRow
              v-for="entry in entries"
              :key="entry.id"
              :entry="entry"
              @remove="removeEntry(entry)"
              @update="editEntry(entry, $event)"
            />
            <div v-if="entries.length === 0" class="text-sm text-faint">
              {{ t('logtime.day.none') }}
            </div>
          </div>

          <!-- Form nhanh: dự án · việc · giờ · task. Mỗi ô là một khung có viền bọc icon
             dẫn + control KHÔNG viền bên trong (viền ở khung chứ không ở control — để ở
             control thì icon và ô nhập là hai hộp rời nhau), rồi tới cặp nút ± đứng
             riêng — bản phác tách ô nhập giờ khỏi nút tăng/giảm. -->
          <form
            class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5"
            autocomplete="off"
            @submit.prevent="submitForm"
          >
            <div
              class="flex min-h-ctrl-sm min-w-0 items-center gap-2 rounded-md border bg-muted px-2 focus-within:border-selected-border shrink-0 grow-0 basis-41"
            >
              <Icon name="listul" class="size-3.5 shrink-0 text-faint" />
              <AppSelect
                v-model="formProject"
                :options="projectOptions"
                :placeholder="t('logtime.form.project')"
                variant="ghost"
                size="sm"
                width="100%"
                class="min-w-0 flex-1"
              />
            </div>
            <div
              ref="noteFieldRef"
              class="flex min-h-ctrl-sm min-w-0 items-center gap-2 rounded-md border bg-muted px-2 focus-within:border-selected-border shrink grow basis-55"
              :class="{ 'border-selected-border': formComposing }"
            >
              <!-- Ô note đang chờ AI: viền accent nhạt + icon xoay để rõ là đang làm việc. -->
              <Icon
                v-if="formComposing"
                name="refresh"
                class="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
              />
              <!-- Bút chì là NÚT mở popover textarea: note dài (AI sinh) không xem/sửa nổi
                   trong ô một dòng. -->
              <Button
                v-else
                type="button"
                variant="ghost"
                class="size-3.5 shrink-0 p-0 text-faint hover:bg-transparent hover:text-primary [&_svg]:size-3.5"
                :title="t('logtime.form.expandNote')"
                :disabled="formComposing"
                @click="openNotePopover"
              >
                <Icon name="edit" />
              </Button>
              <Input
                v-model="formNote"
                unstyled
                class="min-w-0 flex-1 text-sm"
                :placeholder="formComposing ? t('logtime.form.composing') : t('logtime.form.note')"
                :disabled="formComposing"
              />
            </div>
            <div
              class="flex min-h-ctrl-sm min-w-0 items-center gap-2 rounded-md border bg-muted px-2 focus-within:border-selected-border"
            >
              <Icon name="clock" class="size-3.5 shrink-0 text-faint" />
              <span class="text-right text-sm tabular-nums">{{ fmt(formHours) }}</span>
              <span class="text-xs text-faint">{{ t('logtime.hoursShort') }}</span>
            </div>
            <!-- Cặp ± đứng riêng ngoài khung giờ, hai nút vuông rời — không gộp vào một hộp. -->
            <div class="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="outline"
                class="size-6 p-0 text-sm font-normal text-muted-foreground hover:border-input hover:text-foreground"
                :aria-label="t('logtime.form.minus')"
                @click="bumpHours(-1)"
              >
                −
              </Button>
              <Button
                type="button"
                variant="outline"
                class="size-6 p-0 text-sm font-normal text-muted-foreground hover:border-input hover:text-foreground"
                :aria-label="t('logtime.form.plus')"
                @click="bumpHours(1)"
              >
                +
              </Button>
            </div>
            <Button type="button" class="shrink-0" variant="outline" @click="openTaskPicker">
              <Icon name="link" />
              <span v-if="!formTask">{{ t('logtime.form.attach') }}</span>
              <span v-else class="tabular-nums">#{{ formTask.issue ?? '—' }}</span>
            </Button>
            <Button
              v-if="formTask"
              type="button"
              variant="ghost"
              size="iconSm"
              class="size-6.5 text-faint"
              :title="t('logtime.form.detach')"
              @click="formTask = null"
            >
              <Icon name="x" />
            </Button>
            <Button type="submit" :disabled="formComposing" class="shrink-0" variant="default">
              {{ t('logtime.form.add') }}
            </Button>
          </form>

          <!-- Popover sửa note (dùng chung với LogtimeRow). Neo theo ô note; tự chọn mở
               lên/xuống. `source-ref`/`kind` để "Sửa bằng AI" đọc digest phiên nguồn. -->
          <LogtimeNotePopover
            v-model="formNote"
            v-model:open="noteOpen"
            :anchor="noteFieldRef"
            :project-key="formProject"
            :issue="formTask?.issue"
            :source-ref-id="formSourceRef"
            :kind="formSourceKind || 'session'"
          />

          <!-- Chú giải trạng thái: đọc xong biết dòng nào còn ở máy, dòng nào đã lên PMS.
             Nói bằng lời thường, KHÔNG lộ tên trường nội bộ. Thuộc về CUỐI nội dung đang
             cuộn chứ không phải chân trang (chân trang là của thanh xác nhận). Cùng một
             kiểu với chú giải dự án trong tile ngân sách. -->
          <div
            class="mt-3 flex flex-wrap gap-x-3.5 gap-y-2.5 text-xs text-dim *:inline-flex *:items-center *:gap-1.5"
          >
            <span>
              <i class="size-2 shrink-0 rounded-full bg-dim" />
              {{ t('logtime.legend.draft') }}
            </span>
            <span>
              <i class="size-2 shrink-0 rounded-full bg-primary" />
              {{ t('logtime.legend.posted') }}
            </span>
            <span>
              <i class="size-2 shrink-0 rounded-full bg-warning" />
              {{ t('logtime.legend.locked') }}
            </span>
          </div>
        </div>

        <!-- Cột phải: việc AWOG tự đo được của ngày. Panel tự lo ẩn/hiện (ngày không đo
             được gì, và không có việc bị bỏ qua/không lỗi, thì nó không render gì). -->
        <LogtimeSuggestions />
      </div>

      <!-- Thanh xác nhận: luôn thấy, không phải đi tìm nút đẩy. Câu chính và đuôi mờ nằm
           CÙNG dòng, nối bằng khe gap-1 — Vue xoá node khoảng trắng chỉ gồm xuống dòng +
           thụt lề giữa hai phần tử nên không trông cậy được vào dấu cách nguồn. -->
      <div class="flex shrink-0 flex-wrap items-center gap-2.5 border-t bg-sidebar px-6 py-2.5">
        <span class="size-2 shrink-0 rounded-full" :class="barDotClass" />
        <span class="inline-flex min-w-0 items-baseline gap-1">
          <span class="text-sm font-semibold" :class="{ 'text-primary': drafts.length === 0 }">
            {{ barTitle }}
          </span>
          <span class="text-xs text-dim">{{ barSub }}</span>
        </span>
        <span class="flex-1" />
        <!-- "Xem trước payload" mở ĐÚNG modal của nút đẩy — bản phác cũng nối hai nút
             vào một handler, và modal đã bày payload từng dòng nên đây không phải nút
             giả: nó là lối vào chỉ-đọc của cùng một thứ. -->
        <Button
          type="button"
          :disabled="drafts.length === 0 || store.busy"
          class="shrink-0"
          variant="outline"
          @click="openPush"
        >
          {{ t('logtime.action.preview') }}
        </Button>
        <Button
          type="button"
          :disabled="drafts.length === 0 || store.busy"
          class="shrink-0"
          variant="default"
          @click="openPush"
        >
          <Icon name="arrow-up" />
          {{ t('logtime.action.push', { n: drafts.length }) }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn Ngày của Logtime. State lấy từ singleton `useLogtimeManager` thay vì prop —
// xem chú thích ở composable.
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const {
  store,
  date,
  settings,
  entries,
  segments,
  total,
  budget,
  drafts,
  pushableDrafts,
  blockedDrafts,
  projectOptions,
  formProject,
  formNote,
  formHours,
  formTask,
  formComposing,
  formSourceRef,
  formSourceKind,
  fmt,
  labelOf,
  sourceNameOf,
  longDateOf,
  dayMeta,
  hasYesterday,
  bumpHours,
  submitForm,
  editEntry,
  removeEntry,
  copyYesterday,
  openPush,
  pullRange,
  openTaskPicker,
  openReport,
} = useLogtimeManager()

const remoteNote = computed(() => {
  const change = store.lastRemoteChange
  if (!change) return ''
  if (change.source === 'agent') return t('logtime.day.changedByAgent')
  if (change.source === 'pull') return t('logtime.day.changedByPull')
  return ''
})

// Popover sửa note của form. Vị trí tính CỐ ĐỊNH lúc mở (backdrop chặn cuộn nên không
// trôi); neo trên ô note, mở LÊN để không bị vùng cuộn của thân ngày cắt.
// Popover sửa note của form (LogtimeNotePopover tự định vị theo `noteFieldRef`).
const noteFieldRef = useTemplateRef<HTMLElement>('noteFieldRef')
const noteOpen = ref(false)

function openNotePopover(): void {
  noteOpen.value = true
}

const ticks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((f) => `${String(Number((budget.value * f).toFixed(2)))}h`),
)

const budgetTag = computed(() => {
  if (budget.value > 0 && total.value > budget.value) {
    return t('logtime.day.over', { h: fmt(total.value - budget.value) })
  }
  if (total.value >= budget.value) return t('logtime.day.full', { h: fmt(budget.value) })
  return t('logtime.day.missing', { h: fmt(budget.value - total.value) })
})

const budgetTagClass = computed(() => {
  if (budget.value > 0 && total.value > budget.value)
    return 'border-destructive/40 text-destructive'
  return total.value >= budget.value
    ? 'border-primary/40 bg-primary/10 text-primary'
    : 'border-warning/40 text-warning'
})

const barDotClass = computed(() => {
  if (drafts.value.length === 0) return 'bg-primary'
  return blockedDrafts.value.length > 0 ? 'bg-destructive' : 'bg-warning'
})

const barTitle = computed(() =>
  drafts.value.length === 0
    ? t('logtime.bar.clean')
    : t('logtime.bar.drafts', {
        n: drafts.value.length,
        h: fmt(drafts.value.reduce((s, e) => s + e.hours, 0)),
      }),
)

// Tên tool ghi worklog là QUY ƯỚC của sidecar — `TOOL.create` trong
// apps/desktop/sidecar/src/logtime/mcp.ts. UI chỉ đọc lại để nói trước cho người dùng
// biết cú bấm này sẽ gọi cái gì. Sidecar đổi quy ước thì dòng phụ hiện tên cũ; không
// có gì vỡ, và cố ý KHÔNG suy ra từ `cap.tools` — nguồn chỉ đọc vẫn liệt kê tool nó có,
// nên suy từ đó sẽ hứa một cú gọi mà `canPush` chưa chắc cho phép.
const CREATE_TOOL = 'worklog_create'

const barSub = computed(() => {
  if (drafts.value.length === 0) return t('logtime.bar.cleanSub')
  if (blockedDrafts.value.length > 0) {
    return t('logtime.bar.blocked', { n: blockedDrafts.value.length })
  }
  // Nguồn của ĐÚNG những dòng sắp đẩy. Nhiều nguồn thì kể ra hết — gộp còn một cái tên
  // là nói sai về chỗ giờ sắp chảy tới.
  const names = [...new Set(pushableDrafts.value.map((e) => sourceNameOf(e.projectKey)))]
  return t('logtime.bar.sourceTool', { source: names.join(' + '), tool: CREATE_TOOL })
})
</script>
