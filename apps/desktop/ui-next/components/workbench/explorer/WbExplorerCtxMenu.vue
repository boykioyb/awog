<template>
  <!-- Context menu chung của Workbench (file tree / SCM / doc tab). Fixed
       popover teleport ra body để không bị panel overflow clip. Hỗ trợ
       separator / danger / disabled / hint phím tắt — parity menu VS Code.
       Skin dùng `.smenu`/`.mi` GLOBAL của app (contract migration giữ nguyên):
       theme-cute + luật tương tác đã nhắm đúng từ vựng này; Tailwind chỉ lo
       kích thước/neo/no-drag còn lại của `.wbm` cũ. -->
  <Teleport to="body">
    <div
      v-if="exp.menuOpen.value"
      ref="menuEl"
      class="smenu min-w-[184px] max-w-[260px] [-webkit-app-region:no-drag]"
      :style="{ left: exp.menuX.value + 'px', top: exp.menuY.value + 'px' }"
    >
      <template v-for="(it, i) in exp.menuItems.value" :key="i">
        <div v-if="it.separator" class="msep" />
        <div
          v-else
          class="mi"
          :class="{ dmi: it.danger, mdisabled: it.disabled }"
          @click="pick(it)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis">{{ it.label }}</span>
          <span v-if="it.hint" class="mhint">{{ it.hint }}</span>
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
