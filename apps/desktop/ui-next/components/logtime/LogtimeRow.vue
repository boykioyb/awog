<template>
  <!-- Grid có vùng đặt tên: giờ và ghi chú không bao giờ đè lên nhau dù panel hẹp
       cỡ nào (ở dưới 720px hàng tự xếp thành 3 tầng). -->
  <div class="ltrow" :class="[entry.status, { editing }]">
    <span class="ltpj">
      <i class="ltdot" :style="{ background: color }" />
      <b>{{ labelOf(entry.projectKey) }}</b>
    </span>

    <span ref="noteCellRef" class="ltnt">
      <span v-if="editing" class="ltntedit">
        <input
          ref="noteEl"
          v-model="draftNote"
          class="ltedit"
          :placeholder="t('logtime.form.note')"
          @keydown.enter.prevent="save"
          @keydown.esc.prevent="cancel"
        />
        <!-- Mở popover textarea + Sửa bằng AI (note dài không xem/sửa nổi trong ô một dòng). -->
        <button
          type="button"
          class="ltact"
          :title="t('logtime.form.expandNote')"
          @click="notePopOpen = true"
        >
          <Icon name="edit" />
        </button>
      </span>
      <template v-else>
        <span class="ltn1">{{ entry.note }}</span>
        <span class="ltn2">
          <a
            v-if="issueUrl"
            class="chip"
            :href="issueUrl"
            target="_blank"
            rel="noopener"
            :title="t('logtime.row.openIssue', { n: entry.task?.issue ?? 0 })"
          >
            <Icon name="link" />
            <span>#{{ entry.task?.issue }} {{ entry.task?.title }}</span>
          </a>
          <span v-else-if="entry.task?.id" class="chip">
            <Icon name="link" />
            <span>{{ entry.task?.title }}</span>
          </span>
          <span class="ltsrc">{{ sourceNameOf(entry.projectKey) }}</span>
        </span>
      </template>
    </span>

    <span class="lthr">
      <input
        v-if="editing"
        v-model="draftHours"
        class="ltedit ltnum tnum"
        inputmode="decimal"
        @keydown.enter.prevent="save"
        @keydown.esc.prevent="cancel"
      />
      <template v-else>{{ fmt(entry.hours) }}h</template>
    </span>

    <span class="ltst">
      <span v-if="entry.status === 'posted'" class="chip acc">
        <Icon name="check" />
        {{ t('logtime.status.posted') }}
      </span>
      <span v-else-if="entry.status === 'locked'" class="chip warn">
        <Icon name="shield" />
        {{ t('logtime.status.locked') }}
      </span>
      <span v-else-if="!canPush" class="chip dgr">
        <Icon name="alert" />
        {{ t('logtime.status.unlinked') }}
      </span>
      <span v-else class="chip">{{ t('logtime.status.draft') }}</span>
    </span>

    <span class="ltops">
      <template v-if="editing">
        <button type="button" class="ltact ok" :title="t('common.save')" @click="save">
          <Icon name="check" />
        </button>
        <button type="button" class="ltact" :title="t('common.cancel')" @click="cancel">
          <Icon name="x" />
        </button>
      </template>
      <template v-else>
        <button
          v-if="entry.status !== 'locked'"
          type="button"
          class="ltact"
          :title="t('common.edit')"
          @click="startEdit"
        >
          <Icon name="edit" />
        </button>
        <button
          v-if="entry.status !== 'locked'"
          type="button"
          class="ltact del"
          :title="t('common.delete')"
          @click="emit('remove')"
        >
          <Icon name="trash" />
        </button>
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

<style scoped>
.ltrow {
  display: grid;
  gap: 4px 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  /* Thẻ nền trắng (card) thay vì nền xám nhạt — `--bgPanel` là trắng ở theme sáng,
     màu card ở theme tối. */
  background: var(--bgPanel);
  grid-template-columns: 136px minmax(0, 1fr) auto auto auto;
  grid-template-areas: 'pj nt hr st ops';
}
/* Đã đẩy PMS: giữ nền trắng như mọi thẻ; trạng thái đã có chip riêng nên không cần
   phân biệt bằng nền (trước để `transparent`). */
.ltrow.posted {
  background: var(--bgPanel);
}
.ltrow.locked {
  opacity: 0.72;
}
/* Hàng đang sửa nhấc lên khỏi nền để mắt bám đúng dòng. */
.ltrow.editing {
  border-color: var(--accentBorder);
  background: var(--bgInput);
}
.ltpj {
  grid-area: pj;
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.ltpj b {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltdot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ltnt {
  grid-area: nt;
  min-width: 0;
}
/* Ô nhập note + nút mở popover khi đang sửa. */
.ltntedit {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
/* `display:block` bắt buộc: .ltn1 là <span> nên inline, mà overflow/text-overflow
   KHÔNG áp dụng cho phần tử inline — thiếu dòng này là chữ tràn đè lên cột giờ. */
.ltn1 {
  display: block;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltn2 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  margin-top: 3px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.ltn2 .chip {
  min-width: 0;
  max-width: 60%;
}
.ltn2 .chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltsrc {
  white-space: nowrap;
  flex: 0 0 auto;
}
.lthr {
  grid-area: hr;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  min-width: 46px;
  text-align: right;
}
.ltst {
  grid-area: st;
  justify-self: start;
}
.ltops {
  grid-area: ops;
  justify-self: end;
  display: flex;
  gap: 3px;
}
/* Tên `.ltact` chứ KHÔNG phải `.ltop`: `prototype.css` đã có `.ltop` cho hàng đầu
   của danh sách master-detail (`.md/.list/.srch`), mang `padding:11px` +
   `border-bottom`. Rule scoped ở đây chỉ thắng những thuộc tính nó KHAI, nên
   `padding` lọt qua từ bên kia: hộp 26×26 còn content box 2×2, icon 16px tràn ra
   và neo vào góc trên-trái content box ⇒ glyph lệch +7px phải +7px xuống, dính
   góc dưới-phải nút (đo được: svg 1537→1553 trong nút 1525→1551).
   `padding: 0` khai tường minh vì đây là hộp cố định 26×26 — padding ăn thẳng vào icon. */
.ltact {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textFaint);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltact:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltact.ok:hover {
  background: var(--accentDim);
  color: var(--accent);
}
.ltact.del:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.ltedit {
  width: 100%;
  min-width: 0;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  padding: 5px 8px;
  outline: none;
}
.ltedit:focus {
  border-color: var(--accentBorder);
}
.ltnum {
  width: 72px;
  text-align: right;
}
@media (max-width: 720px) {
  .ltrow {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas: 'pj hr ops' 'nt nt nt' 'st st st';
    row-gap: 7px;
  }
  .lthr {
    min-width: 0;
  }
}
</style>
