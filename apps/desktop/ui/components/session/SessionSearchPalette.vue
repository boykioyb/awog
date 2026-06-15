<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[100] flex items-start justify-center"
      @mousedown.self="close"
    >
      <div class="absolute inset-0" :style="{ background: 'rgba(0,0,0,0.45)' }" @click="close" />
      <div
        class="relative mt-[12vh] w-full max-w-xl mx-4 rounded-xl overflow-hidden flex flex-col"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.border}`,
          boxShadow: `0 24px 64px ${t.shadow}`,
        }"
      >
        <!-- Query input -->
        <div
          class="flex items-center gap-2.5 px-3.5 py-3 flex-shrink-0"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <Search :size="15" :style="{ color: t.textDim }" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="flex-1 bg-transparent outline-none text-[1em]"
            :style="{ color: t.text }"
            :placeholder="tr('session.search.placeholder')"
            @keydown="onKeydown"
          />
          <Loader2 v-if="loading" :size="14" class="animate-spin" :style="{ color: t.textDim }" />
        </div>

        <!-- Results -->
        <div ref="listRef" class="max-h-[52vh] overflow-y-auto">
          <p
            v-if="query.trim().length < 2"
            class="px-4 py-6 text-center text-[1em]"
            :style="{ color: t.textFaint }"
          >
            {{ tr('session.search.hint') }}
          </p>
          <p
            v-else-if="!loading && results.length === 0"
            class="px-4 py-6 text-center text-[1em]"
            :style="{ color: t.textFaint }"
          >
            {{ tr('session.search.empty') }}
          </p>
          <button
            v-for="(r, i) in results"
            :key="r.messageId"
            type="button"
            :data-idx="i"
            class="w-full text-left px-3.5 py-2.5 flex flex-col gap-1 transition"
            :style="{ background: i === active ? t.bgHover : 'transparent' }"
            @mouseenter="active = i"
            @click="select(r)"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="text-[12px] font-mono px-1.5 rounded leading-none py-0.5 flex-shrink-0"
                :style="{ background: t.bgSubtle, color: roleColor(r.role) }"
              >
                {{ r.role }}
              </span>
              <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">
                {{ r.sessionTitle }}
              </span>
              <span class="text-[12px] ml-auto flex-shrink-0" :style="{ color: t.textFaint }">
                {{ fmt(r.at) }}
              </span>
            </div>
            <p class="text-[1em] line-clamp-2 break-words" :style="{ color: t.textDim }">
              {{ r.snippet }}
            </p>
          </button>
        </div>

        <!-- Footer hint -->
        <div
          class="px-3.5 py-2 flex items-center gap-3 text-[12px] flex-shrink-0"
          :style="{ borderTop: `1px solid ${t.border}`, color: t.textFaint }"
        >
          <span>↑↓ {{ tr('session.search.nav') }}</span>
          <span>↵ {{ tr('session.search.open') }}</span>
          <span>esc {{ tr('session.search.close') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Loader2, Search } from 'lucide-vue-next'
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import type { SessionSearchResult } from '~/types'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()
const settingsStore = useSettingsStore()

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const listRef = useTemplateRef<HTMLElement>('listRef')
const query = ref('')
const results = ref<SessionSearchResult[]>([])
const loading = ref(false)
const active = ref(0)

const fmt = (at: string) => formatTime(at, settingsStore.defaults?.timezone)

const roleColor = (role: SessionSearchResult['role']) => {
  if (role === 'user') return t.value.info
  if (role === 'agent') return t.value.accent
  return t.value.textDim
}

// Debounced search. A monotonically-increasing token discards stale responses
// so a slow earlier query never overwrites a newer one's results.
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let runToken = 0
const runSearch = (q: string) => {
  const token = ++runToken
  loading.value = true
  void store.searchSessions(q).then((res) => {
    if (token !== runToken) return
    results.value = res
    active.value = 0
    loading.value = false
  })
}

watch(query, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (q.trim().length < 2) {
    results.value = []
    loading.value = false
    return
  }
  debounceTimer = setTimeout(() => runSearch(q.trim()), 220)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    results.value = []
    active.value = 0
    void nextTick(() => inputRef.value?.focus())
  },
)

const scrollActiveIntoView = () => {
  void nextTick(() => {
    listRef.value
      ?.querySelector<HTMLElement>(`[data-idx="${active.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

const close = () => emit('close')

const select = (r: SessionSearchResult) => {
  emit('close')
  store.openSearchResult(r.sessionId, r.messageId)
  void navigateTo('/sessions')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.value.length) {
      active.value = (active.value + 1) % results.value.length
      scrollActiveIntoView()
    }
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length) {
      active.value = (active.value - 1 + results.value.length) % results.value.length
      scrollActiveIntoView()
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const r = results.value[active.value]
    if (r) select(r)
  }
}
</script>
