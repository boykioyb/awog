<template>
  <BaseModal :open="open" :title="tr('import.dialog.title')" size="lg" @close="emit('close')">
    <div class="p-4 space-y-4">
      <p class="text-[1em]" :style="{ color: t.textDim }">
        {{ tr('import.dialog.subtitle') }}
      </p>

      <div
        v-if="candidates.length === 0"
        class="text-[1em] py-8 text-center"
        :style="{ color: t.textFaint }"
      >
        {{ tr('import.dialog.empty') }}
      </div>

      <div v-for="group in groups" :key="group.kind" class="space-y-1.5">
        <div class="flex items-center gap-2">
          <span
            class="text-[1em] uppercase tracking-wider font-semibold"
            :style="{ color: t.textDim }"
          >
            {{ tr(`import.kind.${group.kind}`) }}
          </span>
          <span
            class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded"
            :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            {{ group.items.length }}
          </span>
        </div>
        <label
          v-for="item in group.items"
          :key="candidateKey(item)"
          class="flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition"
          :style="{
            background: isChecked(item) ? t.bgActive : 'transparent',
            opacity: item.alreadyExists ? 0.5 : 1,
            cursor: item.alreadyExists ? 'not-allowed' : 'pointer',
          }"
        >
          <input
            type="checkbox"
            :checked="isChecked(item)"
            :disabled="item.alreadyExists"
            :style="{ accentColor: t.accent, marginTop: '2px' }"
            @change="toggle(item)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[1em] font-mono" :style="{ color: t.text }">{{ item.id }}</span>
              <span
                v-if="item.alreadyExists"
                class="text-[12px] px-1 rounded leading-none"
                :style="{ color: t.textFaint, border: `1px solid ${t.border}` }"
              >
                {{ tr('import.dialog.exists') }}
              </span>
            </div>
            <div
              class="flex items-center gap-1.5 text-[1em] truncate"
              :style="{ color: t.textDim }"
            >
              <span class="truncate">{{ item.name || item.id }}</span>
              <span :style="{ color: t.textFaint }">·</span>
              <span class="font-mono">{{ item.fromLabel }}</span>
            </div>
          </div>
        </label>
      </div>
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition"
        :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
        @click="emit('close')"
      >
        {{ tr('common.cancel') }}
      </button>
      <button
        class="px-3 py-1.5 text-[1em] rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
        :style="{ background: t.accent, color: t.accentText }"
        :disabled="selected.size === 0 || importing"
        @click="onConfirm"
      >
        {{ tr('import.dialog.confirm', { count: selected.size }) }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import type { ConfigKind, ImportCandidate } from '~/types'
import { KIND_ORDER, type ImportSelection } from '~/composables/useConfigImport'

const props = defineProps<{
  open: boolean
  candidates: ImportCandidate[]
  importing: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: [items: ImportSelection[]]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const candidateKey = (c: ImportCandidate): string =>
  `${c.kind}|${c.targetScope}|${c.projectId ?? ''}|${c.id}`

const groups = computed(() => {
  const byKind = new Map<ConfigKind, ImportCandidate[]>()
  for (const c of props.candidates) {
    const list = byKind.get(c.kind) ?? []
    list.push(c)
    byKind.set(c.kind, list)
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    items: byKind.get(kind) ?? [],
  }))
})

// Default-check every candidate that doesn't already exist in `.awog`. Re-seeded
// whenever the dialog opens with a fresh candidate set.
const selected = ref<Set<string>>(new Set())

const seedSelection = () => {
  const next = new Set<string>()
  for (const c of props.candidates) {
    if (!c.alreadyExists) next.add(candidateKey(c))
  }
  selected.value = next
}

watch(
  () => [props.open, props.candidates] as const,
  ([isOpen]) => {
    if (isOpen) seedSelection()
  },
  { immediate: true },
)

const isChecked = (c: ImportCandidate): boolean => selected.value.has(candidateKey(c))

const toggle = (c: ImportCandidate) => {
  if (c.alreadyExists) return
  const key = candidateKey(c)
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const onConfirm = () => {
  const items: ImportSelection[] = props.candidates
    .filter((c) => selected.value.has(candidateKey(c)))
    .map((c) => ({
      kind: c.kind,
      id: c.id,
      targetScope: c.targetScope,
      ...(c.projectId ? { projectId: c.projectId } : {}),
    }))
  if (items.length > 0) emit('confirm', items)
}
</script>
