<template>
  <div class="flex w-70 flex-none flex-col overflow-hidden border-r bg-sidebar max-[820px]:w-57.5">
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto px-3 py-2 outline-none"
      tabindex="0"
      role="listbox"
      :aria-label="t('infra.list.section.accounts')"
      @keydown="onKeydown"
    >
      <div v-for="grp in groups" :key="grp.key" class="mb-0.5 [&+&]:mt-3">
        <!-- Đầu nhóm dính trên cùng khi cuộn để nhóm đang đọc luôn có nhãn. -->
        <div
          class="group/grph sticky top-0 z-2 flex cursor-pointer items-center gap-2 bg-sidebar px-2 py-1.5 select-none hover:bg-accent"
          @click="toggleGroup(grp.key)"
        >
          <Icon
            name="chev"
            class="size-3 flex-none text-faint transition-transform"
            :class="{ '-rotate-90': collapsed[grp.key] }"
          />
          <span
            class="text-xs font-semibold text-muted-foreground group-hover/grph:text-foreground"
          >
            {{ grp.label }}
          </span>
          <span class="ml-auto text-xs text-faint tabular-nums">{{ grp.items.length }}</span>
        </div>
        <div v-show="!collapsed[grp.key]" class="pt-1">
          <!-- Hàng đang chọn = accent-tint + thanh accent 2px (không nền xám). -->
          <div
            v-for="row in grp.items"
            :key="row.name"
            class="mb-0.5 cursor-pointer rounded-md border border-transparent px-2.5 py-2"
            :class="
              row.name === selected
                ? 'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
                : 'hover:bg-accent'
            "
            role="option"
            :aria-selected="row.name === selected"
            @click="onRowClick(row.name)"
          >
            <div class="flex items-center gap-2">
              <span
                class="min-w-0 flex-1 truncate text-base"
                :class="row.name === selected ? 'font-semibold text-foreground' : 'font-medium'"
              >
                {{ row.name }}
              </span>
              <span
                v-if="row.name === defaultProfile"
                class="size-1.5 flex-none rounded-full bg-primary"
                :title="t('infra.list.default')"
              />
            </div>
            <div class="mt-1 flex items-center gap-1.5 text-xs text-dim">
              <!-- mono-ok: account id — định danh người dùng copy sang console/CLI. -->
              <span v-if="row.accountId" class="font-mono">{{ row.accountId }}</span>
              <!-- "Hết hạn"/lỗi là lỗi thật (không truy cập được), khác warn (chỉ là chú ý). -->
              <Badge
                v-else-if="row.accountIdFailure"
                variant="outline"
                class="rounded-sm border-destructive/40 px-1.5 py-0 font-normal text-destructive"
                :title="row.accountIdFailure"
              >
                {{ t('infra.list.accountId.failedTag') }}
              </Badge>
              <Badge
                v-if="row.expiry"
                variant="outline"
                class="rounded-sm px-1.5 py-0 font-normal"
                :class="
                  row.expiry.expired
                    ? 'border-destructive/40 text-destructive'
                    : 'text-muted-foreground'
                "
              >
                {{ row.expiry.label }}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Sidebar trái của màn "Tài khoản" (A2) — danh sách profile AWS nhóm theo kind,
// khuôn thị giác mượn nguyên từ LibraryView.vue (`.list`/`.lscroll`/`.grp`/`.grph`/
// `.grpitems`/`.libli` — TOÀN BỘ là class TOÀN CỤC trong assets/css/prototype.css,
// không phải style scoped của LibraryView.vue, nên dùng lại được mà không cần
// import component đó). Không dùng thẳng <LibraryView>: nó tự sở hữu ô tìm +
// selection nội bộ (`ref q`/`selectedKey`), trong khi hợp đồng của InfraAccounts.vue
// bắt props `search`/`selected` đến từ page-controller (controlled component) —
// hai mô hình không khớp nhau, ép dùng sẽ sinh ra HAI trạng thái tìm kiếm song song.
import { computed, reactive, useTemplateRef } from 'vue'
import { computeExpiry } from '~/utils/aws-profile-view'
import type { AwsProfile, AwsProfileKind } from '~/types'

