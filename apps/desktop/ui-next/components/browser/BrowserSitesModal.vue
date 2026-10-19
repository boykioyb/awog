<template>
  <!-- Dialog shadcn: `[role="dialog"][data-state="open"]` nằm trong OVERLAYS của
       useEmbeddedBrowser nên trang web nhường chỗ khi hộp mở. -->
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-h-[86vh] max-w-115 gap-3.5 overflow-y-auto p-4.5">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 pr-6 text-lg font-normal">
          <Icon name="shield" class="size-4" />
          {{ t('browser.sites.title') }}
        </DialogTitle>
        <DialogDescription class="text-sm leading-relaxed text-muted-foreground">
          {{ t('browser.sites.desc') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <span>{{ t('browser.sites.mode') }}</span>
        <AppSelect v-model="modeModel" :options="modeOptions" width="100%" :disabled="busy" />
      </div>

      <div class="flex flex-col gap-1.5 text-sm text-muted-foreground">
        <span>{{ t('browser.sites.hosts') }}</span>
        <form class="flex items-center gap-1.5" @submit.prevent="onAdd">
          <Input
            v-model="draft"
            type="text"
            spellcheck="false"
            :placeholder="t('browser.sites.placeholder')"
          />
          <Button type="submit" variant="outline" :disabled="!normalizedDraft || busy">
            {{ t('browser.sites.add') }}
          </Button>
        </form>

        <div v-if="!hosts.length" class="rounded-md border bg-muted px-2.5 py-2 text-faint">
          {{ t('browser.sites.empty') }}
        </div>
        <ul v-else class="flex max-h-55 flex-col gap-1 overflow-y-auto">
          <li
            v-for="host in hosts"
            :key="host"
            class="flex items-center gap-2 rounded-md border bg-muted py-1 pr-1.5 pl-2.5"
          >
            <!-- Host là chuỗi kỹ thuật người dùng copy-paste ⇒ mono. -->
            <span class="flex-1 truncate font-mono text-foreground">{{ host }}</span>
            <Button
              variant="ghost"
              size="iconSm"
              class="text-muted-foreground [&_svg]:size-3"
              :title="t('browser.sites.remove')"
              :aria-label="t('browser.sites.remove')"
              @click="onRemove(host)"
            >
              <Icon name="x" />
            </Button>
          </li>
        </ul>
      </div>

      <Alert
        v-if="error"
        variant="destructive"
        class="border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs"
      >
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// ⋮ → "Quản lý site được phép" (ADR 0086 phần E) — chính sách host của trình duyệt
// agent. 'off' = chỉ hàng rào có sẵn (loopback / IP private) chặn; 'allowlist' =
// thêm điều kiện host phải nằm trong danh sách.
//
// Ghi NGAY mỗi lần đổi (không có nút Save): một chính sách bảo mật nửa vời trên
// màn hình mà chưa xuống đĩa là thứ dễ đọc sai nhất ở bề mặt này.
import type { AwogBrowserSites } from '~/types/awog-bridge'
import Input from '~/components/ui/input/Input.vue'

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
