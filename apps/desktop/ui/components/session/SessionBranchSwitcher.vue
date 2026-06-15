<template>
  <!-- Only rendered once a branch is known (project bound to a real repo). -->
  <div v-if="currentBranch" class="relative inline-flex">
    <button
      ref="btnRef"
      type="button"
      class="inline-flex items-center gap-1 px-1.5 py-0.5 -my-0.5 rounded transition max-w-[180px]"
      :style="{
        color: t.text,
        background: open ? t.bgSubtle : 'transparent',
      }"
      :title="tr('session.branch.switch')"
      @click="toggle"
    >
      <GitBranch :size="10" class="flex-shrink-0" />
      <span class="font-mono truncate">{{ currentBranch }}</span>
      <span
        v-if="ahead || behind"
        class="font-mono leading-none text-[12px] flex items-center gap-0.5 flex-shrink-0"
        :style="{ color: t.textDim }"
      >
        <span v-if="ahead">↑{{ ahead }}</span>
        <span v-if="behind">↓{{ behind }}</span>
      </span>
      <ChevronDown :size="10" class="flex-shrink-0" />
    </button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-40" @click="close" />
      <div
        v-if="open"
        class="fixed z-50 rounded-md shadow-lg overflow-hidden flex flex-col min-w-[240px]"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.border}`,
          top: `${menuPos.top}px`,
          left: `${menuPos.left}px`,
          maxHeight: 'min(60vh, 380px)',
        }"
      >
        <div class="p-2 flex-shrink-0" :style="{ borderBottom: `1px solid ${t.border}` }">
          <input
            ref="filterRef"
            v-model="query"
            :placeholder="tr('session.branch.filter')"
            class="w-full rounded px-2 py-1 text-[1em] outline-none"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
          />
        </div>

        <!-- Dirty-tree notice: quick switch stays clean-only; recovery is in the
             full manager. -->
        <div
          v-if="dirtyBranch"
          class="px-3 py-2 flex-shrink-0 text-[1em]"
          :style="{
            background: t.dangerBg,
            color: t.danger,
            borderBottom: `1px solid ${t.border}`,
          }"
        >
          {{ tr('session.branch.dirty', { name: dirtyBranch }) }}
        </div>

        <div class="flex-1 overflow-y-auto py-1 min-h-0">
          <button
            v-for="b in filtered"
            :key="b.name"
            type="button"
            class="w-full text-left px-3 py-1.5 flex items-center gap-2 transition"
            :style="{
              background: hover === b.name ? t.bgHover : 'transparent',
              color: b.isCurrent ? t.accent : t.text,
            }"
            @mouseenter="hover = b.name"
            @mouseleave="hover = null"
            @click="onPick(b)"
          >
            <GitBranch :size="11" class="flex-shrink-0" :style="{ color: t.textDim }" />
            <span class="font-mono text-[1em] flex-1 truncate">{{ b.name }}</span>
            <span
              v-if="b.ahead || b.behind"
              class="font-mono leading-none text-[12px] flex-shrink-0"
              :style="{ color: t.textFaint }"
            >
              <span v-if="b.ahead">↑{{ b.ahead }}</span>
              <span v-if="b.behind" class="ml-1">↓{{ b.behind }}</span>
            </span>
            <Check
              v-if="b.isCurrent"
              :size="11"
              class="flex-shrink-0"
              :style="{ color: t.accent }"
            />
          </button>
          <div
            v-if="filtered.length === 0"
            class="px-3 py-4 text-center text-[1em]"
            :style="{ color: t.textFaint }"
          >
            {{ query ? tr('session.branch.no_match') : tr('session.branch.none') }}
          </div>
        </div>

        <button
          type="button"
          class="px-3 py-2 flex-shrink-0 flex items-center gap-2 text-[1em] transition"
          :style="{
            color: t.textDim,
            borderTop: `1px solid ${t.border}`,
            background: openGitHover ? t.bgHover : 'transparent',
          }"
          @mouseenter="openGitHover = true"
          @mouseleave="openGitHover = false"
          @click="onOpenGit"
        >
          <GitCompare :size="12" />
          <span>{{ tr('session.branch.open_git') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronDown, GitBranch, GitCompare } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { SidecarGitBranch } from '~/composables/useGitApi'

const props = defineProps<{
  // Absolute path of the session's bound project (null when no repo). Drives the
  // independent branch reader.
  workspaceRoot: string | null
}>()

const emit = defineEmits<{ 'open-git': [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

const { localBranches, currentBranch, ahead, behind, dirtyBranch, switchBranch, clearDirty } =
  useSessionBranch(() => props.workspaceRoot)

const open = ref(false)
const query = ref('')
const hover = ref<string | null>(null)
const openGitHover = ref(false)
const btnRef = ref<HTMLElement | null>(null)
const filterRef = ref<HTMLInputElement | null>(null)
const menuPos = ref({ top: 0, left: 0 })

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return localBranches.value
  return localBranches.value.filter((b) => b.name.toLowerCase().includes(q))
})

const close = () => {
  open.value = false
}

const toggle = () => {
  open.value = !open.value
}

const onPick = async (b: SidecarGitBranch) => {
  if (b.isCurrent) {
    close()
    return
  }
  const ok = await switchBranch(b.name)
  if (ok) close()
}

const onOpenGit = () => {
  close()
  emit('open-git')
}

watch(open, async (next) => {
  if (!next) {
    clearDirty()
    return
  }
  query.value = ''
  await nextTick()
  const r = btnRef.value?.getBoundingClientRect()
  // Right-align the 240px menu under the chip, clamped to the viewport.
  if (r)
    menuPos.value = {
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - 248)),
    }
  filterRef.value?.focus()
})
</script>
