<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-105 gap-3 p-4">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 pr-6 font-normal">
          <Icon name="bookmark" class="size-4" />
          {{ bookmarkId ? t('browser.bookmarks.editTitle') : t('browser.bookmarks.addTitle') }}
        </DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-1">
        <Label for="bmd-title" class="text-xs font-normal text-muted-foreground">
          {{ t('browser.bookmarks.name') }}
        </Label>
        <Input id="bmd-title" v-model="titleDraft" type="text" @keydown.enter.prevent="save" />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="bmd-url" class="text-xs font-normal text-muted-foreground">URL</Label>
        <Input
          id="bmd-url"
          v-model="urlDraft"
          type="text"
          spellcheck="false"
          @keydown.enter.prevent="save"
        />
      </div>

      <div class="flex flex-col gap-1">
        <span class="text-xs text-muted-foreground">{{ t('browser.bookmarks.folder') }}</span>
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
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Hộp thoại thêm / sửa MỘT bookmark (☆ trong ô URL và "Sửa" ở thanh bookmark). Là Dialog
// chứ không phải popover neo: view native của trang vẽ đè lên mọi DOM, mà
// `[role="dialog"][data-state="open"]` nằm trong OVERLAYS của useEmbeddedBrowser nên
// trang tự nhường chỗ.
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
