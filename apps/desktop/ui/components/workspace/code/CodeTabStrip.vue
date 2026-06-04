<template>
  <div
    class="flex items-stretch overflow-x-auto flex-shrink-0"
    :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
  >
    <div
      v-for="tab in ctx.tabs.value"
      :key="tab.path"
      class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer flex-shrink-0 text-[1em]"
      :style="{
        background: tab.path === ctx.activePath.value ? t.bg : 'transparent',
        color: tab.path === ctx.activePath.value ? t.text : t.textDim,
        borderRight: `1px solid ${t.border}`,
        borderTop: `2px solid ${tab.path === ctx.activePath.value ? t.accent : 'transparent'}`,
      }"
      :title="tab.path"
      @click="ctx.openFile(tab.path)"
    >
      <span class="truncate max-w-[160px]">{{ tab.name }}</span>
      <span v-if="tab.readOnly" class="text-[12px]" :style="{ color: t.textFaint }">RO</span>
      <button
        type="button"
        class="flex items-center justify-center w-4 h-4 rounded transition"
        :style="{ color: t.textDim }"
        @click.stop="ctx.requestCloseTab(tab.path)"
      >
        <span
          v-if="tab.dirty"
          class="w-2 h-2 rounded-full group-hover:hidden"
          :style="{ background: t.text }"
        />
        <X :size="13" :class="tab.dirty ? 'hidden group-hover:block' : ''" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'

const { t } = useTheme()
const ctx = useProjectWorkspaceContext()
</script>
