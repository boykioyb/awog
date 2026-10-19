<template>
  <!-- GRID vì lý do y hệt TopBarNotifyRow: `minmax(0, 1fr)` là thứ duy nhất buộc cột
       chữ không vượt quá phần còn lại trên mọi phiên bản Chromium mà Electron ship.
       `[&+&]:mt-1` = khoảng cách giữa hai hàng liền nhau. -->
  <div
    class="group/prw grid grid-cols-[var(--icon-sm)_minmax(0,1fr)] items-start gap-x-1.5 rounded-md py-2 pr-1.5 pl-1 hover:bg-accent [&+&]:mt-1"
  >
    <!-- Trạng thái CI là thứ hàng này tồn tại để trả lời, nên nó đứng đầu và luôn
         chiếm chỗ — kể cả khi chưa theo dõi (ô trống giữ cột thẳng hàng). -->
    <Icon :name="ciIcon" class="mt-0.5 size-3.5" :class="ciClass" :title="ciTitle" />
    <div class="min-w-0">
      <!-- raw-ok: cả khối tiêu đề + meta là một vùng bấm mở PR (block, căn trái) -->
      <button
        class="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
        type="button"
        :title="hoverText"
        @click="emit('open')"
      >
        <!-- Chưa theo dõi = ứng viên, đọc nhạt hơn hàng đang theo dõi. -->
        <span
          class="block truncate text-base"
          :class="watched ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ title }}
        </span>
        <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span class="tabular-nums">#{{ number }}</span>
          <span v-if="reviewLabel" :class="{ 'text-destructive': needsChanges }">
            {{ reviewLabel }}
          </span>
          <span v-if="stateLabel" class="text-lavender">{{ stateLabel }}</span>
          <span
            v-if="failingCheck"
            class="max-w-[45%] truncate text-destructive"
            :title="failingCheck"
          >
            {{ failingCheck }}
          </span>
        </span>
      </button>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <!-- Đang theo dõi = accent-tint + viền accent, KHÔNG phải nền xám đặc. -->
        <Button
          variant="outline"
          size="xs"
          class="h-auto gap-1 rounded-sm px-1.5 py-0.5 font-normal"
          :class="
            watched
              ? 'border-ring bg-primary/15 text-primary'
              : 'text-muted-foreground hover:border-input hover:text-foreground'
          "
          :disabled="busy"
          :title="watched ? t('ghWatch.unwatchHint') : t('ghWatch.watchHint')"
          @click.stop="emit('toggle', !watched)"
        >
          <Icon :name="watched ? 'eye' : 'eye-off'" class="size-3" />
          <span>{{ watched ? t('ghWatch.unwatch') : t('ghWatch.watch') }}</span>
        </Button>
        <!-- Ai đang nghe. Một PR được theo dõi mà không gắn phiên nào thì chỉ là
             một cái badge — nói thẳng ra thay vì để người dùng đoán. -->
        <span
          v-if="watched"
          class="truncate text-xs"
          :class="sessionLabel ? 'text-muted-foreground' : 'text-faint'"
        >
          {{ sessionLabel ? t('ghWatch.boundTo', { name: sessionLabel }) : t('ghWatch.notBound') }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PrWatchItem } from '~/composables/usePrWatch'
import Button from '~/components/ui/button/Button.vue'

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
const ciClass = computed(() => {
  if (ci.value === 'pass') return 'text-success'
  if (ci.value === 'fail') return 'text-destructive'
  return ci.value === 'pending' ? 'text-warning' : 'text-faint'
})
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
