<template>
  <!-- Hai cột (trái 240–320px · phải phần còn lại), cùng lề với các tab /infra khác. -->
  <div
    class="grid h-full min-h-0 grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] gap-3.5 overflow-hidden px-4 py-3.5"
  >
    <InfraEmpty
      v-if="!profile"
      :title="t('infra.empty.noProfile.title')"
      :hint="t('infra.empty.noProfile.hint.logs')"
      action="accounts"
      :action-label="t('infra.empty.noProfile.action')"
    />

    <template v-else>
      <!-- ── Cột trái (3/12): ngữ cảnh · chế độ · khoảng · nhóm log · thư viện ── -->
      <!-- Hai cột là CARD; đây chỉ thêm bố cục + padding trong khung. -->
      <Card class="min-h-0 gap-3 overflow-y-auto p-3">
        <!-- Hai chế độ: xem dòng mới nhất (rẻ, tail) hay soạn truy vấn Insights.
             Ba nhãn ĐẦY ĐỦ cần 302px trong khi cột chỉ cho 230–284px, nên nhãn rút
             ngắn (câu đầy đủ ở `title`). `whitespace-nowrap` KHÔNG được bỏ: cột hẹp
             nhất gặp cỡ chữ lớn nhất thì thanh gãy thành hai hàng gọn chứ không bẻ
             chữ giữa cụm từ. Bấm lại ô đang bật không bỏ chọn — xem `onMode`. -->
        <ToggleGroup
          type="single"
          variant="outline"
          class="w-full flex-wrap self-stretch"
          :model-value="mode"
          @update:model-value="onMode"
        >
          <ToggleGroupItem
            v-for="m in MODES"
            :key="m"
            :value="m"
            class="h-ctrl-sm flex-auto px-2 text-xs whitespace-nowrap data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary"
            :title="t(`infra.logs.mode.${m}Full`)"
          >
            {{ t(`infra.logs.mode.${m}`) }}
          </ToggleGroupItem>
        </ToggleGroup>

        <!-- Khoảng thời gian: control kiểu AWS CloudWatch (thanh gọn + popover
             Absolute/Relative). Dùng chung với Giám sát/Dashboard. -->
        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-semibold text-foreground">
            {{ t('infra.logs.window.label') }}
          </span>
          <InfraTimeRange v-model="win" />
        </div>

        <!-- Nhóm log dưới dạng CHIP — bấm là xem (tail) / chọn (multi). -->
        <InfraLogsGroupPicker
          :groups="groups"
          :mode="mode === 'tail' ? 'tail' : 'multi'"
          :picked="picked"
          :active="tailGroup"
          :recent="recentGroups"
          :pattern="pattern"
          :loading="groupsLoading"
          :error="groupsError"
          @tail="onTail"
          @toggle="toggleGroup"
          @reload="loadGroups"
          @update:pattern="pattern = $event"
        />

        <InfraLogsLibrary
          v-if="mode === 'advanced'"
          :templates="templates"
          :saved="saved"
          :history="history"
          @apply="onApplyLibrary"
          @delete="onDeleteSaved"
          @clear-history="onClearHistory"
        />
      </Card>

      <!-- ── Cột phải (9/12): log chính ─────────────────────────────────────── -->
      <!-- Bảng/danh sách bên trong cột này không tự mang khung — card trong card. -->
      <Card class="min-h-0 gap-2 overflow-y-auto p-3">
        <!-- ══════════ TAIL (mặc định) ══════════ -->
        <template v-if="mode === 'tail'">
          <!-- Chưa bấm nhóm log nào — cột trái là nơi bắt đầu. -->
          <div
            v-if="!tailGroup"
            class="flex flex-auto flex-col items-center justify-center gap-2 text-dim"
          >
            <Icon name="table" class="size-5" />
            <p class="max-w-105 text-center text-sm">{{ t('infra.logs.tail.pickGroup') }}</p>
          </div>

          <!-- ── CHỦ: danh sách stream của nhóm vừa bấm ──────────────────────
               Mô hình chủ–chi tiết (chốt 2026-09-17): nhóm → stream → dòng log.
               Chưa chọn stream thì KHÔNG gọi dòng log nào — `activeStream === null`
               là trạng thái riêng, khác hẳn `''` (gộp mọi stream). -->
          <template v-else-if="activeStream === null">
            <div class="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                :disabled="streamsLoading"
                variant="outline"
                @click="onTail(tailGroup)"
              >
                <Icon :name="streamsLoading ? 'clock' : 'refresh'" />
                {{ streamsLoading ? t('infra.logs.tail.loading') : t('infra.logs.tail.refresh') }}
              </Button>
              <!-- mono-ok: tên log group là định danh tài nguyên -->
              <span class="min-w-0 font-mono text-xs wrap-anywhere text-dim" :title="tailGroup">
                {{ tailGroup }}
              </span>
            </div>

            <InfraLogsStreamPicker
              :streams="streams"
              :loading="streamsLoading"
              :error="streamsError"
              @select="selectStream"
            />

            <!-- Ghi chú về giá đứng ở ĐÂY, không ở màn đọc dòng: đây là lúc người ta
                 quyết định có mở hay không, còn ở bên kia nó chỉ ăn chiều cao của
                 chính cái bảng vừa mở ra để đọc. -->
            <p class="text-xs text-faint">{{ t('infra.logs.tail.rateNote') }}</p>
          </template>

          <!-- ── CHI TIẾT: dòng log của stream đã chọn ─────────────────────── -->
          <!-- Toàn màn hình = TELEPORT, không phải dựng lại một bản thứ hai: instance
               component được giữ nguyên nên bộ lọc, tập dòng đã đọc thêm, và dòng đang
               mở chi tiết đều còn — bật/tắt không làm mất chỗ đang đọc, và cũng không
               sinh thêm một lệnh gọi AWS nào.
               `disabled` khi tắt ⇒ inline đúng chỗ cũ, không đổi gì. -->
          <Teleport v-else to="body" :disabled="!tailFull">
            <!-- Bọc phần "đọc dòng log" để teleport được nguyên khối. Khi KHÔNG toàn màn
                 hình nó cư xử như các con trực tiếp của cột chính (cùng trục, cùng khe,
                 `min-h-0` để bảng còn co được) và là khối neo (`relative`) cho nút đọc
                 thêm. Toàn màn hình: phủ kín cửa sổ ở `z-160` — trên mọi lớp của shell
                 (≤ 92) nhưng DƯỚI Dialog (170) và popper (180) của shadcn, để hộp chi
                 tiết dòng / Tuỳ chọn / menu chọn mở từ bên trong vẫn nổi lên trên. -->
            <div
              class="flex min-h-0 flex-auto flex-col gap-2"
              :class="tailFull ? 'fixed inset-0 z-160 bg-background p-3' : 'relative'"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Button v-if="!tailFull" type="button" variant="outline" @click="backToStreams">
                  <Icon name="chev-left" />
                  {{ t('infra.logs.streams.back') }}
                </Button>
                <Button
                  type="button"
                  :disabled="tailLoading"
                  variant="outline"
                  @click="refreshTail"
                >
                  <Icon :name="tailLoading ? 'clock' : 'refresh'" />
                  {{ tailLoading ? t('infra.logs.tail.loading') : t('infra.logs.tail.refresh') }}
                </Button>
                <!-- Đang đọc CÁI GÌ: nhóm rồi tới stream. Thiếu vế sau thì hai bảng
                     của hai stream khác nhau trông y hệt nhau. Ở toàn màn hình thì
                     càng cần: cột trái mang ngữ cảnh đã bị ẩn đi. -->
                <!-- mono-ok: tên log group / stream là định danh tài nguyên. Hiện ĐẦY ĐỦ:
                     giữ nguyên khi vừa một dòng, tự ngắt ở bất kỳ đâu khi hẹp. -->
                <span class="min-w-0 font-mono text-xs wrap-anywhere text-dim" :title="tailGroup">
                  {{ tailGroup }}
                </span>
                <Icon name="chev-right" class="size-3 shrink-0 text-faint" />
                <span
                  class="min-w-0 font-mono text-xs wrap-anywhere text-dim"
                  :title="activeStream || undefined"
                >
                  {{ activeStream === '' ? t('infra.logs.streams.all') : activeStream }}
                </span>
                <span class="flex-auto" />
                <span
                  v-if="!tailLoading && tailRanAt"
                  class="text-xs text-muted-foreground tabular-nums"
                >
                  {{ t('infra.logs.tail.status', { n: tailRows.length }) }}
                  <span class="ml-1 text-faint">· {{ tailWhenLabel }}</span>
                </span>
                <!-- "Còn nữa" là SỰ THẬT chứ không phải cảnh báo nữa: đã có đường
                     đọc tiếp ngay dưới bảng. -->
                <span v-if="tailNextToken" class="text-xs text-warning">
                  {{ t('infra.logs.tail.hasMore') }}
                </span>
                <Button
                  type="button"
                  :title="
                    tailFull ? t('infra.logs.tail.exitFullTitle') : t('infra.logs.tail.fullTitle')
                  "
                  :aria-label="
                    tailFull ? t('infra.logs.tail.exitFullTitle') : t('infra.logs.tail.fullTitle')
                  "
                  variant="outline"
                  size="iconMd"
                  @click="tailFull = !tailFull"
                >
                  <Icon :name="tailFull ? 'fullscreen-exit' : 'fullscreen'" />
                </Button>
              </div>

              <Alert v-if="tailError" variant="destructive" class="border-destructive px-2 py-1.5">
                <AlertDescription class="block">
                  {{ tailError }}
                  <span v-if="tailTokenDead">— {{ t('infra.logs.tail.tokenDead') }}</span>
                </AlertDescription>
              </Alert>

              <InfraLogsFilters
                v-model:quick="quickFilter"
                v-model:level="levelFilter"
                :facets="[]"
                :active="null"
                :shown="tailFilteredRows.length"
                :total="tailRows.length"
                @insert="() => {}"
              />

              <InfraLogsResults
                :rows="tailFilteredRows"
                :copied="justCopied"
                :loading="tailLoading"
                fill
                :empty-text="t('infra.logs.tail.emptyStream')"
                @copy="onCopyText"
                @send-to-chat="onSendToChat"
                @trace="onTraceFromRow"
              />

              <!-- Đọc thêm NỔI trên bảng thay vì đứng thành một hàng dưới nó: một
                   hàng riêng ăn chiều cao của đúng cái bảng đang đọc, mà nó chỉ là
                   một hành động thỉnh thoảng mới dùng. Mờ khi rảnh, rõ khi trỏ tới.
                   Vẫn là một NÚT chứ không tự nạp khi cuộn: mỗi lượt là một request
                   `filter-log-events` thật, tính tiền theo số request — nên nhãn đó
                   nằm trong `title`, chỗ người dùng hỏi thì mới trả lời. -->
              <Button
                v-if="tailNextToken && !tailLoading"
                variant="outline"
                size="iconMd"
                class="absolute bottom-2.5 left-1/2 z-2 -translate-x-1/2 rounded-full bg-card text-dim opacity-45 shadow-md transition-opacity hover:bg-card hover:text-foreground hover:opacity-100 disabled:opacity-35 [&_svg]:size-3.5"
                :disabled="tailLoadingMore"
                :title="`${t('infra.logs.tail.loadMore')} — ${t('infra.logs.tail.loadMoreHint')}`"
                :aria-label="t('infra.logs.tail.loadMore')"
                @click="loadMoreTail"
              >
                <!-- DẤU CỘNG chứ không phải mũi tên xuống: mũi tên xuống trùng
                     nghĩa với "cuộn xuống cuối", mà nay cạnh nó có đúng một nút làm
                     việc đó thật. Cộng = thêm dòng vào tập đang có. -->
                <Icon :name="tailLoadingMore ? 'clock' : 'plus'" />
              </Button>
            </div>
          </Teleport>
        </template>

        <!-- ══════════ LẦN THEO MỘT REQUEST (L5) ══════════ -->
        <InfraLogsTrace
          v-else-if="mode === 'trace'"
          v-model:trace-id="traceId"
          :trace="trace"
          :running="tracing"
          :can-run="canTrace"
          :error="traceError"
          :notes="traceNotes"
          :estimate="traceEstimate"
          :bytes-scanned="traceBytes"
          :open-hop-key="openHopKey"
          :has-groups="picked.length > 0"
          @run="onTraceRun"
          @cancel="cancelTrace"
          @toggle-hop="toggleHop"
          @open-logs="onOpenHopLogs"
          @show-on-graph="onShowOnGraph"
        />

        <!-- ══════════ INSIGHTS (nâng cao) ══════════ -->
        <template v-else>
          <InfraLogsQueryEditor v-model="query" @run="onRun" @cancel="onCancel" />

          <!-- Thanh chạy là một Card; mỗi cụm nghĩa là một đơn vị gãy dòng (`shrink-0`)
               nên khi hẹp thanh xuống dòng theo cụm, không bỏ rơi một nút lẻ. -->
          <Card class="shrink-0 flex-row flex-wrap items-center gap-2.5 px-2.5 py-2">
            <div class="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                type="button"
                :disabled="!canRun"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                variant="default"
                @click="onRun"
              >
                <Icon :name="running ? 'clock' : 'play'" />
                {{ running ? t('infra.logs.run.running') : t('infra.logs.run.go') }}
              </Button>
              <Button
                v-if="running"
                type="button"
                aria-keyshortcuts="Meta+. Control+."
                variant="outline"
                @click="onCancel"
              >
                <Icon name="stop" />
                {{ t('infra.logs.run.cancel') }}
              </Button>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button type="button" :disabled="saving" variant="outline" @click="onSave">
                <Icon name="save" />
                {{ t('infra.logs.run.save') }}
              </Button>
              <Button type="button" variant="outline" @click="onCopyQuery">
                <Icon name="copy" />
                {{ t('infra.logs.run.copyQuery') }}
              </Button>
              <Button
                type="button"
                :title="t('infra.logs.window.sendToMonitoringHint')"
                variant="outline"
                @click="onSendToMonitoring"
              >
                <Icon name="forward" />
                {{ t('infra.logs.window.sendToMonitoring') }}
              </Button>
            </div>

            <div class="ml-auto flex shrink-0 flex-wrap items-center gap-2.5">
              <Label class="cursor-pointer gap-1 text-xs font-normal text-dim">
                <Checkbox
                  :model-value="histogramOn"
                  @update:model-value="histogramOn = $event === true"
                />
                {{ t('infra.logs.run.histogram') }}
              </Label>

              <span class="text-xs text-muted-foreground tabular-nums">
                <template v-if="estimating">{{ t('infra.logs.run.estimating') }}</template>
                <template v-else-if="estimate">
                  {{
                    t('infra.logs.run.estimate', {
                      size: formatBytes(estimate.bytes * plannedQueries),
                      usd: plannedUsd.toFixed(4),
                    })
                  }}
                  <span class="ml-1 text-faint">
                    {{
                      estimate.basis === 'history'
                        ? t('infra.logs.run.basisHistory')
                        : t('infra.logs.run.basisStored')
                    }}
                  </span>
                </template>
                <template v-else>{{ t('infra.logs.run.noEstimate') }}</template>
              </span>

              <Button
                type="button"
                :disabled="picked.length === 0"
                variant="outline"
                size="sm"
                @click="refreshEstimate"
              >
                <Icon name="refresh" />
                {{ t('infra.logs.run.reestimate') }}
              </Button>
            </div>
          </Card>

          <Alert v-if="runError" variant="destructive" class="border-destructive px-2 py-1.5">
            <AlertDescription>{{ runError }}</AlertDescription>
          </Alert>

          <div v-if="status" class="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              class="rounded-sm font-normal"
              :class="status === 'Complete' ? 'border-success text-success' : 'text-dim'"
            >
              {{ status }}
            </Badge>
            <span class="text-xs text-muted-foreground tabular-nums">
              {{
                t('infra.logs.run.scanned', {
                  size: formatBytes(bytesScanned),
                  usd: actualUsd.toFixed(4),
                  matched: recordsMatched,
                })
              }}
            </span>
            <span v-if="ranAt" class="text-xs text-faint">{{ whenLabel }}</span>
          </div>

          <InfraLogsHistogram :buckets="histogram" :from-rows="histogramFromRows" @zoom="onZoom" />

          <InfraLogsFilters
            v-model:quick="quickFilter"
            v-model:level="levelFilter"
            :facets="facets"
            :active="facetFilter"
            :shown="filteredRows.length"
            :total="rows.length"
            @insert="insertFacetFilter"
          />

          <InfraLogsResults
            :rows="filteredRows"
            :copied="justCopied"
            :loading="running"
            fill
            @copy="onCopyText"
            @send-to-chat="onSendToChat"
            @trace="onTraceFromRow"
          />

          <p class="text-xs text-faint">{{ t('infra.logs.run.rateNote') }}</p>
        </template>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
