<template>
  <!-- Khung popover của các chip hàng ngữ cảnh (SSH · hạ tầng · đánh dấu). Bên gọi
       vẫn tự teleport ra <body>, tự vẽ backdrop và neo `fixed` bằng usePopoverAnchor
       (`:style` rơi xuống phần tử gốc này); đây chỉ còn bề mặt. Bề rộng do bên gọi
       truyền qua class (`w-71` / `w-74` / `w-80`) — không khai ở đây để khỏi chồng hai
       giá trị `w-*` trên cùng phần tử.
       `role="dialog"` + `data-state="open"` khớp selector `[role="dialog"][data-state="open"]`
       trong OVERLAYS (composables/useEmbeddedBrowser.ts) — thay cho class `.pop` cũ, để
       trình duyệt nhúng nhường chỗ khi popover mở. -->
  <div
    role="dialog"
    data-state="open"
    class="fixed z-130 max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border bg-popover p-3.5 text-popover-foreground shadow-md"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
// Bề mặt dùng chung — không state, không logic. Template ref của bên gọi trỏ vào
// instance: đọc `$el` để đưa cho usePopoverAnchor.
</script>
