<template>
  <!-- Nạp lại file từ đĩa. Luôn có; khi useWorkbenchDocs dò thấy file đổi ngoài
       app (fs:changed / chọn tab / cửa sổ lấy lại focus) thì đổi sang màu accent +
       nhãn "Đã thay đổi" để người dùng thấy bản đang xem đã cũ. -->
  <button
    type="button"
    class="flex h-6 flex-none items-center gap-1 rounded-[var(--r-xs)] px-1 transition hover:bg-[var(--bgHover)]"
    :class="st.diskChanged ? 'text-[var(--accent)]' : 'text-dim hover:text-[var(--text)]'"
    :title="st.diskChanged ? t('workbench.file.reloadChanged') : t('workbench.file.reload')"
    :aria-label="st.diskChanged ? t('workbench.file.reloadChanged') : t('workbench.file.reload')"
    :disabled="busy"
    @click="onReload"
  >
    <Icon
      name="refresh"
      :class="{ 'animate-spin': busy }"
      style="width: var(--icon-sm); height: var(--icon-sm)"
    />
    <span v-if="st.diskChanged" class="text-xs">{{ t('workbench.file.changedOnDisk') }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import Icon from '~/components/Icon.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()
const emit = defineEmits<{ reloaded: [] }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const st = wbDocs.fileStateOf(props.doc)
const busy = ref(false)

async function onReload() {
  busy.value = true
  try {
    if (await wbDocs.reloadFile(props.doc)) emit('reloaded')
  } finally {
    busy.value = false
  }
}
</script>