// Màn CloudWatch Logs. Trang chỉ điều phối; state/luồng nằm ở useInfraLogs().
//
// LAYOUT KIBANA 3/9 (2026-09-16): cột trái 3 phần = điều khiển (ngữ cảnh · chế độ ·
// khoảng thời gian dạng chip · nhóm log dạng chip · thư viện); cột phải 9 phần = log
// chính (bảng lấp đầy chiều cao).
//
// HAI CHẾ ĐỘ:
//   · Dòng mới nhất (mặc định) — CHỦ–CHI TIẾT ba tầng, đúng ba tầng của CloudWatch:
//     bấm một nhóm log ⇒ panel chính hiện DANH SÁCH STREAM của nhóm đó; bấm một
//     stream (hoặc "Tất cả stream") ⇒ mới đọc dòng qua `filter-log-events`. Lệnh RẺ
//     (không tính GB quét như Insights) nên mỗi cú bấm chạy thẳng, không ước lượng.
//     ⚠ Trước 2026-09-17 bấm nhóm là tail luôn, và bộ chọn stream nằm ở cột trái —
//     người dùng chốt đổi sang mô hình này: thêm một cú bấm trước dòng log đầu tiên,
//     đổi lại thấy nhóm có những stream nào và stream nào vừa có event.
//   · Nâng cao — soạn câu Insights (textarea, KHÔNG Monaco nữa) + histogram + thư
//     viện + facet. Luật "không tự chạy Insights" giữ nguyên: truy vấn tốn tiền vẫn
//     đứng sau một cú bấm + một con số ước lượng.
//
// Mọi truy vấn đi qua sidecar, nơi `runInfra` đã redact stdout TRƯỚC khi rời tiến
// trình (invariant #1). Màn này KHÔNG tự redact lại.
import InfraLogsFilters from '~/components/infra/logs/InfraLogsFilters.vue'
import InfraLogsGroupPicker from '~/components/infra/logs/InfraLogsGroupPicker.vue'
import InfraLogsHistogram from '~/components/infra/logs/InfraLogsHistogram.vue'
import InfraLogsLibrary from '~/components/infra/logs/InfraLogsLibrary.vue'
import InfraLogsQueryEditor from '~/components/infra/logs/InfraLogsQueryEditor.vue'
import InfraLogsResults from '~/components/infra/logs/InfraLogsResults.vue'
import InfraLogsStreamPicker from '~/components/infra/logs/InfraLogsStreamPicker.vue'
import InfraLogsTrace from '~/components/infra/logs/InfraLogsTrace.vue'
import InfraTimeRange from '~/components/infra/InfraTimeRange.vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraLogs } from '~/composables/useInfraLogs'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import { useInfraTrace } from '~/composables/useInfraTrace'
import { useInfraTraceHighlight } from '~/composables/useInfraTraceHighlight'
import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
import type { LogsSeed } from '~/composables/useInfraLogs'
import Button from '~/components/ui/button/Button.vue'

