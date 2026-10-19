<template>
  <div class="flex min-h-0 flex-auto flex-col gap-2 px-2.5 pt-2 pb-2.5">
    <!-- Thanh điều khiển: bật/tắt từng ô + thêm một phiên BẤT KỲ bằng id. Chip đầu
         tiên là chính phiên cha (mặc định tắt), rồi tới các phiên con; phiên thêm tay
         nằm sau cùng, có dấu ✕ để bỏ hẳn.
         Chip bật/tắt ô: pill nền muted; chip SÁNG là tint primary (cùng quy ước "on"
         của các nút trạng thái mở), không phải nền đặc. -->
    <div class="flex shrink-0 flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted-foreground">{{ t('sessions.grid.panes') }}</span>
      <!-- Ô của CHÍNH phiên cha: mặc định tắt (lưới mở ra là để nhìn các con), bật lại
           bằng chip này. -->
      <Button
        variant="outline"
        size="xs"
        class="h-auto max-w-45 gap-1 overflow-hidden rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground shadow-none"
        :class="
          parentChip.shown &&
          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
        "
        :title="parentChip.title"
        @click="toggle(parentChip.engineId)"
      >
        <!-- Màu chấm là dữ liệu trạng thái phiên, không phải màu theme. -->
        <span class="size-1.5 shrink-0 rounded-full" :style="{ background: parentChip.color }" />
        {{ parentChip.label }}
      </Button>
      <Separator v-if="childChips.length" orientation="vertical" class="h-3.5" />
      <Button
        v-for="c in childChips"
        :key="c.id"
        variant="outline"
        size="xs"
        class="h-auto max-w-45 gap-1 overflow-hidden rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground shadow-none"
        :class="
          c.shown &&
          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
        "
        :title="c.title"
        @click="toggle(c.engineId)"
      >
        <span class="size-1.5 shrink-0 rounded-full" :style="{ background: c.color }" />
        {{ c.label }}
      </Button>

      <Separator v-if="extraChips.length" orientation="vertical" class="h-3.5" />
      <Badge
        v-for="c in extraChips"
        :key="c.id"
        variant="outline"
        class="max-w-45 gap-1 overflow-hidden border-primary/40 bg-primary/10 px-2 py-0.5 font-normal whitespace-nowrap text-primary"
        :title="c.title"
      >
        <span class="size-1.5 shrink-0 rounded-full" :style="{ background: c.color }" />
        {{ c.label }}
        <span
          class="cursor-pointer opacity-70 hover:opacity-100"
          :title="t('sessions.grid.remove')"
          @click.stop="drop(c.engineId)"
        >
          ✕
        </span>
      </Badge>

      <span class="flex-1" />

      <!-- Thêm phiên: gõ TÊN hoặc id. Dán id thì thêm thẳng; gõ tên thì hiện danh sách
           khớp để chọn — người dùng nhớ tên phiên chứ không nhớ `260915-agent-3f2a`.
           Ô nhập gọn (ôm theo hàng chip): nền muted, không viền, ring khi focus. -->
      <div class="relative shrink-0">
        <Input
          v-model="query"
          :placeholder="t('sessions.grid.searchPlaceholder')"
          class="h-auto w-47.5 border-transparent bg-muted px-2 py-0.5 text-xs shadow-none"
          @keydown.enter.prevent="addFirstMatch"
          @keydown.esc.prevent="query = ''"
        />
        <div
          v-if="matches.length || query.trim()"
          class="absolute top-[118%] right-0 z-60 max-h-65 min-w-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
        >
          <template v-if="matches.length">
            <div
              v-for="m in matches"
              :key="m.id"
              class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-accent"
              @click="addSession(m.engineId)"
            >
              <span class="size-1.5 shrink-0 rounded-full" :style="{ background: m.color }" />
              <span class="min-w-0 flex-auto truncate">{{ m.title }}</span>
              <span v-if="m.role" class="shrink-0 text-xs text-primary">{{ m.role }}</span>
            </div>
          </template>
          <div v-else class="rounded-sm px-2 py-1.5 text-sm text-muted-foreground">
            {{ t('sessions.grid.noMatch') }}
          </div>
        </div>
      </div>
    </div>

    <!-- `@container/sgpanes` + `@max-[900px]/sgpanes:` dịch đúng nguyên văn container
         query cũ (khai ngay trên chính lưới). Lưu ý: container query chỉ khớp TỔ TIÊN,
         nên biến thể này hiện không bao giờ bắn — giữ nguyên hành vi, đã ghi báo cáo. -->
    <div
      v-if="panes.length"
      class="@container/sgpanes grid min-h-0 flex-auto grid-cols-2 gap-2 overflow-y-auto @max-[900px]/sgpanes:grid-cols-1"
    >
      <!-- Ô CUỐI khi tổng số ô là LẺ chiếm trọn hàng: 3 ô ⇒ 6/6 rồi 12, 1 ô ⇒ 12. -->
      <SessionGridPane
        v-for="(p, i) in panes"
        :key="p.id"
        :class="lastIsWide && i === panes.length - 1 && 'col-span-full'"
        :session="p"
        :primary="p.id === session.id"
        @hide="hide(p)"
        @open-full="openFull"
      />
    </div>
    <!-- Tắt hết ô là một trạng thái hợp lệ (ô cha cũng ẩn được), nhưng một khung trống
         không nói được vì sao nó trống. -->
    <div v-else class="flex flex-auto items-center justify-center text-muted-foreground">
      {{ t('sessions.grid.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Chế độ LƯỚI của một phiên: các phiên CON của nó (và, nếu bật, chính nó), mỗi phiên
// một ô có transcript và composer riêng (docs/features/session-runs.md).
//
// Vì sao nó đáng có: một phiên điều phối mà phải bấm qua bấm lại từng phiên con thì
// người dùng mất hết cảm giác "cả nhóm đang làm gì". Bảng trạng thái (tab Group) trả
// lời "ai xong"; lưới này trả lời "nó đang NÓI gì" — và cho hích một câu vào ô nào cần.
//
// Mặc định là ĐỦ CÁC PHIÊN CON, không có ô của phiên cha: mở lưới từ một phiên cha là
// để nhìn các con: chính transcript của cha thì vừa đọc xong ở chế độ đơn. Ô cha vẫn
// bật lại được bằng chip đầu thanh — nó là một ô như mọi ô khác, không phải cái neo.
//
// Ô nào hiện được nhớ theo phiên gốc trong localStorage, nên mở lại không phải bật
// lại từ đầu. KHÔNG qua IPC: đây là sở thích hiển thị của một máy, không phải dữ liệu
// của phiên.
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionsData, type Session } from '~/composables/useSessionsData'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  // Phiên GỐC của lưới (phiên cha). Các ô mặc định là những phiên con của nó.
  session: Session
  // Tăng lên mỗi lần người dùng gọi "Xem các phiên con dạng lưới" từ menu chuột phải
  // của danh sách ⇒ quên sở thích cũ và bày lại đủ các phiên con.
  revealTick?: number
}>()

const { t } = useI18n()
const store = useSessionsStore()
const { STATUS_COLOR } = useSessionsData()

const STORAGE = 'awog.sessionGrid.'

// engineId của các ô đang hiện. `null` = CHƯA có sở thích ⇒ hiện mọi phiên con.
// Phân biệt `null` với `[]` là bắt buộc: trên đĩa hai cái trông như nhau nhưng nghĩa
// ngược nhau — "chưa chọn gì" (bày hết ra) và "đã tắt hết" (để trống).
const shown = ref<string[] | null>(null)
const query = ref('')

function storageKey(): string {
  return `${STORAGE}${props.session.engineId ?? props.session.id}`
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) ?? 'null')
    shown.value = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : null
  } catch {
    shown.value = null
  }
}
function save() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(shown.value ?? []))
  } catch {
    // Riêng tư / hết quota: lưới vẫn chạy trong phiên làm việc này, chỉ không nhớ.
  }
}
// Đổi phiên gốc ⇒ đọc lại danh sách của phiên đó (ô hiện là sở thích THEO NHÓM).
watch(() => props.session.id, load, { immediate: true })

