<template>
  <!-- Màn Dịch vụ (task 3.8): danh mục theo NHÓM VIỆC, ba mức hỗ trợ, ghim đổi
       sidebar, và một ô tìm kiếm ⌘K quét cả danh mục lẫn những dòng đã nạp.
       Đây là MẶT DANH MỤC của tab "Dịch vụ" — không phải tab riêng, cũng không
       phải hộp thoại (2026-09-14: "khám phá là page con trong dịch vụ thôi chứ?").
       Danh mục 102 dịch vụ vẫn cần chỗ rộng, nên nó chiếm trọn vùng bảng của tab;
       cột dịch vụ đã ghim thì nằm trong khung Explorer. -->
  <div class="ixc">
    <header class="ixc-hd">
      <!-- Chỉ hiện khi THẬT SỰ có view để quay về: một nút dẫn tới khung trống còn
           tệ hơn không có nút (cùng luật với nút ↗ ở màn Nhật ký). -->
      <button
        v-if="closable"
        class="btn sm"
        type="button"
        :title="t('infra.explorer.services.back')"
        @click="$emit('close')"
      >
        <Icon name="chev-left" />
        {{ t('infra.explorer.services.back') }}
      </button>
      <Icon name="layers" />
      <span class="ixc-ttl">{{ t('infra.explorer.services.title') }}</span>
      <label class="srch ixc-srch">
        <Icon name="search" />
        <input ref="searchEl" v-model="q" :placeholder="t('infra.explorer.services.search')" />
        <span class="ixc-kbd">⌘K</span>
      </label>
      <!-- Nút ⓘ ở góc phải. `title` trên badge chỉ giúp người biết cần rê chuột;
           người mới thì không biết mà rê. Một chỗ bấm ra lời giải thích là thứ
           thiếu sau khi nhãn cũ ("Full screen in the app") bị hỏi lại.

           Lời giải thích mở dưới dạng POPOVER neo vào chính nút, không phải khối
           đẩy nội dung xuống. Bản trước chèn một <section> ngay dưới header; đọc
           thì được nhưng nó ĐẨY cả lưới thẻ xuống, và mỗi lần xem lại nhãn là một
           lần xô lệch trang (2026-09-14: "sao không hiện dưới dạng popover").
           Dùng chung khuôn `iwrap`/`ibackdrop`/`ipop` của ba chip hạ tầng — bấm ra
           ngoài để đóng, nên vẫn nhìn thấy thẻ phía sau như bản cũ. -->
      <span class="iwrap ixc-info">
        <button
          class="iconbtn"
          type="button"
          :aria-label="t('infra.explorer.levels.open')"
          :aria-expanded="infoOpen"
          :title="t('infra.explorer.levels.open')"
          @click.stop="infoOpen = !infoOpen"
        >
          <Icon name="info" />
        </button>
        <template v-if="infoOpen">
          <div class="ibackdrop" @click="infoOpen = false" />
          <!-- Bảng chú giải dùng CHÍNH những badge đang có trên thẻ, không phải ảnh
               hay mô tả bằng lời: người đọc đối chiếu được ngay giữa chú giải và
               thẻ. Neo phải (`right: 0`) vì nút nằm sát mép phải header. -->
          <div
            class="pop ipop ixc-ipop"
            role="region"
            :aria-label="t('infra.explorer.levels.title')"
            @click.stop
          >
            <div class="ixc-legend-hd">
              <span class="ixc-legend-ttl">{{ t('infra.explorer.levels.title') }}</span>
              <button
                class="iconbtn ixc-legend-x"
                type="button"
                :aria-label="t('common.close')"
                @click="infoOpen = false"
              >
                <Icon name="x" />
              </button>
            </div>
            <p class="ixc-legend-intro">{{ t('infra.explorer.levels.intro') }}</p>
            <ul class="ixc-legend-list">
              <li v-for="lv in LEVELS" :key="lv" class="ixc-legend-row">
                <span class="chip" :class="`lv-${lv}`">
                  {{ t(`infra.explorer.support.${lv}`) }}
                </span>
                <span class="ixc-legend-body">{{ t(`infra.explorer.support.hint.${lv}`) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </span>
    </header>

    <!-- Băng "danh mục mẫu". BẮT BUỘC phải có: bản mẫu trông y hệt bản thật (cùng
         dịch vụ, cùng nhãn, cùng nút), nên thiếu băng này thì người đọc sẽ hiểu nó
         là tài khoản của mình. Đây là cái giá của việc cho web hiện danh mục. -->
    <p v-if="mock" class="ixc-mock">
      <Icon name="alert" class="ixc-mock-ic" />
      <span>{{ t('infra.explorer.services.mock') }}</span>
    </p>

    <!-- Kết quả quét DÒNG đã nạp. Đây là đường duy nhất trong app trả lời "tôi vừa
         thấy cái này ở đâu" mà không phải nhớ tên dịch vụ trước. -->
    <div v-if="hits.length" class="ixc-hits">
      <div class="ixc-gh">{{ t('infra.explorer.services.rowHits') }}</div>
      <button
        v-for="hit in hits"
        :key="hit.viewId + hit.name"
        class="ixc-hit"
        type="button"
        @click="$emit('open-view', { viewId: hit.viewId, values: hit.values })"
      >
        <span class="ixc-hit-name">{{ hit.name }}</span>
        <span class="ixc-hit-view">{{ t(hit.label) }}</span>
      </button>
    </div>

    <div class="ixc-body">
      <section v-for="g in filteredGroups" :key="g" class="ixc-group">
        <div class="ixc-gh">{{ t(`infra.explorer.group.${g}`) }}</div>
        <div class="ixc-grid">
          <div
            v-for="s in grouped()[g]"
            :key="s.id"
            class="ixc-card"
            :class="{ inuse: inUse.has(s.id) }"
          >
            <div class="ixc-card-hd">
              <span class="ixc-name">{{ t(s.label) }}</span>
              <button
                class="ixc-pin"
                :class="{ on: pinned.includes(s.id) }"
                type="button"
                :title="
                  t(
                    pinned.includes(s.id)
                      ? 'infra.explorer.pinned.remove'
                      : 'infra.explorer.pinned.add',
                  )
                "
                @click="$emit('pin', s.id)"
              >
                <Icon name="pin" />
              </button>
            </div>
            <p class="ixc-about">{{ t(s.about) }}</p>
            <div class="ixc-card-ft">
              <!-- Ba mức hỗ trợ, mỗi mức một câu người đọc được. Nhãn không được là
                   "full/list/console" — người dùng không nói tiếng đó.

                   Nhãn phải nói NGƯỜI DÙNG LÀM ĐƯỢC GÌ, không nói AWOG đã dựng tới
                   đâu. Bản cũ ghi "Full screen in the app" cho mức `full`; người
                   dùng đọc thành "mở toàn màn hình" và hỏi lại badge này nghĩa là
                   gì (2026-09-14). `title` giữ phần giải thích đầy đủ cho ai cần,
                   còn nhãn thì đứng một mình vẫn hiểu được. -->
              <span
                class="chip"
                :class="`lv-${s.level}`"
                :title="t(`infra.explorer.support.hint.${s.level}`)"
              >
                {{ t(`infra.explorer.support.${s.level}`) }}
              </span>
              <span v-if="inUse.has(s.id)" class="chip inuse">
                {{ t('infra.explorer.services.inUse') }}
              </span>
              <button
                v-if="s.target.kind !== 'console'"
                class="btn sm ixc-go"
                type="button"
                @click="$emit('open-target', s.target)"
              >
                <Icon name="chev-right" />
              </button>
              <button
                v-else-if="s.consoleUrl"
                class="btn sm ixc-go"
                type="button"
                :title="t('infra.explorer.console')"
                @click="$emit('console', s.consoleUrl)"
              >
                <Icon name="external" />
              </button>
            </div>
          </div>
        </div>
      </section>
      <!-- Ba trạng thái trống KHÁC NHAU, không được gộp làm một. "Không dịch vụ nào
           khớp" là câu nói về Ô TÌM; khi danh mục chưa nạp được thì câu đúng là
           "chưa đọc được", kèm lý do và một nút thử lại. Gộp chúng lại từng làm
          người dùng tưởng AWOG không có dịch vụ nào (2026-09-14). -->
      <p v-if="error && !services.length" class="ixc-empty" :class="{ err: error === 'failed' }">
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
        <button v-if="error === 'failed'" class="btn sm" type="button" @click="$emit('retry')">
          <Icon name="refresh" />
          {{ t('infra.explorer.services.retry') }}
        </button>
      </p>
      <p v-else-if="loading && !services.length" class="ixc-empty">
        {{ t('infra.explorer.loading') }}
      </p>
      <p v-else-if="!filteredGroups.length" class="ixc-empty">
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
  // Esc đóng popover chú giải. Cần riêng cho bàn phím: đường đóng còn lại là bấm
  // ra ngoài (`.ibackdrop`), mà bàn phím thì không bấm ra ngoài được.
  if (e.key === 'Escape' && infoOpen.value) infoOpen.value = false
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchEl.value?.focus()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.ixc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ixc-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Đệm trên 8px không phải chuyện thẩm mỹ: hàng này là nội dung ĐẦU TIÊN của
     pane, mà pane không có đệm trên. Đo khoảng từ vạch phân cách của thanh tab
     xuống chữ đầu tiên ở 6 tab: Tổng quan 20 · Nhật ký 16 · Logs 14 · Tài khoản
     12 · Kubernetes 10 · **Dịch vụ 6**. 8px này đưa Dịch vụ về 14px, đúng dải
     của các tab còn lại (ảnh chụp 2026-09-14: "đang thiếu margin top"). */
  padding: 8px 16px 8px;
  color: var(--textMuted);
}

.ixc-ttl {
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
}

.ixc-srch {
  max-width: 320px;
}

/* `margin-left: auto` nằm trên `.iwrap` (nay là con flex của header) để nút vẫn
   ở góc phải; `flex: 0 0 auto` để ô tìm co lại trước, không phải nút. */
.ixc-info {
  margin-left: auto;
  flex: 0 0 auto;
}

/* Neo phải: nút ⓘ sát mép phải header, neo trái thì popover thò ra ngoài cửa sổ.
   Rộng hơn `.ipop` mặc định (296px) vì ở đây có ba đoạn giải thích. */
.ixc-ipop {
  left: auto;
  right: 0;
  top: 128%;
  width: 320px;
  max-width: calc(100vw - 32px);
}

.ixc-legend-hd {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ixc-legend-ttl {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixc-legend-x {
  width: 24px;
  height: 24px;
  border: none;
}

.ixc-legend-intro {
  margin: 4px 0 8px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixc-legend-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Trong popover 320px, xếp nhãn TRÊN câu giải thích chứ không hai cột: cột nhãn
   lấy bề rộng của nhãn dài nhất ("Mở trong Console AWS") sẽ bóp cột chữ còn ~140px
   và câu giải thích xuống dòng liên tục. `align-items: flex-start` để chip không
   bị kéo dài hết bề ngang (mặc định của flex column là stretch). */
.ixc-legend-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 0;
}

/* Vạch mảnh giữa ba mức: nhãn mức sau nằm ngay dưới câu giải thích mức trước, không
   có vạch thì hai mức đọc liền thành một khối. Vạch trên mức đầu và dưới mức cuối
   là thừa (đã có viền popover / khoảng của `.ixc-legend-intro`). */
.ixc-legend-row + .ixc-legend-row {
  border-top: 1px solid var(--border);
}

.ixc-legend-row:first-child {
  padding-top: 0;
}

.ixc-legend-row:last-child {
  padding-bottom: 0;
}

.ixc-legend-body {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixc-mock {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 16px 8px;
  padding: 8px 10px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-sm);
  background: var(--amberDim);
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixc-mock-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--amber);
}

.ixc-kbd {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 1px 5px;
}

.ixc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 16px 16px;
}

.ixc-hits {
  padding: 0 16px;
}

.ixc-hit {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.ixc-hit-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixc-hit-view {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ixc-gh {
  padding: 10px 2px 6px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
}

.ixc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.ixc-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}

.ixc-card.inuse {
  border-color: var(--accentBorder);
}

.ixc-card-hd {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ixc-name {
  flex: 1;
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixc-pin {
  border: none;
  background: transparent;
  color: var(--textFaint);
  cursor: pointer;
  padding: 2px;
}

.ixc-pin.on {
  color: var(--accent);
}

.ixc-about {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixc-card-ft {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
}

.ixc-go {
  margin-left: auto;
}

.chip.lv-full {
  color: var(--green);
  border-color: var(--green);
}

.chip.lv-console {
  color: var(--textDim);
}

.chip.inuse {
  color: var(--accent);
  border-color: var(--accentBorder);
}

.ixc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 20px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}

.ixc-empty.err {
  color: var(--red);
}
</style>
