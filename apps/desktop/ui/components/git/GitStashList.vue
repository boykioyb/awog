<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="px-3 py-2 flex items-center justify-between flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[11px] uppercase tracking-wider" :style="{ color: t.textDim }">Stashes</div>
      <button
        class="flex items-center gap-1 px-2 py-1 text-[10px] rounded transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="showSave = true"
      >
        <Plus :size="10" />
        Stash
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.stashes.length === 0"
        class="px-3 py-12 text-center text-xs"
        :style="{ color: t.textDim }"
      >
        No stash entries
      </div>
      <div
        v-for="entry in store.stashes"
        :key="entry.ref"
        class="px-3 py-2.5"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono" :style="{ color: t.accent }">{{ entry.ref }}</span>
          <span class="text-[10px]" :style="{ color: t.textDim }">on {{ entry.branch }}</span>
          <span class="ml-auto text-[10px]" :style="{ color: t.textFaint }">
            {{ formatDate(entry.date) }}
          </span>
        </div>
        <div class="text-xs mt-1 truncate" :style="{ color: t.text }">
          {{ entry.message }}
        </div>
        <div class="flex items-center gap-1 mt-2">
          <button
            class="text-[10px] px-2 py-1 rounded transition"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
            @click="store.stashPop(entry.index)"
          >
            Pop
          </button>
          <button
            class="text-[10px] px-2 py-1 rounded transition"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
            @click="store.stashApply(entry.index)"
          >
            Apply
          </button>
          <button
            class="text-[10px] px-2 py-1 rounded transition ml-auto"
            :style="{
              background: t.dangerBg,
              color: t.danger,
              border: `1px solid ${t.dangerBorder}`,
            }"
            @click="askDrop(entry.index)"
          >
            Drop
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showSave"
      class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
      style="background: rgba(0, 0, 0, 0.5)"
      @click="showSave = false"
    >
      <div
        class="w-full max-w-[400px] rounded-lg overflow-hidden flex flex-col"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 20px 60px ${t.shadow}`,
        }"
        @click.stop
      >
        <div
          class="px-4 py-3 text-sm font-medium"
          :style="{ borderBottom: `1px solid ${t.border}`, color: t.text }"
        >
          Save stash
        </div>
        <div class="p-4">
          <input
            v-model="newMessage"
            placeholder="Stash message (optional)"
            class="w-full rounded text-xs px-2 py-1.5"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
              outline: 'none',
            }"
            @keydown.enter="onSave"
          />
        </div>
        <div
          class="px-4 py-3 flex justify-end gap-2"
          :style="{ borderTop: `1px solid ${t.border}` }"
        >
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{ color: t.textMuted }"
            @click="showSave = false"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="onSave"
          >
            Save
          </button>
        </div>
      </div>
    </div>

    <ConfirmDeleteModal
      v-if="pendingDrop !== null"
      title="Drop stash?"
      :description="`Stash sẽ bị xóa vĩnh viễn. Tiếp tục?`"
      @confirm="confirmDrop"
      @cancel="pendingDrop = null"
    />
  </div>
</template>

<script setup lang="ts">
import { Plus } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()

const showSave = ref(false)
const newMessage = ref('')
const pendingDrop = ref<number | null>(null)

const formatDate = (iso: string) => {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  const hour = 1000 * 60 * 60
  if (diff < hour) return `${Math.floor(diff / 60000)}m ago`
  if (diff < hour * 24) return `${Math.floor(diff / hour)}h ago`
  return `${Math.floor(diff / (hour * 24))}d ago`
}

const onSave = async () => {
  await store.stashSave(newMessage.value)
  newMessage.value = ''
  showSave.value = false
}

const askDrop = (index: number) => {
  pendingDrop.value = index
}

const confirmDrop = async () => {
  if (pendingDrop.value !== null) {
    await store.stashDrop(pendingDrop.value)
  }
  pendingDrop.value = null
}
</script>
