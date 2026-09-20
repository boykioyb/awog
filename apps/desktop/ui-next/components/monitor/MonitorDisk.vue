<template>
  <div class="mondisk">
    <div v-if="error" class="monerr">
      <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ error }}
    </div>

    <!-- Ổ đĩa. Chỉ ổ chứa thư mục nhà + ổ gắn ngoài; các mount ảo của APFS bị lọc
         ở sidecar, nếu không sẽ hiện bảy dòng cùng dung lượng. -->
    <div class="mondiskvols">
      <div v-for="v in volumes" :key="v.filesystem" class="tile mondiskvol">
        <div class="monclbl">{{ v.mount }}</div>
        <div class="moncbig tnum" :style="{ color: levelColor(volLevel(v)) }">
          {{ formatMem(v.usedKb) }} / {{ formatMem(v.totalKb) }}
        </div>
        <div class="monmeter">
          <i :style="{ width: `${pct(v)}%`, background: levelColor(volLevel(v)) }" />
        </div>
        <div class="mondiskvolft">
          <span class="moncsub">
            {{ t('disk.free', { free: formatMem(v.freeKb), pct: Math.round(pct(v)) }) }}
          </span>
          <!-- Lối vào để trả lời "chỗ trống đi đâu". Không có nút này thì tab Đĩa
               chỉ có danh mục rác soạn sẵn, và mọi thứ ngoài danh mục đó vô hình. -->
          <button class="btn mondiskbrowse" :title="v.mount" @click="emit('open', v.mount)">
            <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('disk.browse') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Lối tắt tới những thư mục hay chiếm chỗ nhất, ngoài danh mục rác. -->
    <div class="mondiskroots">
      <span class="fd">{{ t('disk.roots.label') }}</span>
      <button v-for="r in roots" :key="r.path" class="btn" @click="emit('open', r.path)">
        <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ r.name }}
      </button>
    </div>

    <!-- Gợi ý dọn -->
    <div class="tile monsec">
      <div class="monsech">
        <span class="monsect">{{ t('disk.clean.title') }}</span>
        <span class="fd">{{ countLabel }}</span>
        <button class="btn monscanbtn" :disabled="measuring > 0" @click="emit('measure')">
          <!-- Thước, không phải khung quét: `scan` là bốn góc ngắm — nó đọc ra
               "quét mã QR", còn việc ở đây là ĐO dung lượng. -->
          <Icon name="ruler" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ buttonLabel }}
        </button>
      </div>
      <!-- Chỉ cộng mục "an toàn": gộp cả mục cần cân nhắc vào một con số "dọn được"
           là mời người dùng xoá thứ họ sẽ tiếc. -->
      <div v-if="totalSafeKb > 0" class="mondisksum">
        {{ t('disk.clean.total', { size: formatMem(totalSafeKb) }) }}
      </div>

      <table class="montbl">
        <thead>
          <tr>
            <th>{{ t('disk.clean.col.item') }}</th>
            <th class="num size">{{ t('disk.clean.col.size') }}</th>
            <th class="act" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in sorted" :key="x.id" @contextmenu="emit('menu', $event, x.path, 'dir')">
            <td>
              <div class="mondisknm">
                <!-- Icon theo LOẠI rác: hai mươi dòng chữ thuần thì phải đọc từng
                     dòng mới biết cái nào là cache, cái nào là kho gói. -->
                <Icon
                  :name="kindIcon(x.kind)"
                  class="mondiskicn"
                  :class="{ warn: x.safety === 'review' }"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
                <span class="mondisklbl mondiskdir" :title="x.label" @click="emit('open', x.path)">
                  {{ x.label }}
                </span>
                <span
                  class="tag"
                  :class="{ acc: x.safety === 'safe', warn: x.safety === 'review' }"
                >
                  {{ t(`disk.safety.${x.safety}`) }}
                </span>
              </div>
              <div class="mondiskhint">{{ x.hint }}</div>
              <div class="mondiskpath mono" :title="x.path">{{ x.path }}</div>
            </td>
            <td class="num size tnum">{{ sizeText(x.path) }}</td>
            <td class="act">
              <div class="mondiskacts">
                <!-- Quét sâu phải là một NÚT. Trước đó lối vào duy nhất là bấm vào
                   chữ tên mục — không có gì báo hiệu nó bấm được, nên coi như không
                   tồn tại với người chưa biết. -->
                <button class="iconbtn" :title="t('disk.tree.open')" @click="emit('open', x.path)">
                  <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
                <!-- Hiện trong Finder + Sao chép đường dẫn: hai việc người dùng
                     làm ngay sau khi thấy một mục to, trước cả khi quyết định xoá.
                     Cũng có trong menu chuột phải (dùng chung với tab Files của
                     Sessions), nhưng menu ẩn thì không ai đoán ra nó có. -->
                <button
                  class="iconbtn"
                  :title="t('disk.reveal.action')"
                  @click="emit('reveal', x.path)"
                >
                  <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
                <button
                  class="iconbtn"
                  :title="t('disk.copyPath.action')"
                  @click="emit('copy-path', x.path)"
                >
                  <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
                <!-- Cùng luật với drawer: đọc phủ cả đĩa, XOÁ chỉ trong nhà. Một
                     project nằm ở ổ ngoài vẫn sinh ra dòng `node_modules` ở đây,
                     và nút xoá của nó sẽ luôn bị Electron main từ chối. -->
                <button
                  v-if="canTrash(x.path)"
                  class="iconbtn mondisktrash"
                  :title="t('disk.trash.action')"
                  @click="emit('trash', x.path, x.label, sizes[x.path] ?? undefined)"
                >
                  <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </button>
                <!-- Mang luôn class `iconbtn` để LẤY ĐÚNG khổ nút: `.iconbtn` là
                     32px ở theme awog nhưng 30px ở theme cute, nên ghim con số ở
                     đây là lệch hàng ở một trong hai theme. Nó là `<span>` nên
                     không bấm được; viền/bóng bị khử bên dưới. -->
                <span v-else class="iconbtn mondisknotrash" :title="t('disk.trash.outsideHome')">
                  <Icon name="info" style="width: var(--icon-sm); height: var(--icon-sm)" />
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Dọn bằng công cụ.
         Có những chỗ Thùng rác KHÔNG với tới được: layer của Docker nằm trong
         máy ảo, simulator do CoreSimulator quản lý, kho gói của pnpm là hard-link
         nên xoá tay là hỏng mọi node_modules đang trỏ vào. Cách duy nhất đúng là
         để chính công cụ đó dọn phần thừa của nó.
         Lệnh hiện NGUYÊN VĂN ngay trên hàng — không giấu sau một cái nhãn — vì
         đây là nhóm xoá KHÔNG hoàn tác được, khác hẳn phần Thùng rác ở trên. -->
    <div v-if="cleanupActions.length > 0" class="tile monsec">
      <div class="monsech">
        <span class="monsect">{{ t('disk.cleanup.title') }}</span>
        <span class="fd mondiskcleansub">{{ t('disk.cleanup.subtitle') }}</span>
      </div>
      <div class="mondiskclean">
        <div v-for="a in cleanupActions" :key="a.id" class="mondiskcleanrow">
          <div class="mondiskcleanmain">
            <div class="mondiskcleanlbl">{{ a.label }}</div>
            <!-- mono-ok: dòng lệnh shell thật, người dùng copy thẳng vào terminal -->
            <div class="mondiskcleancmd" :title="a.command">{{ a.command }}</div>
            <div class="mondiskhint">{{ a.hint }}</div>
          </div>
          <button class="btn" :disabled="cleanupRunning !== ''" @click="emit('cleanup', a.id)">
            <Icon name="sparkles" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ cleanupRunning === a.id ? t('disk.cleanup.running') : t('disk.cleanup.run') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatMem, levelColor, type UsageLevel } from '~/composables/useMonitorManager'
