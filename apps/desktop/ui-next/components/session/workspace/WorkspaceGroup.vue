<template>
  <div class="wsgrp">
    <div v-if="!sorted.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.group.placeholder') }}</div>
    </div>

    <template v-else>
      <!-- Tổng kết một dòng: câu trả lời cho "tình hình thế nào" mà không phải đọc
           từng hàng. Ô nào bằng 0 thì không hiện — một hàng toàn số 0 chỉ tốn chỗ. -->
      <div class="wsgrp-sum">
        <span v-if="counts.running" class="wsgrp-cnt is-run">
          {{ t('sessions.workspace.group.running', { n: counts.running }) }}
        </span>
        <span v-if="counts.waiting" class="wsgrp-cnt is-wait">
          {{ t('sessions.workspace.group.waiting', { n: counts.waiting }) }}
        </span>
        <span v-if="counts.error" class="wsgrp-cnt is-err">
          {{ t('sessions.workspace.group.failed', { n: counts.error }) }}
        </span>
        <span v-if="counts.done" class="wsgrp-cnt">
          {{ t('sessions.workspace.group.done', { n: counts.done }) }}
        </span>
        <span v-if="counts.idle" class="wsgrp-cnt">
          {{ t('sessions.workspace.group.idle', { n: counts.idle }) }}
        </span>
      </div>

      <div class="wsgrp-list">
        <div v-for="row in sorted" :key="row.id" class="wsgrp-row" @click="open(row.id)">
          <span class="wsgrp-dot" :style="{ background: row.color }" :title="row.statusLabel" />
          <div class="wsgrp-main">
            <div class="wsgrp-head">
              <span class="wsgrp-title">{{ row.title }}</span>
              <span v-if="row.role" class="wsgrp-role">{{ row.role }}</span>
            </div>
            <div class="wsgrp-meta">
              <span>{{ row.statusLabel }}</span>
              <span>·</span>
              <span>{{ row.when }}</span>
              <span v-if="row.descendants">·</span>
              <span v-if="row.descendants">
                {{ t('sessions.workspace.group.subCount', { n: row.descendants }) }}
              </span>
            </div>
            <!-- Cái này là "ai đang KẸT": có tin nằm chờ mà không ai giao. Không có
                 dòng này thì một nhóm chưa bật tự giao (hoặc vừa chạm trần) đứng im mà
                 không chỗ nào nói vì sao. -->
            <div v-if="row.pending" class="wsgrp-stall">
              <Icon name="bell" style="width: var(--icon-xs); height: var(--icon-xs)" />
              <span>{{ t('sessions.workspace.group.pending', { n: row.pending }) }}</span>
              <button
                class="wsgrp-deliver"
                :disabled="!row.canDeliver"
                :title="
                  row.canDeliver ? t('sessionsInbox.deliverHint') : t('sessionsInbox.waiting')
                "
                @click.stop="deliver(row.engineId)"
              >
                {{ t('sessionsInbox.deliver') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Tab "Nhóm" — bảng trạng thái các phiên CON của phiên này (docs/features/session-groups.md).
//
// Thuần DẪN XUẤT từ store, KHÔNG có IPC mới: `sessions.list` đã mang `groupParentId`,
// `groupRole` và trạng thái nghỉ của mọi phiên, nên bảng này chỉ lọc + đếm. Trạng thái
// tự cập nhật theo store như mọi chỗ khác.
//
// Bảng này dành cho NGƯỜI DÙNG, nên nó được phép hiện mọi thứ họ vốn đã xem được (họ
// sở hữu cả nhóm). Tool `group_status` của model thì KHÁC: nó chỉ trả metadata, không
// trả nội dung phiên khác — xem runtime/tools/session-tools.ts.
import { computed } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import { useNow } from '~/composables/useNow'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionsData, type Session, type SessionStatus } from '~/composables/useSessionsData'
import { relativeTime } from '~/utils/relative-time'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const store = useSessionsStore()
const { STATUS_COLOR } = useSessionsData()
const now = useNow()

type Row = {
  id: number
  engineId: string
  title: string
  role: string
  status: SessionStatus
  statusLabel: string
  color: string
  when: string
  // Số con cháu của CHÍNH phiên con này (nhóm lồng nhau).
  descendants: number
  // Số tin đang nằm chờ người bấm giao.
  pending: number
  canDeliver: boolean
}

// Con TRỰC TIẾP của phiên này. Cháu không lên bảng — chúng thuộc bảng của cha chúng;
// ở đây chỉ hiện SỐ LƯỢNG để biết nhánh nào còn sâu.
const children = computed<Session[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  return store.sessions.filter((s) => s.groupParentId === eid)
})

