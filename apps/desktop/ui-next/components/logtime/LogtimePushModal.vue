<template>
  <Teleport to="body">
    <div v-if="pushOpen" class="ovl on ltp-ovl" @click.self="close">
      <div class="ltp-card" role="dialog" aria-modal="true" :aria-label="t('logtime.push.title')">
        <div class="ltp-head">
          <div>
            <div class="ltp-title">
              {{ done ? t('logtime.push.done') : t('logtime.push.title') }}
            </div>
            <div class="ltp-sub">
              {{ t('logtime.push.sub', { n: pushableDrafts.length, h: fmt(pushableHours) }) }}
            </div>
          </div>
          <span class="ltsp" />
          <button class="ltp-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="ltp-body">
          <!-- Cảnh báo thao tác RA NGOÀI: PMS là hệ thống thật của công ty. -->
          <div v-if="!done" class="ltp-warn">
            <Icon name="alert" class="ltp-warnic" />
            <span>{{ t('logtime.push.warn') }}</span>
          </div>
          <div v-else class="ltp-warn ok">
            <Icon name="check" class="ltp-warnic" />
            <span>{{ t('logtime.push.okNote', { n: okCount }) }}</span>
          </div>

          <div v-if="blockedDrafts.length > 0" class="ltp-warn bad">
            <Icon name="alert" class="ltp-warnic" />
            <span>{{ t('logtime.push.blocked', { n: blockedDrafts.length }) }}</span>
          </div>

          <!-- Từng dòng sẽ gửi, gom theo nguồn -->
          <div v-for="group in groups" :key="group.sourceId" class="ltp-grp">
            <div class="ltp-grph">
              <span class="ltp-gname">{{ group.name }}</span>
              <span class="ltp-gurl">{{ group.url }}</span>
              <span class="ltsp" />
              <span class="chip tnum">{{ group.entries.length }} · {{ fmt(group.hours) }}h</span>
            </div>
            <div v-for="entry in group.entries" :key="entry.id" class="ltp-row">
              <span class="ltp-pn">{{ labelOf(entry.projectKey) }} — {{ entry.note }}</span>
              <span class="ltp-ph tnum">{{ fmt(entry.hours) }}h</span>
              <span class="ltp-ps">
                <span v-if="resultOf(entry.id)?.ok" class="chip acc">
                  <Icon name="check" />
                  {{ shortId(resultOf(entry.id)?.worklogId) }}
                </span>
                <span
                  v-else-if="resultOf(entry.id)"
                  class="chip dgr"
                  :title="resultOf(entry.id)?.error"
                >
                  <Icon name="alert" />
                  {{ t('logtime.push.failed') }}
                </span>
                <span v-else-if="pushing" class="chip">{{ t('logtime.push.sending') }}</span>
                <span v-else class="chip">{{ t('logtime.push.ready') }}</span>
              </span>
            </div>
          </div>

          <!-- Payload dòng đầu: nhìn thấy đúng thứ sắp bay đi -->
          <template v-if="!done && firstPayload">
            <div class="ltp-sech">{{ t('logtime.push.payload') }}</div>
            <pre class="ltp-code">{{ firstPayload }}</pre>
          </template>

          <!-- Ô xác nhận: nút chỉ mở khoá khi người dùng tự tích -->
          <label v-if="!done" class="ltp-confirm">
            <input v-model="pushConfirmed" type="checkbox" />
            <span>
              {{ t('logtime.push.confirm', { n: pushableDrafts.length, h: fmt(pushableHours) }) }}
            </span>
          </label>
        </div>

        <div class="ltp-foot">
          <span class="ltp-hint">
            {{ done ? t('logtime.push.hintDone') : t('logtime.push.hint') }}
          </span>
          <span class="ltsp" />
          <button class="btn" type="button" @click="close">
            {{ done ? t('common.close') : t('common.cancel') }}
          </button>
          <button
            v-if="!done"
            class="btn pri"
            type="button"
            :disabled="!pushConfirmed || pushing || pushableDrafts.length === 0"
            @click="runPush"
          >
            {{ t('logtime.push.go', { n: pushableDrafts.length }) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp thoại đẩy — hai bước (xem lại → tích ô → gửi), ADR 0091 D-5. Chưa gọi gì
// lên PMS cho tới khi bấm nút cuối.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import type { LogtimeEntry } from '~/stores/logtime'

const { t } = useI18n()
const {
  store,
  date,
  pushOpen,
  pushConfirmed,
  pushResults,
  pushing,
  pushableDrafts,
  blockedDrafts,
  fmt,
  labelOf,
  runPush,
} = useLogtimeManager()

const done = computed(() => pushResults.value.length > 0 && !pushing.value)
const okCount = computed(() => pushResults.value.filter((r) => r.ok).length)
const pushableHours = computed(() => pushableDrafts.value.reduce((s, e) => s + e.hours, 0))

const groups = computed(() => {
  const out = new Map<
    string,
    { sourceId: string; name: string; url: string; entries: LogtimeEntry[]; hours: number }
  >()
  for (const entry of pushableDrafts.value) {
    const link = store.linkOf(entry.projectKey)
    if (!link) continue
    const cap = store.capabilities.find((c) => c.sourceId === link.sourceId)
    const group = out.get(link.sourceId) ?? {
      sourceId: link.sourceId,
      name: cap?.name ?? link.sourceId,
      url: cap?.url ?? '',
      entries: [],
      hours: 0,
    }
    group.entries.push(entry)
    group.hours += entry.hours
    out.set(link.sourceId, group)
  }
  return [...out.values()]
})

const resultOf = (id: string) => pushResults.value.find((r) => r.entryId === id)

const shortId = (id: string | undefined): string => (id ? `${id.slice(0, 8)}…` : '')

// Payload thật của dòng đầu — cùng shape với lời gọi `worklog_create` ở sidecar.
const firstPayload = computed(() => {
  const entry = pushableDrafts.value[0]
  if (!entry) return ''
  const link = store.linkOf(entry.projectKey)
  if (!link) return ''
  const url =
    link.githubRepo && entry.task?.issue
      ? `https://github.com/${link.githubRepo}/issues/${entry.task.issue}`
      : null
  return JSON.stringify(
    {
      tool: 'worklog_create',
      source: link.sourceId,
      projectId: link.pmsProjectId,
      date: date.value,
      hours: entry.hours,
      note: entry.note,
      taskIds: entry.task?.id ? [entry.task.id] : [],
      githubIssueUrls: url ? [url] : [],
    },
    null,
    2,
  )
})

function close(): void {
  pushOpen.value = false
}
</script>

<style scoped>
.ltp-ovl {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.ltp-card {
  background: var(--bgPanel);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 680px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ltp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  box-shadow: inset 0 -1px 0 var(--border);
  flex: 0 0 auto;
}
.ltp-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}
.ltp-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltsp {
  flex: 1;
}
.ltp-x {
  width: 28px;
  height: 28px;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltp-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltp-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ltp-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  border-radius: var(--r-btn);
  padding: 10px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.ltp-warn.ok {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.ltp-warn.bad {
  border-color: var(--dangerBorder);
  background: var(--dangerBg);
}
.ltp-warnic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--amber);
}
.ltp-warn.ok .ltp-warnic {
  color: var(--accent);
}
.ltp-warn.bad .ltp-warnic {
  color: var(--danger);
}
.ltp-grp {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  overflow: hidden;
}
.ltp-grph {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 9px 11px;
  background: var(--bgSubtle);
  box-shadow: inset 0 -1px 0 var(--border);
}
.ltp-gname {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.ltp-gurl {
  font-family: var(--code); /* mono-ok: URL endpoint MCP, người dùng copy được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  word-break: break-all;
}
.ltp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 9px;
  align-items: center;
  padding: 9px 11px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ltp-pn {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ltp-ph {
  color: var(--textDim);
}
.ltp-sech {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.ltp-code {
  margin: 0;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
  font-family: var(--code); /* mono-ok: payload JSON gửi đi, copy được */
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
  overflow-x: auto;
}
.ltp-confirm {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  padding: 11px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  cursor: pointer;
}
.ltp-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 11px 16px;
  box-shadow: inset 0 1px 0 var(--border);
  flex: 0 0 auto;
}
.ltp-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
