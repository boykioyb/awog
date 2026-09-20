<template>
  <!-- Quét sâu là luồng LẦN XUỐNG nhiều cấp. Để nó thành một khối ở đáy trang thì
       mỗi cú bấm lại phải cuộn xuống tìm kết quả, rồi cuộn lên chọn tiếp. Drawer
       đứng yên một chỗ trong suốt cả luồng. -->
  <div class="mondrwscrim" @click="emit('close')" />
  <aside class="mondrw" role="dialog" :aria-label="t('disk.tree.title')">
    <div class="mondrwhd">
      <button class="iconbtn" :disabled="!canGoUp" :title="t('disk.tree.up')" @click="emit('up')">
        <Icon name="chev-left" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <div class="mondrwttl">
        <div class="mondrwt">{{ t('disk.tree.title') }}</div>
        <!-- Breadcrumb, không phải một dòng đường dẫn chết: drawer chỉ hiện MỘT
             cấp mỗi lúc, nên đây là chỗ duy nhất cho thấy mình đang ở đâu trong
             cây và nhảy thẳng về cấp bất kỳ. -->
        <div class="mondrwcrumb mono">
          <template v-for="(c, i) in crumbs" :key="c.path">
            <!-- Không thêm dấu phân cách ngay sau gốc `/` — bản thân nó đã là
                 dấu gạch, thêm nữa thì hiện ra `/ / Applications`. -->
            <span v-if="i > 0 && crumbs[i - 1]?.name !== '/'" class="mondrwsep">/</span>
            <button
              class="mondrwseg"
              :class="{ on: i === crumbs.length - 1 }"
              :disabled="i === crumbs.length - 1"
              @click="emit('open', c.path)"
            >
              {{ c.name }}
            </button>
          </template>
        </div>
      </div>
      <!-- Hai việc làm với CHÍNH thư mục đang mở. Không gắn vào từng hàng: hàng
           đã là lưới 3 cột chật, thêm hai nút nữa là tên folder không còn chỗ.
           Từng hàng có menu chuột phải (dùng chung với tab Files của Sessions). -->
      <button class="iconbtn" :title="t('disk.reveal.action')" @click="emit('reveal', path)">
        <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button class="iconbtn" :title="t('disk.copyPath.action')" @click="emit('copy-path', path)">
        <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <!-- Xoá CHÍNH thư mục đang mở. Chỉ hiện khi nó nằm trong phạm vi xoá. -->
      <button
        v-if="canTrash(path)"
        class="iconbtn mondrwtrash"
        :title="t('disk.tree.trashCurrent')"
        @click="emit('trash-current')"
      >
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <!-- Quét lại là THỦ CÔNG: lần xuống rồi quay lại dùng kết quả đã có, vì mỗi
           lượt quét là một loạt tiến trình `du` cày đĩa. -->
      <button
        class="iconbtn"
        :disabled="loading"
        :title="t('disk.tree.rescan')"
        @click="emit('rescan')"
      >
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button class="iconbtn" :title="t('common.close')" @click="emit('close')">
        <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <!-- Tiến độ THẬT: tổng số mục biết ngay từ `readdir`, rồi mỗi mục đo xong là
         một bước. Thanh chạy theo tỉ lệ, không phải thanh chạy tới lui giả vờ. -->
    <!-- Nói rõ đây là kết quả CŨ: một con số dung lượng không kèm thời điểm thì
         người dùng không biết nó còn đúng không sau khi vừa xoá thứ gì. -->
    <!-- Cả thư mục nằm ngoài phạm vi xoá: nói MỘT lần ở đây, thay vì để hai mươi
         dòng `—` câm khiến người dùng tưởng nút xoá bị hỏng. -->
    <div v-if="!loading && entries.length > 0 && !anyTrashable" class="mondrwnote">
      <Icon name="info" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span>{{ t('disk.trash.outsideHomeNote') }}</span>
    </div>
    <div v-if="!loading && cachedAt > 0" class="mondrwcached">
      {{ t('disk.tree.cachedAt', { time: cachedTime }) }}
    </div>
    <div v-if="loading" class="mondrwprog">
      <div class="mondrwprogbar">
        <i
          :class="{ indet: total === 0 }"
          :style="total > 0 ? { width: `${donePct}%` } : undefined"
        />
      </div>
      <div class="mondrwproglbl">
        {{
          total > 0
            ? t('disk.tree.scanningAt', { n: entries.length, total, name: lastPath || '…' })
            : t('disk.tree.loading')
        }}
      </div>
    </div>

    <div class="mondrwbody">
      <div v-if="!loading && entries.length === 0" class="mondrwmsg">{{ t('disk.tree.none') }}</div>
      <div
        v-for="e in entries"
        :key="e.path"
        class="mondrwrow"
        @contextmenu="emit('menu', $event, e.path, e.isDir ? 'dir' : 'file')"
      >
        <!-- File không lần xuống được (`readdir` trên file là lỗi), nên nó KHÔNG
             phải nút — mời bấm một thứ chỉ để báo lỗi là tệ hơn không mời. -->
        <component
          :is="e.isDir ? 'button' : 'div'"
          class="mondrwname"
          :class="{ leaf: !e.isDir }"
          @click="e.isDir && emit('open', e.path)"
        >
          <span class="mondrwnmrow">
            <Icon
              :name="e.isDir ? 'folder' : 'file'"
              class="mondrwicn"
              :class="{ dir: e.isDir }"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            <!-- Tên bị cắt bằng `…` thì tooltip là đường dẫn ĐẦY ĐỦ: nó chứa
                 luôn tên, và còn trả lời "nó nằm ở đâu". -->
            <span class="mondrwnm" :title="e.path">{{ e.name }}</span>
            <Icon
              v-if="e.isDir"
              name="chev-right"
              class="mondrwgo"
              style="width: var(--icon-xs); height: var(--icon-xs)"
            />
          </span>
          <!-- Vạch tỉ lệ so với mục LỚN NHẤT trong cùng cấp: mắt so sánh hình
               nhanh hơn so sánh số, và đây đúng là việc "tìm cái nào nặng". -->
          <span class="mondrwbar">
            <i :style="{ width: `${share(e.sizeKb)}%` }" />
          </span>
        </component>
        <span class="mondrwsize tnum">{{ formatMem(e.sizeKb) }}</span>
        <div class="mondrwacts">
          <!-- Hiện trong Finder + Sao chép đường dẫn có ở MỌI hàng: chúng là thao
               tác ĐỌC, mà phạm vi đọc phủ cả đĩa. Trước đó chỉ có ở header nên
               muốn mở một thư mục con trong Finder thì phải lần xuống nó đã. -->
          <button class="iconbtn" :title="t('disk.reveal.action')" @click="emit('reveal', e.path)">
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
          <button
            class="iconbtn"
            :title="t('disk.copyPath.action')"
            @click="emit('copy-path', e.path)"
          >
            <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
          <!-- Đọc phủ cả đĩa, XOÁ thì chỉ trong thư mục nhà (Electron main cưỡng
               chế). Ngoài phạm vi đó thì ẩn nút — mời bấm một thứ chắc chắn bị từ
               chối là tệ hơn không mời. -->
          <button
            v-if="canTrash(e.path)"
            class="iconbtn mondrwtrash"
            :title="t('disk.trash.action')"
            @click="emit('trash', e.path, e.name, e.sizeKb)"
          >
            <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
          <!-- Ô giữ chỗ VÔ HÌNH, và chỉ khi danh sách này CÓ ít nhất một hàng xoá
               được. Nó giữ hai nút kia thẳng cột giữa hàng-xoá-được và
               hàng-không; còn ở thư mục ngoài nhà (không hàng nào xoá được) thì
               không ai render nó, nên không có dải trắng chết ở mép phải. -->
          <span v-else-if="anyTrashable" class="iconbtn mondrwslot" aria-hidden="true" />
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { formatMem } from '~/composables/useMonitorManager'
import type { TreeEntry } from '~/composables/useDiskManager'

