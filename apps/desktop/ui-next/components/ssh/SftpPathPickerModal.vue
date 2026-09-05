<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on sfpp-ovl" @click.self="emit('cancel')">
      <div class="sfpp-card" role="dialog" aria-modal="true">
        <div class="sfpp-head">
          <Icon :name="mode === 'move' ? 'move' : 'copy'" class="sfpp-icn" />
          <span class="sfpp-title">
            {{ mode === 'move' ? t('ssh.sftp.picker.moveTitle') : t('ssh.sftp.picker.copyTitle') }}
          </span>
        </div>

        <div class="sfpp-crumbs">
          <button class="sfpp-crumb" :disabled="pcwd === '.'" @click="navigate('.')">~</button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <span class="sfpp-sep">/</span>
            <button class="sfpp-crumb" @click="navigate(seg.path)">{{ seg.name }}</button>
          </template>
        </div>

        <div class="sfpp-list">
          <div v-if="loading" class="sfpp-empty">{{ t('ssh.sftp.loading') }}</div>
          <div v-else-if="error" class="sfpp-err mono">{{ error }}</div>
          <template v-else>
            <button v-if="pcwd !== '.'" class="sfpp-row" @click="navigate(parentPath)">
              <Icon name="chev" class="sfpp-up-icn" style="width: 13px; height: 13px" />
              <span>..</span>
            </button>
            <div v-if="!dirs.length" class="sfpp-empty">{{ t('ssh.sftp.picker.noSubdirs') }}</div>
            <button
              v-for="d in dirs"
              :key="d.name"
              class="sfpp-row"
              @click="navigate(join(d.name))"
            >
              <Icon name="folder" class="sfpp-dir-icn" style="width: 13px; height: 13px" />
              <span>{{ d.name }}</span>
            </button>
          </template>
        </div>

        <div class="sfpp-dest mono">{{ displayPath }}</div>

        <div class="sfpp-foot">
          <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
          <button class="btn pri" @click="emit('confirm', pcwd)">
            {{ t('ssh.sftp.picker.select') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Remote folder picker for Move/Copy destinations. Browses directories only, in
// the same path space as the main browser ('.'-relative or absolute), and returns
// the chosen folder path. Reuses ssh.sftp.list.
import { computed, ref, watch } from 'vue'
import { useSshApi, type SftpEntry } from '~/composables/useSshApi'

const props = defineProps<{
  open: boolean
  connId: string
  mode: 'move' | 'copy'
  startPath: string
}>()
const emit = defineEmits<{ confirm: [dest: string]; cancel: [] }>()

const { t } = useI18n()
const api = useSshApi()

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

<style scoped>
.sfpp-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 200;
}
.sfpp-card {
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.sfpp-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.sfpp-icn {
  width: 16px;
  height: 16px;
  color: var(--accent);
}
.sfpp-title {
  font-size: var(--fs-lg);
  font-weight: 650;
  color: var(--text);
}
.sfpp-crumbs {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
}
.sfpp-crumb {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 1px 3px;
  border-radius: var(--r-xs);
  /* mono-ok: remote path segment */
  font-family: var(--code);
}
.sfpp-crumb:disabled {
  color: var(--textDim);
  cursor: default;
}
.sfpp-crumb:not(:disabled):hover {
  background: var(--bgHover);
}
.sfpp-sep {
  color: var(--textDim);
}
.sfpp-list {
  height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgInput);
}
.sfpp-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.sfpp-row + .sfpp-row {
  border-top: 1px solid var(--border);
}
.sfpp-row:hover {
  background: var(--bgHover);
}
.sfpp-up-icn {
  transform: rotate(90deg);
  color: var(--textDim);
}
.sfpp-dir-icn {
  color: var(--accent);
}
.sfpp-empty {
  padding: 12px 14px;
  font-size: var(--fs-sm);
  color: var(--textDim);
}
.sfpp-err {
  padding: 12px 14px;
  font-size: var(--fs-sm);
  color: var(--danger);
  word-break: break-word;
}
.sfpp-dest {
  font-size: var(--fs-sm);
  color: var(--textDim);
  word-break: break-all;
}
.sfpp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
