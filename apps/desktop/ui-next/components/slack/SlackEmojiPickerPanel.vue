<template>
  <Input
    ref="searchRef"
    v-model="query"
    class="h-[var(--ctrl-h-sm)]"
    :placeholder="t('slack.emoji.search')"
  />
  <Tabs v-if="!query.trim()" v-model="tab">
    <TabsList class="w-full">
      <TabsTrigger value="recent" class="flex-1">{{ t('slack.emoji.recent') }}</TabsTrigger>
      <TabsTrigger value="standard" class="flex-1">
        {{ t('slack.emoji.standard') }}
      </TabsTrigger>
      <TabsTrigger value="custom" class="flex-1">{{ t('slack.emoji.custom') }}</TabsTrigger>
    </TabsList>
  </Tabs>
  <div v-if="tab === 'standard' && !query.trim()" class="flex gap-0.5">
    <Button
      v-for="g in EMOJI_GROUPS"
      :key="g.id"
      variant="ghost"
      size="iconSm"
      :class="{ 'slk-grp-on': g.id === group }"
      :title="t(`slack.emoji.group.${g.id}`)"
      @click="group = g.id"
    >
      {{ g.items[0]?.char }}
    </Button>
  </div>
  <div ref="gridRef" class="slk-grid">
    <Button
      v-for="it in items"
      :key="it.name"
      :ref="(el) => observe(el, it.name)"
      variant="ghost"
      size="iconSm"
      class="slk-cell"
      :title="`:${it.name}:`"
      @click="pick(it.name)"
    >
      <SlackEmoji :name="it.name" :custom-url="customUrl" />
    </Button>
    <div v-if="!items.length" class="col-span-full py-4 text-center text-xs text-dim">
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Thân bảng chọn emoji: tab Gần đây · Chuẩn · Tuỳ chỉnh + ô tìm. Chỉ dựng khi picker mở
// (SlackEmojiPicker). Emoji tuỳ chỉnh: danh sách tên nạp lười lần đầu mở (thiếu scope
// `emoji:read` ⇒ rỗng); ẢNH chỉ xin cho ô đang lọt vào khung cuộn (IntersectionObserver),
// theo lô — workspace vài nghìn emoji mà xin hết một lượt là quá nặng.
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { EMOJI_GROUPS, POPULAR_EMOJI, searchStandardEmoji } from '~/utils/slack-emoji'
import { useSlackEmojiRecent } from '~/composables/useSlackEmojiRecent'
import { useSlackStore } from '~/stores/slack'

const props = defineProps<{ teamId: string; customUrl: (name: string) => string | null }>()
const emit = defineEmits<{ pick: [name: string] }>()

// Tối đa bao nhiêu kết quả khi tìm (chuẩn trước, tuỳ chỉnh sau).
const SEARCH_STD_MAX = 60
const SEARCH_MAX = 80
// Số ô của tab Gần đây (gần đây + bù emoji hay dùng): 4 hàng × 8 cột.
const RECENT_SHOWN = 32
// Gom tên vừa hiện trong khoảng này thành một lô xin ảnh.
const IMAGE_FLUSH_MS = 60

const { t } = useI18n()
const store = useSlackStore()
const { recent, remember } = useSlackEmojiRecent()
const query = ref('')
// Tab đầu luôn có nội dung (gần đây + bù emoji hay dùng) ⇒ mở picker luôn vào đó.
const tab = ref<'recent' | 'standard' | 'custom'>('recent')
const group = ref(EMOJI_GROUPS[0]?.id ?? '')
const searchRef = useTemplateRef<{ focus: () => void }>('searchRef')
const gridRef = useTemplateRef<HTMLElement>('gridRef')

const customList = computed(() => store.teamEmoji[props.teamId] ?? [])

type Item = { name: string }
const items = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (q) {
    const custom = customList.value.filter((e) => e.name.includes(q)).map((e) => ({ name: e.name }))
    return [...searchStandardEmoji(q, SEARCH_STD_MAX), ...custom].slice(0, SEARCH_MAX)
  }
  if (tab.value === 'recent') {
    // Gần đây trước, bù emoji hay dùng (công việc với khách Nhật) cho đủ một bảng.
    const names = [...recent.value, ...POPULAR_EMOJI.filter((n) => !recent.value.includes(n))]
    return names.slice(0, RECENT_SHOWN).map((name) => ({ name }))
  }
  if (tab.value === 'custom') return customList.value.map((e) => ({ name: e.name }))
  return EMOJI_GROUPS.find((g) => g.id === group.value)?.items ?? []
})

const emptyText = computed(() => {
  if (query.value.trim()) return t('slack.emoji.noMatch')
  if (tab.value === 'recent') return t('slack.emoji.noRecent')
  return t('slack.emoji.noCustom')
})

// ── Ảnh emoji tuỳ chỉnh cho ô đang hiện ──────────────────────────────────────
const cellName = new WeakMap<Element, string>()
const observed = new Set<Element>()
let io: IntersectionObserver | null = null
let queued = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  flushTimer = null
  const names = [...queued].flatMap((n) => {
    const r = store.resolveCustomEmoji(props.teamId, n)
    return r && !r.url ? [r.name] : []
  })
  queued = new Set()
  store.requestEmojiImages(props.teamId, names)
}

function onIntersect(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    const name = e.isIntersecting ? cellName.get(e.target) : undefined
    if (name) queued.add(name)
  }
  if (queued.size && !flushTimer) flushTimer = setTimeout(flush, IMAGE_FLUSH_MS)
}

// Function ref của từng ô: chỉ theo dõi ô của emoji TUỲ CHỈNH (emoji chuẩn là unicode).
function observe(el: unknown, name: string): void {
  const node = (el as { $el?: unknown } | null)?.$el
  if (!(node instanceof Element) || observed.has(node)) return
  if (!store.resolveCustomEmoji(props.teamId, name)) return
  cellName.set(node, name)
  observed.add(node)
  io?.observe(node)
}

onMounted(() => {
  searchRef.value?.focus()
  io = new IntersectionObserver(onIntersect, { root: gridRef.value })
  for (const node of observed) io.observe(node)
  void store.loadTeamEmoji(props.teamId).catch(() => undefined)
})
onBeforeUnmount(() => {
  io?.disconnect()
  if (flushTimer) clearTimeout(flushTimer)
})

// Đổi tab / kết quả tìm ⇒ ô cũ biến mất; bỏ theo dõi để Set không phình.
watch(
  items,
  () => {
    for (const node of observed) {
      if (node.isConnected) continue
      io?.unobserve(node)
      observed.delete(node)
    }
  },
  { flush: 'post' },
)

function pick(name: string): void {
  remember(name)
  emit('pick', name)
}
</script>

<style scoped>
.slk-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 2px;
  /* Chiếm phần còn lại của khung picker CAO CỐ ĐỊNH (SlackEmojiPicker): tab ít/không có
     emoji cũng không làm khung co lại ⇒ popover không lật trên/dưới khi đổi tab. */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.slk-cell {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
}
.slk-grp-on {
  background: var(--accentDim);
  box-shadow: inset 0 0 0 1px var(--accentBorder);
}
</style>
