<template>
  <div class="ltday">
    <LogtimeMonthColumn />

    <div class="ltmain">
      <!-- Tiêu đề ngày. "Kéo từ PMS" và "Chép hôm qua" thuộc về đây: chúng là việc
           soạn công của ngày, còn thanh dưới chỉ để chốt đẩy. -->
      <div class="lthead">
        <span class="ltheadtext">
          <b class="ltheadd">{{ longDateOf(date) }}</b>
          <span class="ltheads">{{ dayMeta }}</span>
        </span>
        <span class="ltsp" />
        <button class="btn ltbtn" type="button" :disabled="store.busy" @click="pullRange">
          <Icon name="refresh" />
          {{ t('logtime.action.pull') }}
        </button>
        <button class="btn ltbtn" type="button" :disabled="!hasYesterday" @click="copyYesterday">
          <Icon name="copy" />
          {{ t('logtime.action.copy') }}
        </button>
        <!-- Chỉ đọc: mở báo cáo của ngày để chép ra ngoài. Không gửi gì lên PMS. -->
        <button
          class="btn ltbtn"
          type="button"
          :disabled="entries.length === 0"
          @click="openReport"
        >
          <Icon name="file" />
          {{ t('logtime.report.open') }}
        </button>
      </div>

      <!-- Nội dung ngày (cuộn) + cột phải "Hôm nay bạn đã làm", dán liền nhau như bản
           phác: `.ltdwrap` là hàng ngang chiếm hết chiều cao còn lại, thanh xác nhận
           nằm DƯỚI nó nên luôn thấy. -->
      <div class="ltdwrap">
        <div class="ltbody">
          <!-- Ngân sách ngày -->
          <div class="tile ltbudget">
            <div class="ltbhead">
              <span class="ltbnum tnum">{{ fmt(total) }}</span>
              <span class="ltbof tnum">/ {{ fmt(budget) }} {{ t('logtime.hoursUnit') }}</span>
              <span class="ltsp" />
              <!-- Nhãn TRẠNG THÁI nên là `.tag`: `.chip` của prototype.css không có
                 modifier `.acc`/`.warn` nào, còn `.tag` thì có — để nguyên `.chip` là
                 badge không lên màu. -->
              <span class="tag" :class="budgetTagClass">{{ budgetTag }}</span>
            </div>
            <div class="lttrack">
              <i
                v-for="seg in segments"
                :key="seg.key"
                :style="{ width: `${seg.pct}%`, background: seg.color }"
              />
            </div>
            <div class="ltticks tnum">
              <span v-for="tick in ticks" :key="tick">{{ tick }}</span>
            </div>
            <div class="ltlegend">
              <span v-for="seg in segments" :key="seg.key">
                <i class="ltdot" :style="{ background: seg.color }" />
                {{ labelOf(seg.key) }}
                <!-- Số giờ là SỐ LIỆU PHỤ của nhãn dự án, không phải nhãn — bản phác để
                   nó mờ và đều nét, không in đậm. -->
                <span class="tnum">{{ fmt(seg.hours) }}{{ t('logtime.hoursShort') }}</span>
              </span>
              <span v-if="segments.length === 0" class="ltempty">{{ t('logtime.day.empty') }}</span>
            </div>
          </div>

          <!-- Dòng công -->
          <div class="ltsech">
            <span>{{ t('logtime.day.rows') }}</span>
            <!-- Ai đó ngoài màn này vừa ghi (phiên chat qua tool logtime_*, hoặc đồng bộ
               PMS). Danh sách đã tự nạp lại nhờ sự kiện `logtime.changed`; chip chỉ để
               người dùng không giật mình vì con số tự đổi. -->
            <span v-if="remoteNote" class="tag acc">
              <Icon name="zap" />
              {{ remoteNote }}
            </span>
            <span class="ltsp" />
            <span class="ltmuted">
              {{ t('logtime.day.roundHint', { step: fmt(settings.roundStep) }) }}
            </span>
          </div>

          <div class="ltrows">
            <LogtimeRow
              v-for="entry in entries"
              :key="entry.id"
              :entry="entry"
              @remove="removeEntry(entry)"
              @update="editEntry(entry, $event)"
            />
            <div v-if="entries.length === 0" class="ltnone">{{ t('logtime.day.none') }}</div>
          </div>

          <!-- Form nhanh: dự án · việc · giờ · task. Mỗi ô là một khung `.ltfld` bọc
             icon dẫn + control KHÔNG viền bên trong, rồi tới cặp nút ± đứng riêng —
             bản phác tách ô nhập giờ khỏi nút tăng/giảm chứ không gộp chúng vào một
             hộp như bản cũ. -->
          <form class="ltform" autocomplete="off" @submit.prevent="submitForm">
            <div class="ltfld ltproj">
              <Icon name="listul" />
              <AppSelect
                v-model="formProject"
                :options="projectOptions"
                :placeholder="t('logtime.form.project')"
                width="100%"
              />
            </div>
            <div ref="noteFieldRef" class="ltfld ltgrow" :class="{ composing: formComposing }">
              <Icon v-if="formComposing" name="refresh" class="ltfld-spin" />
              <!-- Bút chì là NÚT mở popover textarea: note dài (AI sinh) không xem/sửa nổi
                   trong ô một dòng. -->
              <button
                v-else
                type="button"
                class="ltnotebtn"
                :title="t('logtime.form.expandNote')"
                :disabled="formComposing"
                @click="openNotePopover"
              >
                <Icon name="edit" />
              </button>
              <input
                v-model="formNote"
                :placeholder="formComposing ? t('logtime.form.composing') : t('logtime.form.note')"
                :disabled="formComposing"
              />
            </div>
            <div class="ltfld">
              <Icon name="clock" />
              <span class="tnum lthval">{{ fmt(formHours) }}</span>
              <span class="lthunit">{{ t('logtime.hoursShort') }}</span>
            </div>
            <div class="ltstepgrp">
              <button type="button" :aria-label="t('logtime.form.minus')" @click="bumpHours(-1)">
                −
              </button>
              <button type="button" :aria-label="t('logtime.form.plus')" @click="bumpHours(1)">
                +
              </button>
            </div>
            <button type="button" class="btn ltbtn" @click="openTaskPicker">
              <Icon name="link" />
              <span v-if="!formTask">{{ t('logtime.form.attach') }}</span>
              <span v-else class="tnum">#{{ formTask.issue ?? '—' }}</span>
            </button>
            <button
              v-if="formTask"
              type="button"
              class="ltx"
              :title="t('logtime.form.detach')"
              @click="formTask = null"
            >
              <Icon name="x" />
            </button>
            <button type="submit" class="btn pri ltbtn" :disabled="formComposing">
              {{ t('logtime.form.add') }}
            </button>
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
             cuộn chứ không phải chân trang (chân trang là của thanh xác nhận). -->
          <div class="ltlegend">
            <span>
              <i class="ltdot" :style="{ background: 'var(--textDim)' }" />
              {{ t('logtime.legend.draft') }}
            </span>
            <span>
              <i class="ltdot" :style="{ background: 'var(--accent)' }" />
              {{ t('logtime.legend.posted') }}
            </span>
            <span>
              <i class="ltdot" :style="{ background: 'var(--amber)' }" />
              {{ t('logtime.legend.locked') }}
            </span>
          </div>
        </div>

        <!-- Cột phải: việc AWOG tự đo được của ngày. Panel tự lo ẩn/hiện (ngày không đo
             được gì, và không có việc bị bỏ qua/không lỗi, thì nó không render gì). -->
        <LogtimeSuggestions />
      </div>

      <!-- Thanh xác nhận: luôn thấy, không phải đi tìm nút đẩy -->
      <div class="ltbar" :class="{ clean: drafts.length === 0 }">
        <span class="ltdot" :style="{ background: barColor }" />
        <span class="ltbartext">
          <span class="ltbar1">{{ barTitle }}</span>
          <span class="ltbar2">{{ barSub }}</span>
        </span>
        <span class="ltsp" />
        <!-- "Xem trước payload" mở ĐÚNG modal của nút đẩy — bản phác cũng nối hai nút
             vào một handler, và modal đã bày payload từng dòng nên đây không phải nút
             giả: nó là lối vào chỉ-đọc của cùng một thứ. -->
        <button
          class="btn ltbtn"
          type="button"
          :disabled="drafts.length === 0 || store.busy"
          @click="openPush"
        >
          {{ t('logtime.action.preview') }}
        </button>
        <button
          class="btn pri ltbtn"
          type="button"
          :disabled="drafts.length === 0 || store.busy"
          @click="openPush"
        >
          <Icon name="arrow-up" />
          {{ t('logtime.action.push', { n: drafts.length }) }}
        </button>
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
// trôi); neo trên ô note, mở LÊN để không bị vùng cuộn `.ltbody` cắt.
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
  if (budget.value > 0 && total.value > budget.value) return 'dgr'
  return total.value >= budget.value ? 'acc' : 'warn'
})

