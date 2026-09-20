<template>
  <div class="tile monsec">
    <!-- Khối mồ côi nhúng bảng này mà không cần tiêu đề riêng (banner đã nói rồi),
         nên không có tiêu đề thì bỏ luôn cả hàng đầu thay vì để một dòng đếm lửng. -->
    <div v-if="title" class="monsech">
      <span class="monsect">{{ title }}</span>
      <span class="fd">{{ t('monitor.processes.count', { n: rows.length }) }}</span>
      <button
        v-if="sortable"
        class="btn mongroupbtn"
        :class="{ on: grouped }"
        @click="emit('toggle-group')"
      >
        <Icon name="layers" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('monitor.app.group') }}
      </button>
    </div>

    <div v-if="rows.length === 0" class="monempty">{{ t('monitor.processes.empty') }}</div>

    <table v-else class="montbl">
      <!-- Sắp xếp nằm Ở CHÍNH TIÊU ĐỀ CỘT: đó là chỗ người ta bấm theo phản xạ,
           và nó nói được cả CHIỀU (mũi tên) — thứ mà một cụm nút rời không nói được. -->
      <thead>
        <tr>
          <th :class="thCls('name')" @click="onSort('name')">
            {{ t('monitor.processes.col.process') }}
            <SortCaret :dir="caret('name')" />
          </th>
          <th class="num pid" :class="thCls('pid')" @click="onSort('pid')">
            PID
            <SortCaret :dir="caret('pid')" />
          </th>
          <th class="num cpu" :class="thCls('cpu')" @click="onSort('cpu')">
            {{ t('monitor.col.cpu') }}
            <SortCaret :dir="caret('cpu')" />
          </th>
          <!-- Cột GPU chỉ hiện khi nền tảng đo được theo tiến trình (macOS). Một
               cột toàn "—" chiếm chỗ của dòng lệnh mà không nói gì. -->
          <th v-if="showGpu" class="num gpu" :class="thCls('gpu')" @click="onSort('gpu')">
            {{ t('monitor.col.gpu') }}
            <SortCaret :dir="caret('gpu')" />
          </th>
          <th class="num mem" :class="thCls('mem')" @click="onSort('mem')">
            {{ t('monitor.col.mem') }}
            <SortCaret :dir="caret('mem')" />
          </th>
          <th class="num uptime" :class="thCls('uptime')" @click="onSort('uptime')">
            {{ t('monitor.processes.col.uptime') }}
            <SortCaret :dir="caret('uptime')" />
          </th>
          <th class="act" />
        </tr>
      </thead>
      <!-- Gom theo ứng dụng: một hàng cho mỗi app với tổng CPU/GPU/RAM, mở ra mới
           thấy từng tiến trình. Hai mươi dòng helper của Chrome không trả lời được
           câu "Chrome đang ăn bao nhiêu máy"; một dòng cộng lại thì có. -->
      <tbody v-if="grouped">
        <template v-for="g in appGroups" :key="g.app">
          <tr class="mongrouprow" @click="emit('toggle-app', g.app)">
            <td>
              <div class="monpnm">
                <Icon
                  name="chev"
                  class="mongroupchev"
                  :class="{ open: expandedApps.has(g.app) }"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
                <span class="monplbl" :title="g.app">{{ g.app }}</span>
              </div>
            </td>
            <!-- Số tiến trình nằm ở cột PID: hàng nhóm không có PID nên cột đó
                 đang bỏ không, mà nhét nó thành một tag cạnh tên thì bị cắt mất
                 ("2 tiến t") ở bề rộng panel thật. -->
            <td
              class="num pid tnum mongroupn"
              :title="t('monitor.app.procs', { n: g.procs.length })"
            >
              ×{{ g.procs.length }}
            </td>
            <td class="num cpu tnum" :style="{ color: levelColor(cpuLevel(g.cpuPercent)) }">
              {{ formatCpuLoad(g.cpuPercent) }}
            </td>
            <td
              v-if="showGpu"
              class="num gpu tnum"
              :style="{ color: levelColor(gpuLevel(g.gpuPercent)) }"
            >
              {{ g.gpuPercent === null || g.gpuPercent < 0.05 ? '—' : formatCpuLoad(g.gpuPercent) }}
            </td>
            <td class="num mem tnum" :style="{ color: levelColor(memLevel(g.rssKb, totalMemKb)) }">
              {{ formatMem(g.rssKb) }}
            </td>
            <td class="num uptime tnum" />
            <td class="act">
              <button
                v-if="g.killable"
                class="iconbtn monkill"
                :title="t('monitor.app.kill', { app: g.app })"
                @click.stop="emit('kill-app', g)"
              >
                <Icon name="stop" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </button>
            </td>
          </tr>
          <tr
            v-for="p in expandedApps.has(g.app) ? g.procs : []"
            :key="p.pid"
            class="mongroupchild"
          >
            <td>
              <div class="monpnm monpnmchild">
                <span class="monplbl" :title="p.label">{{ p.label }}</span>
              </div>
              <div class="monpmeta monpnmchild">
                <span v-if="p.sessionId" class="tag acc">{{ sessionTitle(p.sessionId) }}</span>
                <span class="monpcmd mono" :title="p.command">{{ p.command }}</span>
              </div>
            </td>
            <td class="num pid tnum">{{ p.pid }}</td>
            <td class="num cpu tnum" :style="{ color: levelColor(cpuLevel(p.cpuPercent)) }">
              {{ formatCpuLoad(p.cpuPercent) }}
            </td>
            <td
              v-if="showGpu"
              class="num gpu tnum"
              :style="{ color: levelColor(gpuLevel(p.gpuPercent)) }"
            >
              {{ p.gpuPercent === null || p.gpuPercent < 0.05 ? '—' : formatCpuLoad(p.gpuPercent) }}
            </td>
            <td class="num mem tnum" :style="{ color: levelColor(memLevel(p.rssKb, totalMemKb)) }">
              {{ formatMem(p.rssKb) }}
            </td>
            <td class="num uptime tnum">{{ formatUptime(p.elapsedSeconds) }}</td>
            <td class="act">
              <button
                v-if="canKill(p)"
                class="iconbtn monkill"
                :class="{ force: needsForce(p.pid) }"
                :disabled="killing === p.pid"
                :title="
                  needsForce(p.pid) ? t('monitor.processes.killForce') : t('monitor.processes.kill')
                "
                @click="emit('kill', p, needsForce(p.pid))"
              >
                <Icon
                  :name="needsForce(p.pid) ? 'zap' : 'stop'"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
              </button>
            </td>
          </tr>
        </template>
      </tbody>
      <tbody v-else>
        <tr v-for="p in rows" :key="p.pid">
          <td>
            <!-- Dòng 1 chỉ tên tiến trình. Nhồi cả tag vào đây thì ở bề rộng panel
                 thật (610px) tag bị cắt còn "cla…" — hiện một tag không đọc được
                 thì thà đừng hiện. -->
            <div class="monpnm">
              <span class="monplbl" :title="p.label">{{ p.label }}</span>
            </div>
            <!-- Dòng 2: tag (ngắn, hiện đủ) rồi tới dòng lệnh — thứ DUY NHẤT co được. -->
            <div class="monpmeta">
              <span v-if="p.model" class="tag">{{ p.model }}</span>
              <span v-if="p.sessionId" class="tag acc">{{ sessionTitle(p.sessionId) }}</span>
              <span v-if="p.orphan" class="tag warn">{{ t('monitor.processes.orphanTag') }}</span>
              <span class="monpcmd mono" :title="p.command">{{ p.command }}</span>
            </div>
          </td>
          <td class="num pid tnum">{{ p.pid }}</td>
          <!-- Màu theo MỨC, không theo một con số cứng: ngưỡng suy từ số lõi và
               RAM vật lý của máy đang đo (xem cpuLevel/memLevel). -->
          <td class="num cpu tnum" :style="{ color: levelColor(cpuLevel(p.cpuPercent)) }">
            {{ formatCpuLoad(p.cpuPercent) }}
          </td>
          <td
            v-if="showGpu"
            class="num gpu tnum"
            :style="{ color: levelColor(gpuLevel(p.gpuPercent)) }"
          >
            {{ p.gpuPercent === null || p.gpuPercent < 0.05 ? '—' : formatCpuLoad(p.gpuPercent) }}
          </td>
          <td class="num mem tnum" :style="{ color: levelColor(memLevel(p.rssKb, totalMemKb)) }">
            {{ formatMem(p.rssKb) }}
          </td>
          <td class="num uptime tnum">{{ formatUptime(p.elapsedSeconds) }}</td>
          <td class="act">
            <!-- SIGTERM đã gửi mà tiến trình vẫn còn ở nhịp sau ⇒ nút leo thang
                 lên SIGKILL. Không có đường này thì đúng loại tiến trình cần giết
                 nhất — cái đang quay tít nên không xử lý nổi tín hiệu — lại là cái
                 duy nhất giết không được. -->
            <button
              v-if="canKill(p)"
              class="iconbtn monkill"
              :class="{ force: needsForce(p.pid) }"
              :disabled="killing === p.pid"
              :title="
                needsForce(p.pid) ? t('monitor.processes.killForce') : t('monitor.processes.kill')
              "
              @click="emit('kill', p, needsForce(p.pid))"
            >
              <Icon
                :name="needsForce(p.pid) ? 'zap' : 'stop'"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  cpuLevel,
  formatCpuLoad,
  gpuLevel,
  formatMem,
  formatUptime,
  levelColor,
  memLevel,
  type AppGroup,
  type MonitorProcess,
  type MonitorSortKey,
  type SortDir,
} from '~/composables/useMonitorManager'