import type { CleanupAction, DiskVolume, JunkTarget, SizeState } from '~/composables/useDiskManager'

const props = defineProps<{
  volumes: DiskVolume[]
  targets: JunkTarget[]
  sizes: Record<string, SizeState>
  measuring: number
  measured: number
  /** Tiến độ lượt đo hiện tại; `measureTotal = 0` ⇒ không có lượt nào đang chạy. */
  measureDone: number
  measureTotal: number
  /** Thư mục nhà, để dựng lối vào quét. */
  home: string
  /** Đã đo hết ⇒ nút nói "Đo lại", vì bấm nữa là đo LẠI chứ không phải đo tiếp. */
  allMeasured: boolean
  totalSafeKb: number
  error: string
  /** Xoá được không — phạm vi xoá HẸP hơn phạm vi đọc (chỉ trong thư mục nhà). */
  canTrash: (path: string) => boolean
  cleanupActions: CleanupAction[]
  /** Id đang chạy — khoá mọi nút, vì các lệnh này đụng cùng một đĩa. */
  cleanupRunning: string
}>()

const emit = defineEmits<{
  (e: 'measure'): void
  (e: 'open', path: string): void
  (e: 'trash', path: string, label: string, sizeKb?: number): void
  (e: 'cleanup', id: string): void
  (e: 'reveal', path: string): void
  (e: 'copy-path', path: string): void
  (e: 'menu', ev: MouseEvent, path: string, kind: 'file' | 'dir'): void
}>()