// `seed` cho phép màn khác (Tổng quan) mở tab này với một câu lệnh đã điền sẵn —
// điền câu lệnh KHÔNG phải chạy. Câu Insights ⇒ mở luôn chế độ nâng cao.
const props = defineProps<{ seed?: LogsSeed | null }>()

const { t } = useI18n()
const toast = useToast()
const { askAgent, copyText } = useInfraAskAgent()
const api = useAwsLogsApi()

const {
  profile,
  groups,
  groupsLoading,
  groupsError,
  picked,
  pattern,
  recentGroups,
  loadGroups,
  toggleGroup,
  query,
  win,
  windowSeconds,
  windowValid,
  estimate,
  estimating,
  histogramOn,
  plannedQueries,
  plannedUsd,
  refreshEstimate,
  running,
  status,
  rows,
  filteredRows,
  bytesScanned,
  recordsMatched,
  actualUsd,
  runError,
  ranAt,
  canRun,
  run,
  cancel,
  quickFilter,
  levelFilter,
  facetFilter,
  facets,
  insertFacetFilter,
  histogram,
  histogramFromRows,
  templates,
  saved,
  history,
  reloadLibrary,
  applyTemplate,
  zoomToWindow,
  windowMs,
  // ba chế độ của màn (tail · nâng cao · lần theo request)
  mode,
  tailGroup,
  tailRows,
  tailFilteredRows,
  tailLoading,
  tailLoadingMore,
  tailError,
  tailRanAt,
  tailNextToken,
  tailTokenDead,
  loadMoreTail,
  openTail,
  refreshTail,
  // tầng giữa: log stream
  streams,
  streamsLoading,
  streamsError,
  activeStream,
  selectStream,
  backToStreams,
} = useInfraLogs()

