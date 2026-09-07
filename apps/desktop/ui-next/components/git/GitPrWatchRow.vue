<template>
  <div class="prw-row" :class="{ off: !watched }">
    <!-- Trạng thái CI là thứ hàng này tồn tại để trả lời, nên nó đứng đầu và luôn
         chiếm chỗ — kể cả khi chưa theo dõi (ô trống giữ cột thẳng hàng). -->
    <Icon :name="ciIcon" class="prw-ci" :class="ciClass" :title="ciTitle" />
    <div class="prw-body">
      <button class="prw-main" type="button" :title="hoverText" @click="emit('open')">
        <span class="prw-title">{{ title }}</span>
        <span class="prw-meta">
          <span class="prw-num tnum">#{{ number }}</span>
          <span v-if="reviewLabel" class="prw-review" :class="{ warn: needsChanges }">
            {{ reviewLabel }}
          </span>
          <span v-if="stateLabel" class="prw-state">{{ stateLabel }}</span>
          <span v-if="failingCheck" class="prw-check" :title="failingCheck">
            {{ failingCheck }}
          </span>
        </span>
      </button>
      <div class="prw-acts">
        <button
          class="prw-act"
          :class="{ on: watched }"
          type="button"
          :disabled="busy"
          :title="watched ? t('ghWatch.unwatchHint') : t('ghWatch.watchHint')"
          @click.stop="emit('toggle', !watched)"
        >
          <Icon
            :name="watched ? 'eye' : 'eye-off'"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
          <span>{{ watched ? t('ghWatch.unwatch') : t('ghWatch.watch') }}</span>
        </button>
        <!-- Ai đang nghe. Một PR được theo dõi mà không gắn phiên nào thì chỉ là
             một cái badge — nói thẳng ra thay vì để người dùng đoán. -->
        <span v-if="watched" class="prw-bind" :class="{ none: !sessionLabel }">
          {{ sessionLabel ? t('ghWatch.boundTo', { name: sessionLabel }) : t('ghWatch.notBound') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PrWatchItem } from '~/composables/usePrWatch'

// Một hàng "PR đang theo dõi" (hoặc một PR trong hộp thư có thể theo dõi).
// Trình bày thuần: mọi RPC + định tuyến nằm ở panel cha, nên hàng này dùng lại
// được ở trang Git về sau.

const props = defineProps<{
  repo: string
  number: number
  title: string
  // Đang theo dõi hay chưa (quyết định cả icon lẫn nhãn nút).
  watched: boolean
  // Trạng thái lần cuối quan sát được; null khi chưa theo dõi.
  item?: PrWatchItem | null
  // Tiêu đề phiên được gắn ('' = chưa gắn phiên nào).
  sessionLabel?: string
  busy?: boolean
}>()
const emit = defineEmits<{
  (e: 'toggle', watch: boolean): void
  (e: 'open'): void
}>()

const { t } = useI18n()

const ci = computed(() => props.item?.ci ?? 'none')
const ciIcon = computed(() =>
  ci.value === 'pass'
    ? 'check'
    : ci.value === 'fail'
      ? 'alert'
      : ci.value === 'pending'
        ? 'clock'
        : 'minus',
)
const ciClass = computed(() => ({
  pass: ci.value === 'pass',
  fail: ci.value === 'fail',
  pending: ci.value === 'pending',
}))
const ciTitle = computed(() => t(`ghWatch.ci.${ci.value}`))

const decision = computed(() => props.item?.reviewDecision ?? '')
const needsChanges = computed(() => decision.value === 'CHANGES_REQUESTED')
const reviewLabel = computed(() => {
  if (decision.value === 'APPROVED') return t('ghWatch.review.approved')
  if (decision.value === 'CHANGES_REQUESTED') return t('ghWatch.review.changesRequested')
  if (decision.value === 'REVIEW_REQUIRED') return t('ghWatch.review.required')
  return ''
})
const stateLabel = computed(() => {
  const state = props.item?.state ?? ''
  if (state === 'MERGED') return t('ghWatch.state.merged')
  if (state === 'CLOSED') return t('ghWatch.state.closed')
  return ''
})
const failingCheck = computed(() => (ci.value === 'fail' ? (props.item?.failingCheck ?? '') : ''))
const hoverText = computed(() => `${props.repo} #${props.number}\n${props.title}`)
</script>

<style scoped>
/* GRID vì lý do y hệt TopBarNotifyRow: `minmax(0, 1fr)` là thứ duy nhất buộc cột
   chữ không vượt quá phần còn lại trên mọi phiên bản Chromium mà Electron ship. */
.prw-row {
  display: grid;
  grid-template-columns: var(--icon-sm) minmax(0, 1fr);
  column-gap: 6px;
  align-items: start;
  padding: 7px 6px 7px 4px;
  border-radius: var(--r-sm);
}
.prw-row + .prw-row {
  margin-top: 4px;
}
.prw-row:hover {
  background: var(--bgHover);
}
/* Chưa theo dõi = ứng viên, đọc nhạt hơn hàng đang theo dõi. */
.prw-row.off .prw-title {
  color: var(--textDim);
}
.prw-ci {
  width: var(--icon-sm);
  height: var(--icon-sm);
  margin-top: 2px;
  color: var(--textFaint);
}
.prw-ci.pass {
  color: var(--green);
}
.prw-ci.fail {
  color: var(--danger);
}
.prw-ci.pending {
  color: var(--amber);
}
.prw-body {
  min-width: 0;
}
.prw-main {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.prw-title {
  display: block;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prw-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.prw-num {
  color: var(--textMuted);
}
.prw-review.warn {
  color: var(--danger);
}
.prw-state {
  color: var(--violet);
}
.prw-check {
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--danger);
}
.prw-acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.prw-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.prw-act:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--borderStrong);
}
.prw-act:disabled {
  opacity: 0.5;
  cursor: default;
}
/* Đang theo dõi = accent-tint + viền accent, KHÔNG phải nền xám đặc. */
.prw-act.on {
  color: var(--accentText);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.prw-bind {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prw-bind.none {
  color: var(--textFaint);
}
</style>
