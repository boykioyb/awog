<template>
  <!-- Khung output của một pod — log hoặc `describe` — trong MỘT modal có hai tab.
       Vì sao modal: log là văn bản dài, để nó nằm trong dòng chảy của trang thì
       hoặc bị cắt, hoặc đẩy cả trang phải cuộn. Trong modal, `pre` là vùng duy nhất
       cuộn và nó lấp hết phần thân.

       Nó cố ý KHÔNG stream (`kubectl logs -f` là tiến trình sống, việc của tab Logs
       trong Workspace Panel — P2 việc 21). Ở đây là ảnh chụp có nút ↻: đọc xong,
       không để lại tiến trình nào chạy nền. -->
  <Teleport to="body">
    <div v-if="out.open" class="ikm-ovl" @click.self="kube.closeOut()">
      <div class="ikm-card wide" role="dialog" aria-modal="true">
        <div class="ikm-head">
          <span class="ikm-title">
            <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ out.pod }}
          </span>
          <span class="iksec-sub">{{ out.title }}</span>

          <div class="ikm-actions">
            <!-- Hai tab của cùng một pod: log và mô tả. `setOutMode` gọi lại đúng
                 op của tab vừa chọn; số dòng đã chọn được giữ nguyên. -->
            <!-- Khoá khi đang nạp: bấm tab khác giữa chừng là hai lệnh chồng nhau
                 trên cùng một khung. -->
            <div class="seg" :class="{ ikoff: out.loading }" role="tablist">
              <span
                role="button"
                tabindex="0"
                :class="{ on: out.mode === 'logs' }"
                @click="kube.setOutMode('logs')"
                @keydown.enter.prevent="kube.setOutMode('logs')"
                @keydown.space.prevent="kube.setOutMode('logs')"
              >
                {{ t('infra.kube.out.tabLogs') }}
              </span>
              <span
                role="button"
                tabindex="0"
                :class="{ on: out.mode === 'describe' }"
                @click="kube.setOutMode('describe')"
                @keydown.enter.prevent="kube.setOutMode('describe')"
                @keydown.space.prevent="kube.setOutMode('describe')"
              >
                {{ t('infra.kube.act.describe') }}
              </span>
              <span
                role="button"
                tabindex="0"
                :class="{ on: out.mode === 'terminal' }"
                @click="kube.setOutMode('terminal')"
                @keydown.enter.prevent="kube.setOutMode('terminal')"
                @keydown.space.prevent="kube.setOutMode('terminal')"
              >
                {{ t('infra.kube.out.tabTerminal') }}
              </span>
            </div>

            <AppSelect
              v-if="out.mode === 'logs' && out.containers.length"
              :model-value="out.container"
              :options="containerOptions"
              width="auto"
              :disabled="out.loading"
              @update:model-value="kube.setContainer"
            />
            <AppSelect
              v-if="out.mode === 'logs'"
              :model-value="String(out.tail)"
              :options="tailOptions"
              width="auto"
              :disabled="out.loading"
              @update:model-value="onTail"
            />
            <!-- `--since` là bộ lọc của CLUSTER: đổi nó là chạy lại `kubectl logs`.
                 Nó đứng cạnh ô số dòng vì cả hai trả lời cùng một câu — "lấy về bao
                 nhiêu" — còn hai bộ lọc bên dưới chỉ xén thứ đã lấy về. Cần dòng cũ
                 hơn `--tail` cho phép thì đây là đường duy nhất. -->
            <AppSelect
              v-if="out.mode === 'logs'"
              :model-value="out.since"
              :options="sinceOptions"
              width="auto"
              :disabled="out.loading"
              @update:model-value="kube.setSince"
            />
            <button
              v-if="out.mode !== 'terminal'"
              type="button"
              class="btn"
              :disabled="out.loading"
              :title="t('infra.kube.refresh')"
              @click="kube.refreshOut()"
            >
              <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button type="button" class="btn" :title="t('common.close')" @click="kube.closeOut()">
              <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
          </div>
        </div>

        <div class="ikm-body">
          <!-- Ảnh chụp log/mô tả: TOÀN BỘ khối này ẩn ở tab Terminal — terminal là
               một component sống (xterm + PTY), không dùng `out.text`. -->
          <template v-if="out.mode !== 'terminal'">
            <!-- Dòng lệnh đã chạy: có ích khi cần chép sang terminal để tự làm tiếp. -->
            <div v-if="out.command" class="ikcmd">
              <code>{{ out.command }}</code>
              <button type="button" class="btn" @click="kube.copyCommand(out.command)">
                {{ t('infra.kube.blocked.copy') }}
              </button>
            </div>

            <p v-if="out.error" class="ierr">{{ out.error }}</p>

            <!-- MỘT HÀNG CHO CẢ BA BỘ LỌC (gộp 2026-09-17). Bản trước xếp ô tìm
                 chữ, hàng chip mức và hàng chip khoảng thành BA dòng chồng nhau, mỗi
                 dòng bỏ trống hai phần ba bề ngang modal — ba dòng để nói ba thứ mà
                 gộp lại vẫn thừa chỗ. Nay ô tìm chữ giãn lấy phần trống, hai bộ lọc
                 còn lại thu vào dropdown, và số khớp đẩy về sát mép phải.

                 Lọc chạy trên chữ ĐÃ tải về (một lần `kubectl logs`), không gọi lại
                 cluster: `kubectl logs` không có cờ lọc nội dung nào (chỉ `--tail`
                 với `--since`, cả hai nằm ở thanh trên). Ô tìm chữ mặc định GIẤU
                 dòng không khớp; nút bên cạnh đổi sang chỉ tô sáng để giữ mạch log. -->
            <div v-if="out.text || out.loading" class="iklogbar">
              <div class="srch iklogfind">
                <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
                <input
                  :value="logQuery"
                  type="text"
                  spellcheck="false"
                  :placeholder="t('infra.kube.log.filter.ph')"
                  :aria-label="t('infra.kube.log.filter.ph')"
                  @input="onQuery"
                />
                <button
                  v-if="logQuery"
                  class="ikfindx"
                  type="button"
                  :title="t('infra.kube.search.clear')"
                  :aria-label="t('infra.kube.search.clear')"
                  @click="logQuery = ''"
                >
                  <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
                </button>
              </div>

              <!-- Mức: MỘT dropdown, không phải năm chip. Năm chip chiếm cả một dòng
                   để nói một lựa chọn, và log thật thường chỉ có một hai mức nên ba
                   trong năm chip luôn là "0". Tổ hợp hay dùng ("Lỗi + cảnh báo") là
                   một mục sẵn trong danh sách — đủ thay cho multi-select. -->
              <AppSelect
                v-if="hasLevels"
                v-model="sevFilter"
                :options="sevOptions"
                width="auto"
                :aria-label="t('infra.kube.log.sevLabel')"
              />

              <!-- Khoảng thời gian neo vào DÒNG MỚI NHẤT, không vào đồng hồ máy: log
                   có thể đã cũ (pod dừng hôm qua), và "5 phút cuối" tính theo đồng hồ
                   sẽ trả về rỗng — trông y hệt một bộ lọc hỏng. -->
              <AppSelect
                v-if="hasStamps"
                v-model="rangeMode"
                :options="rangeOptions"
                width="auto"
                :aria-label="t('infra.kube.log.rangeLabel')"
              />
              <!-- Hai ô giờ chỉ có mặt khi người dùng chọn "Tuỳ chọn": lúc nào cũng
                   hiện thì chúng là hai ô trống nằm cạnh một dropdown đã trả lời xong
                   câu hỏi. -->
              <span v-if="rangeMode === 'custom'" class="iklogfrom">
                <input
                  v-model="fromTime"
                  type="text"
                  spellcheck="false"
                  class="iktime"
                  placeholder="16:40"
                  :aria-label="t('infra.kube.log.from')"
                />
                <span class="ihint">→</span>
                <input
                  v-model="toTime"
                  type="text"
                  spellcheck="false"
                  class="iktime"
                  placeholder="16:50"
                  :aria-label="t('infra.kube.log.to')"
                />
              </span>

              <!-- Số khớp và nút chế độ đẩy về mép phải: chúng nói về KẾT QUẢ, không
                   phải một bộ lọc nữa. -->
              <span v-if="filtering" class="ihint iklogcount" role="status">
                {{ t('infra.kube.log.hits', { shown: matchedCount, total: lineCount }) }}
              </span>
              <button
                v-if="logQuery"
                type="button"
                class="btn"
                :aria-pressed="onlyMatches"
                @click="onlyMatches = !onlyMatches"
              >
                <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
                {{ onlyMatches ? t('infra.kube.log.allLines') : t('infra.kube.log.onlyMatches') }}
              </button>
            </div>

            <!-- Đang nạp: chưa có chữ thì hiện dòng "đang nạp", có chữ cũ (bấm ↻, đổi
               số dòng) thì làm mờ chữ cũ. Thân modal trống trơn trước đây trông y
               hệt "không có gì để hiện". -->
            <p v-if="out.loading && !out.text" class="ikload" role="status" aria-busy="true">
              <Icon
                name="refresh"
                class="ikspin"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              {{ t('infra.kube.loading') }}
            </p>
            <p v-else-if="noMatch" class="ihint">
              {{
                logQuery
                  ? t('infra.kube.log.noMatch', { q: logQuery })
                  : t('infra.kube.log.noneLeft')
              }}
            </p>
            <!-- Một khối chữ: chưa lọc, hoặc đang ở chế độ chỉ-hiện-dòng-khớp (mọi
               dòng đều khớp nên tô sáng là vô nghĩa). -->
            <pre v-else-if="displayText !== null" class="ikpre" :class="{ ikdim: out.loading }">{{
              displayText
            }}</pre>
            <!-- Chế độ "tất cả dòng": từng dòng một để tô sáng dòng khớp. -->
            <pre v-else-if="lineViews.length" class="ikpre iklines" :class="{ ikdim: out.loading }">