/**
 * Bảng log chiếm cả cửa sổ.
 *
 * Trạng thái TRÌNH BÀY thuần nên nằm ở component, không vào `useInfraLogs` (composable
 * đó lo state + IPC). Không nhớ qua lần mở sau: toàn màn hình là thứ người ta bật cho
 * một lần đọc cụ thể, còn mở lại app mà rơi thẳng vào một lớp phủ kín màn hình thì
 * không ai hiểu vì sao.
 */
const tailFull = ref(false)

// Rời khỏi chế độ đọc dòng log thì cũng rời toàn màn hình: quay lại danh sách stream
// mà lớp phủ còn đó sẽ che một trang không còn liên quan gì.
watch([mode, activeStream], () => {
  tailFull.value = false
})

// Esc thoát. Pha CAPTURE + `stopPropagation` theo đúng khuôn của `MermaidView`: modal
// chi tiết một dòng cũng nghe Esc, và bấm Esc khi cả hai đang mở phải đóng đúng cái
// trên cùng, không đóng cả hai.
function onTailFullKey(e: KeyboardEvent): void {
  if (tailFull.value && e.key === 'Escape') {
    tailFull.value = false
    e.stopPropagation()
  }
}
onMounted(() => window.addEventListener('keydown', onTailFullKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onTailFullKey, true))

