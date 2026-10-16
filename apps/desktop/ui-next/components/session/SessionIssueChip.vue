<template>
  <!-- Chip issue của phiên (docs/features/session-issue-tracking.md) — cùng khuôn chip
       SSH/hạ tầng trong SessionContextStrip: một chip mở popover của chính nó. Phiên
       chưa có issue (chưa gửi tin nào) hoặc không có project thì chip VẮNG MẶT. -->
  <span v-if="item" class="iswrap">
    <button
      ref="chipEl"
      type="button"
      class="ctxchip"
      :class="{ on: open }"
      :title="`${statusLabel(item.status)} · ${item.title}`"
      @click.stop="open = !open"
    >
      <!-- Gọn: chỉ chấm màu + status, KHÔNG title issue — issue tự sinh mang đúng
           title của phiên (đã nằm ngay bên trái header), lặp lại chỉ đẩy status
           vào chỗ bị cắt "Đa…". Title đầy đủ ở tooltip + đầu popover. -->
      <span class="isdot" :style="{ background: statusColor(item.status) }" />
      <span class="islbl">{{ statusLabel(item.status) }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>

    <Teleport to="body">
      <div v-if="open" class="isbackdrop" @click="open = false" />
      <div v-if="open" ref="popEl" class="pop ispop" :style="popStyle" @click.stop>
        <div class="ishead">
          <span class="istitle">{{ item.title }}</span>
          <span class="isid">{{ item.id }}</span>
        </div>

        <div class="pl">{{ t('sessions.issue.status') }}</div>
        <div class="isgrid">
          <button
            v-for="st in ISSUE_QUICK_STATUSES"
            :key="st"
            type="button"
            class="isst"
            :class="{ cur: item.status === st }"
            @click="onStatus(st)"
          >
            <span class="isdot" :style="{ background: statusColor(st) }" />
            {{ statusLabel(st) }}
          </button>
        </div>

        <div class="isrecap-h">
          <span class="pl">
            {{
              item.recap
                ? t('sessions.issue.recapAt', { when: fmtWhen(item.recap.at) })
                : t('sessions.issue.recap')
            }}
          </span>
          <button type="button" class="islink" :disabled="recapping" @click="recap()">
            {{
              recapping
                ? t('sessions.issue.recapRunning')
                : item.recap
                  ? t('sessions.issue.recapRefresh')
                  : t('sessions.issue.recapRun')
            }}
          </button>
        </div>
        <div class="isrecap">
          <IssueRecapView v-if="item.recap" :text="item.recap.text" />
          <p v-else class="ishint">{{ t('sessions.issue.recapEmpty') }}</p>
        </div>

        <button type="button" class="ctxpop-act" @click="onOpenBoard">
          <Icon name="board" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.issue.openBoard') }}
        </button>
        <button type="button" class="ctxpop-act danger" @click="onUntrack">
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.issue.untrack') }}
        </button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import type { Session } from '~/composables/useSessionsData'
import type { BoardItemStatus } from '~/stores/board'
import { ISSUE_QUICK_STATUSES } from '~/composables/useIssueStatus'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { statusLabel, statusColor } = useIssueStatus()
const { item, recapping, recap, setStatus, openOnBoard, untrack } = useSessionIssue(
  () => props.session,
)

const open = ref(false)
const chipEl = useTemplateRef<HTMLElement>('chipEl')
const popEl = useTemplateRef<HTMLElement>('popEl')
const { style: popStyle } = usePopoverAnchor(chipEl, popEl, open)

// Popover đóng TRƯỚC khi mở hộp thoại ghi chú / xác nhận — hai lớp phủ chồng nhau
// thì backdrop của chip nuốt click của hộp thoại.
function onStatus(st: BoardItemStatus): void {
  open.value = false
  void setStatus(st)
}
function onOpenBoard(): void {
  open.value = false
  openOnBoard()
}
function onUntrack(): void {
  open.value = false
  void untrack()
}

const fmtWhen = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<style scoped>
.iswrap {
  position: relative;
  display: inline-flex;
  /* Không co: chip đã ngắn (chấm + một chữ status) — để hàng chật thì chip khác
     (hạ tầng, checklist) cắt chữ của chúng, đừng cắt status ra "Đa…". */
  flex: 0 0 auto;
}
.islbl {
  white-space: nowrap;
}
/* Chấm màu status — hình dạng chính là thông tin, không phải chữ. */
.isdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ispop {
  width: 320px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  background: var(--popover);
  border-color: var(--border);
  border-radius: var(--radius);
}
.ishead {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}
.istitle {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--popover-foreground);
}
.isid {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
}
.isgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin: 4px 0 10px;
}
.isst {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--popover-foreground);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: left;
  cursor: pointer;
}
.isst:hover {
  background: var(--accent-wash);
}
/* Status hiện tại = accent-tint, không nền xám đặc. */
.isst.cur {
  background: var(--accentDim);
  border-color: var(--accentBorder);
}
.isst:focus-visible,
.islink:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.isrecap-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.islink {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--primary);
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.islink:disabled {
  color: var(--muted-foreground);
  cursor: default;
}
.isrecap {
  margin: 4px 0 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  color: var(--popover-foreground);
}
.ishint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
/* Hàng hành động — cùng nhịp với popover SSH của SessionContextStrip. */
.ctxpop-act {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  border-radius: var(--r-xs);
  color: var(--popover-foreground);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  text-align: left;
}
.ctxpop-act:hover {
  background: var(--accent-wash);
}
.ctxpop-act.danger {
  color: var(--destructive);
}
.ctxpop-act .icn {
  flex: 0 0 auto;
}
.isbackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
</style>