<span
  v-for="line in lineViews"
  :key="line.i"
  class="ikln"
  :class="{ ikhit: line.hit }"
>{{ line.text }}</span></pre>
            <p v-else-if="!out.error" class="ihint">{{ t('infra.kube.out.empty') }}</p>
            <p v-if="cappedInfo" class="ihint">
              {{ t('infra.kube.log.capped', cappedInfo) }}
            </p>
          </template>

          <!-- Terminal: MOUNT khi mở lần đầu rồi GIỮ (v-show) để đổi sang Logs và
               quay lại không giết shell. `:key` theo pod ⇒ đổi pod thì remount
               (PTY cũ bị tắt, mở shell mới). Đóng modal (`out.open`=false) tháo cả
               cây con ⇒ WorkspaceTerminal tự kill PTY lúc unmount. -->
          <InfraKubeExecTab
            v-if="terminalOpened"
            v-show="out.mode === 'terminal'"
            :key="out.pod"
            :kube="kube"
            :visible="out.mode === 'terminal'"
          />
        </div>

        <div class="ikm-foot">
          <!-- Xoá pod nằm CẠNH thứ nói về pod đó (log/mô tả của chính nó) — chỗ duy
               nhất trong màn mà hành vi phá huỷ có đủ ngữ cảnh để người dùng quyết.
               Vẫn qua hộp duyệt hạ tầng: phải gõ lại tên pod mới xoá được. -->
          <button
            type="button"
            class="btn gdanger"
            :title="t('infra.kube.act.deletePodWhy')"
            :disabled="!!deleting"
            :aria-busy="deleting === out.pod"
            @click="kube.deletePod(out.pod)"
          >
            <Icon
              :name="deleting === out.pod ? 'refresh' : 'trash'"
              :class="{ ikspin: deleting === out.pod }"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('infra.kube.act.deletePod') }}
          </button>
          <button type="button" class="btn" @click="kube.closeOut()">
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import InfraKubeExecTab from '~/components/infra/kube/InfraKubeExecTab.vue'
import { KUBE_SINCES, KUBE_TAILS } from '~/composables/useInfraKube'
import {
  LOG_SEVERITIES,
  annotateLogLines,
  newestStamp,
  severityCounts,
  timeOfDayMs,
} from '~/utils/kube-logs'
import type { LogLine, LogSeverity } from '~/utils/kube-logs'
import type { InfraKubeController } from '~/composables/useInfraKube'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

