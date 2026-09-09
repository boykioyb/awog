<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="emit('close')">
      <div class="bsm-card" role="dialog" aria-modal="true">
        <div class="bsm-head">
          <Icon name="shield" class="icn" />
          <span class="bsm-title">{{ t('browser.sites.title') }}</span>
          <button class="bsm-x" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" class="icn" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <p class="bsm-desc">{{ t('browser.sites.desc') }}</p>

        <div class="bsm-row">
          <span class="bsm-label">{{ t('browser.sites.mode') }}</span>
          <AppSelect v-model="modeModel" :options="modeOptions" width="100%" :disabled="busy" />
        </div>

        <div class="bsm-row">
          <span class="bsm-label">{{ t('browser.sites.hosts') }}</span>
          <form class="bsm-add" @submit.prevent="onAdd">
            <input
              v-model="draft"
              class="bsm-input"
              type="text"
              spellcheck="false"
              :placeholder="t('browser.sites.placeholder')"
            />
            <button type="submit" class="bsm-btn" :disabled="!normalizedDraft || busy">
              {{ t('browser.sites.add') }}
            </button>
          </form>

          <div v-if="!hosts.length" class="bsm-empty">{{ t('browser.sites.empty') }}</div>
          <ul v-else class="bsm-hosts">
            <li v-for="host in hosts" :key="host" class="bsm-host">
              <span class="bsm-hostname">{{ host }}</span>
              <button class="bsm-x" :title="t('browser.sites.remove')" @click="onRemove(host)">
                <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </button>
            </li>
          </ul>
        </div>

        <div v-if="error" class="bsm-err">{{ error }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// ⋮ → "Quản lý site được phép" (ADR 0086 phần E) — chính sách host của trình duyệt
// agent. 'off' = chỉ hàng rào có sẵn (loopback / IP private) chặn; 'allowlist' =
// thêm điều kiện host phải nằm trong danh sách.
//
// Ghi NGAY mỗi lần đổi (không có nút Save): một chính sách bảo mật nửa vời trên
// màn hình mà chưa xuống đĩa là thứ dễ đọc sai nhất ở bề mặt này.
import type { AwogBrowserSites } from '~/types/awog-bridge'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()

const bridge = computed(() =>
  typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
)
const mode = ref<AwogBrowserSites['mode']>('off')
// AppSelect nói chuyện bằng v-model<string>; đi qua một computed để tách "người
// dùng đổi chính sách" (phải ghi xuống đĩa) khỏi "load() gán giá trị từ đĩa" (không
// được ghi lại — nó sẽ đè lên thay đổi mà cửa sổ khác vừa làm).
const modeModel = computed<string>({
  get: () => mode.value,
  set: (next) => {
    if (next !== 'off' && next !== 'allowlist') return
    if (next === mode.value) return
    mode.value = next
    void save()
  },
})
const hosts = ref<string[]>([])
const draft = ref('')
const busy = ref(false)
const error = ref('')

const modeOptions = computed(() => [
  { label: t('browser.sites.mode.off'), value: 'off' },
  { label: t('browser.sites.mode.allowlist'), value: 'allowlist' },
])

// Input của người dùng là L1: nhận cả link dán vào ("https://x.com/a?b") và cắt
// xuống đúng phần host trước khi cho nó vào chính sách.
const normalize = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^/@]*@/, '')
    .split(/[/?#]/)[0]!
    .replace(/\.+$/, '')
const normalizedDraft = computed(() => {
  const host = normalize(draft.value)
  return /^[a-z0-9.*_:-]+$/.test(host) ? host : ''
})

const load = async (): Promise<void> => {
  const api = bridge.value
  if (!api) return
  error.value = ''
  try {
    const sites = await api.sites()
    mode.value = sites.mode
    hosts.value = [...sites.hosts]
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const save = async (): Promise<void> => {
  const api = bridge.value
  if (!api) return
  busy.value = true
  error.value = ''
  try {
    // Bản sao thuần: `hosts.value` là proxy reactive, và biên IPC clone theo cấu
    // trúc — đừng đẩy proxy xuống dưới đó.
    await api.setSites({ mode: mode.value, hosts: [...hosts.value] })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    // Chính sách trên đĩa mới là sự thật — đọc lại để UI không nói dối.
    await load()
  } finally {
    busy.value = false
  }
}

const onAdd = (): void => {
  const host = normalizedDraft.value
  if (!host) return
  draft.value = ''
  if (hosts.value.includes(host)) return
  hosts.value = [...hosts.value, host]
  void save()
}
const onRemove = (host: string): void => {
  hosts.value = hosts.value.filter((h) => h !== host)
  void save()
}

// Nạp lại mỗi lần mở: agent (hoặc cửa sổ khác) có thể đã đổi chính sách.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    draft.value = ''
    void load()
  },
  { immediate: true },
)
useEscToClose(
  () => props.open,
  () => emit('close'),
)
</script>

<style scoped>
.bsm-card {
  width: min(460px, 92vw);
  max-height: 86vh;
  overflow-y: auto;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bsm-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bsm-title {
  flex: 1;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}
.bsm-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
}
.bsm-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.bsm-desc {
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.bsm-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.bsm-add {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bsm-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bsm-input:focus {
  outline: none;
  border-color: var(--accentBorder);
}
.bsm-btn {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: var(--r-btn);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.bsm-btn:hover:not(:disabled) {
  border-color: var(--accentBorder);
}
.bsm-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.bsm-empty {
  padding: 8px 10px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textFaint);
}
.bsm-hosts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.bsm-host {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.bsm-hostname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-family: var(--code); /* mono-ok: host là chuỗi kỹ thuật người dùng copy-paste */
}
.bsm-err {
  padding: 8px 10px;
  border-radius: var(--r-btn);
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
