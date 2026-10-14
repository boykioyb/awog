<template>
  <div>
    <SettingsPaneHeader :title="t('userscripts.settings.heading')" />
    <p class="su-intro">{{ t('userscripts.settings.intro') }}</p>
    <p class="su-note">
      <Icon name="warn" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span>{{ t('userscripts.settings.agentNote') }}</span>
    </p>

    <div v-if="!hasEngine" class="su-intro">{{ t('userscripts.settings.unavailable') }}</div>

    <template v-else>
      <div class="su-toolbar">
        <Button size="sm" variant="default" @click="openNew">
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('userscripts.settings.add') }}
        </Button>
        <Button size="sm" variant="outline" @click="importOpen = !importOpen">
          <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('userscripts.settings.importUrl') }}
        </Button>
      </div>

      <form v-if="importOpen" class="su-import" @submit.prevent="onImport">
        <Input
          v-model="importDraft"
          type="text"
          spellcheck="false"
          :placeholder="t('userscripts.settings.importPlaceholder')"
          :disabled="importing"
        />
        <Button
          size="sm"
          variant="default"
          type="submit"
          :disabled="!importDraft.trim() || importing"
        >
          {{ importing ? t('userscripts.settings.importing') : t('userscripts.settings.import') }}
        </Button>
      </form>
      <div v-if="importError" class="su-err" role="alert">{{ importError }}</div>

      <div v-if="!scripts.length" class="su-empty">{{ t('userscripts.settings.empty') }}</div>

      <div v-for="s in scripts" :key="s.id" class="su-row" :class="{ off: !s.enabled }">
        <div class="su-head">
          <span class="su-name">{{ s.meta.name }}</span>
          <span v-if="s.meta.version" class="su-ver">{{ s.meta.version }}</span>
          <span
            v-if="s.warnings.length"
            class="su-warn"
            :title="s.warnings.join('\n')"
            :aria-label="s.warnings.join(' · ')"
          >
            <Icon name="warn" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ t('userscripts.settings.warnings', { count: s.warnings.length }) }}
          </span>
          <span class="flex-1" />
          <button
            type="button"
            class="su-btn"
            :title="t('common.edit')"
            :aria-label="t('common.edit')"
            @click="openEdit(s.id)"
          >
            <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
          <button
            type="button"
            class="su-btn su-del"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @click="onDelete(s)"
          >
            <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
          <Switch
            :checked="s.enabled"
            :title="t('userscripts.settings.enabled')"
            :aria-label="t('userscripts.settings.enabled')"
            @update:checked="run(() => api.setEnabled(s.id, $event))"
          />
        </div>
        <div v-if="s.meta.description" class="su-desc">{{ s.meta.description }}</div>
        <div class="su-meta">
          <span class="su-match" :title="patternsOf(s).join('\n')">{{ matchSummary(s) }}</span>
          <span class="chip">{{ s.meta.runAt }}</span>
        </div>
        <ul v-if="s.warnings.length" class="su-warnlist">
          <li v-for="w in s.warnings" :key="w">{{ w }}</li>
        </ul>
      </div>
    </template>

    <UserscriptEditorModal :open="editorOpen" :script-id="editingId" @close="editorOpen = false" />
  </div>
</template>

<script setup lang="ts">
// Settings → Userscript (docs/features/browser-userscripts.md).
//
// Section riêng chứ không phải sub-card của "Hồ sơ trình duyệt": script là GLOBAL (chạy ở
// mọi hồ sơ), còn mọi thứ trong "Hồ sơ" là theo-hồ-sơ — để chung sẽ gợi ý sai rằng script
// thuộc về một hồ sơ. Cũng giữ SettingsBrowser (đang có nhiều người sửa) khỏi phình thêm.
//
// Mọi thao tác ghi đi qua sidecar (`userscripts.*`); sidecar parse header, UI chỉ hiển
// thị. Xoá là phá huỷ (mất cả mã nguồn người dùng đã viết) nên đi qua confirm().
import type { UserscriptItem } from '~/types'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Switch from '~/components/ui/switch/Switch.vue'
import UserscriptEditorModal from '~/components/userscript/UserscriptEditorModal.vue'
import { useConfirm } from '~/composables/useConfirm'
import { sidecarErrorText, useSidecar } from '~/composables/useSidecar'
import { useUserscripts } from '~/composables/useUserscripts'

const { t } = useI18n()
const { confirm } = useConfirm()
const hasEngine = useSidecar().available
const api = useUserscripts()
const { scripts } = api

const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const importOpen = ref(false)
const importDraft = ref('')
const importing = ref(false)
const importError = ref('')

const fail = (err: unknown): void => {
  useToast().add({
    title: t('browser.toast.failed', { message: sidecarErrorText(err) }),
    color: 'error',
  })
}

const run = async (fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn()
  } catch (err) {
    fail(err)
  }
}

const openNew = (): void => {
  editingId.value = null
  editorOpen.value = true
}

const openEdit = (id: string): void => {
  editingId.value = id
  editorOpen.value = true
}

const patternsOf = (s: UserscriptItem): string[] => [...s.meta.match, ...s.meta.include]

// Một dòng gọn: hai pattern đầu + "+N" — danh sách đầy đủ nằm ở tooltip.
const matchSummary = (s: UserscriptItem): string => {
  const all = patternsOf(s)
  if (!all.length) return t('userscripts.settings.noMatch')
  const shown = all.slice(0, 2).join(', ')
  return all.length > 2 ? `${shown} +${all.length - 2}` : shown
}

const onImport = async (): Promise<void> => {
  const url = importDraft.value.trim()
  if (!url || importing.value) return
  importing.value = true
  importError.value = ''
  try {
    const item = await api.importUrl(url)
    importDraft.value = ''
    importOpen.value = false
    useToast().add({
      title: t('userscripts.toast.imported', { name: item.meta.name }),
      color: 'success',
    })
  } catch (err) {
    importError.value = sidecarErrorText(err)
  } finally {
    importing.value = false
  }
}

const onDelete = async (s: UserscriptItem): Promise<void> => {
  const ok = await confirm({
    title: t('userscripts.settings.deleteTitle', { name: s.meta.name }),
    description: t('userscripts.settings.deleteDesc'),
    confirmLabel: t('common.delete'),
  })
  if (ok) await run(() => api.remove(s.id))
}
</script>

<style scoped>
.su-intro {
  margin: 0 0 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.su-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.su-note svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--amber);
}
.su-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.su-import {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.su-err {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: var(--r-btn);
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
}
.su-empty {
  padding: 16px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--r-card);
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}
.su-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.su-row.off .su-name {
  color: var(--textDim);
}
.su-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.su-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.su-ver {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.su-warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--amber) 16%, transparent);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.su-btn {
  display: flex;
  align-items: center;
  padding: 6px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.su-btn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.su-del:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
.su-desc {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.su-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.su-match {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textFaint);
  font-family: var(--code); /* mono-ok: pattern @match là chuỗi kỹ thuật người dùng copy-paste */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.su-warnlist {
  margin: 0;
  padding-left: 18px;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  list-style: disc;
}
</style>