const props = defineProps<{ kube: InfraKubeController }>()
const { out, deleting } = props.kube

// Terminal chỉ MOUNT khi người dùng mở tab đó lần đầu (đừng spawn shell + hộp duyệt
// cho pod họ chỉ muốn xem log). Một khi đã mount thì giữ nguyên qua v-show.
const terminalOpened = ref(false)
watch(
  () => out.value.mode,
  (mode) => {
    if (mode === 'terminal') terminalOpened.value = true
  },
)
// Đổi pod (mở modal cho pod khác mà không đóng) ⇒ reset cờ; `:key="out.pod"` đã
// remount component, nhưng cờ phải theo để tab Terminal của pod mới lại mount lười.
watch(
  () => out.value.pod,
  () => {
    terminalOpened.value = out.value.mode === 'terminal'
  },
)

const { t } = useI18n()
const kube = props.kube

/** Trần số dòng ĐƯỢC VẼ: một pod có thể trả về 5000 dòng, dựng 5000 phần tử DOM
 *  chỉ để nhìn là tự bắn vào chân. Dòng thừa vẫn nằm trong bộ nhớ và được đếm ra. */
const MAX_VIEW_LINES = 2000

const logQuery = ref('')
/** `true` = giấu dòng không khớp; `false` = chỉ tô sáng. Chỉ áp cho ô TÌM CHỮ —
 *  lọc theo mức và theo giờ thì luôn GIẤU, vì chúng là "bỏ bớt", không phải "tìm". */
