<template>
  <!-- z-200: band hộp thoại trên cùng — mở từ SFTP browser có thể đang nằm trong modal. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && emit('cancel')">
    <DialogContent class="z-200 flex max-w-[92vw] flex-col gap-3 rounded-xl p-4.5 sm:max-w-105">
      <DialogHeader class="flex-row items-center gap-2">
        <Icon :name="mode === 'move' ? 'move' : 'copy'" class="size-4 shrink-0 text-primary" />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ mode === 'move' ? t('ssh.sftp.picker.moveTitle') : t('ssh.sftp.picker.copyTitle') }}
        </DialogTitle>
      </DialogHeader>

      <div class="flex flex-wrap items-center gap-0.5 text-sm">
        <Button
          variant="ghost"
          size="xs"
          :class="CRUMB"
          :disabled="pcwd === '.'"
          @click="navigate('.')"
        >
          ~
        </Button>
        <template v-for="(seg, i) in crumbs" :key="i">
          <span class="text-muted-foreground">/</span>
          <Button variant="ghost" size="xs" :class="CRUMB" @click="navigate(seg.path)">
            {{ seg.name }}
          </Button>
        </template>
      </div>

      <div class="h-60 overflow-y-auto rounded-lg border bg-muted">
        <div v-if="loading" class="px-3.5 py-3 text-sm text-muted-foreground">
          {{ t('ssh.sftp.loading') }}
        </div>
        <div v-else-if="error" class="px-3.5 py-3 font-mono text-sm break-words text-destructive">
          {{ error }}
        </div>
        <template v-else>
          <!-- raw-ok: cả hàng thư mục là một vùng bấm (đi vào thư mục), không phải nút. -->
          <button v-if="pcwd !== '.'" type="button" :class="ROW" @click="navigate(parentPath)">
            <Icon name="chev" class="size-3.5 shrink-0 rotate-90 text-muted-foreground" />
            <span>..</span>
          </button>
          <div v-if="!dirs.length" class="px-3.5 py-3 text-sm text-muted-foreground">
            {{ t('ssh.sftp.picker.noSubdirs') }}
          </div>
          <!-- raw-ok: cả hàng thư mục là một vùng bấm (đi vào thư mục), không phải nút. -->
          <button
            v-for="d in dirs"
            :key="d.name"
            type="button"
            :class="ROW"
            @click="navigate(join(d.name))"
          >
            <Icon name="folder" class="size-3.5 shrink-0 text-primary" />
            <span>{{ d.name }}</span>
          </button>
        </template>
      </div>

      <div class="font-mono text-sm break-all text-muted-foreground">{{ displayPath }}</div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button variant="default" @click="emit('confirm', pcwd)">
          {{ t('ssh.sftp.picker.select') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Remote folder picker for Move/Copy destinations. Browses directories only, in
// the same path space as the main browser ('.'-relative or absolute), and returns
// the chosen folder path. Reuses ssh.sftp.list.
import { computed, ref, watch } from 'vue'
import { useSshApi, type SftpEntry } from '~/composables/useSshApi'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  connId: string
  mode: 'move' | 'copy'
  startPath: string
}>()
const emit = defineEmits<{ confirm: [dest: string]; cancel: [] }>()

const { t } = useI18n()
const api = useSshApi()

// Class lặp: hàng thư mục (chia hairline giữa hai hàng liền kề) + breadcrumb.
const ROW =
  'flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-accent [&+&]:border-t'
const CRUMB =
  'h-auto px-1 py-0 font-mono text-sm font-normal text-primary disabled:text-muted-foreground disabled:opacity-100'

const pcwd = ref('.')
const entries = ref<SftpEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const dirs = computed(() =>
  entries.value
    .filter((e) => (e.type === 'dir' || e.type === 'symlink') && e.name !== '.' && e.name !== '..')
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const displayPath = computed(() =>
  pcwd.value === '.' ? '~' : pcwd.value.startsWith('/') ? pcwd.value : `~/${pcwd.value}`,
)
const crumbs = computed(() => {
  if (pcwd.value === '.') return [] as { name: string; path: string }[]
  const abs = pcwd.value.startsWith('/')
  const parts = pcwd.value.split('/').filter(Boolean)
  const out: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : abs ? `/${p}` : p
    out.push({ name: p, path: acc })
  }
  return out
})
const parentPath = computed(() => {
  if (pcwd.value === '.') return '.'
  const idx = pcwd.value.lastIndexOf('/')
  return idx < 0 ? '.' : pcwd.value.slice(0, idx)
})
const join = (name: string): string => (pcwd.value === '.' ? name : `${pcwd.value}/${name}`)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await api.sftpList(props.connId, pcwd.value)
    entries.value = res.entries
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    entries.value = []
  } finally {
    loading.value = false
  }
}
function navigate(path: string): void {
  pcwd.value = path || '.'
  void load()
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      pcwd.value = props.startPath || '.'
      void load()
    }
  },
)
</script>