const { t } = useI18n()

/**
 * Lối vào quét nhanh. `home` đến từ sidecar chứ không đoán ở renderer; các mục
 * còn lại là nơi chiếm chỗ lớn quen thuộc trên macOS/Linux mà danh mục rác
 * không phủ (ứng dụng đã cài, thư viện hệ thống).
 */
const roots = computed(() => {
  const out: { name: string; path: string }[] = []
  if (props.home) out.push({ name: t('disk.roots.home'), path: props.home })
  out.push({ name: t('disk.roots.apps'), path: '/Applications' })
  // ⚠ "Toàn ổ" là mount của ổ CHỨA THƯ MỤC NHÀ, không phải `/`. Trên APFS, `/`
  // là volume hệ thống niêm phong còn dữ liệu người dùng nằm ở volume Data, mà
  // `du -x` dừng ở biên filesystem — quét `/` ra 32 GB Applications mà KHÔNG có
  // `/Users`, tức một bức tranh sai về chỗ trống đã đi đâu (đo được).
  const dataVolume = props.volumes[0]?.mount
  if (dataVolume) out.push({ name: t('disk.roots.root'), path: dataVolume })
  return out
})

const countLabel = computed(() =>
  props.measureTotal > 0
    ? t('disk.clean.progress', { done: props.measureDone, total: props.measureTotal })
    : t('disk.clean.count', { n: props.targets.length, done: props.measured }),
)

const buttonLabel = computed(() =>
  props.measuring > 0
    ? t('disk.clean.scanning')
    : props.allMeasured
      ? t('disk.clean.rescan')
      : t('disk.clean.scan'),
)

const pct = (v: DiskVolume): number => (v.totalKb > 0 ? (v.usedKb / v.totalKb) * 100 : 0)

// Ổ gần đầy là vấn đề THẬT (máy bắt đầu hỏng hành vi ở ~95%), nên ngưỡng cao hơn
// RAM: 85% vàng, 93% đỏ.
const volLevel = (v: DiskVolume): UsageLevel => {
  const p = pct(v)
  return p >= 93 ? 'high' : p >= 85 ? 'warn' : 'ok'
}

// Chưa đo hiện "—", đo hỏng hiện "?" — hai trạng thái khác nhau, đừng gộp thành 0.
const sizeText = (path: string): string => {
  const s = props.sizes[path]
  if (s === undefined) return '—'
  if (s === null) return '?'
  return formatMem(s)
}

/**
 * Icon theo loại rác. Chọn theo THỨ SẼ MẤT, không theo thư mục nằm ở đâu:
 * cache/build tự sinh lại (`refresh`/`layers`), kho gói phải tải lại (`download`),
 * log là một danh sách dòng (`listul`), thùng rác là thùng rác.
 */
function kindIcon(kind: JunkTarget['kind']): string {
  if (kind === 'store') return 'download'
  if (kind === 'logs') return 'listul'
  if (kind === 'trash') return 'trash'
  if (kind === 'build') return 'layers'
  return 'refresh'
}

const sorted = computed(() =>
  [...props.targets].sort((a, b) => (props.sizes[b.path] ?? -1) - (props.sizes[a.path] ?? -1)),
)
</script>