const onlyMatches = ref(true)

/**
 * Mức đang xem. MỘT giá trị, không phải một tập: người dùng đã bác kiểu chip
 * (2026-09-17) vì năm chip ăn cả một dòng để nói một lựa chọn. Tổ hợp duy nhất
 * thật sự hay dùng — "lỗi + cảnh báo" — là một mục sẵn trong danh sách, nên bỏ
 * multi-select không mất gì thực tế.
 */
type SevFilter = 'all' | 'errwarn' | LogSeverity
const sevFilter = ref<SevFilter>('all')

/** Khoảng nhanh, neo vào dòng MỚI NHẤT. `all` = không giới hạn; `custom` = hai ô giờ. */
type RangeMode = 'all' | '5m' | '15m' | '1h' | 'custom'
const RANGE_MS: Record<string, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 3_600_000,
}
const rangeMode = ref<RangeMode>('all')
const fromTime = ref('')
const toTime = ref('')

function onQuery(e: Event): void {
  const el = e.target
  logQuery.value = el instanceof HTMLInputElement ? el.value : ''
}

const allLines = computed<readonly string[]>(() =>
  out.value.text ? out.value.text.split('\n') : [],
)
const lineCount = computed(() => allLines.value.length)

/** Từng dòng đã gắn mức + mốc thời gian (dòng nối thừa kế dòng trên — xem
 *  `utils/kube-logs.ts`). */
const annotated = computed<LogLine[]>(() => annotateLogLines(allLines.value))
const counts = computed(() => severityCounts(annotated.value))
const hasLevels = computed(() => annotated.value.some((line) => line.own))
const newest = computed(() => newestStamp(annotated.value))
const hasStamps = computed(() => newest.value !== null)

/** Danh sách mức: chỉ những mức THẬT SỰ có trong log, kèm số đếm. Một mục cho một
 *  mức đang có 0 dòng là một lựa chọn bấm vào sẽ xoá sạch màn hình. */
const sevOptions = computed<AppSelectOption[]>(() => {
  const c = counts.value
  const out: AppSelectOption[] = [
    { label: t('infra.kube.log.sevAll', { n: annotated.value.length }), value: 'all' },
  ]
  if (c.error > 0 && c.warn > 0) {
    out.push({ label: t('infra.kube.log.sevErrWarn', { n: c.error + c.warn }), value: 'errwarn' })
  }
  for (const key of LOG_SEVERITIES) {
    if (c[key] > 0) {
      out.push({ label: `${t(`infra.kube.log.sev.${key}`)} (${c[key]})`, value: key })
    }
  }
  return out
})