/** Cầu nối khoảng thời gian hai chiều với màn Giám sát (6.3). */
const bridge = useInfraWindowSync()

/** Ba chế độ, khai một chỗ để thanh chuyển chế độ không phải liệt kê tay. */
const MODES = ['tail', 'advanced', 'trace'] as const

/** Bấm lại chế độ đang bật thì ToggleGroup gửi giá trị rỗng — bỏ qua để luôn có một chế độ. */
function onMode(v: unknown): void {
  const next = MODES.find((m) => m === v)
  if (next) mode.value = next
}

// ── Lần theo một request (L5) ───────────────────────────────────────────────
// Nhóm log + khoảng thời gian do CỘT TRÁI sở hữu, nên chúng được đưa vào qua hàm
// chứ không nhân bản sang `useInfraTrace` — một bản sao là một bản có thể lệch.
const {
  traceId,
  running: tracing,
  error: traceError,
  notes: traceNotes,
  estimate: traceEstimate,
  bytesScanned: traceBytes,
  trace,
  openHopKey,
  canRun: canTrace,
  run: runTrace,
  cancel: cancelTrace,
  toggleHop,
  traceFrom,
} = useInfraTrace(() => ({
  logGroups: picked.value,
  startMs: windowMs.value?.startMs ?? 0,
  endMs: windowMs.value?.endMs ?? 0,
}))