const props = defineProps<{
  title: string
  rows: MonitorProcess[]
  killing: number | null
  /** RAM vật lý của máy đang đo — ngưỡng màu của cột RAM suy từ đây. */
  totalMemKb: number
  canKill: (p: MonitorProcess) => boolean
  needsForce: (pid: number) => boolean
  sessionTitles: Map<string, string>
  sortKey?: MonitorSortKey
  sortDir?: SortDir
  sortable?: boolean
  grouped?: boolean
  groups?: AppGroup[]
  expanded?: Set<string>
}>()

// Khối mồ côi nhúng lại bảng này mà không truyền nhóm; mặc định rỗng để template
// khỏi phải phòng thủ `undefined` ở hai chỗ.
const expandedApps = computed(() => props.expanded ?? new Set<string>())
const appGroups = computed(() => props.groups ?? [])

const emit = defineEmits<{
  (e: 'kill', p: MonitorProcess, force: boolean): void
  (e: 'sort', key: MonitorSortKey): void
  (e: 'toggle-group'): void
  (e: 'toggle-app', app: string): void
  (e: 'kill-app', group: AppGroup): void
}>()

const { t } = useI18n()

const sessionTitle = (id: string): string => props.sessionTitles.get(id) ?? id

// Có ít nhất một tiến trình đo được GPU ⇒ nền tảng hỗ trợ. Không dựa vào
// `process.platform` ở renderer: máy đo có thể là máy từ xa qua SSH.
const showGpu = computed(() => props.rows.some((p) => p.gpuPercent !== null))

