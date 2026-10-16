<template>
  <!-- Recap của một issue (boards.recap) — markdown 4 mục do model viết. Render qua
       đường markdown đã sanitize của transcript (useMarkdown → SessionMarkdownHtml),
       không v-html thô. -->
  <div class="irecap">
    <template v-for="(seg, i) in segments" :key="i">
      <SessionMarkdownHtml v-if="seg.type === 'html'" :html="seg.html" />
    </template>
  </div>
</template>

<script setup lang="ts">
// Dùng chung cho chip issue trên header phiên và khung Issues của workbench — một
// cách hiển thị recap ở mọi nơi.
const props = defineProps<{ text: string }>()

const { renderMarkdown } = useMarkdown()
const segments = computed(() => renderMarkdown(props.text))
</script>

<style scoped>
/* Recap là bản tóm gọn trong popover hẹp: thu heading về cỡ nhãn và siết nhịp
   khoảng cách của markdown transcript (vốn cho prose dài). */
.irecap :deep(h2) {
  margin: 8px 0 2px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}
.irecap :deep(h2:first-child) {
  margin-top: 0;
}
.irecap :deep(ul) {
  margin: 0;
  padding-left: 16px;
}
.irecap :deep(li),
.irecap :deep(p) {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
