<template>
  <!-- Một nhóm đối tượng "tên + một con số + ổn hay không": StatefulSet, DaemonSet,
       Job, PVC, Service, Ingress. Năm chỗ dùng chung MỘT hình dạng, nên hình dạng
       đó sống ở đây — năm bản copy là năm chỗ để lệch nhau ở lần sửa đầu tiên.

       CHIP CHỨ KHÔNG PHẢI BẢNG. Mỗi nhóm thường có 1–6 phần tử và chỉ có hai cột
       thật (tên, trạng thái); một bảng có tiêu đề cột cho ngần đó dữ liệu tốn ba
       dòng để nói một dòng.

       Nhóm RỖNG vẫn hiện một câu. "Không có Job nào" là một KẾT QUẢ — im lặng thì
       người đọc không phân biệt được với "chưa đọc được". -->
  <div class="ikrc">
    <div class="ikrc-head">
      <span class="ikrc-t">{{ title }}</span>
      <span v-if="items.length" class="ihint">{{ items.length }}</span>
    </div>

    <p v-if="gap" class="ikrc-gap">
      {{ t('infra.kube.report.gapRead') }}
      <span class="ihint">{{ gap }}</span>
    </p>
    <span v-else-if="items.length === 0" class="ihint">{{ empty }}</span>

    <ul v-else class="ikrc-list">
      <li v-for="item in items" :key="item.name" class="ikrc-i" :class="`c-${item.rate}`">
        <span class="ikrc-dot" />
        <code class="ikrc-name" :title="item.name">{{ item.name }}</code>
        <span v-if="item.value" class="ikrc-v">{{ item.value }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ChipItem } from '~/composables/useInfraKubeReport'

defineProps<{
  title: string
  items: ChipItem[]
  /** Câu hiện khi nhóm rỗng — mỗi loại nói một câu khác nhau. */
  empty: string
  /** Lý do không đọc được nhóm này (rỗng = đọc được). */
  gap: string
}>()

const { t } = useI18n()
</script>

<style scoped>
.ikrc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ikrc-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ikrc-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrc-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikrc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ikrc-i {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgEl);
}
.ikrc-i.c-warn {
  border-color: var(--amberBorder);
}
.ikrc-i.c-bad {
  border-color: var(--dangerBorder);
}
.ikrc-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--green);
}
.c-warn .ikrc-dot {
  background: var(--amber);
}
.c-bad .ikrc-dot {
  background: var(--danger);
}
.ikrc-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên object là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrc-v {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
</style>