// Mức đang chọn biến mất khỏi danh sách (bấm ↻ và lượt đọc mới không còn dòng lỗi
// nào) ⇒ trả về "tất cả". Không có bước này thì `AppSelect` hiện nhãn RỖNG còn bộ
// lọc giấu sạch log — một màn trắng không ai giải thích được.
watch(sevOptions, (options) => {
  if (!options.some((o) => o.value === sevFilter.value)) sevFilter.value = 'all'
})

const rangeOptions = computed<AppSelectOption[]>(() => [
  { label: t('infra.kube.log.range.all'), value: 'all' },
  { label: t('infra.kube.log.range.5m'), value: '5m' },
  { label: t('infra.kube.log.range.15m'), value: '15m' },
  { label: t('infra.kube.log.range.1h'), value: '1h' },
  { label: t('infra.kube.log.range.custom'), value: 'custom' },
])

/** Dòng này có lọt qua bộ lọc mức không. */
function sevOk(sev: LogSeverity): boolean {
  const pick = sevFilter.value
  if (pick === 'all') return true
  if (pick === 'errwarn') return sev === 'error' || sev === 'warn'
  return sev === pick
}

/** Giờ người dùng gõ → epoch, đặt vào NGÀY của dòng mới nhất. Gõ sai (`99:99`,
 *  gõ dở) ⇒ `null` ⇒ coi như chưa gõ, không phải một khoảng rỗng nuốt sạch log. */
const customFrom = computed(() =>
  newest.value === null ? null : timeOfDayMs(fromTime.value, newest.value),
)
const customTo = computed(() =>
  newest.value === null ? null : timeOfDayMs(toTime.value, newest.value),
)
/** Cửa sổ thời gian đang có hiệu lực, `null` = không giới hạn.
 *  KHÔNG đặt tên `window`: nó che mất `window` toàn cục, và listener Esc ở cuối
 *  file im lặng gọi `addEventListener` trên một computed. */
const timeWindow = computed<{ from: number; to: number } | null>(() => {
  const anchor = newest.value
  if (anchor === null) return null
  if (rangeMode.value === 'custom') {
    // Chọn "Tuỳ chọn" mà chưa gõ gì (hoặc gõ dở) ⇒ chưa lọc, KHÔNG phải lọc rỗng.
    if (customFrom.value === null && customTo.value === null) return null
    return { from: customFrom.value ?? -Infinity, to: customTo.value ?? Infinity }
  }
  const span = RANGE_MS[rangeMode.value]
  return span ? { from: anchor - span, to: Infinity } : null
})

/** Lọc "bỏ bớt": mức + khoảng giờ. Dòng KHÔNG có mốc nào (log không in giờ) được
 *  GIỮ khi đang lọc theo giờ — loại nó đi là xoá sạch màn hình của những log đó, và
 *  bộ lọc trông như hỏng. */
const filtered = computed<LogLine[]>(() => {
  const w = timeWindow.value
  return annotated.value.filter(
    (line) => sevOk(line.sev) && (!w || line.ms === null || (line.ms >= w.from && line.ms <= w.to)),
  )
})

const q = computed(() => logQuery.value.trim().toLowerCase())
const hits = computed<LogLine[]>(() =>
  q.value
    ? filtered.value.filter((line) => line.text.toLowerCase().includes(q.value))
    : filtered.value,
)
const matchedCount = computed(() => hits.value.length)
const trimmed = computed(() => filtered.value.length !== annotated.value.length)
/** Có bộ lọc nào đang hoạt động không — quyết định việc hiện dòng "n/N". */
const filtering = computed(() => !!q.value || trimmed.value)
const noMatch = computed(() => matchedCount.value === 0 && lineCount.value > 0)