<style scoped>
.mondisk {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mondiskvols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
}
.mondiskroots {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.mondiskvolft {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mondiskbrowse {
  flex: 0 0 auto;
}
.mondiskvol {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.monclbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.moncbig {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
}
.moncsub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.monmeter {
  height: 4px; /* design-token-ok: độ dày vạch chính là hình dạng */
  border-radius: var(--r-pill);
  background: var(--bgActive);
  overflow: hidden;
}
.monmeter > i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 0.25s ease;
}
.monsec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 4px;
}
.monsech {
  display: flex;
  align-items: center;
  gap: 8px;
}
.monsect {
  /* Tiêu đề không được co: nhãn phụ bên cạnh dài hơn nhiều, flex mặc định sẽ
     bóp chính cái tên mục xuống hai dòng ("Dọn bằng công / cụ"). */
  flex: 0 0 auto;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.monscanbtn {
  margin-left: auto;
}
.mondisksum {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.montbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  table-layout: fixed;
}
.montbl th {
  text-align: left;
  padding: 6px 10px;
  color: var(--textFaint);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.montbl th.num,
.montbl td.num {
  text-align: right;
}
.montbl th.size,
.montbl td.size {
  width: 92px;
}
.montbl th.act,
.montbl td.act {
  /* BỐN nút cạnh nhau: 4 × 32px + 3 × 4px khoảng cách + padding ô 20px.
     ⚠ Cột này từng ghim 88px (đúng cho hai nút). Thêm nút thứ ba và tư thì con
     flex bị BÓP — `width: 32px` chỉ là basis, `flex-shrink` mặc định là 1 — nên
     bốn nút vuông biến thành bốn viên thuốc hẹp. `flex: 0 0 auto` bên dưới khiến
     lần sau thêm nút sẽ TRÀN (nhìn thấy ngay) thay vì âm thầm bóp cả hàng. */
  width: 160px;
  text-align: right;
}
/* Ô `td` không tự xếp ngang được (padding ăn mất chỗ rồi nút rơi xuống dòng),
   nên bọc hai nút trong một hàng flex. */
.mondiskacts {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.mondiskacts > * {
  flex: 0 0 auto;
}
.montbl td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
  vertical-align: top;
}
.mondisknm {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.mondiskicn {
  flex: 0 0 auto;
  color: var(--accent);
}
/* Mục "cân nhắc" dùng màu cảnh báo cho khớp với thẻ bên cạnh nó. */
.mondiskicn.warn {
  color: var(--amber);
}
.mondisklbl {
  color: var(--text);
  white-space: nowrap;
}
.mondiskdir {
  cursor: pointer;
}
.mondiskdir:hover {
  color: var(--accent);
  text-decoration: underline;
}
.mondiskhint {
  margin-top: 2px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
/* Đường dẫn là thứ người dùng copy vào terminal để tự kiểm ⇒ mono hợp lệ. */
.mondiskpath {
  margin-top: 2px;
  font-family: var(--code); /* mono-ok: đường dẫn hệ thống, copy-paste được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mondisktrash:hover {
  color: var(--danger);
  background: var(--dangerBg);
}
.monerr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* Dọn bằng công cụ — mỗi hàng: nhãn + lệnh + giải thích, nút ở cuối.
   Grid chứ không flex: cột nút phải thẳng hàng giữa các hàng, và `1fr` kèm
   `min-width: 0` là thứ duy nhất cho lệnh dài cắt ellipsis thay vì đẩy nút
   tràn ra ngoài thẻ. */
.mondisknotrash {
  border-color: transparent;
  box-shadow: none;
  color: var(--textFaint);
  cursor: default;
}
.mondiskcleansub {
  min-width: 0;
}
.mondiskclean {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.mondiskcleanrow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border-radius: var(--r-sm);
}
.mondiskcleanrow:hover {
  background: var(--bgHover);
}
.mondiskcleanmain {
  min-width: 0;
}
.mondiskcleanlbl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.mondiskcleancmd {
  margin-top: 2px;
  overflow: hidden;
  /* mono-ok: dòng lệnh shell thật — người dùng đối chiếu/copy vào terminal. */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