// Khối mồ côi nhúng lại bảng này mà KHÔNG sắp xếp được (nó có hai dòng và đã sắp
// theo CPU), nên tiêu đề ở đó không được giả vờ bấm được.
const onSort = (key: MonitorSortKey): void => {
  if (props.sortable) emit('sort', key)
}
const thCls = (key: MonitorSortKey) => ({
  sortable: props.sortable === true,
  on: props.sortable === true && props.sortKey === key,
})
const caret = (key: MonitorSortKey): SortDir | null =>
  props.sortable === true && props.sortKey === key ? (props.sortDir ?? 'desc') : null
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
  align-items: center;
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
  table-layout: fixed;
}
.montbl th {
  text-align: left;
  padding: 6px 10px;
  color: var(--textFaint);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.montbl th.sortable {
  cursor: pointer;
  user-select: none;
}
.montbl th.sortable:hover {
  color: var(--textDim);
}
.montbl th.on {
  color: var(--text);
}
/* Cột số vừa đủ chứa giá trị lớn nhất có thật (PID 7 chữ số, CPU "1000%",
   RAM "12.3 GB") — 84px đều nhau là hào phóng với số và keo kiệt với cột tên,
   mà cột tên mới là chỗ chứa dòng lệnh. */
.montbl th.num,
.montbl td.num {
  text-align: right;
}
.montbl th.pid,
.montbl td.pid {
  width: 72px;
}
.montbl th.cpu,
.montbl td.cpu {
  width: 66px;
}
.montbl th.gpu,
.montbl td.gpu {
  width: 62px;
}
.montbl th.mem,
.montbl td.mem {
  width: 78px;
}
/* Nhãn "Thời gian chạy" dài hơn ba cột số kia; 84px làm nó xuống hai dòng. */
.montbl th.uptime,
.montbl td.uptime {
  width: 92px;
}
.montbl th.act,
.montbl td.act {
  width: 36px;
  text-align: right;
}
.montbl td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
  vertical-align: top;
}
/* `table-layout: fixed` ấn định bề rộng ô, nhưng KHÔNG cắt nội dung tràn — hàng
   tag (model + tên phiên) dài ra là đè thẳng lên cột PID/CPU (đo được trên một
   dòng Claude CLI có tag phiên). Ô này phải tự cắt. */
.monpnm {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.monplbl {
  flex: 0 0 auto;
  color: var(--text);
  white-space: nowrap;
}
.monpmeta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  margin-top: 2px;
}
/* Tag giữ nguyên bề rộng thật — chúng ngắn; dòng lệnh là thứ nhường chỗ. */
.monpmeta > .tag {
  flex: 0 0 auto;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Dòng lệnh là thứ người dùng copy vào terminal để tra tiếp ⇒ mono hợp lệ. */
.monpcmd {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--code); /* mono-ok: dòng lệnh shell, copy-paste được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.monkill {
  width: 26px;
  height: 26px;
}
/* Hàng nhóm: bấm cả hàng để mở/đóng. */
.mongrouprow {
  cursor: pointer;
}
.mongrouprow:hover td {
  background: var(--bgHover);
}
.mongroupn {
  color: var(--textFaint);
}
.mongroupchev {
  flex: 0 0 auto;
  color: var(--textFaint);
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
}
.mongroupchev.open {
  transform: rotate(0deg);
}
/* Tiến trình con thụt vào để thấy ngay nó thuộc nhóm trên. */
.monpnmchild {
  padding-left: 20px;
}
.mongroupchild td {
  background: var(--bgHover);
}
.mongroupbtn {
  margin-left: auto;
}
.mongroupbtn.on {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.monkill:hover:not(:disabled) {
  color: var(--danger);
  background: var(--dangerBg);
}
/* Đã leo thang: nút đỏ sẵn, không chờ hover — lần bấm này khác hẳn lần trước. */
.monkill.force {
  color: var(--danger);
  background: var(--dangerBg);
}
</style>