const props = defineProps<{
  path: string
  entries: TreeEntry[]
  loading: boolean
  /** Mục vừa đo xong — nói "đang ở đâu" trong lúc còn chạy. */
  lastPath: string
  /** Tổng số mục con, biết ngay từ `readdir`. 0 = chưa liệt kê xong. */
  total: number
  /** Xoá được không — phạm vi xoá HẸP hơn phạm vi đọc. */
  canTrash: (path: string) => boolean
  /** Mốc của kết quả đang hiện; 0 = vừa quét xong. */
  cachedAt: number
  /** Còn đi lên được không — không cho leo ra khỏi thư mục nhà. */
  canGoUp: boolean
}>()

const emit = defineEmits<{
  (e: 'open', path: string): void
  (e: 'up'): void
  (e: 'close'): void
  (e: 'rescan'): void
  (e: 'trash-current'): void
  (e: 'trash', path: string, label: string, sizeKb?: number): void
  (e: 'reveal', path: string): void
  (e: 'copy-path', path: string): void
  (e: 'menu', ev: MouseEvent, path: string, kind: 'file' | 'dir'): void
}>()

const { t } = useI18n()

/**
 * Các cấp từ thư mục nhà tới thư mục đang mở. Cấp cuối là chỗ đang đứng (không
 * bấm được); các cấp trước bấm để nhảy thẳng về.
 */
