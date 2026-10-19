<template>
  <!-- Màn Nhật ký hoạt động (task 3.9). Đây là màn DUY NHẤT của `/infra` được nạp
       khi mở: nó đọc một file cục bộ, không tốn lời gọi AWS nào. -->
  <div class="flex h-full min-h-0 flex-col gap-2 px-4 pt-3 pb-3.5">
    <!-- Thanh công cụ là MỘT CARD chứa NĂM CỤM, không phải mười một control rời
         của một hàng `flex-wrap` phẳng. Hàng phẳng được phép gãy ở giữa hai nút
         bất kỳ, nên khi hết chỗ nó bỏ rơi đúng "Nạp lại" xuống hàng dưới, đứng một
         mình dưới mười control khác (ảnh người dùng 2026-09-16). Cụm là đơn vị
         gãy (`flex-none`): hàng vẫn xuống dòng ở cửa sổ hẹp, nhưng xuống theo ranh
         giới nghĩa. -->
    <header
      class="flex flex-none flex-wrap items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm"
    >
      <div class="flex flex-none flex-wrap items-center gap-1.5">
        <ToggleGroup
          type="single"
          :spacing="1"
          class="rounded-lg bg-muted p-0.5"
          :model-value="range"
          @update:model-value="
            (v) => {
              const r = RANGES.find((x) => x === v)
              if (r) onRange(r)
            }
          "
        >
          <ToggleGroupItem
            v-for="r in RANGES"
            :key="r"
            :value="r"
            class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {{ t(`infra.audit.range.${r}`) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <!-- Bốn ô lọc là MỘT cụm: chúng trả lời cùng một câu hỏi ("thu hẹp sổ lại"),
           và cụm này nuốt chỗ thừa nên ô tìm kiếm là thứ giãn ra, không phải khoảng
           trắng giữa các nút. BASIS 380px (không phải `auto`): flex xếp hàng theo
           basis — với `auto` = max-content cụm luôn tự xuống dòng (đo 2026-09-16). -->
      <div class="flex min-w-0 flex-[1_1_380px] flex-wrap items-center gap-1.5">
        <div class="relative max-w-55 min-w-0 flex-1">
          <Icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim"
          />
          <Input
            v-model="contains"
            class="h-ctrl-sm pl-8"
            :placeholder="t('infra.audit.filter.contains')"
            @change="load"
          />
        </div>
        <AppSelect
          v-model="klass"
          :options="classOptions"
          :placeholder="t('infra.audit.filter.class')"
          width="150px"
        />
        <AppSelect
          v-model="decision"
          :options="decisionOptions"
          :placeholder="t('infra.audit.filter.decision')"
          width="150px"
        />
        <Input
          v-model="actor"
          class="h-ctrl-sm max-w-35 min-w-0 flex-1"
          :placeholder="t('infra.audit.filter.actor')"
          @change="load"
        />
      </div>

      <!-- MỌI HÀNH ĐỘNG TRONG MỘT CỤM, đẩy về mép phải. Cụm này đủ rộng để ở cửa sổ
           thường nó xuống hàng dưới — và đó là ý muốn: hai hàng có NGHĨA (lọc ở trên,
           hành động ở dưới) đọc được, còn bốn cụm rơi rớt mỗi cụm một hàng thì không.
           "Nạp lại" nằm ở đây chứ không nằm cùng bộ lọc: mọi ô lọc đã tự nạp lại khi
           đổi (`onRange`, `watch([klass, decision])`, `@change`), nên nút này là một
           hành động độc lập — và nó chính là nút bị bỏ rơi một mình ở hàng hai trong
           ảnh người dùng 2026-09-16. -->
      <div class="ml-auto flex flex-none flex-wrap items-center gap-1.5">
        <Button type="button" :disabled="loading" variant="outline" size="sm" @click="load">
          <Icon name="refresh" />
          {{ t('infra.audit.reload') }}
        </Button>

        <!-- Vạch ngăn giữa ba loại hành động của cùng một cụm (nạp lại · tải về · xoá):
             cụm đã gộp làm một để chúng luôn xuống dòng CÙNG NHAU, nên ranh giới phải
             tự đứng được. -->
        <Separator orientation="vertical" class="mx-0.5 self-stretch" />

        <Button type="button" variant="outline" size="sm" @click="exportAs('csv')">
          <Icon name="download" />
          CSV
        </Button>
        <Button type="button" variant="outline" size="sm" @click="exportAs('jsonl')">
          <Icon name="download" />
          JSONL
        </Button>

        <!-- Vạch ngăn trước hai nút XOÁ: một cú bấm nhầm ở đây xoá sổ trên đĩa, nên
             chúng không được đứng liền kề nút tải về như anh em cùng loại. -->
        <Separator orientation="vertical" class="mx-0.5 self-stretch" />

        <!-- Nhãn NGẮN trên nút, câu đầy đủ trong `title`. Hai nhãn cũ ("Dọn những
             dòng đang hiện" · "Dọn CẢ nhật ký") chiếm ~350px của thanh cho hai
             hành động hiếm khi dùng, và chính chúng là thứ đẩy "Nạp lại" xuống
             hàng dưới. Icon-trần thì KHÔNG dùng được ở đây: bộ icon chỉ có một
             glyph `trash`, nên hai nút sẽ trông y hệt nhau trong khi một cái xoá
             theo bộ lọc còn cái kia xoá sạch sổ. -->
        <Button
          type="button"
          :title="t('infra.audit.clean.title')"
          :disabled="cleaning || !entries.length"
          variant="danger"
          size="sm"
          @click="clean('filtered')"
        >
          <Icon name="trash" />
          {{ t('infra.audit.clean.short') }}
        </Button>
        <Button
          type="button"
          :title="t('infra.audit.clean.allTitle')"
          :disabled="cleaning || !summary?.total"
          variant="danger"
          size="sm"
          @click="clean('all')"
        >
          <Icon name="trash" />
          {{ t('infra.audit.clean.allShort') }}
        </Button>
      </div>
    </header>

    <!-- Dòng tổng nằm NGAY TRÊN bảng: "tuần này tôi chạy gì" phải trả lời được mà
         không cần đọc từng dòng. -->
    <p v-if="summary" class="m-0 text-sm text-muted-foreground">
      {{
        t('infra.audit.summary', {
          total: summary.total,
          write: summary.byClass['write'] ?? 0,
          destructive: summary.byClass['destructive'] ?? 0,
          denied: summary.byDecision['denied'] ?? 0,
        })
      }}
      <span v-if="loadedAt" class="ml-2 text-xs text-faint tabular-nums">
        {{ t('infra.audit.loadedAt', { time: hhmm(loadedAt) }) }}
      </span>
    </p>

    <!-- Bảng chiếm HẾT bề rộng khi chưa chọn dòng nào; cột chi tiết chỉ tồn tại khi có
         thứ để đặt vào nó (trước 2026-09-15 lưới giữ trọn cột hai 380px để trống).
         Trần cột chi tiết bám bề rộng khung (`min(380px, 34%)`): cửa sổ rộng không
         đổi gì, khung hẹp thì nhường chỗ cho bảng thay vì để bảng cuộn ngang. -->
    <div
      class="grid min-h-0 flex-1 gap-2.5"
      :class="
        selected
          ? 'grid-cols-[minmax(0,1fr)_minmax(260px,min(380px,34%))]'
          : 'grid-cols-[minmax(0,1fr)]'
      "
    >
      <!-- Khung cuộn là CHÍNH vỏ của `Table` (h-full), để hàng tiêu đề `sticky` dính
           đúng khung cuộn khi bảng dài hơn khung. -->
      <div
        class="min-h-0 overflow-hidden rounded-xl border bg-card shadow-sm [&>[data-slot=table-container]]:h-full"
      >
        <p v-if="loading && !entries.length" class="m-0 px-3.5 py-5.5 text-center text-sm text-dim">
          {{ t('infra.audit.loading') }}
        </p>
        <p v-else-if="error" class="m-0 px-3.5 py-5.5 text-center text-sm text-destructive">
          {{ error }}
        </p>
        <p v-else-if="!entries.length" class="m-0 px-3.5 py-5.5 text-center text-sm text-dim">
          {{ t('infra.audit.empty') }}
        </p>
        <Table v-else>
          <TableHeader
            class="sticky top-0 z-1 bg-muted [&_th]:h-auto [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-xs [&_th]:whitespace-nowrap"
          >
            <TableRow class="hover:bg-transparent">
              <TableHead>{{ t('infra.audit.col.at') }}</TableHead>
              <TableHead>{{ t('infra.audit.col.source') }}</TableHead>
              <TableHead>{{ t('infra.audit.col.tool') }}</TableHead>
              <TableHead>{{ t('infra.audit.col.class') }}</TableHead>
              <TableHead>{{ t('infra.audit.col.decision') }}</TableHead>
              <TableHead>{{ t('infra.audit.col.actor') }}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody class="[&_td]:px-2.5 [&_td]:py-1.5">
            <TableRow
              v-for="(e, i) in entries"
              :key="`${e.at}-${i}`"
              class="cursor-pointer hover:bg-accent"
              :class="{ 'bg-accent': selected === e }"
              tabindex="0"
              @click="selected = e"
              @keydown.enter.prevent="selected = e"
            >
              <TableCell class="whitespace-nowrap text-muted-foreground tabular-nums">
                {{ hhmm(e.at) }}
              </TableCell>
              <TableCell>
                <Badge variant="outline" class="rounded-sm font-medium text-muted-foreground">
                  {{ sourceOf(e) }}
                </Badge>
              </TableCell>
              <!-- Đơn giản: `aws ec2 describe-instances`. Chuyên sâu: nguyên argv,
                   copy dán được. `title` luôn giữ bản đầy đủ ở cả hai chế độ.
                   Cột DUY NHẤT co giãn (`w-full max-w-0`): hút hết chỗ thừa để bảng
                   chạm mép phải, và lệnh dài cắt ellipsis thay vì đẩy bảng cuộn ngang. -->
              <TableCell class="w-full max-w-0 truncate" :title="commandOf(e)">
                {{ isExpert ? commandOf(e) : shortCommandOf(e) }}
              </TableCell>
              <TableCell>
                <Badge variant="outline" class="rounded-sm font-medium" :class="chipTone(e.class)">
                  {{ t(`infra.audit.class.${e.class}`) }}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  class="rounded-sm font-medium"
                  :class="chipTone(e.decision)"
                >
                  {{ t(`infra.audit.decision.${e.decision}`) }}
                </Badge>
              </TableCell>
              <TableCell class="w-[1%] whitespace-nowrap">{{ e.actor || '—' }}</TableCell>
              <TableCell class="w-[1%] whitespace-nowrap">
                <div class="flex items-center justify-end gap-1">
                  <!-- "Hỏi agent" cho MỘT dòng: đẩy dòng này (kèm JSON thô) vào hộp
                       chọn đích dùng chung — phiên hiện tại hay phiên mới. Đây là
                       chiều ngược lại của "agent đọc được nhật ký". -->
                  <Button
                    type="button"
                    :title="t('infra.audit.ask.label')"
                    :aria-label="t('infra.audit.ask.label')"
                    variant="outline"
                    size="iconSm"
                    @click.stop="askAbout(e)"
                  >
                    <Icon name="sparkles" />
                  </Button>
                  <!-- ↗ nhảy về phiên: chỉ hiện khi dòng THẬT SỰ có phiên + tin để
                       nhảy tới. Một nút dẫn tới hư không còn tệ hơn không có nút. -->
                  <Button
                    v-if="e.sessionId && e.messageId"
                    type="button"
                    :title="t('infra.audit.jump.label')"
                    :aria-label="t('infra.audit.jump.label')"
                    variant="outline"
                    size="iconSm"
                    @click.stop="jumpToSession(e)"
                  >
                    <Icon name="forward" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <aside
        v-if="selected"
        class="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        <header class="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-muted-foreground">
          <Icon name="info" class="size-3.5" />
          <span class="flex-1 text-sm font-medium text-foreground">
            {{ t('infra.audit.detail.title') }}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            :aria-label="t('common.close')"
            @click="selected = null"
          >
            <Icon name="x" />
          </Button>
        </header>
        <dl
          class="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 px-2.5 py-2 text-xs [&>dd]:m-0 [&>dd]:break-words [&>dd]:text-foreground [&>dt]:text-dim"
        >
          <dt>{{ t('infra.audit.col.at') }}</dt>
          <dd>{{ selected.at }}</dd>
          <!-- Dòng nhật ký chỉ ghi `tool` + `surface`, và KHÔNG chỗ nào trên màn
                 hiện chúng. Đây là chỗ trả lời "dòng này do cái gì chạy": `tool` là
                 tên tool AWOG, `surface` là màn hình đã bấm. Cả hai đều là giá trị
                 thô của hợp đồng, không dịch — chúng là định danh, không phải nhãn. -->
          <dt>{{ t('infra.audit.col.source') }}</dt>
          <dd>{{ sourceOf(selected) }}</dd>
          <dt>{{ t('infra.audit.detail.toolName') }}</dt>
          <dd>{{ selected.tool }}</dd>
          <dt>{{ t('infra.audit.col.surface') }}</dt>
          <dd>{{ selected.surface }}</dd>
          <dt>{{ t('infra.audit.col.context') }}</dt>
          <dd>{{ contextLine(selected) || '—' }}</dd>
          <dt>{{ t('infra.audit.col.result') }}</dt>
          <dd>{{ resultLine(selected) || '—' }}</dd>
        </dl>
        <!-- mono-ok: JSON thô của một dòng nhật ký — bằng chứng, đọc và copy nguyên văn -->
        <pre
          class="m-0 flex-1 overflow-auto px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground"
          >{{ JSON.stringify(selected, null, 2) }}</pre
        >
      </aside>
    </div>

    <!-- CloudTrail (Mốc 7, 7.6). Sổ ở trên là thứ AWOG chạy; khối này là thứ TÀI KHOẢN
         bị chạm — kể cả do người khác, do Console, hay do một pipeline. Nó đứng DƯỚI,
         đóng sẵn, và có nút riêng: sổ ở trên đọc một file cục bộ, còn nó gọi mạng. -->
    <InfraTrailPanel />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import InfraTrailPanel from '~/components/infra/audit/InfraTrailPanel.vue'
import { useInfraAuditLog } from '~/composables/useInfraAuditLog'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraMode } from '~/composables/useInfraMode'
import type { InfraAuditEntry } from '~/composables/useInfraResourcesApi'
import { infraAuditSource } from '~/utils/infra-audit-source'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const { isExpert } = useInfraMode()
const {
  entries,
  summary,
  loading,
  error,
  loadedAt,
  selected,
  range,
  actor,
  klass,
  decision,
  contains,
  load,
  exportAs,
  clean,
  cleaning,
  jumpToSession,
} = useInfraAuditLog()

const { askAgent } = useInfraAskAgent()

/**
 * "Hỏi agent về dòng này" — dựng một khối có tiêu đề + JSON thô rồi giao cho hộp
 * chọn đích dùng chung (`useInfraAskAgent`): phiên hiện tại hay phiên mới trong
 * `awog-infra`. Ở đây KHÔNG tự gửi, và cũng không tự lọc bí mật — dòng nhật ký đã
 * qua `redactString()` lúc ghi đĩa, nên lọc lại là định nghĩa thứ hai về "bí mật".
 */
function askAbout(e: InfraAuditEntry): void {
  const lines = [
    `[nhật ký hạ tầng] ${e.at} — ${e.argv.join(' ')}`,
    `lớp=${e.class} · phán quyết=${e.decision} · người=${e.actor || '—'}`,
  ]
  const ctx = contextLine(e)
  if (ctx) lines.push(`ngữ cảnh: ${ctx}`)
  const res = resultLine(e)
  if (res) lines.push(`kết quả: ${res}`)
  lines.push('', '```json', JSON.stringify(e, null, 2), '```')
  void askAgent(lines.join('\n'), t('infra.audit.ask.source'))
}

const RANGES = ['24h', '7d', '30d', 'all'] as const

/** Màu chip của cột Lớp/Phán quyết: phá huỷ · bị từ chối · bị chặn = đỏ; ghi · đã duyệt = xanh. */
function chipTone(value: string): string {
  if (value === 'destructive' || value === 'denied' || value === 'blocked') {
    return 'border-destructive text-destructive'
  }
  if (value === 'write' || value === 'approved') return 'border-success text-success'
  return 'text-muted-foreground'
}

const classOptions = computed(() =>
  (['', 'read', 'write', 'destructive', 'context-switch'] as const).map((c) => ({
    value: c,
    label: c === '' ? t('infra.audit.filter.all') : t(`infra.audit.class.${c}`),
  })),
)
const decisionOptions = computed(() =>
  (['', 'auto', 'approved', 'denied', 'blocked', 'bypass-temp'] as const).map((d) => ({
    value: d,
    label: d === '' ? t('infra.audit.filter.all') : t(`infra.audit.decision.${d}`),
  })),
)

/** Mọi thay đổi bộ lọc đều nạp lại NGAY: nhật ký là file cục bộ, đọc lại là rẻ. */
function onRange(r: (typeof RANGES)[number]): void {
  range.value = r
  void load()
}
watch([klass, decision], () => void load())

onMounted(() => void load())

/** Nhận ISO (từ store nhật ký) HOẶC epoch ms (mốc "nạp lúc") — cả hai đều là thời gian. */
function hhmm(at: string | number): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? String(at)
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Nguồn của dòng: tên dịch vụ AWS (`ec2`, `logs`), tên CLI (terraform/kubectl),
 * hay tên tool với thao tác nội bộ AWOG. Luật nằm ở `utils/infra-audit-source.ts`.
 */
function sourceOf(e: InfraAuditEntry): string {
  return infraAuditSource(e)
}

/** Lệnh đã chạy, KHÔNG kèm tên binary — đúng những gì nhật ký ghi xuống đĩa. */
/**
 * Bản rút gọn cho chế độ Đơn giản: binary + hai token đầu KHÔNG phải cờ.
 * `aws ec2 describe-instances --filters … --output json` ⇒ `aws ec2 describe-instances`.
 * Đủ để đọc lướt cả cột và biết chuyện gì đã chạy; bản đầy đủ nằm ở `title` và ở
 * chế độ Chuyên sâu.
 */
function shortCommandOf(e: InfraAuditEntry): string {
  const bin = e.tool.replace(/_cli$/, '')
  const op = e.argv
    .filter((a) => !a.startsWith('-'))
    .slice(0, 2)
    .join(' ')
  return op ? `${bin} ${op}` : bin
}

function commandOf(e: InfraAuditEntry): string {
  return e.argv.join(' ')
}

function contextLine(e: InfraAuditEntry): string {
  const c = e.context
  return [c.profile, c.region, c.accountId, c.cluster, c.namespace].filter(Boolean).join(' · ')
}

function resultLine(e: InfraAuditEntry): string {
  const r = e.result
  const parts: string[] = []
  if (r.exitCode !== undefined) parts.push(`exit ${r.exitCode}`)
  if (r.durationMs !== undefined) parts.push(`${r.durationMs}ms`)
  if (r.bytesScanned !== undefined) parts.push(`${r.bytesScanned}B`)
  if (r.summary) parts.push(r.summary)
  return parts.join(' · ')
}
</script>
