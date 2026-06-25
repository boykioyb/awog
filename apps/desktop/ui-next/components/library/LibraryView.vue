<template>
  <div class="md libwrap">
    <div class="list" style="flex: 0 0 288px">
      <div class="ltop">
        <div class="srch">
          <Icon name="search" style="width: 13px; height: 13px" />
          <input v-model="q" :placeholder="placeholder ?? t('common.search')" />
        </div>
        <button
          v-if="showNew"
          class="iconbtn"
          :title="t('common.add')"
          style="width: 32px; height: 32px"
          @click="emit('new')"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div class="lscroll">
        <div
          v-for="it in filtered"
          :key="itemKey(it)"
          class="libli"
          :class="{ on: !!selected && itemKey(it) === itemKey(selected) }"
          @click="selectedKey = itemKey(it)"
        >
          <slot name="row" :item="it" />
        </div>
        <div v-if="!filtered.length" class="listempty">{{ t('common.empty.none') }}</div>
      </div>
    </div>
    <div class="detail">
      <slot v-if="selected" name="detail" :item="selected" />
      <div v-else class="empty">
        <span class="ei"><Icon name="folder" style="width: 20px; height: 20px" /></span>
        <div class="et">{{ t('common.empty.choose') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'

// Shared master-detail shell — faithful port of the prototype's mountLib(): a
// searchable list (.list/.ltop/.lscroll/.libli) beside a detail pane (.detail).
// Pages supply per-entity #row and #detail slots + an itemKey. Visual only.
const props = defineProps<{
  items: T[]
  itemKey: (it: T) => string
  // Text searched by the filter box; defaults to itemKey when omitted.
  searchText?: (it: T) => string
  placeholder?: string
  showNew?: boolean
}>()

const emit = defineEmits<{ (e: 'new'): void }>()

const { t } = useI18n()

const q = ref('')
const selectedKey = ref<string | null>(null)

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase()
  if (!query) return props.items
  const text = props.searchText ?? props.itemKey
  return props.items.filter((it) => text(it).toLowerCase().includes(query))
})

// Effective selection: the chosen item if still visible, else the first row
// (matches the prototype auto-selecting the top item).
const selected = computed<T | null>(() => {
  const list = filtered.value
  if (!list.length) return null
  return list.find((it) => props.itemKey(it) === selectedKey.value) ?? list[0] ?? null
})
</script>
