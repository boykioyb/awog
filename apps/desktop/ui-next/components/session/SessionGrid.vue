<template>
  <div class="sgrid">
    <!-- Thanh điều khiển: bật/tắt từng ô + thêm một phiên BẤT KỲ bằng id. Chip đầu
         tiên là chính phiên cha (mặc định tắt), rồi tới các phiên con; phiên thêm tay
         nằm sau cùng, có dấu ✕ để bỏ hẳn. -->
    <div class="sgbar">
      <span class="sglbl">{{ t('sessions.grid.panes') }}</span>
      <!-- Ô của CHÍNH phiên cha: mặc định tắt (lưới mở ra là để nhìn các con), bật lại
           bằng chip này. -->
      <button
        class="sgchip"
        :class="{ on: parentChip.shown }"
        :title="parentChip.title"
        @click="toggle(parentChip.engineId)"
      >
        <span class="sgcdot" :style="{ background: parentChip.color }" />
        {{ parentChip.label }}
      </button>
      <span v-if="childChips.length" class="sgsep" />
      <button
        v-for="c in childChips"
        :key="c.id"
        class="sgchip"
        :class="{ on: c.shown }"
        :title="c.title"
        @click="toggle(c.engineId)"
      >
        <span class="sgcdot" :style="{ background: c.color }" />
        {{ c.label }}
      </button>

      <span v-if="extraChips.length" class="sgsep" />
      <span v-for="c in extraChips" :key="c.id" class="sgchip on is-extra" :title="c.title">
        <span class="sgcdot" :style="{ background: c.color }" />
        {{ c.label }}
        <span class="sgcx" :title="t('sessions.grid.remove')" @click.stop="drop(c.engineId)">
          ✕
        </span>
      </span>

      <span style="flex: 1" />

      <!-- Thêm phiên: gõ TÊN hoặc id. Dán id thì thêm thẳng; gõ tên thì hiện danh sách
           khớp để chọn — người dùng nhớ tên phiên chứ không nhớ `260915-agent-3f2a`. -->
      <div class="sgaddwrap">
        <input
          v-model="query"
          class="sgadd"
          :placeholder="t('sessions.grid.searchPlaceholder')"
          @keydown.enter.prevent="addFirstMatch"
          @keydown.esc.prevent="query = ''"
        />
        <div v-if="matches.length" class="sgmenu">
          <div v-for="m in matches" :key="m.id" class="sgmi" @click="addSession(m.engineId)">
            <span class="sgcdot" :style="{ background: m.color }" />
            <span class="sgmt">{{ m.title }}</span>
            <span v-if="m.role" class="sgmr">{{ m.role }}</span>
          </div>
        </div>
        <div v-else-if="query.trim()" class="sgmenu">
          <div class="sgmi is-empty">{{ t('sessions.grid.noMatch') }}</div>
        </div>
      </div>
    </div>

    <div v-if="panes.length" class="sgpanes">
      <SessionGridPane
        v-for="(p, i) in panes"
        :key="p.id"
        class="sgpane"
        :class="{ wide: lastIsWide && i === panes.length - 1 }"
        :session="p"
        :primary="p.id === session.id"
        @hide="hide(p)"
        @open-full="openFull"
      />
    </div>
    <!-- Tắt hết ô là một trạng thái hợp lệ (ô cha cũng ẩn được), nhưng một khung trống
         không nói được vì sao nó trống. -->
    <div v-else class="sgempty">{{ t('sessions.grid.empty') }}</div>
  </div>
</template>

<script setup lang="ts">
// Chế độ LƯỚI của một phiên: các phiên CON của nó (và, nếu bật, chính nó), mỗi phiên
// một ô có transcript và composer riêng (docs/features/session-groups.md).
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
  return store.sessions.filter((s) => s.groupParentId === eid)
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
// khi khung hẹp (container query dưới `.sgpanes`).
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
  label: s.groupRole || s.title,
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
        (s.groupRole ?? '').toLowerCase().includes(q) ||
        (s.engineId ?? '').toLowerCase().includes(q),
    )
    .slice(0, MAX_MATCHES)
    .map((s) => ({
      id: s.id,
      engineId: s.engineId ?? '',
      title: s.title,
      role: s.groupRole ?? '',
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

<style scoped>
.sgrid {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
}
.sgbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.sglbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.sgchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sgchip:hover {
  background: var(--bgHover);
}
.sgchip.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.sgchip.is-extra {
  cursor: default;
}
.sgcdot {
  width: 6px; /* design-token-ok: chấm tròn — con số px CHÍNH LÀ hình dạng */
  height: 6px; /* design-token-ok: chấm tròn */
  border-radius: 50%;
  flex: 0 0 auto;
}
.sgcx {
  cursor: pointer;
  opacity: 0.7;
}
.sgcx:hover {
  opacity: 1;
}
.sgsep {
  width: 1px;
  height: 14px;
  background: var(--border);
}
.sgadd {
  width: 190px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  outline: none;
}
.sgadd:focus {
  border-color: var(--accent);
}
.sgaddb {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.sgaddb:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}
.sgaddb:disabled {
  opacity: 0.4;
  cursor: default;
}
.sgaddwrap {
  position: relative;
  flex: 0 0 auto;
}
.sgmenu {
  position: absolute;
  top: 118%;
  right: 0;
  z-index: 60;
  min-width: 240px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-lg);
}
.sgmi {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sgmi:hover {
  background: var(--bgHover);
}
.sgmi.is-empty {
  color: var(--textFaint);
  cursor: default;
}
.sgmi.is-empty:hover {
  background: transparent;
}
.sgmt {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sgmr {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.sgpanes {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  overflow-y: auto;
  /* Container query chứ không phải @media: cột chat co lại khi mở workspace panel
     trong khi cửa sổ vẫn rộng nguyên — đo cửa sổ thì bỏ sót đúng cái trường hợp đó. */
  container-type: inline-size;
  container-name: sgpanes;
}
/* Ô CUỐI khi tổng số ô là LẺ chiếm trọn hàng: 3 ô ⇒ 6/6 rồi 12, 1 ô ⇒ 12. */
.sgpane.wide {
  grid-column: 1 / -1;
}
/* Một ô hẹp hơn chừng này thì transcript không còn đọc được — dồn về một cột. */
@container sgpanes (max-width: 900px) {
  .sgpanes {
    grid-template-columns: minmax(0, 1fr);
  }
}
.sgempty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textFaint);
}
</style>