const crumbs = computed(() => {
  // ⚠ Nhánh "ngoài thư mục nhà" từng trả về ĐÚNG MỘT mẩu (cả đường dẫn làm một
  // cục), mà mẩu cuối thì bị `disabled` — nên breadcrumb ở `/Applications/...`
  // hay bất cứ đâu ngoài `~` đều không bấm được. Dựng từ SEGMENT cho mọi đường
  // dẫn; `~` chỉ là cách rút gọn phần đầu khi nó nằm trong nhà.
  const home = /^(\/(?:Users|home)\/[^/]+)/.exec(props.path)?.[1]
  const base = home ? { name: '~', path: home } : { name: '/', path: '/' }
  const rest = (home ? props.path.slice(home.length) : props.path).split('/').filter(Boolean)
  const out = [base]
  let acc = home ?? ''
  for (const seg of rest) {
    acc = `${acc}/${seg}`
    out.push({ name: seg, path: acc })
  }
  return out
})

// Có mục nào xoá được không. Cả danh sách đều không thì bỏ hẳn cột nút và thay
// bằng một dòng giải thích — một cột toàn dấu gạch chỉ chiếm chỗ và gây hiểu nhầm.
const anyTrashable = computed(() => props.entries.some((e) => props.canTrash(e.path)))

const cachedTime = computed(() =>
  props.cachedAt > 0
    ? new Date(props.cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '',
)

const donePct = computed(() =>
  props.total > 0 ? Math.min(100, (props.entries.length / props.total) * 100) : 0,
)

const max = computed(() => Math.max(1, ...props.entries.map((x) => x.sizeKb)))
const share = (kb: number): number => Math.min(100, (kb / max.value) * 100)

// Esc đóng drawer. Nghe trên window vì drawer không giữ focus — người dùng có thể
// vừa cuộn bảng bên dưới vừa bấm Esc.
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* ⚠ `--topbar-h` KHÔNG TỒN TẠI trong repo (chỉ có `--statusbar-h`), nên bản đầu
   viết `top: var(--topbar-h, 48px)` thực chất là ghim cứng 48px — một con số
   không liên quan gì tới chiều cao thanh trên thật, để hở một dải ở đỉnh.
   Drawer chạy suốt chiều cao; chỉ chừa thanh trạng thái, đúng quy ước sẵn có của
   app (app-shell.css: "leave the status bar interactive while a drawer is open"). */
/* ⚠ `-webkit-app-region: no-drag` là BẮT BUỘC, không phải tuỳ chọn: thanh trên của
   app chính là thanh tiêu đề cửa sổ (`.top { -webkit-app-region: drag }`), và vùng
   kéo được tính ở tầng cửa sổ — một lớp phủ nằm ĐÈ lên nó mà không tự trừ mình ra
   thì click bị nuốt. Drawer chạy `top: 0` nên phần đầu nó nằm đúng dải đó: nút
   quay lại và breadcrumb bấm không ăn (lỗi đã đo). */
.mondrwscrim {
  position: fixed;
  inset: 0;
  bottom: var(--statusbar-h);
  z-index: 90;
  background: rgba(0, 0, 0, 0.28);
  -webkit-app-region: no-drag;
}
.mondrw {
  position: fixed;
  top: 0;
  right: 0;
  bottom: var(--statusbar-h);
  z-index: 91;
  width: min(440px, 92vw);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg, -8px 0 24px rgba(0, 0, 0, 0.18));
  -webkit-app-region: no-drag;
}
.mondrwhd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.mondrwttl {
  flex: 1 1 auto;
  min-width: 0;
}
.mondrwt {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.mondrwcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-family: var(--code); /* mono-ok: đường dẫn hệ thống, copy-paste được */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.mondrwsep {
  color: var(--textFaint);
}
.mondrwseg {
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--textDim);
  cursor: pointer;
}
.mondrwseg:hover:not(:disabled) {
  color: var(--accent);
  text-decoration: underline;
}
.mondrwseg.on {
  color: var(--textFaint);
  cursor: default;
}
.mondrwnmrow {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mondrwicn {
  flex: 0 0 auto;
  color: var(--textFaint);
}
/* Thư mục tô accent: đó là thứ bấm vào được, và mắt cần phân biệt ngay hai loại. */
.mondrwicn.dir {
  color: var(--accent);
}
.mondrwgo {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--textFaint);
  opacity: 0;
  transition: opacity 0.12s;
}
.mondrwrow:hover .mondrwgo {
  opacity: 1;
}
/* Thanh tiến độ KHÔNG xác định (indeterminate): `du` không cho biết còn bao
   nhiêu, nên một thanh chạy tới lui là trung thực hơn một phần trăm bịa. */
