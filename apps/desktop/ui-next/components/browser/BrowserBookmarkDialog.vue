<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div
        class="flex w-[min(420px,92vw)] flex-col gap-3 rounded-xl border border-border bg-popover p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center gap-2">
          <Icon name="bookmark" style="width: var(--icon-md); height: var(--icon-md)" />
          <span class="flex-1 text-base text-foreground">
            {{ bookmarkId ? t('browser.bookmarks.editTitle') : t('browser.bookmarks.addTitle') }}
          </span>
          <button
            type="button"
            class="bmd-x"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <label class="bmd-field">
          <span class="bmd-label">{{ t('browser.bookmarks.name') }}</span>
          <Input v-model="titleDraft" type="text" @keydown.enter.prevent="save" />
        </label>
        <label class="bmd-field">
          <span class="bmd-label">URL</span>
          <Input v-model="urlDraft" type="text" spellcheck="false" @keydown.enter.prevent="save" />
        </label>

        <div class="bmd-field">
          <span class="bmd-label">{{ t('browser.bookmarks.folder') }}</span>
          <AppSelect v-model="folderDraft" :options="folderOptions" width="100%" />
          <Input
            v-if="folderDraft === NEW_FOLDER"
            v-model="newFolderName"
            type="text"
            :placeholder="t('browser.bookmarks.newFolderPlaceholder')"
            @keydown.enter.prevent="save"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <div class="flex items-center gap-2">
          <Button v-if="bookmarkId" variant="ghost" size="sm" :disabled="busy" @click="removeIt">
            {{ t('browser.bookmarks.remove') }}
          </Button>
          <span class="flex-1" />
          <Button variant="outline" size="sm" @click="emit('close')">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="default" size="sm" :disabled="!canSave || busy" @click="save">
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp thoại thêm / sửa MỘT bookmark (☆ trong ô URL và "Sửa" ở thanh bookmark). Là modal
// `.ovl.on` chứ không phải popover neo: view native của trang vẽ đè lên mọi DOM, mà
// `.ovl.on` nằm trong danh sách OVERLAYS của useEmbeddedBrowser nên trang tự nhường chỗ.
import { useBookmarks } from '~/composables/useBookmarks'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import { sidecarErrorText } from '~/composables/useSidecar'

const props = defineProps<{
  open: boolean
  profileId: string
  // Giá trị gợi ý khi THÊM (URL + title của trang đang xem).
  url: string
  title: string
  // Có = đang SỬA bookmark này.
  bookmarkId?: string
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const bm = useBookmarks(() => props.profileId)

const ROOT = '__root'
const NEW_FOLDER = '__new'

const titleDraft = ref('')
const urlDraft = ref('')
const folderDraft = ref(ROOT)
const newFolderName = ref('')
const busy = ref(false)
const error = ref('')

const folderOptions = computed<AppSelectOption[]>(() => [
  { value: ROOT, label: t('browser.bookmarks.bar') },
  ...bm.folders.value.map((f) => ({ value: f.id, label: f.title })),
  { value: NEW_FOLDER, label: t('browser.bookmarks.newFolder') },
])

const canSave = computed(
  () =>
    /^https?:\/\//i.test(urlDraft.value.trim()) &&
    (folderDraft.value !== NEW_FOLDER || newFolderName.value.trim().length > 0),
)

// Nạp lại form MỖI LẦN mở: mở ☆ ở trang khác không được giữ lại nháp của lần trước.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    error.value = ''
    newFolderName.value = ''
    const existing = props.bookmarkId
      ? bm.flat.value.find((e) => e.node.id === props.bookmarkId)
      : undefined
    titleDraft.value = existing ? existing.node.title : props.title
    urlDraft.value = existing ? existing.node.url : props.url
    folderDraft.value = existing?.folderId ?? ROOT
  },
  { immediate: true },
)

const save = async (): Promise<void> => {
  if (!canSave.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    let folderId: string | null =
      folderDraft.value === ROOT || folderDraft.value === NEW_FOLDER ? null : folderDraft.value
    if (folderDraft.value === NEW_FOLDER) folderId = await bm.addFolder(newFolderName.value.trim())
    const title = titleDraft.value.trim()
    const url = urlDraft.value.trim()
    if (props.bookmarkId) {
      await bm.update(props.bookmarkId, { title, url, folderId })
    } else {
      await bm.add(url, title, folderId ?? undefined)
    }
    emit('close')
  } catch (err) {
    error.value = sidecarErrorText(err)
  } finally {
    busy.value = false
  }
}

const removeIt = async (): Promise<void> => {
  if (!props.bookmarkId) return
  busy.value = true
  try {
    await bm.remove(props.bookmarkId)
    emit('close')
  } catch (err) {
    error.value = sidecarErrorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.bmd-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bmd-label {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.bmd-x {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.bmd-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
</style>
