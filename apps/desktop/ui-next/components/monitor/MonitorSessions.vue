<template>
  <div class="tile monsec">
    <div class="monsech">
      <span class="monsect">{{ t('monitor.sessions.title') }}</span>
      <span class="fd">{{ t('monitor.sessions.count', { n: sessions.length }) }}</span>
    </div>

    <div v-if="sessions.length === 0" class="monempty">{{ t('monitor.sessions.empty') }}</div>

    <table v-else class="montbl">
      <thead>
        <tr>
          <th>{{ t('monitor.sessions.col.session') }}</th>
          <th class="num">{{ t('monitor.col.cpu') }}</th>
          <th class="num">{{ t('monitor.col.mem') }}</th>
          <th class="num">{{ t('monitor.sessions.col.procs') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="s in sessions"
          :key="s.sessionId"
          class="monrow"
          @click="emit('open', s.sessionId)"
        >
          <td>
            <div class="monsesnm">
              <span class="mondot" :class="{ on: s.running }" />
              <span class="monsest" :title="s.title">{{ s.title }}</span>
              <span class="tag" :class="{ warn: s.attribution !== 'own-process' }">
                {{ t(`monitor.sessions.attribution.${s.attribution}`) }}
              </span>
            </div>
            <!-- Phiên chạy trong engine/daemon dùng chung: nói rõ VÌ SAO cột CPU
                 trống, thay vì để người dùng tưởng phiên đang rảnh. -->
            <div v-if="s.attribution !== 'own-process'" class="monseshint">
              {{ t(`monitor.sessions.hint.${s.attribution}`) }}
            </div>
          </td>
          <!-- Màu chỉ có nghĩa khi con số là của ĐÚNG phiên này; phiên chạy trong
               engine dùng chung thì ô trống, tô màu ô trống là vô nghĩa. -->
          <td
            class="num tnum"
            :style="{ color: own(s) ? levelColor(cpuLevel(s.cpuPercent)) : undefined }"
          >
            {{ own(s) ? formatCpuLoad(s.cpuPercent) : '—' }}
          </td>
          <td
            class="num tnum"
            :style="{ color: own(s) ? levelColor(memLevel(s.rssKb, totalMemKb)) : undefined }"
          >
            {{ own(s) ? formatMem(s.rssKb) : '—' }}
          </td>
          <td class="num tnum">{{ s.pids.length }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import {
  cpuLevel,
  formatCpuLoad,
  formatMem,
  levelColor,
  memLevel,
  type MonitorSession,
} from '~/composables/useMonitorManager'

defineProps<{ sessions: MonitorSession[]; totalMemKb: number }>()
const emit = defineEmits<{ (e: 'open', sessionId: string): void }>()

const { t } = useI18n()

const own = (s: MonitorSession): boolean => s.attribution === 'own-process'
</script>

<style scoped>
.monsec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 4px;
}
.monsech {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.monsect {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.monempty {
  padding: 16px;
  text-align: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
  border: 1px dashed var(--border);
  border-radius: var(--r-card);
}
.montbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.montbl th {
  text-align: left;
  padding: 6px 10px;
  color: var(--textFaint);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
}
.montbl th.num,
.montbl td.num {
  text-align: right;
  width: 92px;
}
.montbl td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--borderSoft, var(--border));
  color: var(--textDim);
  vertical-align: top;
}
.monrow {
  cursor: pointer;
}
.monrow:hover td {
  background: var(--bgHover);
}
.monsesnm {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.monsest {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
.monseshint {
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.mondot {
  flex: 0 0 auto;
  width: 7px; /* design-token-ok: chấm trạng thái — con số px CHÍNH LÀ hình dạng */
  height: 7px; /* design-token-ok: như trên */
  border-radius: 50%;
  background: var(--textFaint);
}
.mondot.on {
  background: var(--accent);
}
</style>
