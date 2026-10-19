<template>
  <!-- Quét sâu là luồng LẦN XUỐNG nhiều cấp. Để nó thành một khối ở đáy trang thì
       mỗi cú bấm lại phải cuộn xuống tìm kết quả, rồi cuộn lên chọn tiếp. Drawer
       đứng yên một chỗ trong suốt cả luồng.
       Không dùng `Sheet`: Sheet là dialog modal (z-170, khoá pointer-events của
       body) nên menu chuột phải dùng chung (AppContextMenu, render ngoài drawer)
       sẽ không bấm được, và nó phủ cả thanh trạng thái. Drawer giữ band z 90/91.
       Drawer chạy suốt chiều cao, chỉ chừa thanh trạng thái (`--statusbar-h`).
       `-webkit-app-region: no-drag` là BẮT BUỘC: thanh trên của app chính là thanh
       tiêu đề cửa sổ (vùng kéo), drawer chạy `top-0` nên phần đầu nó nằm đúng dải
       đó — thiếu no-drag thì nút quay lại và breadcrumb bấm không ăn (lỗi đã đo). -->
  <div
    class="fixed inset-0 bottom-(--statusbar-h) z-90 bg-black/28 [-webkit-app-region:no-drag]"
    @click="emit('close')"
  />
  <aside
    class="fixed top-0 right-0 bottom-(--statusbar-h) z-91 flex w-[min(440px,92vw)] flex-col border-l bg-background shadow-lg [-webkit-app-region:no-drag]"
    role="dialog"
    data-state="open"
    :aria-label="t('disk.tree.title')"
  >
    <div class="flex items-center gap-2 border-b px-3 py-2.5">
      <Button
        :disabled="!canGoUp"
        :title="t('disk.tree.up')"
        variant="outline"
        size="iconMd"
        @click="emit('up')"
      >
        <Icon name="chev-left" />
      </Button>
      <div class="min-w-0 flex-auto">
        <div class="text-base text-foreground">{{ t('disk.tree.title') }}</div>
        <!-- Breadcrumb, không phải một dòng đường dẫn chết: drawer chỉ hiện MỘT
             cấp mỗi lúc, nên đây là chỗ duy nhất cho thấy mình đang ở đâu trong
             cây và nhảy thẳng về cấp bất kỳ. Đường dẫn hệ thống ⇒ mono hợp lệ. -->
        <div class="flex flex-wrap items-center gap-0.5 font-mono text-xs">
          <template v-for="(c, i) in crumbs" :key="c.path">
            <!-- Không thêm dấu phân cách ngay sau gốc `/` — bản thân nó đã là
                 dấu gạch, thêm nữa thì hiện ra `/ / Applications`. -->
            <span v-if="i > 0 && crumbs[i - 1]?.name !== '/'" class="text-faint">/</span>
            <Button
              variant="link"
              class="h-auto p-0 font-mono text-xs font-normal text-dim hover:text-primary disabled:text-faint disabled:opacity-100"
              :disabled="i === crumbs.length - 1"
              @click="emit('open', c.path)"
            >
              {{ c.name }}
            </Button>
          </template>
        </div>
      </div>
      <!-- Hai việc làm với CHÍNH thư mục đang mở. Không gắn vào từng hàng: hàng
           đã là lưới 3 cột chật, thêm hai nút nữa là tên folder không còn chỗ.
           Từng hàng có menu chuột phải (dùng chung với tab Files của Sessions). -->
      <Button
        :title="t('disk.reveal.action')"
        variant="outline"
        size="iconMd"
        @click="emit('reveal', path)"
      >
        <Icon name="folder" />
      </Button>
      <Button
        :title="t('disk.copyPath.action')"
        variant="outline"
        size="iconMd"
        @click="emit('copy-path', path)"
      >
        <Icon name="copy" />
      </Button>
      <!-- Xoá CHÍNH thư mục đang mở. Chỉ hiện khi nó nằm trong phạm vi xoá. -->
      <Button
        v-if="canTrash(path)"
        :title="t('disk.tree.trashCurrent')"
        class="hover:bg-destructive/10 hover:text-destructive"
        variant="outline"
        size="iconMd"
        @click="emit('trash-current')"
      >
        <Icon name="trash" />
      </Button>
      <!-- Quét lại là THỦ CÔNG: lần xuống rồi quay lại dùng kết quả đã có, vì mỗi
           lượt quét là một loạt tiến trình `du` cày đĩa. -->
      <Button
        :disabled="loading"
        :title="t('disk.tree.rescan')"
        variant="outline"
        size="iconMd"
        @click="emit('rescan')"
      >
        <Icon name="refresh" />
      </Button>
      <Button :title="t('common.close')" variant="outline" size="iconMd" @click="emit('close')">
        <Icon name="x" />
      </Button>
    </div>

    <!-- Tiến độ THẬT: tổng số mục biết ngay từ `readdir`, rồi mỗi mục đo xong là
         một bước. Thanh chạy theo tỉ lệ, không phải thanh chạy tới lui giả vờ. -->
    <!-- Nói rõ đây là kết quả CŨ: một con số dung lượng không kèm thời điểm thì
         người dùng không biết nó còn đúng không sau khi vừa xoá thứ gì. -->
    <!-- Cả thư mục nằm ngoài phạm vi xoá: nói MỘT lần ở đây, thay vì để hai mươi
         dòng `—` câm khiến người dùng tưởng nút xoá bị hỏng. -->
    <div
      v-if="!loading && entries.length > 0 && !anyTrashable"
      class="flex items-start gap-1.5 border-b px-3 py-2 text-xs text-dim"
    >
      <Icon name="info" class="size-3.5 shrink-0" />
      <span>{{ t('disk.trash.outsideHomeNote') }}</span>
    </div>
    <div v-if="!loading && cachedAt > 0" class="border-b px-3 py-1.5 text-xs text-faint">
      {{ t('disk.tree.cachedAt', { time: cachedTime }) }}
    </div>
    <div v-if="loading" class="border-b px-3 pt-2 pb-2.5">
      <!-- px-ok: vạch tiến độ 3px — độ dày chính là hình dạng -->
      <div class="h-[3px] overflow-hidden rounded-full bg-muted">
        <i
          class="block h-full rounded-full bg-primary transition-[width] duration-200 ease-linear"
          :class="{ 'mondrw-indet w-[35%]': total === 0 }"
          :style="total > 0 ? { width: `${donePct}%` } : undefined"
        />
      </div>
      <div class="mt-1.5 truncate text-xs text-faint">
        {{
          total > 0
            ? t('disk.tree.scanningAt', { n: entries.length, total, name: lastPath || '…' })
            : t('disk.tree.loading')
        }}
      </div>
    </div>

    <div class="flex-auto overflow-auto px-1.5 pt-1.5 pb-4">
      <div v-if="!loading && entries.length === 0" class="p-4 text-center text-sm text-faint">
        {{ t('disk.tree.none') }}
      </div>
      <!-- GRID, không phải flex: với flex, bề rộng cột dung lượng còn phụ thuộc vào
           độ dài tên ở CÙNG hàng, nên tên dài đẩy số lệch sang phải 14px (đo được)
           và cột số răng cưa. Ba cột cố định thì mọi hàng thẳng nhau bất kể nội dung.
           Cột hành động `auto` + ô giữ chỗ vô hình: nhóm nút căn TRÁI trong cột đó,
           nên "Hiện trong Finder" và "Sao chép" nằm đúng một chỗ ở mọi hàng. -->
      <div
        v-for="e in entries"
        :key="e.path"
        class="group grid grid-cols-[minmax(0,1fr)_62px_auto] items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
        @contextmenu="emit('menu', $event, e.path, e.isDir ? 'dir' : 'file')"
      >
        <!-- File không lần xuống được (`readdir` trên file là lỗi), nên nó KHÔNG
             phải nút — mời bấm một thứ chỉ để báo lỗi là tệ hơn không mời. -->
        <component
          :is="e.isDir ? 'button' : 'div'"
          class="flex min-w-0 flex-col gap-1 border-none bg-transparent py-0.5 text-left"
          :class="e.isDir ? 'cursor-pointer' : 'cursor-default'"
          @click="e.isDir && emit('open', e.path)"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <!-- Thư mục tô accent: đó là thứ bấm vào được, và mắt cần phân biệt
                 ngay hai loại. -->
            <Icon
              :name="e.isDir ? 'folder' : 'file'"
              class="size-3.5 shrink-0"
              :class="e.isDir ? 'text-primary' : 'text-faint'"
            />
            <!-- Tên bị cắt bằng `…` thì tooltip là đường dẫn ĐẦY ĐỦ: nó chứa
                 luôn tên, và còn trả lời "nó nằm ở đâu". `min-w-0` là BẮT BUỘC:
                 flex item mặc định từ chối co nhỏ hơn nội dung, nên tên dài
                 (`https+++codeload.github.com+…`) tràn đè lên cột dung lượng. -->
            <span class="min-w-0 shrink truncate text-sm text-foreground" :title="e.path">
              {{ e.name }}
            </span>
            <Icon
              v-if="e.isDir"
              name="chev-right"
              class="ml-auto size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
            />
          </span>
          <!-- Vạch tỉ lệ so với mục LỚN NHẤT trong cùng cấp: mắt so sánh hình
               nhanh hơn so sánh số, và đây đúng là việc "tìm cái nào nặng". -->
          <!-- px-ok: vạch tỉ lệ 3px — độ dày chính là hình dạng -->
          <span class="block h-[3px] overflow-hidden rounded-full bg-muted">
            <i
              class="block h-full rounded-full bg-primary"
              :style="{ width: `${share(e.sizeKb)}%` }"
            />
          </span>
        </component>
        <!-- Căn phải trong cột cố định: việc chính của panel này là SO SÁNH dung
             lượng, mà số xếp so le thì mắt không so được. -->
        <span class="text-right text-sm tabular-nums text-dim">{{ formatMem(e.sizeKb) }}</span>
        <div class="flex gap-1 *:shrink-0">
          <!-- Hiện trong Finder + Sao chép đường dẫn có ở MỌI hàng: chúng là thao
               tác ĐỌC, mà phạm vi đọc phủ cả đĩa. Trước đó chỉ có ở header nên
               muốn mở một thư mục con trong Finder thì phải lần xuống nó đã. -->
          <Button
            :title="t('disk.reveal.action')"
            variant="outline"
            size="iconMd"
            @click="emit('reveal', e.path)"
          >
            <Icon name="folder" />
          </Button>
          <Button
            :title="t('disk.copyPath.action')"
            variant="outline"
            size="iconMd"
            @click="emit('copy-path', e.path)"
          >
            <Icon name="copy" />
          </Button>
          <!-- Đọc phủ cả đĩa, XOÁ thì chỉ trong thư mục nhà (Electron main cưỡng
               chế). Ngoài phạm vi đó thì ẩn nút — mời bấm một thứ chắc chắn bị từ
               chối là tệ hơn không mời. -->
          <Button
            v-if="canTrash(e.path)"
            :title="t('disk.trash.action')"
            class="hover:bg-destructive/10 hover:text-destructive"
            variant="outline"
            size="iconMd"
            @click="emit('trash', e.path, e.name, e.sizeKb)"
          >
            <Icon name="trash" />
          </Button>
          <!-- Ô giữ chỗ VÔ HÌNH (đúng khổ nút icon `size-ctrl-sm`), và chỉ khi danh
               sách này CÓ ít nhất một hàng xoá được. Nó giữ hai nút kia thẳng cột
               giữa hàng-xoá-được và hàng-không; còn ở thư mục ngoài nhà thì không
               ai render nó, nên không có dải trắng chết ở mép phải. -->
          <span v-else-if="anyTrashable" class="invisible size-ctrl-sm" aria-hidden="true" />
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { formatMem } from '~/composables/useMonitorManager'
import type { TreeEntry } from '~/composables/useDiskManager'
import Button from '~/components/ui/button/Button.vue'

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
/* style-ok: @keyframes thanh tiến độ KHÔNG xác định — tw-animate-css không có kiểu
   "chạy tới lui". Chỉ trong khoảnh khắc chưa biết tổng (`readdir` chưa xong) mới
   chạy; biết tổng rồi thì một thanh giả vờ là nói dối về tiến độ. */
.mondrw-indet {
  animation: mondrw-slide 1.1s ease-in-out infinite;
}
@keyframes mondrw-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mondrw-indet {
    animation: none;
    width: 100%;
    opacity: 0.4;
  }
}
</style>