.mondrwnote {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.mondrwcached {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.mondrwprog {
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--border);
}
.mondrwprogbar {
  height: 3px; /* design-token-ok: độ dày vạch chính là hình dạng */
  border-radius: var(--r-pill);
  background: var(--bgActive);
  overflow: hidden;
}
.mondrwprogbar > i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width 0.2s linear;
}
/* Chỉ trong khoảnh khắc chưa biết tổng (`readdir` chưa xong) mới chạy tới lui —
   biết tổng rồi thì một thanh giả vờ là nói dối về tiến độ. */
.mondrwprogbar > i.indet {
  width: 35%;
  animation: mondrwslide 1.1s ease-in-out infinite;
}
@keyframes mondrwslide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mondrwprogbar > i.indet {
    animation: none;
    width: 100%;
    opacity: 0.4;
  }
}
.mondrwproglbl {
  margin-top: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mondrwbody {
  flex: 1 1 auto;
  overflow: auto;
  padding: 6px 6px 16px;
}
.mondrwmsg {
  padding: 16px;
  text-align: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
/* GRID, không phải flex: với flex, bề rộng cột dung lượng còn phụ thuộc vào độ
   dài tên ở CÙNG hàng, nên tên dài đẩy số lệch sang phải 14px (đo được) và cột
   số răng cưa. Ba cột cố định thì mọi hàng thẳng nhau bất kể nội dung. */
.mondrwrow {
  /* Cột hành động ghim theo trường hợp NHIỀU NÚT NHẤT (3 × 32px + 2 khoảng cách),
     không phải `auto`:
       • `auto` co theo từng hàng, mà số nút đổi theo hàng (mục ngoài thư mục nhà
         không có nút xoá) ⇒ cột Dung lượng xô lệch giữa các hàng — đo được 578 vs
         544 trên cùng một danh sách;
       • ghim theo trường hợp ÍT nút thì `flex-shrink` bóp nút thành viên thuốc
         hẹp (đúng lỗi vừa gặp ở bảng gợi ý dọn).
     Nhóm nút căn TRÁI trong cột đó, nên nút "Hiện trong Finder" và "Sao chép" nằm
     đúng một chỗ ở mọi hàng — chuột đi dọc danh sách không phải ngắm lại. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) 62px auto;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--r-sm);
}
/* Vô hình nhưng vẫn chiếm chỗ — và chiếm ĐÚNG khổ nút nhờ mang class `iconbtn`
   (32px ở theme awog, 30px ở cute). */
.mondrwslot {
  visibility: hidden;
}
.mondrwacts {
  display: flex;
  gap: 4px;
}
.mondrwacts > * {
  flex: 0 0 auto;
}
.mondrwrow:hover {
  background: var(--bgHover);
}
.mondrwname {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
/* File: không bấm được nên cũng không được giả vờ bấm được. */
.mondrwname.leaf {
  cursor: default;
}
/* ⚠ `min-width: 0` là thứ bắt buộc, không phải trang trí: flex item mặc định có
   `min-width: auto`, nghĩa là nó TỪ CHỐI co nhỏ hơn nội dung — nên `overflow:
   hidden` ở đây vô tác dụng và một tên thư mục dài (pnpm store đặt tên kiểu
   `https+++codeload.github.com+…`) tràn ra đè lên cột dung lượng và nút xoá. */
.mondrwnm {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mondrwbar {
  display: block;
  height: 3px; /* design-token-ok: độ dày vạch chính là hình dạng */
  border-radius: var(--r-pill);
  background: var(--bgActive);
  overflow: hidden;
}
.mondrwbar > i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
}
/* Căn phải trong cột cố định của grid: việc chính của panel này là SO SÁNH dung
   lượng, mà số xếp so le thì mắt không so được. */
.mondrwsize {
  text-align: right;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.mondrwtrash:hover {
  color: var(--danger);
  background: var(--dangerBg);
}
</style>
