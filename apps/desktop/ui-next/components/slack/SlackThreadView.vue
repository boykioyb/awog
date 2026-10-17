<template>
  <div v-if="thread" class="flex min-h-0 min-w-0 flex-1 flex-col">
    <SlackThreadHeader :thread="thread" />

    <div v-if="thread.error" class="slk-err">
      <Icon name="alert" />
      {{ t(`slack.thread.error.${thread.error}`) }}
    </div>

    <div class="relative flex min-h-0 flex-1 flex-col">
      <div ref="bodyRef" class="slk-body" @scroll.passive="onScroll">
        <div v-if="!detail" class="slk-empty">
          {{ ctx.store.detailLoading ? t('slack.thread.loading') : t('slack.thread.notLoaded') }}
        </div>
        <template v-else>
          <template v-for="row in ctx.rows.value" :key="row.m.ts">
            <SlackMessage :row="row" :team-id="thread.teamId" :project-id="thread.projectId" />
            <template v-if="row.m.isParent">
              <div class="slk-divider">
                <span>{{ t('slack.thread.replies', { n: thread.replyCount }) }}</span>
              </div>
              <div v-if="ctx.store.olderCursor" class="flex justify-center pb-2">
                <Button
                  variant="ghost"
                  size="xs"
                  :disabled="ctx.store.loadingOlder"
                  @click="loadOlderKeepingPosition"
                >
                  {{
                    ctx.store.loadingOlder ? t('slack.thread.loading') : t('slack.thread.loadOlder')
                  }}
                </Button>
              </div>
            </template>
          </template>
        </template>
      </div>
      <!-- Nhảy nhanh: chỉ hiện nút khi KHÔNG đang ở đúng mép đó. -->
      <div v-if="detail && (!atTop || !atBottom)" class="slk-jump">
        <Button
          v-if="!atTop"
          variant="outline"
          size="iconMd"
          class="slk-jump-btn"
          :title="t('slack.thread.jumpOldest')"
          :aria-label="t('slack.thread.jumpOldest')"
          @click="jumpTo('top')"
        >
          <Icon name="arrow-up" />
        </Button>
        <Button
          v-if="!atBottom"
          variant="outline"
          size="iconMd"
          class="slk-jump-btn"
          :title="t('slack.thread.jumpLatest')"
          :aria-label="t('slack.thread.jumpLatest')"
          @click="jumpTo('bottom')"
        >
          <Icon name="arrow-up" class="rotate-180" />
        </Button>
      </div>
    </div>

    <SlackComposer v-if="!thread.error" :thread="thread" />
  </div>
  <div v-else class="slk-empty flex-1">
    <Icon name="message" class="slk-empty-ic" />
    <div>{{ t('slack.thread.pick') }}</div>
  </div>
</template>

<script setup lang="ts">
// Khung phải: thread đang chọn — đầu (tiêu đề + nút), tin gốc, đường kẻ "N replies",
// các reply (gộp tin liên tiếp), nút nhảy đầu/đáy và ô trả lời. Project + menu "…" nằm
// ở header (SlackThreadHeader).
//
// Cuộn: sidecar trả reply MỚI NHẤT trước, nên mở thread là cuộn xuống đáy. Reply cũ hơn
// chỉ nạp khi bấm "Tải reply cũ hơn" (không tự nạp khi cuộn) và giữ nguyên chỗ đang đọc
// (bù theo khoảng cách tới đáy).
// Reply mới tới lúc đang ở đáy thì bám đáy; đang đọc phía trên thì để yên.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useSlackCtx } from '~/composables/useSlackManager'

// Cách mép bao nhiêu px thì coi là "ở đầu" (nạp cũ hơn) / "ở đáy" (bám reply mới).
const EDGE_PX = 120

const { t } = useI18n()
const ctx = useSlackCtx()
const thread = computed(() => ctx.selected.value)
const detail = computed(() => ctx.detail.value)
const bodyRef = useTemplateRef<HTMLElement>('bodyRef')

const nearBottom = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight < EDGE_PX

// Nút nhảy về đầu (tin gốc = tin cũ nhất của thread) / đáy (reply mới nhất). Trạng thái
// mép cập nhật theo cuộn; nội dung đổi (nạp thêm, reply mới) cũng phải tính lại.
const atTop = ref(true)
const atBottom = ref(true)
function updateEdges(): void {
  const el = bodyRef.value
  if (!el) return
  atTop.value = el.scrollTop < EDGE_PX
  atBottom.value = nearBottom(el)
}
function onScroll(): void {
  updateEdges()
}
function jumpTo(edge: 'top' | 'bottom'): void {
  const el = bodyRef.value
  if (!el) return
  el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}
watch(
  () => [detail.value?.thread.id, detail.value?.messages.length] as const,
  async () => {
    await nextTick()
    updateEdges()
  },
)

async function loadOlderKeepingPosition(): Promise<void> {
  const el = bodyRef.value
  if (!el) return
  const fromBottom = el.scrollHeight - el.scrollTop
  if (!(await ctx.loadOlder())) return
  await nextTick()
  el.scrollTop = el.scrollHeight - fromBottom
}

let shownThread: string | null = null
watch(
  () => [detail.value?.thread.id ?? null, detail.value?.messages.at(-1)?.ts ?? null] as const,
  async ([id]) => {
    const el = bodyRef.value
    const switched = id !== shownThread
    const stick = switched || (el ? nearBottom(el) : true)
    shownThread = id
    if (!stick) return
    await nextTick()
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  },
  { flush: 'pre' },
)
</script>

<style scoped>
.slk-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0 8px;
}
/* Nút nhảy nổi góc dưới phải khung đọc, trên ô soạn. */
.slk-jump {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.slk-jump-btn {
  background: var(--bgPanel);
  box-shadow: var(--shadow-md);
}
.slk-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 20px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.slk-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.slk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.slk-empty-ic {
  width: var(--icon-xl);
  height: var(--icon-xl);
  color: var(--textFaint);
}
.slk-err {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
