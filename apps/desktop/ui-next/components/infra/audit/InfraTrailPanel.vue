<template>
  <!-- CloudTrail trong màn Nhật ký (Mốc 7, việc 7.6).
       Khối RIÊNG, có nút riêng, và cố ý KHÔNG tự nạp theo màn cha: sổ AWOG ở trên là một
       file cục bộ, còn khối này spawn `aws cloudtrail lookup-events` — một lời gọi mạng
       thật trên API mà AWS siết 2 request/giây.

       CÂU HỎI NÓ TRẢ LỜI: "tài khoản vừa bị đổi gì, và có phải do tôi làm trong AWOG
       không". Nhãn trong/ngoài là SUY ĐOÁN (ghép theo tên thao tác + thời gian, không có
       id chung), nên mỗi dòng `awog` hiện kèm mốc của dòng sổ đã khớp để người đọc kiểm
       được thay vì phải tin. -->
  <section class="flex flex-col gap-2 border-t pt-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        class="h-auto gap-1.5 p-0 text-base font-normal text-foreground hover:bg-transparent"
        :aria-expanded="open"
        @click="open = !open"
      >
        <Icon name="chev" class="size-3.5" :class="open ? '' : '-rotate-90'" />
        <span>{{ t('infra.trail.title') }}</span>
      </Button>
      <span class="text-xs text-faint">{{ t('infra.trail.subtitle') }}</span>
    </div>

    <template v-if="open">
      <div
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
                const r = ranges.find((x) => x === v)
                if (r) range = r
              }
            "
          >
            <ToggleGroupItem
              v-for="r in ranges"
              :key="r"
              :value="r"
              class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {{ r }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div class="flex min-w-0 flex-[1_1_380px] flex-wrap items-center gap-1.5">
          <Input
            v-model="resourceName"
            type="text"
            autocomplete="off"
            spellcheck="false"
            class="h-ctrl-sm w-auto min-w-40 flex-[1_1_220px]"
            :placeholder="t('infra.trail.resourcePlaceholder')"
            :title="t('infra.trail.resourceWhy')"
            @keydown.enter="lookup"
          />

          <Button
            type="button"
            :disabled="loading || !hasAccount"
            :aria-busy="loading"
            variant="default"
            size="sm"
            @click="lookup"
          >
            <Icon name="search" class="size-3.5" :class="loading ? 'animate-spin' : ''" />
            {{ t('infra.trail.lookup') }}
          </Button>
        </div>

        <label
          v-if="report"
          class="inline-flex flex-none items-center gap-1.5 text-sm whitespace-nowrap text-dim"
        >
          <Checkbox
            :model-value="externalOnly"
            @update:model-value="externalOnly = $event === true"
          />
          {{ t('infra.trail.externalOnly') }}
        </label>
      </div>

      <p v-if="!sidecarAvailable" class="m-0 px-3.5 py-5.5 text-center text-sm text-dim">
        {{ t('infra.trail.noSidecar') }}
      </p>
      <InfraEmpty
        v-else-if="!hasAccount"
        :title="t('infra.empty.noProfile.title')"
        :hint="t('infra.empty.noProfile.hint.trail')"
        action="accounts"
        :action-label="t('infra.empty.noProfile.action')"
      />
      <p v-else-if="error" class="m-0 px-3.5 py-5.5 text-center text-sm text-destructive">
        {{ errorText }}
      </p>

      <template v-else-if="report">
        <p class="m-0 flex flex-wrap items-baseline gap-2.5 text-sm text-foreground">
          {{ t('infra.trail.counts', { a: report.awogCount, e: report.externalCount }) }}
          <span v-if="report.hasMore" class="text-faint">{{ t('infra.trail.more') }}</span>
          <span v-if="limits" class="text-faint">
            {{ t('infra.trail.limitWhy', { d: limits.maxDays }) }}
          </span>
        </p>

        <!-- Header bảng dính (`sticky`) chỉ bám vào một tổ tiên CÓ CUỘN — khung cuộn là
             chính vỏ của `Table` (trần 420px), không có nó thì header dính vào vùng
             cuộn của cả màn và trôi lên trên thanh công cụ. -->
        <div
          v-if="visible.length"
          class="overflow-hidden rounded-xl border bg-card shadow-sm [&>[data-slot=table-container]]:max-h-105"
        >
          <Table>
            <TableHeader
              class="sticky top-0 z-1 bg-muted [&_th]:h-auto [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-xs [&_th]:whitespace-nowrap"
            >
              <TableRow class="hover:bg-transparent">
                <TableHead>{{ t('infra.trail.col.at') }}</TableHead>
                <TableHead>{{ t('infra.trail.col.origin') }}</TableHead>
                <TableHead>{{ t('infra.trail.col.event') }}</TableHead>
                <TableHead>{{ t('infra.trail.col.who') }}</TableHead>
                <TableHead>{{ t('infra.trail.col.resource') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody class="[&_td]:px-2.5 [&_td]:py-1.5">
              <TableRow v-for="e in visible" :key="e.id">
                <TableCell class="whitespace-nowrap tabular-nums">{{ hhmm(e.at) }}</TableCell>
                <TableCell>
                  <!-- Nhãn mang `title` nói rõ đây là suy đoán, và dòng `awog` chỉ ra
                       ĐƯỢC mốc sổ đã khớp. -->
                  <Badge
                    variant="outline"
                    class="font-normal"
                    :class="e.origin === 'external' ? 'border-warning/40 text-warning' : 'text-dim'"
                    :title="
                      e.origin === 'awog'
                        ? t('infra.trail.matchedWhy', { at: hhmm(e.matchedAt ?? e.at) })
                        : t('infra.trail.externalWhy')
                    "
                  >
                    {{ t(`infra.trail.origin.${e.origin}`) }}
                  </Badge>
                </TableCell>
                <TableCell>
                  {{ e.name }}
                  <span v-if="e.errorCode" class="ml-1.5 text-xs text-destructive">
                    {{ e.errorCode }}
                  </span>
                </TableCell>
                <TableCell class="text-faint">{{ e.username || '—' }}</TableCell>
                <!-- Đơn giản: đoạn cuối của ARN (tên tài nguyên). Chuyên sâu: nguyên
                     ARN, copy dán được. `title` giữ bản đầy đủ ở cả hai.
                     mono-ok: id tài nguyên AWS, copy được vào lệnh. -->
                <TableCell class="font-mono break-all" :title="e.resources.join(' · ')">
                  {{ (isExpert ? e.resources : e.resources.map(shortRes)).join(' · ') || '—' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p
          v-else
          class="m-0 rounded-xl border bg-card px-3.5 py-5.5 text-center text-sm text-dim shadow-sm"
        >
          {{ t('infra.trail.empty') }}
        </p>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
// Lớp bind của khối CloudTrail. Mọi state + RPC ở `useInfraTrail()`.
import { computed, ref } from 'vue'
import InfraEmpty from '~/components/infra/InfraEmpty.vue'
import { useInfraMode } from '~/composables/useInfraMode'
import { useInfraTrail } from '~/composables/useInfraTrail'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const { isExpert } = useInfraMode()

const {
  hasAccount,
  sidecarAvailable,
  report,
  visible,
  loading,
  error,
  range,
  ranges,
  limits,
  externalOnly,
  resourceName,
  lookup,
} = useInfraTrail()

/** Đóng sẵn: khối này tốn một lời gọi mạng, nên nó không mời gọi bằng cách mở sẵn. */
const open = ref(false)

/**
 * Hai lỗi của sidecar là KHOÁ dịch được, phần còn lại là stderr của CLI.
 * `WINDOW_TOO_OLD` là câu trả lời hay gặp nhất và nó không phải một lỗi hệ thống —
 * dịch nó ra tiếng người thay vì để nguyên mã.
 */
const errorText = computed(() => {
  const raw = error.value
  if (raw === 'WINDOW_TOO_OLD' || raw === 'BAD_WINDOW' || raw === 'BAD_OUTPUT') {
    return t(`infra.trail.err.${raw}`)
  }
  return raw
})

/**
 * Phần của một ARN mà người đọc NHẬN RA. `arn:aws:s3:::my-bucket` ⇒ `my-bucket`;
 * `…:instance/i-0abc` ⇒ `i-0abc`. Không phải ARN thì giữ nguyên.
 *
 * ⚠ Load balancer là ngoại lệ, và lấy đoạn cuối ở đó là SAI: ARN của nó kết thúc
 * bằng `loadbalancer/app/<tên>/<mã băm>`, nên luật "đoạn cuối" trả về cái mã băm
 * (`50dc6c49`) — đúng cú pháp, vô nghĩa với người đọc. Tên nằm ở đoạn áp chót.
 */
const LB_TYPES = new Set(['app', 'net', 'gwy'])

function shortRes(v: string): string {
  if (!v.startsWith('arn:')) return v
  const tail = v.split(':').pop() ?? v
  const parts = tail.split('/').filter((x) => x !== '')
  if (parts.length === 0) return tail
  const lbAt = parts.findIndex((x) => LB_TYPES.has(x))
  if (lbAt >= 0 && parts[lbAt + 1]) return parts[lbAt + 1] as string
  return parts[parts.length - 1] as string
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso
}
</script>