const traceHighlight = useInfraTraceHighlight()
const tabOpen = useInfraTabOpen()

/**
 * Chạy lần theo. Ước lượng được làm mới TRƯỚC khi chạy (nhánh log là một truy vấn
 * Insights thật), để dòng nhật ký mang đúng con số và để người dùng thấy nó ở lần
 * sau — cùng luật với nút Chạy của chế độ nâng cao.
 */
/**
 * Chạy lần theo.
 *
 * ⚠ KHÔNG gọi `refreshEstimate()` ở đây nữa. Hàm đó ước lượng câu Insights đang nằm
 * trong EDITOR của chế độ nâng cao — một câu khác hẳn câu lần-theo — và con số ấy
 * vừa hiện ra cho người dùng đọc vừa đi vào dòng nhật ký, tức sổ kiểm toán trả lời
 * sai đúng câu hỏi nó sinh ra để trả lời. Nay `infra.trace-start` tự ước lượng bằng
 * chính câu nó sắp chạy, và trả con số đó về để panel hiện.
 */
async function onTraceRun(): Promise<void> {
  if (!windowValid.value) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  await runTrace()
}

/** Bấm "xem log của chặng này" ⇒ về chế độ tail đúng nhóm đó. */
async function onOpenHopLogs(logGroup: string): Promise<void> {
  mode.value = 'tail'
  await openTail(logGroup)
}