// Đếm con cháu mọi tầng dưới `eid`. `seen` chặn chu trình có sẵn trên đĩa — cùng lý do
// đã viết ở useSessionTree.
function countDescendants(eid: string, seen: Set<string>): number {
  if (seen.has(eid)) return 0
  seen.add(eid)
  return store.sessions
    .filter((s) => s.groupParentId === eid)
    .reduce((n, k) => n + 1 + (k.engineId ? countDescendants(k.engineId, seen) : 0), 0)
}

const rows = computed<Row[]>(() =>
  children.value.map((s) => {
    const eid = s.engineId ?? ''
    const pending = eid ? store.pendingInboxFor(eid).length : 0
    return {
      id: s.id,
      engineId: eid,
      title: s.title,
      role: s.groupRole ?? '',
      status: s.status,
      statusLabel: t(`sessions.status.${s.status}`),
      color: STATUS_COLOR[s.status],
      when: s.updatedAt ? relativeTime(s.updatedAt, now.value) : s.when,
      descendants: eid ? countDescendants(eid, new Set()) : 0,
      pending,
      canDeliver: pending > 0 && eid ? store.canDeliverInbox(eid) : false,
    }
  }),
)

// `streaming` và `awaiting` lên trước: một phiên đang chạy hoặc đang chờ duyệt là thứ
// người dùng cần thấy, còn mấy phiên đã xong thì để phía dưới.
const WEIGHT: Record<SessionStatus, number> = {
  streaming: 0,
  awaiting: 1,
  error: 2,
  done: 3,
  idle: 4,
}
const sorted = computed(() => [...rows.value].sort((a, b) => WEIGHT[a.status] - WEIGHT[b.status]))

const counts = computed(() => ({
  running: rows.value.filter((r) => r.status === 'streaming').length,
  waiting: rows.value.filter((r) => r.status === 'awaiting').length,
  error: rows.value.filter((r) => r.status === 'error').length,
  done: rows.value.filter((r) => r.status === 'done').length,
  idle: rows.value.filter((r) => r.status === 'idle').length,
}))

function open(id: number) {
  store.setActive(id)
}
function deliver(engineId: string) {
  store.deliverInbox(engineId)
}
</script>

<style scoped>
.wsgrp {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.wsgrp-sum {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.wsgrp-cnt {
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wsgrp-cnt.is-run {
  border-color: var(--accentBorder);
  color: var(--accent);
}
.wsgrp-cnt.is-wait {
  border-color: var(--amberBorder);
  color: var(--amber);
}
.wsgrp-cnt.is-err {
  border-color: var(--danger);
  color: var(--danger);
}
.wsgrp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wsgrp-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.wsgrp-row:hover {
  border-color: var(--accentBorder);
  background: var(--bgHover);
}
.wsgrp-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
}
.wsgrp-main {
  min-width: 0;
  flex: 1;
}
.wsgrp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wsgrp-title {
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsgrp-role {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-pill);
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wsgrp-meta {
  display: flex;
  gap: 5px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wsgrp-stall {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wsgrp-deliver {
  padding: 1px 8px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--amber);
  cursor: pointer;
}
.wsgrp-deliver:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