const barColor = computed(() => {
  if (drafts.value.length === 0) return 'var(--accent)'
  return blockedDrafts.value.length > 0 ? 'var(--danger)' : 'var(--amber)'
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

<style scoped>
/* Cột tháng và khung ngày dán liền nhau, không có khe: bản phác để chúng chung một
   đường viền dọc. Khe 14px cũ cộng với `--padX` của từng khung thành hai lần lề. */
.ltday {
  display: flex;
  gap: 0;
  min-height: 0;
  flex: 1;
}
.ltmain {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Ba khung con tự lo lề ngang (`--padX`) chứ không nhận từ cha: bản phác có hai DẢI
   full-bleed (tiêu đề ngày và thanh xác nhận) mà đường kẻ chân của chúng phải chạy hết
   bề ngang. Cha có lề thì hai đường kẻ đó bị hụt vào trong. */
.lthead {
  flex: 0 0 auto;
  min-height: 50px;
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 8px var(--padX);
  /* `inset` chứ không `border-bottom`: thanh cao cố định, `border` ăn 1px của content
     box (50 → 49) và đẩy con đang căn giữa lệch nửa pixel. */
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltheadtext {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ltheadd {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltheads {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
/* Nội dung ngày + cột phải, dán liền như bản phác. `overflow: hidden` để hai con tự
   lo cuộn của mình; `min-height: 0` cho phép con cuộn trong flex. */
.ltdwrap {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ltbody {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 14px var(--padX) 18px;
}
/* Hẹp thì xếp dọc: cột phải tự xuống dưới (media query của chính nó ở
   `LogtimeSuggestions`), còn ở đây `.ltdwrap` đổi sang cột và cuộn cả khối một mạch
   thay vì hai vùng cuộn riêng (mirror bản phác @1180). */
@media (max-width: 1120px) {
  .ltdwrap {
    flex-direction: column;
    overflow-y: auto;
  }
  .ltbody {
    flex: 0 0 auto;
    overflow: visible;
  }
}
/* Khoảng cách giữa các khối ở đây là margin của TỪNG khối, không phải `gap` của cha:
   bản phác đặt 15px dưới tile, 9px dưới tiêu đề mục, 9px trên form, 11px trên chú
   giải — `gap` chỉ cho một con số duy nhất. */
.ltbudget {
  display: flex;
  flex-direction: column;
  /* `.tile` của prototype.css đệm 15px; bản phác đệm 13px 14px. */
  padding: 13px 14px;
  margin-bottom: 15px;
}
.ltbhead {
  display: flex;
  align-items: baseline;
  gap: 9px;
  flex-wrap: wrap;
  margin-bottom: 11px;
}
/* `.tag.acc` và `.tag.warn` có sẵn trong prototype.css, `.tag.dgr` thì KHÔNG — bản phác
   khai nó ở dòng 119 nhưng file dùng chung chưa có. Vượt mức ngày là trạng thái thứ ba,
   gộp nó vào `.warn` là làm "vượt" và "thiếu" trông giống nhau. */
.ltbudget .tag.dgr {
  color: var(--danger);
  border-color: var(--dangerBorder);
}
.ltbnum {
  font-size: var(--fs-2xl);
  line-height: var(--lh-2xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}
.ltbof {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--textDim);
}
.ltsp {
  flex: 1;
}
.lttrack {
  height: 12px;
  border-radius: var(--r-pill);
  background: var(--bgActive);
  display: flex;
  gap: 2px;
  overflow: hidden;
}
.lttrack i {
  display: block;
  height: 12px;
  transition: width var(--dur-panel) var(--ease);
}
.ltticks {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* MỘT lớp cho cả hai chú giải (dự án trong tile ngân sách, trạng thái cuối nội dung).
   Bản phác khai chúng hai nơi lệch nhau 2px ở `gap`/`margin-top` — cùng một thứ đọc
   hai lần, để lệch là tự tạo ra hai chuẩn. */
.ltlegend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 11px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
/* `>` chứ không phải hậu duệ: `.mono` bên trong cũng là `<span>`, cho nó `inline-flex`
   là biến chuỗi `worklogId` thành flex item và mất luôn khoảng trắng trước nó. */
.ltlegend > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ltlegend .tnum {
  color: var(--textFaint);
}
.ltdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ltsech {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.ltmuted {
  font-weight: 400;
}
.ltrows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ltnone,
.ltempty {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.ltform {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 9px;
  border: 1px dashed var(--borderStrong);
  border-radius: var(--r-btn);
  padding: 10px 12px;
}
/* Ô nhập của form nhanh: khung có viền bọc icon dẫn + control KHÔNG viền bên trong.
   Viền nằm ở khung chứ không ở control — để ở control thì icon và ô nhập là hai hộp
   rời nhau, đúng cái bản cũ đang làm. */
.ltfld {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 9px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
/* `>` + `.icn`: `<Icon>` render ra `<svg class="icn">` là phần tử gốc của component
   con nên nó mang attribute scope của file này, không cần `:deep`. `--icon-md` (16) là
   cỡ mặc định của `.icn`; bản phác để icon dẫn nhỏ hơn, `--icon-sm` (14). */
.ltfld > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}
.ltfld input {
  border: 0;
  background: transparent;
  color: var(--text);
  outline: none;
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  min-width: 0;
}
/* Ô note đang chờ AI: viền accent nhạt + icon xoay để rõ là đang làm việc. */
.ltfld.composing {
  border-color: var(--accentBorder);
}
/* `.icn.ltfld-spin` để thắng `.ltfld > .icn { color: textFaint }` mà không cần `!important`. */
.ltfld > .icn.ltfld-spin {
  color: var(--accent);
  animation: ltfld-rot 0.9s linear infinite;
}
@keyframes ltfld-rot {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ltfld-spin {
    animation: none;
  }
}
/* Bút chì trong ô note = nút mở popover; hộp icon nhỏ, `padding: 0` khai tường minh. */
.ltnotebtn {
  width: var(--icon-sm);
  height: var(--icon-sm);
  padding: 0;
  border: 0;
  background: none;
  color: var(--textFaint);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltnotebtn:hover:not(:disabled) {
  color: var(--accent);
}
.ltnotebtn > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.ltfld:focus-within {
  border-color: var(--accentBorder);
}
/* AppSelect tự mang viền + nền + đệm của nó. Trong khung này chúng thành hộp lồng hộp.
   Đây là chuyện BỐ CỤC — control không viền nằm trong khung có viền, đúng như bản phác
   dựng `.fld select` — chứ không phải vá một lệch pha, nên `:deep` là đúng chỗ. */
.ltfld :deep(.asel) {
  flex: 1;
  min-width: 0;
}
.ltfld :deep(.aseltrigger) {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltfld :deep(.aseltrigger:hover) {
  border-color: transparent;
  color: var(--text);
}
.ltproj {
  flex: 0 0 164px;
}
.ltgrow {
  flex: 1 1 220px;
}
.ltgrow input {
  width: 100%;
}
.lthval {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: right;
}
.lthunit {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* Cặp ± đứng riêng ngoài khung giờ, hai nút vuông rời — không gộp vào một hộp. */
.ltstepgrp {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.ltstepgrp button {
  width: 24px;
  height: 24px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textMuted);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltstepgrp button:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.ltbtn {
  flex: 0 0 auto;
}
.ltx {
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textFaint);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.ltx:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Dải chốt đẩy: nền `--bgPanel` + kẻ chân `inset` để tách khỏi phần đang cuộn, và
   đệm `--padX` để đường kẻ chạy hết bề ngang như bản phác. */
.ltbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px var(--padX);
  background: var(--bgPanel);
  box-shadow: inset 0 1px 0 var(--border);
}
/* Câu chính và đuôi mờ nằm CÙNG dòng, nối nhau bằng một khe 4px: bản phác để hai
   `<span>` inline cạnh nhau trong một `<span>`, ở đó khoảng trắng nguồn co lại thành
   một dấu cách. Vue thì XOÁ hẳn node khoảng trắng khi nó chỉ có xuống dòng + thụt lề
   giữa hai phần tử, nên không thể trông cậy vào dấu cách nguồn — khe phải khai ra.
   Xếp hai dòng làm thanh cao gấp đôi bản phác. */
.ltbartext {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.ltbar1 {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.ltbar.clean .ltbar1 {
  color: var(--accent);
}
.ltbar2 {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
