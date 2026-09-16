<template>
  <!-- Bảng dùng chung cho Pods/Deployments. `columns[0]` là cột TÊN; các cột còn
       lại map theo thứ tự vào `row.cells` (đã bóc từ bảng chữ của kubectl ở
       sidecar). Ô thiếu dữ liệu hiện '—' chứ không đẩy lệch cột. -->
  <table class="kt">
    <thead>
      <tr>
        <th v-for="(col, i) in columns" :key="col" :class="{ 'kt-num': i > 0 }">{{ col }}</th>
        <th v-if="$slots.actions" class="kt-actions-col" />
        <th v-else-if="clickable" class="kt-na-col" />
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.name"
        :class="{ 'kt-click': clickable }"
        :tabindex="clickable ? 0 : undefined"
        @click="clickable && emit('row', row.name)"
        @keydown.enter.prevent="clickable && emit('row', row.name)"
        @keydown.space.prevent="clickable && emit('row', row.name)"
      >
        <td class="kt-name">{{ row.name }}</td>
        <td v-for="(col, i) in columns.slice(1)" :key="col" class="kt-num">
          {{ row.cells[i] || '—' }}
        </td>
        <td v-if="$slots.actions" class="kt-actions">
          <slot name="actions" :row="row" />
        </td>
        <!-- Cả hàng là một nút mở bảng chi tiết ⇒ phải có dấu chỉ chỗ bấm được:
             không có mũi tên thì người mới không biết hàng bấm được. -->
        <td v-else-if="clickable" class="kt-na">
          <Icon name="chev-right" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </td>
      </tr>
    </tbody>
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
</script>

<style scoped>
/* Da bảng ở app-shell.css. Dưới đây CHỈ là override riêng của bảng Kubernetes. */

/* Một ô pod có thể mang nhiều dòng (trạng thái + lý do), nên ô căn theo ĐỈNH để
   các cột một dòng không bị đẩy xuống giữa. */
.kt td {
  vertical-align: top;
}

.kt-name {
  font-weight: 500;
}

.kt-actions-col {
  width: 1%;
}

.kt-na-col {
  width: 1%;
}

.kt-click {
  cursor: pointer;
}

.kt-click:hover td {
  background: var(--bgHover);
}

.kt-na {
  width: 1%;
  color: var(--textFaint);
  text-align: right;
}

.kt-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
</style>
