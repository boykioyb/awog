<template>
  <div class="flex flex-col h-full min-h-0" :style="{ background: t.bgPanel }">
    <div class="px-3 py-2 flex-shrink-0" :style="{ borderBottom: `1px solid ${t.border}` }">
      <span class="text-[1em] uppercase tracking-wide font-medium" :style="{ color: t.textDim }">
        Search
      </span>
    </div>

    <div class="px-3 py-2 flex flex-col gap-2 flex-shrink-0">
      <input
        v-model="ctx.searchQuery.value"
        placeholder="Find in files…"
        class="w-full px-2 py-1.5 rounded text-[1em] outline-none"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
        @keydown.enter.prevent="ctx.runSearch()"
      />
      <div class="flex items-center gap-1">
        <button
          v-for="opt in toggles"
          :key="opt.key"
          type="button"
          :title="opt.title"
          class="px-1.5 py-1 rounded text-[12px] font-mono leading-none"
          :style="{
            background: ctx.searchOpts[opt.key] ? t.accentMuted : 'transparent',
            color: ctx.searchOpts[opt.key] ? t.accent : t.textDim,
            border: `1px solid ${ctx.searchOpts[opt.key] ? t.accent : t.border}`,
          }"
          @click="toggle(opt.key)"
        >
          {{ opt.label }}
        </button>
        <button
          type="button"
          class="ml-auto px-2 py-1 rounded text-[1em]"
          :style="{ background: t.accent, color: t.accentText }"
          @click="ctx.runSearch()"
        >
          Search
        </button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <p v-if="ctx.searching.value" class="px-3 py-2 text-[1em]" :style="{ color: t.textFaint }">
        Searching…
      </p>
      <template v-else>
        <p
          v-if="ctx.searchTruncated.value"
          class="px-3 py-1 text-[12px]"
          :style="{ color: t.warning }"
        >
          Results capped — refine the query.
        </p>
        <div v-for="group in ctx.searchGroups.value" :key="group.path" class="mb-1">
          <div
            class="px-3 py-1 text-[1em] truncate sticky top-0"
            :style="{ color: t.textDim, background: t.bgPanel }"
          >
            {{ group.path }}
            <span class="text-[12px] font-mono" :style="{ color: t.textFaint }">
              ({{ group.matches.length }})
            </span>
          </div>
          <button
            v-for="(m, i) in group.matches"
            :key="`${group.path}:${m.line}:${i}`"
            type="button"
            class="w-full text-left flex gap-2 px-3 py-0.5 transition"
            :style="{ color: t.text }"
            @mouseenter="(e) => bg(e, t.bgHover)"
            @mouseleave="(e) => bg(e, 'transparent')"
            @click="ctx.openMatch(m)"
          >
            <span class="text-[12px] font-mono flex-shrink-0" :style="{ color: t.textFaint }">
              {{ m.line }}
            </span>
            <span class="text-[1em] truncate font-mono">{{ m.preview }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'
import type { FsSearchOptions } from '~/composables/useFsApi'

const { t } = useTheme()
const ctx = useProjectWorkspaceContext()

type ToggleKey = 'regex' | 'caseSensitive' | 'wholeWord'
const toggles: { key: ToggleKey; label: string; title: string }[] = [
  { key: 'caseSensitive', label: 'Aa', title: 'Match case' },
  { key: 'wholeWord', label: 'W', title: 'Whole word' },
  { key: 'regex', label: '.*', title: 'Regex' },
]

const toggle = (key: ToggleKey) => {
  const opts = ctx.searchOpts as FsSearchOptions
  opts[key] = !opts[key]
}

const bg = (e: MouseEvent, color: string) => {
  ;(e.currentTarget as HTMLElement).style.background = color
}
</script>