/** Chữ hiện dạng MỘT KHỐI — `null` nghĩa là nhánh vẽ-từng-dòng mới đúng. */
const displayText = computed<string | null>(() => {
  if (noMatch.value) return null
  if (!q.value && !trimmed.value) return out.value.text || null
  if (q.value && !onlyMatches.value) return null
  return hits.value
    .slice(0, MAX_VIEW_LINES)
    .map((line) => line.text)
    .join('\n')
})

const lineViews = computed<{ i: number; text: string; hit: boolean }[]>(() => {
  if (!q.value || onlyMatches.value) return []
  const needle = q.value
  return filtered.value
    .slice(0, MAX_VIEW_LINES)
    .map((line) => ({ i: line.i, text: line.text, hit: line.text.toLowerCase().includes(needle) }))
})

const cappedInfo = computed<{ shown: number; total: number } | null>(() => {
  const total = q.value && !onlyMatches.value ? filtered.value.length : matchedCount.value
  return total > MAX_VIEW_LINES ? { shown: MAX_VIEW_LINES, total } : null
})

// Đổi pod là đổi nội dung: giữ lại chữ đã gõ (hoặc bộ lọc đang bật) sẽ xén nhầm log
// của pod khác, và người dùng không có lý do gì để ngờ.
watch(
  () => out.value.pod,
  () => {
    logQuery.value = ''
    onlyMatches.value = true
    sevFilter.value = 'all'
    rangeMode.value = 'all'
    fromTime.value = ''
    toTime.value = ''
  },
)

const containerOptions = computed<AppSelectOption[]>(() => [
  { label: t('infra.kube.out.allContainers'), value: '' },
  ...out.value.containers.map((name) => ({ label: name, value: name })),
])
const tailOptions = computed<AppSelectOption[]>(() =>
  KUBE_TAILS.map((n) => ({ label: t('infra.kube.out.tail', { n }), value: String(n) })),
)
const sinceOptions = computed<AppSelectOption[]>(() =>
  KUBE_SINCES.map((v) => ({
    label: v ? t('infra.kube.out.since', { v }) : t('infra.kube.out.sinceAll'),
    value: v,
  })),
)

function onTail(value: string): void {
  kube.setTail(Number(value))
}

// Esc đóng khung output — cùng luật với modal quản lý cluster.
function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && out.value.open) kube.closeOut()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<style scoped>
/* Nút đóng nằm sát mép phải; nút xoá ở lại bên trái vì nó không phải đường đi tiếp. */
.ikm-foot .btn:last-child {
  margin-left: auto;
}
/* Ô lọc GIÃN lấy phần trống của hàng (2026-09-17). Trước nó bị ghim ~260px nên
   hai phần ba bề ngang modal bỏ trắng — chính là chỗ người dùng chỉ ra. Nó vẫn có
   trần mềm: ba control bên phải luôn giữ đủ chỗ của mình trước khi ô này giãn. */
.iklogfind {
  flex: 1 1 220px;
  min-width: 180px;
  max-width: 520px;
}
/* MỘT hàng lọc: ô tìm chữ giãn, hai dropdown và ô giờ giữ nguyên cỡ, số khớp đẩy
   sát mép phải. `flex-wrap` để modal hẹp thì xuống dòng thay vì bóp ô tìm chữ. */
.iklogfrom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* Số khớp đứng về bên phải: nó là KẾT QUẢ, không phải thêm một bộ lọc nữa. */
.iklogcount {
  margin-left: auto;
}
/* Ô giờ: chỉ đủ rộng cho `16:46:01`. Rộng hơn thì nó trông như ô tìm kiếm thứ hai. */
.iktime {
  width: 72px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgInput);
  color: var(--text);
  font-family: var(--code); /* mono-ok: `16:46:01` phải thẳng cột khi gõ */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.iktime:focus {
  outline: none;
  border-color: var(--accentBorder);
}
/* Nút xoá trong ô lọc: không viền, không nền — nó thuộc về ô nhập, không phải một
   nút ngang hàng với các nút trong thanh. */
.ikfindx {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--textFaint);
  cursor: pointer;
}
.ikfindx:hover {
  color: var(--text);
}
</style>
