<template>
  <div>
    <SettingsPaneHeader :title="t('userscripts.settings.heading')" />
    <p class="mt-0 mb-3 text-sm text-dim">{{ t('userscripts.settings.intro') }}</p>
    <Alert class="mb-3 px-2.5 py-2 text-dim">
      <Icon name="warn" class="text-warning" />
      <AlertDescription class="text-sm text-dim">
        {{ t('userscripts.settings.agentNote') }}
      </AlertDescription>
    </Alert>

    <div v-if="!hasEngine" class="mb-3 text-sm text-dim">
      {{ t('userscripts.settings.unavailable') }}
    </div>

    <template v-else>
      <div class="mb-2.5 flex gap-2">
        <Button size="sm" variant="default" @click="openNew">
          <Icon name="plus" class="size-3.5" />
          {{ t('userscripts.settings.add') }}
        </Button>
        <Button size="sm" variant="outline" @click="importOpen = !importOpen">
          <Icon name="download" class="size-3.5" />
          {{ t('userscripts.settings.importUrl') }}
        </Button>
      </div>

      <form v-if="importOpen" class="mb-2.5 flex gap-2" @submit.prevent="onImport">
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
      <div
        v-if="importError"
        class="mb-2.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-sm whitespace-pre-wrap text-destructive"
        role="alert"
      >
        {{ importError }}
      </div>

      <div
        v-if="!scripts.length"
        class="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-faint"
      >
        {{ t('userscripts.settings.empty') }}
      </div>

      <div
        v-for="s in scripts"
        :key="s.id"
        class="mb-2 flex flex-col gap-1.5 rounded-xl border px-3 py-2.5"
      >
        <div class="flex items-center gap-2">
          <span
            class="min-w-0 truncate text-base"
            :class="s.enabled ? 'text-foreground' : 'text-dim'"
          >
            {{ s.meta.name }}
          </span>
          <span v-if="s.meta.version" class="text-xs text-faint">{{ s.meta.version }}</span>
          <Badge
            v-if="s.warnings.length"
            variant="warning"
            :title="s.warnings.join('\n')"
            :aria-label="s.warnings.join(' · ')"
          >
            <Icon name="warn" />
            {{ t('userscripts.settings.warnings', { count: s.warnings.length }) }}
          </Badge>
          <span class="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            class="text-dim"
            :title="t('common.edit')"
            :aria-label="t('common.edit')"
            @click="openEdit(s.id)"
          >
            <Icon name="edit" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            class="text-dim hover:bg-destructive/10 hover:text-destructive"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @click="onDelete(s)"
          >
            <Icon name="trash" />
          </Button>
          <Switch
            :checked="s.enabled"
            :title="t('userscripts.settings.enabled')"
            :aria-label="t('userscripts.settings.enabled')"
            @update:checked="run(() => api.setEnabled(s.id, $event))"
          />
        </div>
        <div v-if="s.meta.description" class="text-sm text-dim">{{ s.meta.description }}</div>
        <div class="flex min-w-0 items-center gap-2">
          <!-- mono-ok: pattern @match là chuỗi kỹ thuật người dùng copy-paste -->
          <span
            class="min-w-0 truncate font-mono text-xs text-faint"
            :title="patternsOf(s).join('\n')"
          >
            {{ matchSummary(s) }}
          </span>
          <Badge variant="outline" class="text-muted-foreground">{{ s.meta.runAt }}</Badge>
        </div>
        <ul v-if="s.warnings.length" class="m-0 list-disc pl-4.5 text-xs text-warning">
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
