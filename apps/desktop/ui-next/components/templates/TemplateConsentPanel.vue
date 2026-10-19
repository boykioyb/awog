<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <div class="text-lg font-semibold text-foreground">{{ inspection.name }}</div>
      <Badge v-if="inspection.version" variant="outline" class="rounded-sm text-muted-foreground">
        {{ inspection.version }}
      </Badge>
      <Badge
        v-if="inspection.alreadyInstalled"
        variant="outline"
        class="rounded-sm text-muted-foreground"
      >
        {{ t('templatesDiscover.consent.alreadyInstalled') }}
      </Badge>
    </div>
    <p v-if="inspection.description" class="text-sm leading-relaxed text-muted-foreground">
      {{ inspection.description }}
    </p>

    <!-- Nguồn thật của bundle: người dùng phải đọc được nó trước khi đồng ý. -->
    <div class="flex min-w-0 items-baseline gap-2">
      <span class="shrink-0 text-xs text-dim">{{ t('templatesDiscover.consent.source') }}</span>
      <span class="font-mono text-xs wrap-anywhere text-foreground">
        {{ inspection.sourceUrl }}
      </span>
    </div>

    <!-- Trang chủ do người xuất bản khai (tuỳ chọn). Chỉ hiện khi nó là link
         https thật — homepage hỏng thì KHÔNG hiện gì, không hiện link chết. -->
    <div v-if="safeHomepage" class="flex min-w-0 items-baseline gap-2">
      <span class="shrink-0 text-xs text-dim">{{ t('templatesDiscover.consent.homepage') }}</span>
      <Button
        variant="link"
        class="h-auto p-0 text-left font-mono text-xs font-normal wrap-anywhere whitespace-normal"
        :title="safeHomepage"
        @click="openHomepage"
      >
        {{ safeHomepage }}
      </Button>
    </div>

    <!-- Cảnh báo bề mặt nguy hiểm: hook = script chạy được, rule = vào thẳng
         system prompt. Chỉ hiện khi bundle thật sự có, và nói rõ hậu quả. -->
    <Alert v-if="risky.length" class="border-warning bg-warning/10 [&>svg]:text-warning">
      <Icon name="shield" />
      <AlertTitle class="line-clamp-none font-semibold text-foreground">
        {{ t('templatesDiscover.consent.riskTitle') }}
      </AlertTitle>
      <AlertDescription class="text-xs leading-relaxed">
        <div v-for="kind in risky" :key="kind">
          {{ t('templatesDiscover.consent.risk.' + kind) }}
        </div>
      </AlertDescription>
    </Alert>

    <Alert
      v-if="inspection.undisclosedKinds.length"
      class="border-destructive bg-destructive/10 [&>svg]:text-destructive"
    >
      <Icon name="alert" />
      <AlertTitle class="line-clamp-none font-semibold text-foreground">
        {{ t('templatesDiscover.consent.undisclosedTitle') }}
      </AlertTitle>
      <AlertDescription class="text-xs leading-relaxed">
        {{ t('templatesDiscover.consent.undisclosed', { kinds: undisclosedLabels }) }}
      </AlertDescription>
    </Alert>

    <!-- Danh sách ĐẦY ĐỦ: mọi entity sẽ được ghi, không cắt bớt, không "…and N
         more". Đây là thứ người dùng đang đồng ý. -->
    <Separator />
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2 text-xs font-semibold text-dim">
        <span>{{ t('templatesDiscover.consent.willWrite') }}</span>
        <Badge variant="outline" class="rounded-sm tabular-nums text-muted-foreground">
          {{ inspection.entities.length }}
        </Badge>
      </div>
      <div v-if="!groups.length" class="text-xs leading-relaxed text-dim">
        {{ t('templatesDiscover.consent.nothing') }}
      </div>
      <div v-for="g in groups" :key="g.kind" class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <span
            class="text-sm font-semibold"
            :class="isRisky(g.kind) ? 'text-warning' : 'text-foreground'"
          >
            {{ t('templates.kind.' + g.kind) }}
          </span>
          <Badge variant="outline" class="rounded-sm tabular-nums text-muted-foreground">
            {{ g.entities.length }}
          </Badge>
        </div>
        <div
          v-for="e in g.entities"
          :key="e.kind + '/' + e.id"
          class="flex min-w-0 items-baseline gap-2.5 rounded-md border bg-muted px-2.5 py-1"
        >
          <span class="text-sm text-foreground">{{ e.id }}</span>
          <span class="font-mono text-xs wrap-anywhere text-dim">{{ e.file }}</span>
        </div>
      </div>
    </div>

    <Separator />
    <div class="text-xs leading-relaxed text-dim">
      {{
        t('templatesDiscover.consent.footprint', {
          files: inspection.fileCount,
          size: sizeLabel,
        })
      }}
    </div>
    <div class="text-xs leading-relaxed text-dim">
      {{ t('templatesDiscover.consent.stagingNote') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn hình đồng ý bắt buộc trước khi cài một template từ danh mục (gói #37).
//
// Nó KHÔNG tóm tắt. Bundle có thể chứa hook (script chạy được) và rule (đi thẳng
// vào system prompt của mọi lượt), nên mọi entity sẽ được ghi đều được liệt kê
// đầy đủ kèm đường dẫn file — cùng nguồn thật, số file và dung lượng.
//
// Panel chỉ HIỂN THỊ. Ràng buộc thật nằm ở engine: `templates.marketplaceInstall`
// đòi `inspection.token` (băm của đúng kế hoạch này) và từ chối ghi nếu nguồn đã
// đổi — nên không có cách nào cài mà không đi qua bước này.
import { computed } from 'vue'
import { KIND_ORDER, type ConfigKind, type MarketplaceInspection } from '~/stores/templates'

// `homepage` đến từ ENTRY của danh mục, không từ `inspection` (bundle không khai
// trang chủ) — nên hộp thoại truyền xuống riêng.
const props = defineProps<{ inspection: MarketplaceInspection; homepage?: string }>()

const { t } = useI18n()

// Danh mục do người lạ xuất bản ⇒ `homepage` là L1. Sidecar đã lọc lúc parse
// (`safeHomepage` trong templates/marketplace.ts), nhưng đây là bề mặt biến nó
// thành một cú bấm nên tự kiểm lại: chỉ https, sai hoặc thiếu ⇒ chuỗi rỗng ⇒
// không render dòng nào. Cố ý KHÔNG nhận http — trang chủ của một bundle mà AWOG
// tuyển thì không có cớ nào rơi xuống http, và đó cũng đúng luật danh mục áp cho
// url của entry.
const safeHomepage = computed<string>(() => {
  const raw = props.homepage?.trim()
  if (!raw) return ''
  try {
    return new URL(raw).protocol === 'https:' ? raw : ''
  } catch {
    return ''
  }
})

// Mở qua bộ chọn dùng chung (trong app / ra ngoài), rồi mới tới
// shell.openExternal ở main process (gate theo scheme lần nữa ở đó).
// KHÔNG <a target="_blank">.
function openHomepage(): void {
  const url = safeHomepage.value
  if (!url) return
  void useLinkOpen().openLink(url)
}

// Hai loại entity có hậu quả thực thi/prompt — cái người dùng cần thấy trước nhất.
const RISKY_KINDS: readonly ConfigKind[] = ['hook', 'rule']
const isRisky = (kind: ConfigKind): boolean => RISKY_KINDS.includes(kind)

const risky = computed<ConfigKind[]>(() => {
  const present = new Set(props.inspection.entities.map((e) => e.kind))
  return RISKY_KINDS.filter((k) => present.has(k))
})

const undisclosedLabels = computed(() =>
  props.inspection.undisclosedKinds.map((k) => t('templates.kind.' + k)).join(', '),
)

type Group = { kind: ConfigKind; entities: MarketplaceInspection['entities'] }
const groups = computed<Group[]>(() => {
  const byKind = new Map<ConfigKind, MarketplaceInspection['entities']>()
  for (const e of props.inspection.entities) {
    const list = byKind.get(e.kind) ?? []
    list.push(e)
    byKind.set(e.kind, list)
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    entities: byKind.get(kind) ?? [],
  }))
})

const KB = 1024
const sizeLabel = computed(() => {
  const bytes = props.inspection.totalBytes
  if (bytes < KB) return `${bytes} B`
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`
  return `${(bytes / (KB * KB)).toFixed(1)} MB`
})
</script>
