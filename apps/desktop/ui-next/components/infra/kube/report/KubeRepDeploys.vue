<template>
  <!-- Một hàng một Deployment: tên · số bản sao sẵn sàng · ảnh đang chạy · tuổi.

       VÌ SAO LIỆT KÊ CẢ NHỮNG CÁI ĐỦ BẢN SAO. Ô số phía trên đã nói "5/6 đủ bản
       sao"; cái nó KHÔNG nói là cái nào, và ảnh nào đang chạy. Bảng này trả lời
       đúng hai câu đó — và nhờ có `rollingOut`, nó là chỗ duy nhất trên màn hình
       tố cáo một rollout kẹt: cột READY vẫn in `9/9` vì 9 pod bản CŨ còn phục vụ.

       Mọi chuỗi (bản sao, tuổi, câu rollout) do `InfraKubeReport.vue` dựng sẵn —
       component này chỉ vẽ. -->
  <ul class="ikrd">
    <li v-for="row in rows" :key="row.key" class="ikrd-i">
      <code class="ikrd-name" :title="row.name">{{ row.name }}</code>
      <span class="ikrd-ready" :class="{ bad: row.rolling }">{{ row.ready }}</span>
      <span v-if="row.rolling" class="ikrd-chip">{{ row.rollout }}</span>
      <code v-if="row.image" class="ikrd-img" :title="row.image">{{ row.image }}</code>
      <span v-if="row.age" class="ihint">{{ row.age }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
defineProps<{
  rows: {
    key: string
    name: string
    /** `3/3` — bản sao sẵn sàng trên bản sao mong muốn. */
    ready: string
    /** Bản mới chưa thay xong bản cũ (`upToDate < desired`). */
    rolling: boolean
    /** Câu mô tả rollout dở dang, rỗng khi `rolling` là false. */
    rollout: string
    /** Ảnh container đầu tiên — đủ để nhận ra bản nào đang chạy. */
    image: string
    /** Tuổi của Deployment, đã định dạng. */
    age: string
  }[]
}>()
</script>

<style scoped>
.ikrd {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ikrd-i {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  padding: 6px 0;
}
.ikrd-i:first-child {
  padding-top: 0;
}
.ikrd-i:not(:first-child) {
  border-top: 1px solid var(--border);
}
.ikrd-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên deployment là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ikrd-ready {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--green);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
/* Rollout kẹt thì con số bản sao ĐÚNG nhưng nói dối: bỏ màu xanh đi để nó không
   khẳng định một điều mà chip bên cạnh đang phủ nhận. */
.ikrd-ready.bad {
  color: var(--textMuted);
}
.ikrd-chip {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--dangerBorder);
  border-radius: var(--r-pill);
  background: var(--dangerDim);
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrd-img {
  flex: 1 1 160px;
  color: var(--textMuted);
  font-family: var(--code); /* mono-ok: tag ảnh là thứ dán vào docker/kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
