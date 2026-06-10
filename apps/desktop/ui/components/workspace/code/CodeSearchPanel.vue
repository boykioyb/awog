<template>
  <div class="flex flex-col h-full min-h-0" :style="{ background: t.bgPanel }">
    <div class="px-3 py-2 flex-shrink-0" :style="{ borderBottom: `1px solid ${t.border}` }">
      <span class="text-[1em] uppercase tracking-wide font-medium" :style="{ color: t.textDim }">
        {{ tr('code.search') }}
      </span>
    </div>

    <div class="px-3 py-2 flex flex-col gap-2 flex-shrink-0">
      <input
        v-model="ctx.searchQuery.value"
        :placeholder="tr('code.search.placeholder')"
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
      </div>
      <input
        v-model="ctx.searchOpts.includeGlob"
        :placeholder="tr('code.search.include_placeholder')"
        class="w-full px-2 py-1 rounded text-[1em] outline-none"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
      />
      <input
        v-model="ctx.searchOpts.excludeGlob"
        :placeholder="tr('code.search.exclude_placeholder')"
        class="w-full px-2 py-1 rounded text-[1em] outline-none"
        :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
      />
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <p v-if="ctx.searching.value" class="px-3 py-2 text-[1em]" :style="{ color: t.textFaint }">
        {{ tr('code.search.searching') }}
      </p>
      <template v-else>
        <div
          v-if="ctx.searchResults.value.length > 0"
          class="px-3 py-1 text-[12px] font-mono"
          :style="{ color: t.textDim }"
        >
          {{
            tr('code.search.summary', {
              count: ctx.searchResults.value.length,
              files: ctx.searchGroups.value.length,
            })
          }}
        </div>
        <p
          v-if="ctx.searchTruncated.value"
          class="px-3 py-1 text-[12px]"
          :style="{ color: t.warning }"
        >
          {{ tr('code.search.capped') }}
        </p>
        <p
          v-else-if="
            !ctx.searching.value &&
            ctx.searchResults.value.length === 0 &&
            ctx.searchQuery.value.trim().length > 0
          "
          class="px-3 py-2 text-[1em]"
          :style="{ color: t.textFaint }"
        >
          {{ tr('code.search.no_results') }}
        </p>

        <div v-for="group in ctx.searchGroups.value" :key="group.path" class="mb-1">
          <button
            type="button"
            class="w-full text-left flex items-center gap-1 px-2 py-1 sticky top-0 transition"
            :style="{ color: t.textDim, background: t.bgPanel }"
            @click="toggleGroup(group.path)"
          >
            <component
              :is="collapsed[group.path] ? ChevronRight : ChevronDown"
              :size="13"
              class="flex-shrink-0"
              :style="{ color: t.textFaint }"
            />
            <span class="text-[1em] truncate">{{ group.path }}</span>
            <span class="text-[12px] font-mono flex-shrink-0" :style="{ color: t.textFaint }">
              ({{ group.matches.length }})
            </span>
          </button>
          <template v-if="!collapsed[group.path]">
            <button
              v-for="(m, i) in group.matches"
              :key="`${group.path}:${m.line}:${i}`"
              type="button"
              class="w-full text-left flex gap-2 pl-7 pr-3 py-0.5 transition"
              :style="{ color: t.text }"
              @mouseenter="(e) => bg(e, t.bgHover)"
              @mouseleave="(e) => bg(e, 'transparent')"
              @click="ctx.openMatch(m)"
            >
              <span class="text-[12px] font-mono flex-shrink-0" :style="{ color: t.textFaint }">
                {{ m.line }}
              </span>
              <span class="text-[1em] truncate font-mono">
                <span
                  v-for="(seg, si) in segmentsOf(m.preview)"
                  :key="si"
                  :style="seg.match ? { background: t.accentMuted, color: t.accent } : undefined"
                >
                  {{ seg.text }}
                </span>
              </span>
            </button>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed, reactive } from 'vue'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'
import type { FsSearchOptions } from '~/composables/useFsApi'

const { t } = useTheme()
const { t: tr } = useI18n()
const ctx = useProjectWorkspaceContext()

type ToggleKey = 'regex' | 'caseSensitive' | 'wholeWord'
const toggles = computed<{ key: ToggleKey; label: string; title: string }[]>(() => [
  { key: 'caseSensitive', label: 'Aa', title: tr('code.search.match_case') },
  { key: 'wholeWord', label: 'W', title: tr('code.search.whole_word') },
  { key: 'regex', label: '.*', title: tr('code.search.regex') },
])

const toggle = (key: ToggleKey) => {
  const opts = ctx.searchOpts as FsSearchOptions
  opts[key] = !opts[key]
}

// Per-file collapse state (absent = expanded, so new result groups open by default).
const collapsed = reactive<Record<string, boolean>>({})
const toggleGroup = (path: string) => {
  collapsed[path] = !collapsed[path]
}

// Split a preview line into highlighted segments. Literal mode only — we NEVER
// compile the user's regex client-side (ReDoS-safe, mirrors the sidecar), so a
// regex query renders without highlight.
type Seg = { text: string; match: boolean }
const segmentsOf = (preview: string): Seg[] => {
  const q = ctx.searchQuery.value
  if (ctx.searchOpts.regex || q.length === 0) return [{ text: preview, match: false }]
  const cs = ctx.searchOpts.caseSensitive === true
  const needle = cs ? q : q.toLowerCase()
  if (needle.length === 0) return [{ text: preview, match: false }]
  const hay = cs ? preview : preview.toLowerCase()
  const segs: Seg[] = []
  let i = 0
  while (i < preview.length) {
    const idx = hay.indexOf(needle, i)
    if (idx === -1) {
      segs.push({ text: preview.slice(i), match: false })
      break
    }
    if (idx > i) segs.push({ text: preview.slice(i, idx), match: false })
    segs.push({ text: preview.slice(idx, idx + needle.length), match: true })
    i = idx + needle.length
  }
  return segs
}

const bg = (e: MouseEvent, color: string) => {
  ;(e.currentTarget as HTMLElement).style.background = color
}
</script>
