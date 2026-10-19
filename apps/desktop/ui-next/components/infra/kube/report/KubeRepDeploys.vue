<template>
  <!-- Một hàng một Deployment: tên · số bản sao sẵn sàng · ảnh đang chạy · tuổi.

       VÌ SAO LIỆT KÊ CẢ NHỮNG CÁI ĐỦ BẢN SAO. Ô số phía trên đã nói "5/6 đủ bản
       sao"; cái nó KHÔNG nói là cái nào, và ảnh nào đang chạy. Bảng này trả lời
       đúng hai câu đó — và nhờ có `rollingOut`, nó là chỗ duy nhất trên màn hình
       tố cáo một rollout kẹt: cột READY vẫn in `9/9` vì 9 pod bản CŨ còn phục vụ.

       Mọi chuỗi (bản sao, tuổi, câu rollout) do `InfraKubeReport.vue` dựng sẵn —
       component này chỉ vẽ. -->
  <ul class="flex min-w-0 flex-col">
    <li
      v-for="row in rows"
      :key="row.key"
      class="flex min-w-0 flex-wrap items-baseline gap-2 py-1.5 first:pt-0 not-first:border-t"
    >
      <!-- mono-ok: tên deployment là thứ dán vào kubectl -->
      <code class="max-w-full truncate font-mono text-xs text-foreground" :title="row.name">
        {{ row.name }}
      </code>
      <!-- Rollout kẹt thì con số bản sao ĐÚNG nhưng nói dối: bỏ màu xanh đi để nó
           không khẳng định một điều mà chip bên cạnh đang phủ nhận. -->
      <Badge
        variant="outline"
        class="shrink-0 font-normal tabular-nums"
        :class="row.rolling ? 'text-muted-foreground' : 'text-success'"
      >
        {{ row.ready }}
      </Badge>
      <Badge
        v-if="row.rolling"
        variant="outline"
        class="shrink-0 border-destructive/40 bg-destructive/10 font-normal text-destructive"
      >
        {{ row.rollout }}
      </Badge>
      <!-- mono-ok: tag ảnh là thứ dán vào docker/kubectl -->
      <code
        v-if="row.image"
        class="min-w-0 flex-[1_1_10rem] truncate font-mono text-xs text-muted-foreground"
        :title="row.image"
      >
        {{ row.image }}
      </code>
      <span v-if="row.age" class="text-xs text-faint">{{ row.age }}</span>
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
