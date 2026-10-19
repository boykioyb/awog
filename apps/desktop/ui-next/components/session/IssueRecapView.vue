<template>
  <!-- Recap của một issue (boards.recap) — markdown 4 mục do model viết. Render qua
       đường markdown đã sanitize của transcript (useMarkdown → SessionMarkdownHtml),
       không v-html thô. -->
  <!-- Recap là bản tóm gọn trong popover hẹp: thu heading về cỡ nhãn và siết nhịp
       khoảng cách của markdown transcript (vốn cho prose dài). -->
  <div
    class="[&_h2]:mt-2 [&_h2]:mb-0.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_li]:m-0 [&_li]:text-sm [&_p]:m-0 [&_p]:text-sm [&_ul]:m-0 [&_ul]:pl-4"
  >
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
