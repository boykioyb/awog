<template>
  <Card class="gap-2 px-3.5 pt-3 pb-1">
    <!-- Khối mồ côi nhúng bảng này mà không cần tiêu đề riêng (banner đã nói rồi),
         nên không có tiêu đề thì bỏ luôn cả hàng đầu thay vì để một dòng đếm lửng. -->
    <div v-if="title" class="flex items-center gap-2">
      <span class="text-base text-foreground">{{ title }}</span>
      <span class="text-sm text-dim">{{ t('monitor.processes.count', { n: rows.length }) }}</span>
      <Button
        v-if="sortable"
        class="ml-auto"
        :class="{ 'border-selected-border text-primary': grouped }"
        variant="outline"
        @click="emit('toggle-group')"
      >
        <Icon name="layers" class="size-3.5" />
        {{ t('monitor.app.group') }}
      </Button>
    </div>

    <div
      v-if="rows.length === 0"
      class="rounded-xl border border-dashed p-4 text-center text-sm text-faint"
    >
      {{ t('monitor.processes.empty') }}
    </div>

    <!-- `table-fixed` ấn định bề rộng ô. Cột số vừa đủ chứa giá trị lớn nhất có thật
         (PID 7 chữ số, CPU "1000%", RAM "12.3 GB"); nhãn "Thời gian chạy" dài hơn ba
         cột số kia nên cột đó rộng hơn để khỏi xuống hai dòng. -->
    <Table v-else class="table-fixed">
      <!-- Sắp xếp nằm Ở CHÍNH TIÊU ĐỀ CỘT: đó là chỗ người ta bấm theo phản xạ,
           và nó nói được cả CHIỀU (mũi tên) — thứ mà một cụm nút rời không nói được. -->
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint"
            :class="thCls('name')"
            @click="onSort('name')"
          >
            {{ t('monitor.processes.col.process') }}
            <SortCaret :dir="caret('name')" />
          </TableHead>
          <TableHead
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-18 text-right"
            :class="thCls('pid')"
            @click="onSort('pid')"
          >
            PID
            <SortCaret :dir="caret('pid')" />
          </TableHead>
          <TableHead
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-16.5 text-right"
            :class="thCls('cpu')"
            @click="onSort('cpu')"
          >
            {{ t('monitor.col.cpu') }}
            <SortCaret :dir="caret('cpu')" />
          </TableHead>
          <!-- Cột GPU chỉ hiện khi nền tảng đo được theo tiến trình (macOS). Một
               cột toàn "—" chiếm chỗ của dòng lệnh mà không nói gì. -->
          <TableHead
            v-if="showGpu"
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-15.5 text-right"
            :class="thCls('gpu')"
            @click="onSort('gpu')"
          >
            {{ t('monitor.col.gpu') }}
            <SortCaret :dir="caret('gpu')" />
          </TableHead>
          <TableHead
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-19.5 text-right"
            :class="thCls('mem')"
            @click="onSort('mem')"
          >
            {{ t('monitor.col.mem') }}
            <SortCaret :dir="caret('mem')" />
          </TableHead>
          <TableHead
            class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-23 text-right"
            :class="thCls('uptime')"
            @click="onSort('uptime')"
          >
            {{ t('monitor.processes.col.uptime') }}
            <SortCaret :dir="caret('uptime')" />
          </TableHead>
          <TableHead class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-9 text-right" />
        </TableRow>
      </TableHeader>
      <!-- Gom theo ứng dụng: một hàng cho mỗi app với tổng CPU/GPU/RAM, mở ra mới
           thấy từng tiến trình. Hai mươi dòng helper của Chrome không trả lời được
           câu "Chrome đang ăn bao nhiêu máy"; một dòng cộng lại thì có. -->
      <TableBody v-if="grouped">
        <template v-for="g in appGroups" :key="g.app">
          <!-- Hàng nhóm: bấm cả hàng để mở/đóng. -->
          <TableRow class="cursor-pointer hover:bg-accent" @click="emit('toggle-app', g.app)">
            <TableCell class="px-2.5 py-2 align-top text-dim">
              <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <Icon
                  name="chev"
                  class="size-3.5 shrink-0 text-faint transition-transform"
                  :class="expandedApps.has(g.app) ? 'rotate-0' : '-rotate-90'"
                />
                <span class="shrink-0 whitespace-nowrap text-foreground" :title="g.app">
                  {{ g.app }}
                </span>
              </div>
            </TableCell>
            <!-- Số tiến trình nằm ở cột PID: hàng nhóm không có PID nên cột đó
                 đang bỏ không, mà nhét nó thành một tag cạnh tên thì bị cắt mất
                 ("2 tiến t") ở bề rộng panel thật. -->
            <TableCell
              class="px-2.5 py-2 align-top text-dim w-18 text-right tabular-nums text-faint"
              :title="t('monitor.app.procs', { n: g.procs.length })"
            >
              ×{{ g.procs.length }}
            </TableCell>
            <TableCell
              class="px-2.5 py-2 align-top text-dim w-16.5 text-right tabular-nums"
              :class="levelText(cpuLevel(g.cpuPercent))"
            >
              {{ formatCpuLoad(g.cpuPercent) }}
            </TableCell>
            <TableCell
              v-if="showGpu"
              class="px-2.5 py-2 align-top text-dim w-15.5 text-right tabular-nums"
              :class="levelText(gpuLevel(g.gpuPercent))"
            >
              {{ g.gpuPercent === null || g.gpuPercent < 0.05 ? '—' : formatCpuLoad(g.gpuPercent) }}
            </TableCell>
            <TableCell
              class="px-2.5 py-2 align-top text-dim w-19.5 text-right tabular-nums"
              :class="levelText(memLevel(g.rssKb, totalMemKb))"
            >
              {{ formatMem(g.rssKb) }}
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-23 text-right tabular-nums" />
            <TableCell class="px-2.5 py-2 align-top text-dim w-9 text-right">
              <Button
                v-if="g.killable"
                :title="t('monitor.app.kill', { app: g.app })"
                class="size-6.5 hover:bg-destructive/10 hover:text-destructive"
                variant="outline"
                size="iconSm"
                @click.stop="emit('kill-app', g)"
              >
                <Icon name="stop" />
              </Button>
            </TableCell>
          </TableRow>
          <!-- Tiến trình con thụt vào (pl-5) để thấy ngay nó thuộc nhóm trên. -->
          <TableRow
            v-for="p in expandedApps.has(g.app) ? g.procs : []"
            :key="p.pid"
            class="bg-accent hover:bg-accent"
          >
            <TableCell class="px-2.5 py-2 align-top text-dim">
              <div class="flex min-w-0 items-center gap-1.5 overflow-hidden pl-5">
                <span class="shrink-0 whitespace-nowrap text-foreground" :title="p.label">
                  {{ p.label }}
                </span>
              </div>
              <div class="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden pl-5">
                <Badge
                  v-if="p.sessionId"
                  variant="outline"
                  class="max-w-[38%] shrink-0 truncate rounded-sm border-primary/40 bg-primary/10 text-primary"
                >
                  {{ sessionTitle(p.sessionId) }}
                </Badge>
                <span
                  class="min-w-0 flex-1 truncate font-mono text-xs text-faint"
                  :title="p.command"
                >
                  {{ p.command }}
                </span>
              </div>
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-18 text-right tabular-nums">
              {{ p.pid }}
            </TableCell>
            <TableCell
              class="px-2.5 py-2 align-top text-dim w-16.5 text-right tabular-nums"
              :class="levelText(cpuLevel(p.cpuPercent))"
            >
              {{ formatCpuLoad(p.cpuPercent) }}
            </TableCell>
            <TableCell
              v-if="showGpu"
              class="px-2.5 py-2 align-top text-dim w-15.5 text-right tabular-nums"
              :class="levelText(gpuLevel(p.gpuPercent))"
            >
              {{ p.gpuPercent === null || p.gpuPercent < 0.05 ? '—' : formatCpuLoad(p.gpuPercent) }}
            </TableCell>
            <TableCell
              class="px-2.5 py-2 align-top text-dim w-19.5 text-right tabular-nums"
              :class="levelText(memLevel(p.rssKb, totalMemKb))"
            >
              {{ formatMem(p.rssKb) }}
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-23 text-right tabular-nums">
              {{ formatUptime(p.elapsedSeconds) }}
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-9 text-right">
              <Button
                v-if="canKill(p)"
                :disabled="killing === p.pid"
                :title="
                  needsForce(p.pid) ? t('monitor.processes.killForce') : t('monitor.processes.kill')
                "
                class="size-6.5 hover:bg-destructive/10 hover:text-destructive"
                :class="{ 'bg-destructive/10 text-destructive': needsForce(p.pid) }"
                variant="outline"
                size="iconSm"
                @click="emit('kill', p, needsForce(p.pid))"
              >
                <Icon :name="needsForce(p.pid) ? 'zap' : 'stop'" />
              </Button>
            </TableCell>
          </TableRow>
        </template>
      </TableBody>
      <TableBody v-else>
        <TableRow v-for="p in rows" :key="p.pid" class="hover:bg-transparent">
          <TableCell class="px-2.5 py-2 align-top text-dim">
            <!-- Dòng 1 chỉ tên tiến trình. Nhồi cả tag vào đây thì ở bề rộng panel
                 thật (610px) tag bị cắt còn "cla…" — hiện một tag không đọc được
                 thì thà đừng hiện. `table-fixed` KHÔNG cắt nội dung tràn nên ô tự
                 cắt (overflow-hidden), kẻo hàng tag đè lên cột PID/CPU. -->
            <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <span class="shrink-0 whitespace-nowrap text-foreground" :title="p.label">
                {{ p.label }}
              </span>
            </div>
            <!-- Dòng 2: tag (ngắn, hiện đủ) rồi tới dòng lệnh — thứ DUY NHẤT co được.
                 Dòng lệnh là thứ người dùng copy vào terminal ⇒ mono hợp lệ. -->
            <div class="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
              <Badge
                v-if="p.model"
                variant="outline"
                class="max-w-[38%] shrink-0 truncate rounded-sm text-muted-foreground"
              >
                {{ p.model }}
              </Badge>
              <Badge
                v-if="p.sessionId"
                variant="outline"
                class="max-w-[38%] shrink-0 truncate rounded-sm border-primary/40 bg-primary/10 text-primary"
              >
                {{ sessionTitle(p.sessionId) }}
              </Badge>
              <Badge
                v-if="p.orphan"
                variant="outline"
                class="max-w-[38%] shrink-0 truncate rounded-sm border-warning/40 text-warning"
              >
                {{ t('monitor.processes.orphanTag') }}
              </Badge>
              <span class="min-w-0 flex-1 truncate font-mono text-xs text-faint" :title="p.command">
                {{ p.command }}
              </span>
            </div>
          </TableCell>
          <TableCell class="px-2.5 py-2 align-top text-dim w-18 text-right tabular-nums">
            {{ p.pid }}
          </TableCell>
          <!-- Màu theo MỨC, không theo một con số cứng: ngưỡng suy từ số lõi và
               RAM vật lý của máy đang đo (xem cpuLevel/memLevel). -->
          <TableCell
            class="px-2.5 py-2 align-top text-dim w-16.5 text-right tabular-nums"
            :class="levelText(cpuLevel(p.cpuPercent))"
          >
            {{ formatCpuLoad(p.cpuPercent) }}
          </TableCell>
          <TableCell
            v-if="showGpu"
            class="px-2.5 py-2 align-top text-dim w-15.5 text-right tabular-nums"
            :class="levelText(gpuLevel(p.gpuPercent))"
          >
            {{ p.gpuPercent === null || p.gpuPercent < 0.05 ? '—' : formatCpuLoad(p.gpuPercent) }}
          </TableCell>
          <TableCell
            class="px-2.5 py-2 align-top text-dim w-19.5 text-right tabular-nums"
            :class="levelText(memLevel(p.rssKb, totalMemKb))"
          >
            {{ formatMem(p.rssKb) }}
          </TableCell>
          <TableCell class="px-2.5 py-2 align-top text-dim w-23 text-right tabular-nums">
            {{ formatUptime(p.elapsedSeconds) }}
          </TableCell>
          <TableCell class="px-2.5 py-2 align-top text-dim w-9 text-right">
            <!-- SIGTERM đã gửi mà tiến trình vẫn còn ở nhịp sau ⇒ nút leo thang
                 lên SIGKILL (đỏ sẵn, không chờ hover). Không có đường này thì đúng
                 loại tiến trình cần giết nhất — cái đang quay tít nên không xử lý
                 nổi tín hiệu — lại là cái duy nhất giết không được. -->
            <Button
              v-if="canKill(p)"
              :disabled="killing === p.pid"
              :title="
                needsForce(p.pid) ? t('monitor.processes.killForce') : t('monitor.processes.kill')
              "
              class="size-6.5 hover:bg-destructive/10 hover:text-destructive"
              :class="{ 'bg-destructive/10 text-destructive': needsForce(p.pid) }"
              variant="outline"
              size="iconSm"
              @click="emit('kill', p, needsForce(p.pid))"
            >
              <Icon :name="needsForce(p.pid) ? 'zap' : 'stop'" />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Button from '~/components/ui/button/Button.vue'
import {
  cpuLevel,
  formatCpuLoad,
  gpuLevel,
  formatMem,
  formatUptime,
  memLevel,
  type AppGroup,
  type MonitorProcess,
  type MonitorSortKey,
  type SortDir,
} from '~/composables/useMonitorManager'
import { levelText } from './monitor-level'

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
const thCls = (key: MonitorSortKey) => {
  if (props.sortable !== true) return undefined
  return props.sortKey === key
    ? 'cursor-pointer select-none text-foreground'
    : 'cursor-pointer select-none hover:text-dim'
}
const caret = (key: MonitorSortKey): SortDir | null =>
  props.sortable === true && props.sortKey === key ? (props.sortDir ?? 'desc') : null
</script>
