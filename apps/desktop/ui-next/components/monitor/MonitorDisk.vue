<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="error"
      class="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <Icon name="alert" class="size-3.5" />
      {{ error }}
    </div>

    <!-- Ổ đĩa. Chỉ ổ chứa thư mục nhà + ổ gắn ngoài; các mount ảo của APFS bị lọc
         ở sidecar, nếu không sẽ hiện bảy dòng cùng dung lượng. -->
    <div class="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-2.5">
      <Card v-for="v in volumes" :key="v.filesystem" class="min-w-0 gap-1 px-3.5 py-3">
        <div class="truncate text-xs text-faint">{{ v.mount }}</div>
        <div class="text-xl tabular-nums" :class="levelText(volLevel(v))">
          {{ formatMem(v.usedKb) }} / {{ formatMem(v.totalKb) }}
        </div>
        <!-- Vạch mức 4px (h-1): độ dày chính là hình dạng. -->
        <div class="h-1 overflow-hidden rounded-full bg-muted">
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(volLevel(v))"
            :style="{ width: `${pct(v)}%` }"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-dim">
            {{ t('disk.free', { free: formatMem(v.freeKb), pct: Math.round(pct(v)) }) }}
          </span>
          <!-- Lối vào để trả lời "chỗ trống đi đâu". Không có nút này thì tab Đĩa
               chỉ có danh mục rác soạn sẵn, và mọi thứ ngoài danh mục đó vô hình. -->
          <Button
            :title="v.mount"
            class="shrink-0"
            variant="outline"
            @click="emit('open', v.mount)"
          >
            <Icon name="search" class="size-3.5" />
            {{ t('disk.browse') }}
          </Button>
        </div>
      </Card>
    </div>

    <!-- Lối tắt tới những thư mục hay chiếm chỗ nhất, ngoài danh mục rác. -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-dim">{{ t('disk.roots.label') }}</span>
      <Button v-for="r in roots" :key="r.path" variant="outline" @click="emit('open', r.path)">
        <Icon name="folder" class="size-3.5" />
        {{ r.name }}
      </Button>
    </div>

    <!-- Gợi ý dọn -->
    <Card class="gap-2 px-3.5 pt-3 pb-1">
      <div class="flex items-center gap-2">
        <!-- Tiêu đề không được co: nhãn phụ bên cạnh dài hơn nhiều, flex mặc định sẽ
             bóp chính cái tên mục xuống hai dòng. -->
        <span class="shrink-0 text-base text-foreground">{{ t('disk.clean.title') }}</span>
        <span class="text-sm text-dim">{{ countLabel }}</span>
        <Button
          :disabled="measuring > 0"
          class="ml-auto"
          variant="outline"
          @click="emit('measure')"
        >
          <!-- Thước, không phải khung quét: `scan` là bốn góc ngắm — nó đọc ra
               "quét mã QR", còn việc ở đây là ĐO dung lượng. -->
          <Icon name="ruler" class="size-3.5" />
          {{ buttonLabel }}
        </Button>
      </div>
      <!-- Chỉ cộng mục "an toàn": gộp cả mục cần cân nhắc vào một con số "dọn được"
           là mời người dùng xoá thứ họ sẽ tiếc. -->
      <div v-if="totalSafeKb > 0" class="text-sm text-dim">
        {{ t('disk.clean.total', { size: formatMem(totalSafeKb) }) }}
      </div>

      <Table class="table-fixed">
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint">
              {{ t('disk.clean.col.item') }}
            </TableHead>
            <TableHead class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-23 text-right">
              {{ t('disk.clean.col.size') }}
            </TableHead>
            <!-- BỐN nút cạnh nhau: 4 × 32px + 3 × 4px khoảng cách + padding ô 20px.
                 ⚠ Cột này từng ghim 88px (đúng cho hai nút). Thêm nút thứ ba và tư thì
                 con flex bị BÓP — nên nút để `shrink-0`: lần sau thêm nút sẽ TRÀN
                 (nhìn thấy ngay) thay vì âm thầm bóp cả hàng. -->
            <TableHead class="h-auto px-2.5 py-1.5 whitespace-nowrap text-faint w-40 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="x in sorted"
            :key="x.id"
            class="hover:bg-transparent"
            @contextmenu="emit('menu', $event, x.path, 'dir')"
          >
            <TableCell class="px-2.5 py-2 align-top text-dim">
              <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <!-- Icon theo LOẠI rác: hai mươi dòng chữ thuần thì phải đọc từng
                     dòng mới biết cái nào là cache, cái nào là kho gói. Mục "cân
                     nhắc" dùng màu cảnh báo cho khớp với thẻ bên cạnh nó. -->
                <Icon
                  :name="kindIcon(x.kind)"
                  class="size-3.5 shrink-0"
                  :class="x.safety === 'review' ? 'text-warning' : 'text-primary'"
                />
                <span
                  class="cursor-pointer whitespace-nowrap text-foreground hover:text-primary hover:underline"
                  :title="x.label"
                  @click="emit('open', x.path)"
                >
                  {{ x.label }}
                </span>
                <Badge variant="outline" class="rounded-sm" :class="safetyClass(x.safety)">
                  {{ t(`disk.safety.${x.safety}`) }}
                </Badge>
              </div>
              <div class="mt-0.5 text-xs text-dim">{{ x.hint }}</div>
              <!-- Đường dẫn là thứ người dùng copy vào terminal để tự kiểm ⇒ mono hợp lệ. -->
              <div class="mt-0.5 truncate font-mono text-xs text-faint" :title="x.path">
                {{ x.path }}
              </div>
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-23 text-right tabular-nums">
              {{ sizeText(x.path) }}
            </TableCell>
            <TableCell class="px-2.5 py-2 align-top text-dim w-40 text-right">
              <div class="flex justify-end gap-1 *:shrink-0">
                <!-- Quét sâu phải là một NÚT. Trước đó lối vào duy nhất là bấm vào
                   chữ tên mục — không có gì báo hiệu nó bấm được, nên coi như không
                   tồn tại với người chưa biết. -->
                <Button
                  :title="t('disk.tree.open')"
                  variant="outline"
                  size="iconMd"
                  @click="emit('open', x.path)"
                >
                  <Icon name="search" />
                </Button>
                <!-- Hiện trong Finder + Sao chép đường dẫn: hai việc người dùng
                     làm ngay sau khi thấy một mục to, trước cả khi quyết định xoá.
                     Cũng có trong menu chuột phải (dùng chung với tab Files của
                     Sessions), nhưng menu ẩn thì không ai đoán ra nó có. -->
                <Button
                  :title="t('disk.reveal.action')"
                  variant="outline"
                  size="iconMd"
                  @click="emit('reveal', x.path)"
                >
                  <Icon name="folder" />
                </Button>
                <Button
                  :title="t('disk.copyPath.action')"
                  variant="outline"
                  size="iconMd"
                  @click="emit('copy-path', x.path)"
                >
                  <Icon name="copy" />
                </Button>
                <!-- Cùng luật với drawer: đọc phủ cả đĩa, XOÁ chỉ trong nhà. Một
                     project nằm ở ổ ngoài vẫn sinh ra dòng `node_modules` ở đây,
                     và nút xoá của nó sẽ luôn bị Electron main từ chối. -->
                <Button
                  v-if="canTrash(x.path)"
                  :title="t('disk.trash.action')"
                  class="hover:bg-destructive/10 hover:text-destructive"
                  variant="outline"
                  size="iconMd"
                  @click="emit('trash', x.path, x.label, sizes[x.path] ?? undefined)"
                >
                  <Icon name="trash" />
                </Button>
                <!-- Giữ chỗ đúng khổ nút nhờ `size="iconMd"` — nút thật và
                     placeholder cùng một ladder --ctrl-h-sm ở mọi theme. Render
                     là `<span>` nên không bấm được. -->
                <Button
                  v-else
                  :title="t('disk.trash.outsideHome')"
                  class="cursor-default border-transparent text-faint shadow-none hover:bg-transparent hover:text-faint"
                  as="span"
                  variant="outline"
                  size="iconMd"
                >
                  <Icon name="info" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Dọn bằng công cụ.
         Có những chỗ Thùng rác KHÔNG với tới được: layer của Docker nằm trong
         máy ảo, simulator do CoreSimulator quản lý, kho gói của pnpm là hard-link
         nên xoá tay là hỏng mọi node_modules đang trỏ vào. Cách duy nhất đúng là
         để chính công cụ đó dọn phần thừa của nó.
         Lệnh hiện NGUYÊN VĂN ngay trên hàng — không giấu sau một cái nhãn — vì
         đây là nhóm xoá KHÔNG hoàn tác được, khác hẳn phần Thùng rác ở trên. -->
    <Card v-if="cleanupActions.length > 0" class="gap-2 px-3.5 pt-3 pb-1">
      <div class="flex items-center gap-2">
        <span class="shrink-0 text-base text-foreground">{{ t('disk.cleanup.title') }}</span>
        <span class="min-w-0 text-sm text-dim">{{ t('disk.cleanup.subtitle') }}</span>
      </div>
      <div class="flex flex-col gap-0.5 py-1">
        <!-- Grid chứ không flex: cột nút phải thẳng hàng giữa các hàng, và `1fr`
             kèm `min-w-0` là thứ duy nhất cho lệnh dài cắt ellipsis thay vì đẩy nút
             tràn ra ngoài thẻ. -->
        <div
          v-for="a in cleanupActions"
          :key="a.id"
          class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2.5 py-2 hover:bg-accent"
        >
          <div class="min-w-0">
            <div class="text-base text-foreground">{{ a.label }}</div>
            <!-- Dòng lệnh shell thật, người dùng copy thẳng vào terminal ⇒ mono hợp lệ. -->
            <div class="mt-0.5 truncate font-mono text-xs text-primary" :title="a.command">
              {{ a.command }}
            </div>
            <div class="mt-0.5 text-xs text-dim">{{ a.hint }}</div>
          </div>
          <Button
            :disabled="cleanupRunning !== ''"
            variant="outline"
            @click="emit('cleanup', a.id)"
          >
            <Icon name="sparkles" class="size-3.5" />
            {{ cleanupRunning === a.id ? t('disk.cleanup.running') : t('disk.cleanup.run') }}
          </Button>
        </div>
      </div>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatMem, type UsageLevel } from '~/composables/useMonitorManager'
import { levelBg, levelText } from './monitor-level'
import type { CleanupAction, DiskVolume, JunkTarget, SizeState } from '~/composables/useDiskManager'
import Button from '~/components/ui/button/Button.vue'

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

// Thẻ mức an toàn: "an toàn" = brand, "cân nhắc" = vàng, còn lại viền trung tính.
const safetyClass = (safety: JunkTarget['safety']): string => {
  if (safety === 'safe') return 'border-primary/40 bg-primary/10 text-primary'
  if (safety === 'review') return 'border-warning/40 text-warning'
  return 'text-muted-foreground'
}

const sorted = computed(() =>
  [...props.targets].sort((a, b) => (props.sizes[b.path] ?? -1) - (props.sizes[a.path] ?? -1)),
)
</script>
