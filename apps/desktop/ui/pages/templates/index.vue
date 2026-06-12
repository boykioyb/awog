<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="selectedId"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" :placeholder="tr('templates.search')" />
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('templates.refresh')"
          :disabled="refreshing"
          @click="refresh"
        >
          <RotateCw :size="14" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('templates.new')"
          @click="openSaveDialog"
        >
          <Plus :size="14" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-if="filtered.length === 0"
          class="px-4 py-8 text-center text-[1em]"
          :style="{ color: t.textFaint }"
        >
          {{ tr('templates.empty') }}
        </div>
        <button
          v-for="tpl in filtered"
          :key="tpl.id"
          class="w-full px-3 py-2.5 text-left cursor-pointer transition"
          :style="{
            background: pill(selectedId === tpl.id).background,
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedId === tpl.id ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(tpl)"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Package :size="12" :style="{ color: t.textDim }" />
            <span class="text-[1em] font-medium flex-1 truncate" :style="{ color: t.text }">
              {{ tpl.name }}
            </span>
            <span class="text-[12px] font-mono leading-none" :style="{ color: t.textFaint }">
              {{ tpl.entities.length }}
            </span>
          </div>
          <div class="text-[1em] truncate ml-5" :style="{ color: t.textDim }">
            {{ tpl.description || '—' }}
          </div>
        </button>
      </div>
    </template>

    <template #detail>
      <div v-if="selected" class="flex flex-col h-full min-h-0">
        <div class="flex-1 overflow-y-auto p-4 md:p-6">
          <div class="flex items-start gap-3 mb-6">
            <div
              class="w-12 h-12 rounded flex items-center justify-center"
              :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
            >
              <Package :size="20" :style="{ color: t.textMuted }" />
            </div>
            <div class="flex-1 min-w-0">
              <h1 class="text-lg font-semibold mb-1" :style="{ color: t.text }">
                {{ selected.name }}
              </h1>
              <div class="text-[1em]" :style="{ color: t.textDim }">
                {{ selected.description || '—' }}
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button
                class="px-3 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
                :style="{ background: t.accent, color: t.accentText }"
                @click="openInstallDialog"
              >
                <PackagePlus :size="13" />
                {{ tr('templates.detail.install') }}
              </button>
              <button
                class="p-1.5 rounded transition"
                :style="{ color: t.textDim }"
                :title="tr('templates.detail.delete')"
                @click="askDelete"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>

          <div
            class="text-[1em] uppercase tracking-wider font-medium mb-2"
            :style="{ color: t.textDim }"
          >
            {{ tr('templates.detail.entities') }} · {{ selected.entities.length }}
          </div>

          <div
            v-if="selected.entities.length === 0"
            class="text-[1em] py-4"
            :style="{ color: t.textFaint }"
          >
            {{ tr('templates.detail.no_entities') }}
          </div>

          <div v-for="group in selectedGroups" :key="group.kind" class="mb-4">
            <div class="flex items-center gap-2 mb-1.5">
              <span
                class="text-[1em] uppercase tracking-wider font-semibold"
                :style="{ color: t.textDim }"
              >
                {{ tr(`import.kind.${group.kind}`) }}
              </span>
              <span
                class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded"
                :style="{
                  background: t.bgInput,
                  color: t.textDim,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ group.entities.length }}
              </span>
            </div>
            <div class="space-y-1">
              <div
                v-for="entity in group.entities"
                :key="`${entity.kind}|${entity.id}`"
                class="rounded px-3 py-2 flex items-center gap-2"
                :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
              >
                <span class="text-[1em] font-mono flex-1 truncate" :style="{ color: t.text }">
                  {{ entity.id }}
                </span>
                <span class="text-[12px] font-mono" :style="{ color: t.textFaint }">
                  {{ entity.file }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #empty-detail>
      <EmptyView :icon="Package" :title="tr('templates.select')" />
    </template>
  </MasterDetailShell>

  <SaveAsTemplateDialog :open="saveDialogOpen" @close="saveDialogOpen = false" @saved="onSaved" />

  <InstallTemplateDialog
    v-if="selected"
    :open="installDialogOpen"
    :fixed-template-id="selected.id"
    @close="installDialogOpen = false"
    @installed="onInstalled"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    :title="tr('templates.delete.title', { name: pendingDelete.name })"
    :description="tr('templates.delete.description')"
    @confirm="confirmDelete"
    @cancel="pendingDelete = null"
  />

  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="px-3 py-2 rounded text-[1em] shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Package, PackagePlus, Plus, RotateCw, Trash2 } from 'lucide-vue-next'

const { t } = useTheme()
const { t: tr } = useI18n()
const { pill } = useGlass()

const {
  searchQuery,
  filtered,
  selectedId,
  selected,
  selectedGroups,
  mobilePane,
  refreshing,
  onSelect,
  onBack,
  refresh,
  saveDialogOpen,
  installDialogOpen,
  openSaveDialog,
  openInstallDialog,
  onSaved,
  onInstalled,
  pendingDelete,
  askDelete,
  confirmDelete,
  toasts,
  toastStyle,
} = useTemplatesManager()
</script>