const props = defineProps<{
  profiles: AwsProfile[]
  selected: string
  defaultProfile: string
  /**
   * A8 — account id ĐÃ BIẾT theo tên profile, đã gộp sẵn cả nguồn miễn phí
   * (ssoAccountId/roleArn) lẫn cache đã resolve (`useAwsProfileAccountIds`,
   * chỉ orchestrator InfraAccounts.vue mới gọi composable đó). Component này
   * THUẦN TRÌNH BÀY nên chỉ tra cứu map, không tự tính.
   */
  resolvedAccountIds: Record<string, string>
  /** Lỗi lần phân giải gần nhất, ĐÃ dịch sang câu người — chỉ có khi accountId
   * còn thiếu VÀ lần bấm "điền" gần nhất cho profile đó thất bại. */
  accountIdFailures: Record<string, string>
}>()

const emit = defineEmits<{
  select: [name: string]
  // Enter trên hàng đang chọn — InfraAccounts.vue quyết định có mở Sửa hay không
  // (profile credential_process là chỉ đọc, xem InfraAccountsDetail.vue).
  activate: [name: string]
}>()

const { t } = useI18n()

// Focus container ngay khi click một hàng — không thì ↑/↓ chỉ chạy sau khi người
// dùng Tab thủ công vào danh sách (div không tự nhận focus khi con của nó được
// click).
const scrollRef = useTemplateRef<HTMLElement>('scrollRef')
function onRowClick(name: string): void {
  emit('select', name)
  scrollRef.value?.focus()
}

// Thứ tự nhóm CỐ ĐỊNH theo đúng bảng trong aws-profile-manager.md — không nhóm
// nào bị bỏ nếu có ít nhất một profile, và nhóm rỗng thì không hiện.
const KIND_ORDER: readonly AwsProfileKind[] = [
  'sso',
  'login',
  'static',
  'assume-role',
  'process',
  'unknown',
]

const KIND_LABEL = computed<Record<AwsProfileKind, string>>(() => ({
  sso: t('infra.list.kind.sso'),
  login: t('infra.list.kind.login'),
  static: t('infra.list.kind.static'),
  'assume-role': t('infra.list.kind.assumeRole'),
  process: t('infra.list.kind.process'),
  unknown: t('infra.list.kind.unknown'),
}))

type Row = {
  name: string
  accountId: string
  accountIdFailure: string | null
  expiry: { label: string; expired: boolean } | null
}

function toRow(p: AwsProfile): Row {
  const expiry = computeExpiry(p.expiresAt)
  return {
    name: p.name,
    accountId: props.resolvedAccountIds[p.name] ?? '',
    accountIdFailure: props.accountIdFailures[p.name] ?? null,
    expiry:
      expiry === null
        ? null
        : expiry.status === 'expired'
          ? { label: t('infra.list.expiry.expired'), expired: true }
          : {
              label:
                expiry.hours > 0
                  ? t('infra.list.expiry.inHours', { h: expiry.hours, m: expiry.minutes })
                  : t('infra.list.expiry.inMinutes', { n: expiry.minutes }),
              expired: false,
            },
  }
}

const groups = computed<{ key: AwsProfileKind; label: string; items: Row[] }[]>(() => {
  const buckets = new Map<AwsProfileKind, Row[]>()
  for (const p of props.profiles) {
    const row = toRow(p)
    const bucket = buckets.get(p.kind)
    if (bucket) bucket.push(row)
    else buckets.set(p.kind, [row])
  }
  return KIND_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    label: KIND_LABEL.value[k],
    items: buckets.get(k) ?? [],
  }))
})

// Mặc định mở hết — người dùng tự gập nhóm nào không cần, không persist (danh
// sách này nhỏ, không đáng thêm localStorage cho một trang).
const collapsed = reactive<Record<string, boolean>>({})
function toggleGroup(key: string): void {
  collapsed[key] = !collapsed[key]
}

// Thứ tự phẳng cho ↑/↓ — theo ĐÚNG thứ tự hiển thị (nhóm rồi tới hàng), kể cả
// hàng đang nằm trong nhóm đã gập (gập chỉ ẩn hình, không đổi thứ tự điều hướng).
const flatOrder = computed(() => groups.value.flatMap((g) => g.items.map((r) => r.name)))

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    if (props.selected) emit('activate', props.selected)
    e.preventDefault()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const order = flatOrder.value
  if (!order.length) return
  e.preventDefault()
  const idx = order.indexOf(props.selected)
  const delta = e.key === 'ArrowDown' ? 1 : -1
  const nextIdx = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), order.length - 1)
  const name = order[nextIdx]
  if (name !== undefined && name !== props.selected) emit('select', name)
}
</script>
