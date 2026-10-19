<template>
  <!-- Bảng dùng chung cho Pods/Deployments. `columns[0]` là cột TÊN; các cột còn
       lại map theo thứ tự vào `row.cells` (đã bóc từ bảng chữ của kubectl ở
       sidecar). Ô thiếu dữ liệu hiện '—' chứ không đẩy lệch cột.

       `<table>` trần thay cho `Table`: `Table` bọc bảng trong một div `overflow-auto`
       riêng, mà sticky header bám theo khung cuộn GẦN NHẤT — tức cái div không bao
       giờ cuộn đó — nên tiêu đề cột sẽ trôi mất khi khung của InfraKubeWorkloads cuộn. -->
  <table class="w-full border-collapse text-sm">
    <TableHeader>
      <TableRow class="hover:bg-transparent">
        <TableHead v-for="(col, i) in columns" :key="col" :class="[HEAD, i > 0 && 'tabular-nums']">
          {{ col }}
        </TableHead>
        <TableHead v-if="$slots.actions || clickable" :class="[HEAD, 'w-[1%]']" />
      </TableRow>
    </TableHeader>
    <TableBody>
      <!-- Một ô pod có thể mang nhiều dòng (trạng thái + lý do), nên ô căn theo ĐỈNH
           để các cột một dòng không bị đẩy xuống giữa. -->
      <TableRow
        v-for="row in rows"
        :key="row.name"
        :class="clickable ? 'cursor-pointer hover:bg-accent' : 'hover:bg-transparent'"
        :tabindex="clickable ? 0 : undefined"
        @click="clickable && emit('row', row.name)"
        @keydown.enter.prevent="clickable && emit('row', row.name)"
        @keydown.space.prevent="clickable && emit('row', row.name)"
      >
        <TableCell :class="[CELL, 'font-medium']">{{ row.name }}</TableCell>
        <TableCell
          v-for="(col, i) in columns.slice(1)"
          :key="col"
          :class="[CELL, 'whitespace-nowrap tabular-nums']"
        >
          {{ row.cells[i] || '—' }}
        </TableCell>
        <TableCell v-if="$slots.actions" :class="CELL">
          <div class="flex justify-end gap-1">
            <slot name="actions" :row="row" />
          </div>
        </TableCell>
        <!-- Cả hàng là một nút mở bảng chi tiết ⇒ phải có dấu chỉ chỗ bấm được:
             không có mũi tên thì người mới không biết hàng bấm được. -->
        <TableCell v-else-if="clickable" :class="[CELL, 'w-[1%] text-right text-faint']">
          <Icon name="chev-right" class="size-3.5" />
        </TableCell>
      </TableRow>
    </TableBody>
  </table>
</template>

<script setup lang="ts">
// `clickable` biến mỗi hàng thành một nút (mở khung log/chi tiết của hàng đó);
// `#actions` là đường còn lại cho bảng chỉ có một hành động và hành động đó là
// ghi (khởi động lại deployment) — hàng bấm được mà không có gì để bấm thì lạ.
withDefaults(
  defineProps<{
    columns: readonly string[]
    rows: readonly { name: string; cells: readonly string[] }[]
    clickable?: boolean
  }>(),
  { clickable: false },
)

const emit = defineEmits<{ (e: 'row', name: string): void }>()

/** Tiêu đề cột dính khi cuộn, nền đục — bảng dài hơn khung mà mất nhãn cột là bảng mù. */
const HEAD = 'sticky top-0 z-1 h-auto bg-muted px-2.5 py-1.5 text-xs font-medium whitespace-nowrap'
const CELL = 'px-2.5 py-1.5 align-top text-foreground'
</script>
