<template>
  <div
    class="flex items-stretch flex-shrink-0"
    :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
  >
    <!-- Open tabs (scroll horizontally when they overflow) -->
    <div class="flex items-stretch overflow-x-auto flex-1 min-w-0">
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
        <span v-if="tab.readOnly" class="text-[12px]" :style="{ color: t.textFaint }">
          {{ tr('code.readonly_short') }}
        </span>
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

    <!-- Markdown view toggle (code / split / preview) — pinned right, markdown only -->
    <div
      v-if="ctx.isMarkdown.value"
      class="flex items-center flex-shrink-0 gap-0.5 px-1.5"
      :style="{ borderLeft: `1px solid ${t.border}` }"
    >
      <button
        v-for="mode in viewModes"
        :key="mode.id"
        type="button"
        class="p-1 rounded transition"
        :title="tr(mode.label)"
        :style="{
          color: ctx.effectiveView.value === mode.id ? t.accent : t.textDim,
          background: ctx.effectiveView.value === mode.id ? t.bgActive : 'transparent',
        }"
        @click="ctx.setViewMode(mode.id)"
      >
        <component :is="mode.icon" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Code2, Columns2, Eye, X } from 'lucide-vue-next'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'

const { t } = useTheme()
const { t: tr } = useI18n()
const ctx = useProjectWorkspaceContext()

// `id` is inferred as a literal union, so ctx.setViewMode(mode.id) is type-checked.
const viewModes = [
  { id: 'code', icon: Code2, label: 'code.view.code' },
  { id: 'split', icon: Columns2, label: 'code.view.split' },
  { id: 'preview', icon: Eye, label: 'code.view.preview' },
] as const
</script>