/** Mang đường đi của request sang tab Sơ đồ (G4). */
function onShowOnGraph(): void {
  if (!trace.value) return
  traceHighlight.push(trace.value)
  tabOpen.request('graph')
}

const whenLabel = computed(() => (ranAt.value ? new Date(ranAt.value).toLocaleTimeString() : ''))
const tailWhenLabel = computed(() =>
  tailRanAt.value ? new Date(tailRanAt.value).toLocaleTimeString() : '',
)

const justCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

// Bấm một chip nhóm ở chế độ tail ⇒ xem dòng mới nhất của nhóm đó ngay.
async function onTail(name: string): Promise<void> {
  await openTail(name)
}

function onApplyLibrary(q: string, windowSeconds: number, _templateId: string): void {
  applyTemplate({ id: _templateId, query: q, windowSeconds })
}

const saving = ref(false)

async function onSave(): Promise<void> {
  const body = query.value.trim()
  if (!body) return
  const name = window.prompt(t('infra.logs.save.prompt'), body.slice(0, 60))
  if (!name || !name.trim()) return
  saving.value = true
  try {
    await api.saveQuery({
      name: name.trim(),
      query: body,
      logGroups: picked.value,
      windowSeconds: Math.max(60, windowSeconds.value || 3600),
    })
    toast.add({ title: t('infra.logs.save.done'), color: 'success' })
    await reloadLibrary()
  } catch (err) {
    toast.add({
      title: t('infra.logs.save.failed'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

async function onDeleteSaved(id: string): Promise<void> {
  await api.deleteQuery(id).catch(() => {})
  await reloadLibrary()
}

async function onClearHistory(): Promise<void> {
  await api.clearHistory().catch(() => {})
  await reloadLibrary()
}

// Nút bấm và phím tắt dùng CHUNG hai hàm này, nên guard phải nằm ở đây.
async function onRun(): Promise<void> {
  if (!canRun.value) return
  await run()
}

async function onCancel(): Promise<void> {
  if (!running.value) return
  await cancel()
}

function onZoom(startMs: number, endMs: number): void {
  zoomToWindow(startMs, endMs)
  toast.add({ title: t('infra.logs.hist.zoomed'), color: 'info' })
}

/** Gieo cửa sổ đang chọn sang màn Giám sát (6.3, chiều Logs → Giám sát). */
function onSendToMonitoring(): void {
  const win = windowMs.value
  if (!win) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  bridge.pushWindow('monitoring', win.startMs, win.endMs, t('infra.logs.window.bridgeNote'))
}

async function onCopyQuery(): Promise<void> {
  await writeClipboard(query.value)
}

async function onCopyText(text: string): Promise<void> {
  await writeClipboard(text)
}

async function writeClipboard(text: string): Promise<void> {
  if (!(await copyText(text))) return
  justCopied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    justCopied.value = false
  }, 1500)
}

/**
 * "Lần theo request này" từ một dòng log: chuyển chế độ rồi chạy luôn.
 *
 * Chạy NGAY chứ không chỉ điền id, vì người dùng vừa bấm một nút nói rõ nó sẽ làm
 * gì — bắt họ bấm thêm một nút nữa ở màn vừa mở ra là thừa. Chi phí vẫn hiện ở
 * thanh trạng thái sau khi chạy như mọi truy vấn khác.
 */
async function onTraceFromRow(id: string): Promise<void> {
  // Cùng guard với nút Lần theo: khoảng thời gian hỏng ⇒ `windowMs` là `null` ⇒ gửi
  // `startMs: 0`, và zod ở `infra.trace-start` ném một lỗi thô lên panel thay vì một
  // câu tiếng người. Bản đầu chỉ chặn ở `onTraceRun`, để hở đúng đường vào này.
  if (!windowValid.value) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  if (picked.value.length === 0 && tailGroup.value) picked.value = [tailGroup.value]
  mode.value = 'trace'
  await traceFrom(id)
}

/** Gửi một dòng log vào chat của PHIÊN ĐANG MỞ. */
async function onSendToChat(text: string): Promise<void> {
  const groups = mode.value === 'tail' ? tailGroup.value : picked.value.join(', ')
  const header = t('infra.logs.chat.header', {
    groups: groups || '-',
    query: mode.value === 'advanced' ? query.value.trim() : t(`infra.logs.${mode.value}.mode`),
  })
  await askAgent(`${header}\n\n\`\`\`json\n${text}\n\`\`\``)
}

// Đổi cửa sổ thời gian ở chế độ tail ⇒ tail lại nhóm đang xem (cú bấm của người
// dùng, lệnh rẻ). Chế độ nâng cao KHÔNG tự chạy — Insights vẫn phải bấm Chạy.
watch(win, () => {
  if (mode.value === 'tail' && tailGroup.value) void refreshTail()
})

// Khoảng thời gian do màn Giám sát gieo sang (6.3). Chỉ ĐẶT khoảng, KHÔNG chạy.
watch(
  bridge.pendingLogs,
  (seed) => {
    if (!seed) return
    const got = bridge.consumeWindow('logs')
    if (!got) return
    zoomToWindow(got.startMs, got.endMs)
    if (got.note) toast.add({ title: got.note, color: 'info' })
  },
  { immediate: true },
)

// Câu lệnh do màn khác gieo vào (Tổng quan → "Mở trong Logs"). Câu Insights ⇒ mở
// chế độ nâng cao và điền vào editor, KHÔNG chạy.
watch(
  () => props.seed,
  (seed) => {
    if (!seed) return
    mode.value = seed.mode ?? 'advanced'
    if (seed.pattern !== undefined) {
      pattern.value = seed.pattern
      void loadGroups()
    }
    if (seed.group) {
      picked.value = [seed.group]
      // Chế độ tail xem MỘT nhóm: mở luôn nhóm được gieo, nếu không màn hiện ra
      // trống và người dùng phải tự bấm lại đúng thứ họ vừa xin.
      if (mode.value === 'tail') void openTail(seed.group)
    }
    // Câu lệnh là TUỲ CHỌN: bên gieo chỉ xin mở đúng nhóm log thì không có lý do
    // gì ghi đè câu người dùng đang soạn dở ở chế độ nâng cao.
    if (seed.query) {
      applyTemplate({ id: '', query: seed.query, windowSeconds: seed.windowSeconds })
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await Promise.all([loadGroups(), reloadLibrary()])
})

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  void cancel()
})
</script>
