<template>
  <!-- Màn Dịch vụ (task 3.8): danh mục theo NHÓM VIỆC, ba mức hỗ trợ, ghim đổi
       sidebar, và một ô tìm kiếm ⌘K quét cả danh mục lẫn những dòng đã nạp.
       Đây là MẶT DANH MỤC của tab "Dịch vụ" — không phải tab riêng, cũng không
       phải hộp thoại (2026-09-14: "khám phá là page con trong dịch vụ thôi chứ?").
       Danh mục 102 dịch vụ vẫn cần chỗ rộng, nên nó chiếm trọn vùng bảng của tab;
       cột dịch vụ đã ghim thì nằm trong khung Explorer. -->
  <div class="flex h-full min-h-0 flex-col">
    <!-- Đệm trên 8px không phải chuyện thẩm mỹ: hàng này là nội dung ĐẦU TIÊN của
         pane, mà pane không có đệm trên. Đo khoảng từ vạch phân cách của thanh tab
         xuống chữ đầu tiên ở 6 tab: Tổng quan 20 · Nhật ký 16 · Logs 14 · Tài khoản
         12 · Kubernetes 10 · **Dịch vụ 6**. 8px này đưa Dịch vụ về 14px, đúng dải
         của các tab còn lại (ảnh chụp 2026-09-14: "đang thiếu margin top"). -->
    <header class="flex items-center gap-2.5 px-4 py-2 text-muted-foreground">
      <!-- Chỉ hiện khi THẬT SỰ có view để quay về: một nút dẫn tới khung trống còn
           tệ hơn không có nút (cùng luật với nút ↗ ở màn Nhật ký). -->
      <Button
        v-if="closable"
        type="button"
        :title="t('infra.explorer.services.back')"
        variant="outline"
        size="sm"
        @click="$emit('close')"
      >
        <Icon name="chev-left" />
        {{ t('infra.explorer.services.back') }}
      </Button>
      <Icon name="layers" />
      <span class="text-lg font-semibold text-foreground">
        {{ t('infra.explorer.services.title') }}
      </span>
      <div class="relative max-w-80 min-w-0 flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-dim"
        />
        <Input
          ref="searchEl"
          v-model="q"
          class="h-ctrl-sm pr-12 pl-8"
          :placeholder="t('infra.explorer.services.search')"
        />
        <Kbd class="absolute top-1/2 right-2 -translate-y-1/2">⌘K</Kbd>
      </div>
      <!-- Nút ⓘ ở góc phải. `title` trên badge chỉ giúp người biết cần rê chuột;
           người mới thì không biết mà rê. Một chỗ bấm ra lời giải thích là thứ
           thiếu sau khi nhãn cũ ("Full screen in the app") bị hỏi lại.

           Lời giải thích mở dưới dạng POPOVER neo vào chính nút, không phải khối
           đẩy nội dung xuống. Bản trước chèn một <section> ngay dưới header; đọc
           thì được nhưng nó ĐẨY cả lưới thẻ xuống, và mỗi lần xem lại nhãn là một
           lần xô lệch trang (2026-09-14: "sao không hiện dưới dạng popover").
           Bấm ra ngoài / Esc để đóng, nên vẫn nhìn thấy thẻ phía sau như bản cũ. -->
      <Popover v-model:open="infoOpen">
        <PopoverTrigger as-child>
          <Button
            type="button"
            class="ml-auto shrink-0"
            :aria-label="t('infra.explorer.levels.open')"
            :aria-expanded="infoOpen"
            :title="t('infra.explorer.levels.open')"
            variant="outline"
            size="iconMd"
          >
            <Icon name="info" />
          </Button>
        </PopoverTrigger>
        <!-- Bảng chú giải dùng CHÍNH những badge đang có trên thẻ, không phải ảnh
             hay mô tả bằng lời: người đọc đối chiếu được ngay giữa chú giải và
             thẻ. Neo phải vì nút nằm sát mép phải header; rộng hơn popover mặc
             định vì ở đây có ba đoạn giải thích. -->
        <PopoverContent
          align="end"
          class="w-80 max-w-[calc(100vw-2rem)] p-3"
          role="region"
          :aria-label="t('infra.explorer.levels.title')"
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 text-sm font-semibold text-foreground">
              {{ t('infra.explorer.levels.title') }}
            </span>
            <Button
              type="button"
              :aria-label="t('common.close')"
              class="size-6"
              variant="ghost"
              size="iconSm"
              @click="infoOpen = false"
            >
              <Icon name="x" />
            </Button>
          </div>
          <p class="mt-1 mb-2 text-xs text-dim">{{ t('infra.explorer.levels.intro') }}</p>
          <!-- Xếp nhãn TRÊN câu giải thích chứ không hai cột: cột nhãn lấy bề rộng
               của nhãn dài nhất sẽ bóp cột chữ còn ~140px. Vạch mảnh giữa ba mức để
               hai mức không đọc liền thành một khối. -->
          <ul class="flex flex-col">
            <li
              v-for="lv in LEVELS"
              :key="lv"
              class="flex flex-col items-start gap-1 border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <Badge variant="outline" :class="LEVEL_TONE[lv]">
                {{ t(`infra.explorer.support.${lv}`) }}
              </Badge>
              <span class="text-xs text-muted-foreground">
                {{ t(`infra.explorer.support.hint.${lv}`) }}
              </span>
            </li>
          </ul>
        </PopoverContent>
      </Popover>
    </header>

    <!-- Băng "danh mục mẫu". BẮT BUỘC phải có: bản mẫu trông y hệt bản thật (cùng
         dịch vụ, cùng nhãn, cùng nút), nên thiếu băng này thì người đọc sẽ hiểu nó
         là tài khoản của mình. Đây là cái giá của việc cho web hiện danh mục. -->
    <Alert
      v-if="mock"
      class="mx-4 mb-2 w-auto border-warning/40 bg-warning/10 px-2.5 py-2 text-sm [&>svg]:text-warning"
    >
      <Icon name="alert" />
      <AlertDescription>{{ t('infra.explorer.services.mock') }}</AlertDescription>
    </Alert>

    <!-- Kết quả quét DÒNG đã nạp. Đây là đường duy nhất trong app trả lời "tôi vừa
         thấy cái này ở đâu" mà không phải nhớ tên dịch vụ trước. -->
    <div v-if="hits.length" class="flex flex-col gap-1 px-4">
      <div :class="GROUP_HEAD">{{ t('infra.explorer.services.rowHits') }}</div>
      <Button
        v-for="hit in hits"
        :key="hit.viewId + hit.name"
        variant="outline"
        size="sm"
        class="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
        type="button"
        @click="$emit('open-view', { viewId: hit.viewId, values: hit.values })"
      >
        <span class="min-w-0 flex-1 truncate text-left text-sm text-foreground">
          {{ hit.name }}
        </span>
        <span class="text-xs text-dim">{{ t(hit.label) }}</span>
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4">
      <section v-for="g in filteredGroups" :key="g">
        <div :class="GROUP_HEAD">{{ t(`infra.explorer.group.${g}`) }}</div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
          <Card
            v-for="s in grouped()[g]"
            :key="s.id"
            class="gap-1.5 px-2.5 py-2"
            :class="inUse.has(s.id) && 'border-selected-border'"
          >
            <div class="flex items-center gap-1.5">
              <span class="flex-1 text-sm font-medium text-foreground">{{ t(s.label) }}</span>
              <Button
                variant="ghost"
                size="iconSm"
                :class="pinned.includes(s.id) ? 'text-primary' : 'text-faint'"
                type="button"
                :title="
                  t(
                    pinned.includes(s.id)
                      ? 'infra.explorer.pinned.remove'
                      : 'infra.explorer.pinned.add',
                  )
                "
                :aria-label="
                  t(
                    pinned.includes(s.id)
                      ? 'infra.explorer.pinned.remove'
                      : 'infra.explorer.pinned.add',
                  )
                "
                @click="$emit('pin', s.id)"
              >
                <Icon name="pin" />
              </Button>
            </div>
            <p class="text-xs text-dim">{{ t(s.about) }}</p>
            <div class="mt-auto flex items-center gap-1.5">
              <!-- Ba mức hỗ trợ, mỗi mức một câu người đọc được. Nhãn không được là
                   "full/list/console" — người dùng không nói tiếng đó.

                   Nhãn phải nói NGƯỜI DÙNG LÀM ĐƯỢC GÌ, không nói AWOG đã dựng tới
                   đâu. Bản cũ ghi "Full screen in the app" cho mức `full`; người
                   dùng đọc thành "mở toàn màn hình" và hỏi lại badge này nghĩa là
                   gì (2026-09-14). `title` giữ phần giải thích đầy đủ cho ai cần,
                   còn nhãn thì đứng một mình vẫn hiểu được. -->
              <Badge
                variant="outline"
                :class="LEVEL_TONE[s.level]"
                :title="t(`infra.explorer.support.hint.${s.level}`)"
              >
                {{ t(`infra.explorer.support.${s.level}`) }}
              </Badge>
              <Badge
                v-if="inUse.has(s.id)"
                variant="outline"
                class="border-selected-border text-primary"
              >
                {{ t('infra.explorer.services.inUse') }}
              </Badge>
              <Button
                v-if="s.target.kind !== 'console'"
                type="button"
                class="ml-auto"
                variant="outline"
                size="iconMd"
                @click="$emit('open-target', s.target)"
              >
                <Icon name="chev-right" />
              </Button>
              <Button
                v-else-if="s.consoleUrl"
                type="button"
                :title="t('infra.explorer.console')"
                :aria-label="t('infra.explorer.console')"
                class="ml-auto"
                variant="outline"
                size="iconMd"
                @click="$emit('console', s.consoleUrl)"
              >
                <Icon name="external" />
              </Button>
            </div>
          </Card>
        </div>
      </section>
      <!-- Ba trạng thái trống KHÁC NHAU, không được gộp làm một. "Không dịch vụ nào
           khớp" là câu nói về Ô TÌM; khi danh mục chưa nạp được thì câu đúng là
           "chưa đọc được", kèm lý do và một nút thử lại. Gộp chúng lại từng làm
          người dùng tưởng AWOG không có dịch vụ nào (2026-09-14). -->
      <div
        v-if="error && !services.length"
        :class="[EMPTY, error === 'failed' && 'text-destructive']"
      >
        <span>
          {{
            t(
              error === 'offline'
                ? 'infra.explorer.services.offline'
                : 'infra.explorer.services.failed',
            )
          }}
        </span>
        <!-- Nút chỉ có nghĩa khi đã CÓ cầu nối mà lời gọi hỏng. Chưa có cầu nối thì
             gọi lại cũng không sinh ra nó giữa phiên — bấm nút ở đó là hứa suông. -->
        <Button
          v-if="error === 'failed'"
          type="button"
          variant="outline"
          size="sm"
          @click="$emit('retry')"
        >
          <Icon name="refresh" />
          {{ t('infra.explorer.services.retry') }}
        </Button>
      </div>
      <p v-else-if="loading && !services.length" :class="EMPTY">
        {{ t('infra.explorer.loading') }}
      </p>
      <p v-else-if="!filteredGroups.length" :class="EMPTY">
        {{ t('infra.explorer.services.noMatch') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
// "Đang dùng" ở đây nghĩa là DỊCH VỤ CÓ VIEW ĐANG GIỮ DÒNG trong phiên này — suy
// từ thứ đã nạp, không phải một lần quét chi phí. Spec gốc muốn hàng "đang dùng"
// kèm số tiền, nhưng dữ liệu chi phí (Cost Explorer) là việc của Mốc 4; hiển thị
// một con số đoán mò còn tệ hơn nói thẳng giới hạn này.
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import type { InfraCatalogService } from '~/composables/useInfraResourcesApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

/** Một dòng đã nạp ở màn Explorer, để ⌘K tìm được cả dữ liệu chứ không chỉ tên. */
export type InfraRowHit = {
  viewId: string
  label: string
  values?: Record<string, string>
  name: string
}

const props = defineProps<{
  services: readonly InfraCatalogService[]
  groups: readonly string[]
  pinned: readonly string[]
  inUse: ReadonlySet<string>
  rowHits: readonly InfraRowHit[]
  /** Có view để quay về không — quyết định nút "Quay lại" có hiện hay không. */
  closable?: boolean
  /** Danh mục còn đang được đọc từ sidecar. */
  loading?: boolean
  /** Vì sao danh mục trống: chưa nối engine, hay engine gọi lỗi. */
  error?: 'offline' | 'failed' | null
  /** Danh mục đang hiện là bản MẪU (không có engine) — phải nói rõ với người đọc. */
  mock?: boolean
}>()

defineEmits<{
  (e: 'pin', serviceId: string): void
  (e: 'open-target', target: InfraCatalogService['target']): void
  (e: 'open-view', payload: { viewId: string; values?: Record<string, string> }): void
  (e: 'console', url: string): void
  (e: 'close'): void
  (e: 'retry'): void
}>()

const { t } = useI18n()
const q = ref('')
/** Popover chú giải ba mức hỗ trợ đang mở hay không (nút ⓘ ở góc phải header). */
const infoOpen = ref(false)
/** Thứ tự đọc: mạnh nhất trước, để "Mở trong Console AWS" nằm cuối như một lối thoát. */
const LEVELS = ['full', 'list', 'console'] as const
/** Màu chữ/viền của badge mức hỗ trợ: `full` xanh, `console` mờ (lối thoát), `list` mặc định. */
const LEVEL_TONE: Record<string, string> = {
  full: 'border-success text-success',
  list: 'text-muted-foreground',
  console: 'text-dim',
}
/** Nhãn nhóm (nhóm việc · "dòng đã nạp"). */
const GROUP_HEAD = 'px-0.5 pt-2.5 pb-1.5 text-xs font-semibold text-dim'
/** Ba câu trạng thái trống của danh mục. */
const EMPTY = 'flex flex-col items-center gap-2.5 p-5 text-center text-sm text-dim'
const searchEl = useTemplateRef<HTMLInputElement>('searchEl')

const matching = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const svc = props.services.filter(
    (s) =>
      needle === '' ||
      t(s.label).toLowerCase().includes(needle) ||
      t(s.about).toLowerCase().includes(needle) ||
      s.id.includes(needle),
  )
  return new Set(svc.map((s) => s.id))
})

/** Cùng một ô tìm, hai loại kết quả: tên dịch vụ, và DÒNG đã nạp ở màn Explorer. */
const hits = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (needle === '') return []
  return props.rowHits.filter((h) => h.name.toLowerCase().includes(needle)).slice(0, 12)
})

const filteredGroups = computed(() =>
  props.groups.filter((g) => props.services.some((s) => s.group === g && matching.value.has(s.id))),
)

function grouped(): Record<string, InfraCatalogService[]> {
  const out: Record<string, InfraCatalogService[]> = {}
  for (const g of props.groups) out[g] = []
  for (const s of props.services) if (matching.value.has(s.id)) (out[s.group] ??= []).push(s)
  return out
}

/** ⌘K mở ô tìm và đưa con trỏ vào ngay — "tìm kiếm ⌘K" là một cú bấm, không ba. */
function onKey(e: KeyboardEvent): void {
  // Esc đóng popover chú giải. Popover tự bắt Esc khi focus nằm trong nó; dòng này
  // giữ đường đóng khi focus đang ở chỗ khác trên màn.
  if (e.key === 'Escape' && infoOpen.value) infoOpen.value = false
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchEl.value?.focus()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