// `immediate` là BẮT BUỘC, không phải cho gọn: lệnh từ menu chuột phải bật `gridMode`
// và tăng tick trong CÙNG một nhịp, nên component này MOUNT khi tick đã là 1 — một
// watcher chỉ-theo-thay-đổi sẽ không bao giờ thấy nó, và lưới mở ra với sở thích cũ
// (có thể là rỗng) đúng lúc người dùng vừa bảo "bày hết các con ra".
//
// `0`/`undefined` = không có yêu cầu nào (mở từ menu `⋯`) ⇒ tôn trọng sở thích đã lưu.
// SessionDetail đưa tick về 0 mỗi lần tắt lưới, nên một tick cũ không sống sót sang
// lần bật sau.
//
// Đặt SAU watcher `load` một cách cố ý: hai cái cùng bắn trong một nhịp thì cái chạy
// sau thắng, và lệnh của người dùng phải thắng cái đọc từ localStorage.
watch(
  () => props.revealTick,
  (v) => {
    if (!v) return
    shown.value = null
    try {
      localStorage.removeItem(storageKey())
    } catch {
      // Như `save`: không nhớ được thì thôi, lưới vẫn đúng trong phiên làm việc này.
    }
  },
  { immediate: true },
)

const children = computed<Session[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  return store.sessions.filter((s) => s.teamRunId === eid)
})
const childEids = computed(() => new Set(children.value.map((c) => c.engineId ?? '')))
const parentEid = computed(() => props.session.engineId ?? '')

