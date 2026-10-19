<template>
  <!-- Context menu chung của Workbench (file tree / SCM / doc tab). Fixed
       popover teleport ra body để không bị panel overflow clip. Hỗ trợ
       separator / danger / disabled / hint phím tắt — parity menu VS Code.
       Class bám DropdownMenuContent/Item của shadcn; `.wbm` nằm trong OVERLAYS
       (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
  <Teleport to="body">
    <div
      v-if="exp.menuOpen.value"
      ref="menuEl"
      class="wbm fixed z-130 max-h-[calc(100vh-24px)] min-w-46 max-w-65 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md [-webkit-app-region:no-drag]"
      :style="{ left: exp.menuX.value + 'px', top: exp.menuY.value + 'px' }"
    >
      <template v-for="(it, i) in exp.menuItems.value" :key="i">
        <Separator v-if="it.separator" class="-mx-1 my-1 w-auto" />
        <div
          v-else
          class="flex cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
          :class="[
            it.danger
              ? 'text-destructive hover:text-destructive'
              : 'text-muted-foreground hover:text-accent-foreground',
            { 'pointer-events-none opacity-45': it.disabled },
          ]"
          @click="pick(it)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis">{{ it.label }}</span>
          <span v-if="it.hint" class="tnum ml-auto text-xs text-faint">{{ it.hint }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import type { WbCtxItem } from '~/composables/useWorkbenchExplorer'
import { useWorkbenchExplorer } from '~/composables/useWorkbenchExplorer'

const exp = useWorkbenchExplorer()
const menuEl = useTemplateRef<HTMLElement>('menuEl')

function pick(it: WbCtxItem): void {
  if (it.disabled) return
  exp.closeWbMenu()
  void it.action?.()
}

function onDown(e: MouseEvent): void {
  // Click ngoài menu → đóng (target không thuộc popover teleport).
  if (!menuEl.value?.contains(e.target as Node)) exp.closeWbMenu()
}
useEscToClose(
  () => exp.menuOpen.value,
  () => exp.closeWbMenu(),
)
onMounted(() => {
  window.addEventListener('mousedown', onDown)
  window.addEventListener('blur', exp.closeWbMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDown)
  window.removeEventListener('blur', exp.closeWbMenu)
})
</script>
