<template>
  <div class="sgrid">
    <!-- Thanh điều khiển: bật/tắt từng ô + thêm một phiên BẤT KỲ bằng id. Chip là
         danh sách các phiên con; phiên thêm tay nằm sau, có dấu ✕ để bỏ hẳn. -->
    <div class="sgbar">
      <span class="sglbl">{{ t('sessions.grid.panes') }}</span>
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

    <div class="sgpanes" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
      <SessionGridPane
        v-for="p in panes"
        :key="p.id"
        :session="p"
        :primary="p.id === session.id"
        @hide="hide(p)"
        @open-full="openFull"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Chế độ LƯỚI của một phiên: phiên đang mở + các phiên con của nó, mỗi phiên một ô có
// transcript và composer riêng (docs/features/session-groups.md).
//
// Vì sao nó đáng có: một phiên điều phối mà phải bấm qua bấm lại từng phiên con thì
// người dùng mất hết cảm giác "cả nhóm đang làm gì". Bảng trạng thái (tab Group) trả
// lời "ai xong"; lưới này trả lời "nó đang NÓI gì" — và cho hích một câu vào ô nào cần.
//
// Ô nào hiện được nhớ theo phiên gốc trong localStorage, nên mở lại không phải bật
// lại từ đầu. KHÔNG qua IPC: đây là sở thích hiển thị của một máy, không phải dữ liệu
// của phiên.
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useSessionsStore } from '~/stores/sessions'
import { useSessionsData, type Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const store = useSessionsStore()
const { STATUS_COLOR } = useSessionsData()

const STORAGE = 'awog.sessionGrid.'

// engineId của các ô đang hiện (không kể ô chính). Đọc/ghi theo phiên gốc.
const shown = ref<string[]>([])
const query = ref('')

function storageKey(): string {
  return `${STORAGE}${props.session.engineId ?? props.session.id}`
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) ?? 'null')
    shown.value = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    shown.value = []
  }
}
function save() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(shown.value))
  } catch {
    // Riêng tư / hết quota: lưới vẫn chạy trong phiên làm việc này, chỉ không nhớ.
  }
}
// Đổi phiên gốc ⇒ đọc lại danh sách của phiên đó (ô hiện là sở thích THEO NHÓM).
watch(() => props.session.id, load, { immediate: true })

const children = computed<Session[]>(() => {
  const eid = props.session.engineId
  if (!eid) return []
  return store.sessions.filter((s) => s.groupParentId === eid)
})
const childEids = computed(() => new Set(children.value.map((c) => c.engineId ?? '')))

// Phiên đang hiện mà KHÔNG phải con — tức người dùng tự thêm bằng id.
const extras = computed<Session[]>(() =>
  shown.value
    .filter((eid) => !childEids.value.has(eid))
    .map((eid) => store.sessions.find((s) => s.engineId === eid))
    .filter((s): s is Session => Boolean(s)),
)

// Ô chính LUÔN đứng đầu; các ô còn lại theo thứ tự con trước, thêm-tay sau.
const panes = computed<Session[]>(() => [
  props.session,
  ...children.value.filter((c) => c.engineId && shown.value.includes(c.engineId)),
  ...extras.value,
])

// Số cột: 1 ô ⇒ 1 cột, 2 ⇒ 2, từ 3 trở lên ⇒ 2 cột (3 ô một hàng thì mỗi transcript
// hẹp tới mức không đọc được trên màn hình laptop). Lưới tự xuống hàng theo grid.
const cols = computed(() => (panes.value.length <= 1 ? 1 : 2))

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
  shown: !!s.engineId && shown.value.includes(s.engineId),
})
const childChips = computed<Chip[]>(() => children.value.map(chipOf))
const extraChips = computed<Chip[]>(() => extras.value.map(chipOf))

function toggle(engineId: string) {
  if (!engineId) return
  shown.value = shown.value.includes(engineId)
    ? shown.value.filter((x) => x !== engineId)
    : [...shown.value, engineId]
  save()
}
function drop(engineId: string) {
  shown.value = shown.value.filter((x) => x !== engineId)
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
    .filter((s) => s.engineId && s.id !== props.session.id && !shown.value.includes(s.engineId))
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
  if (!shown.value.includes(engineId)) {
    shown.value = [...shown.value, engineId]
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
  gap: 8px;
  overflow-y: auto;
}
/* Một ô hẹp hơn chừng này thì transcript không còn đọc được — dồn về một cột. */
@media (max-width: 900px) {
  .sgpanes {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}
</style>