// engineId của mọi ô đang hiện. Chưa có sở thích ⇒ đủ các phiên con.
const visible = computed<string[]>(
  () => shown.value ?? children.value.map((c) => c.engineId ?? '').filter(Boolean),
)

// Phiên đang hiện mà không phải cha cũng không phải con — tức người dùng tự thêm.
const extras = computed<Session[]>(() =>
  visible.value
    .filter((eid) => eid !== parentEid.value && !childEids.value.has(eid))
    .map((eid) => store.sessions.find((s) => s.engineId === eid))
    .filter((s): s is Session => Boolean(s)),
)

// Thứ tự ô: cha (nếu bật) → các con → thêm-tay. Ổn định theo cấu trúc nhóm chứ không
// theo thứ tự bấm chip: ô nhảy chỗ mỗi lần bật/tắt thì không ai theo kịp mình đang đọc
// transcript của ai.
const panes = computed<Session[]>(() => {
  const set = new Set(visible.value)
  const out: Session[] = []
  if (parentEid.value && set.has(parentEid.value)) out.push(props.session)
  for (const c of children.value) if (c.engineId && set.has(c.engineId)) out.push(c)
  out.push(...extras.value)
  return out
})

// Bố cục: lưới luôn HAI cột, và ô CUỐI của một số ô lẻ chiếm trọn hàng (2 ô ⇒ 6/6;
// 3 ô ⇒ 6/6 rồi 12; 1 ô ⇒ 12). Ba ô một hàng thì mỗi transcript hẹp tới mức không đọc
// được trên màn hình laptop, nên số cột không tăng theo bề rộng — chỉ GIẢM về một cột
// khi khung hẹp (container query `sgpanes` trên lưới ô).
const lastIsWide = computed(() => panes.value.length % 2 === 1)

type Chip = {
  id: number
  engineId: string
  label: string
  title: string
  color: string
  shown: boolean
}
const chipOf = (s: Session): Chip => ({
  id: s.id,
  engineId: s.engineId ?? '',
  label: s.teamRole || s.title,
  title: s.title,
  color: STATUS_COLOR[s.status],
  shown: !!s.engineId && visible.value.includes(s.engineId),
})
// Chip của CHÍNH phiên cha, đứng đầu thanh và tách khỏi nhóm chip con bằng một vạch:
// nó là ô duy nhất không phải "phiên con", và mặc định TẮT.
const parentChip = computed<Chip>(() => ({
  ...chipOf(props.session),
  title: t('sessions.grid.parentChip', { title: props.session.title }),
}))
const childChips = computed<Chip[]>(() => children.value.map(chipOf))
const extraChips = computed<Chip[]>(() => extras.value.map(chipOf))

function toggle(engineId: string) {
  if (!engineId) return
  const cur = visible.value
  shown.value = cur.includes(engineId) ? cur.filter((x) => x !== engineId) : [...cur, engineId]
  save()
}
function drop(engineId: string) {
  shown.value = visible.value.filter((x) => x !== engineId)
  save()
}
function hide(pane: Session) {
  if (pane.engineId) drop(pane.engineId)
}

// Ứng viên khớp với những gì đang gõ: theo TIÊU ĐỀ, theo VAI, hoặc theo id (dán id vẫn
// phải chạy). Loại sẵn ô chính và những phiên đã lên lưới — hiện chúng chỉ để người
// dùng bấm vào một thứ không có tác dụng gì.
const MAX_MATCHES = 8
const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return store.sessions
    .filter((s) => s.engineId && !visible.value.includes(s.engineId))
    .filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.teamRole ?? '').toLowerCase().includes(q) ||
        (s.engineId ?? '').toLowerCase().includes(q),
    )
    .slice(0, MAX_MATCHES)
    .map((s) => ({
      id: s.id,
      engineId: s.engineId ?? '',
      title: s.title,
      role: s.teamRole ?? '',
      color: STATUS_COLOR[s.status],
    }))
})

function addSession(engineId: string) {
  if (!engineId) return
  if (!visible.value.includes(engineId)) {
    shown.value = [...visible.value, engineId]
    save()
  }
  query.value = ''
}
// Enter = lấy dòng khớp đầu tiên. Không có dòng nào thì KHÔNG làm gì và danh sách vẫn
// hiện "không khớp phiên nào" — im lặng nuốt phím Enter là để người dùng đoán.
function addFirstMatch() {
  const first = matches.value[0]
  if (first) addSession(first.engineId)
}

function openFull(id: number) {
  store.setActive(id)
}
</script>
