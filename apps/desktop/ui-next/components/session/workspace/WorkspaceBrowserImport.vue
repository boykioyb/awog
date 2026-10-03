<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="close">
      <div
        class="flex max-h-[86vh] w-[min(560px,92vw)] flex-col gap-3.5 overflow-y-auto rounded-xl border border-border bg-popover p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex items-center gap-2">
          <Download class="size-4 text-muted-foreground" />
          <span class="flex-1 text-base text-foreground">
            {{ t('sessions.workspace.browser.import.title') }}
          </span>
          <Button
            variant="ghost"
            class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X class="size-3.5" />
          </Button>
        </div>

        <!-- What this hands over. Stated before the pickers, not after: importing a
             whole profile gives the agent every session in it. -->
        <div
          class="flex gap-2.5 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <ShieldCheck class="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p>{{ t('sessions.workspace.browser.import.warn') }}</p>
            <p class="mt-1.5 text-muted-foreground">
              {{ t('sessions.workspace.browser.import.excluded') }}
            </p>
            <!-- Not politeness: Local Storage / IndexedDB are LevelDB stores, and
                 copying one mid-write yields a torn store that loads empty. -->
            <p class="mt-1.5 text-muted-foreground">
              {{ t('sessions.workspace.browser.import.quitHint') }}
            </p>
          </div>
        </div>

        <div v-if="loading" class="text-sm text-muted-foreground">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="!sources.length" class="text-sm text-muted-foreground">
          {{ t('sessions.workspace.browser.import.noBrowsers') }}
        </div>

        <template v-else>
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-xs font-medium text-muted-foreground">
              {{ t('sessions.workspace.browser.import.browser') }}
            </span>
            <AppSelect v-model="browserId" :options="browserOptions" width="100%" />
          </label>

          <label class="flex flex-col gap-1.5 text-sm">
            <span class="text-xs font-medium text-muted-foreground">
              {{ t('sessions.workspace.browser.import.profile') }}
            </span>
            <AppSelect
              v-model="profileDir"
              :options="profileOptions"
              width="100%"
              :disabled="!profileOptions.length"
            />
          </label>

          <div class="flex flex-col gap-2 text-sm">
            <span class="text-xs font-medium text-muted-foreground">
              {{ t('sessions.workspace.browser.import.parts') }}
            </span>
            <!-- Nhãn "cần khởi động lại" đứng NGAY cạnh hai phần gây ra nó, chứ
                 không chỉ hiện trong báo cáo sau khi nhập: cookie vào ngay, còn
                 Local Storage/IndexedDB là store LevelDB nên phải chờ boot. Người
                 dùng chọn được cái giá đó trước khi trả, thay vì biết sau. -->
            <label
              v-for="part in PARTS"
              :key="part"
              class="flex cursor-pointer items-center gap-2 text-foreground"
            >
              <input v-model="parts[part]" type="checkbox" />
              <span>{{ t(`sessions.workspace.browser.import.part.${part}`) }}</span>
              <span
                v-if="part !== 'cookies'"
                class="rounded-sm border border-border px-1.5 py-0.5 text-xs text-faint"
              >
                {{ t('sessions.workspace.browser.import.needsRestartTag') }}
              </span>
            </label>
          </div>

          <!-- Result. Every bucket is shown, including the ones that failed: a
               half-imported jar looks exactly like a working one until the agent
               hits a login wall. -->
          <div
            v-if="report"
            class="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-foreground"
          >
            <div class="text-foreground">
              {{ t('sessions.workspace.browser.import.done', { profile: report.profile }) }}
            </div>
            <ul class="m-0 flex flex-col gap-0.5 pl-4">
              <li v-if="report.cookies">
                {{
                  t('sessions.workspace.browser.import.cookieLine', {
                    imported: report.cookies.imported,
                    total: report.cookies.total,
                  })
                }}
              </li>
              <li v-if="report.cookies?.appBound" class="text-warning">
                {{
                  t('sessions.workspace.browser.import.appBound', {
                    count: report.cookies.appBound,
                  })
                }}
              </li>
              <li v-if="report.cookies?.keyUnavailable" class="text-warning">
                {{ t('sessions.workspace.browser.import.noKey') }}
              </li>
              <li v-if="skippedOther" class="text-muted-foreground">
                {{ t('sessions.workspace.browser.import.skipped', { count: skippedOther }) }}
              </li>
              <li v-if="report.localStorage?.staged">
                {{
                  t('sessions.workspace.browser.import.staged', {
                    what: 'Local Storage',
                    size: formatBytes(report.localStorage.bytes),
                  })
                }}
              </li>
              <li v-if="report.indexedDb?.staged">
                {{
                  t('sessions.workspace.browser.import.staged', {
                    what: 'IndexedDB',
                    size: formatBytes(report.indexedDb.bytes),
                  })
                }}
              </li>
            </ul>
            <Button
              v-if="report.needsRestart"
              variant="default"
              class="h-auto p-0 w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              @click="restart"
            >
              {{ t('sessions.workspace.browser.import.restart') }}
            </Button>
          </div>

          <div v-if="error" class="text-sm text-destructive">{{ error }}</div>
        </template>

        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            class="h-auto p-0 px-0 text-xs text-muted-foreground underline transition-colors hover:text-destructive"
            @click="clearAll"
          >
            {{ t('sessions.workspace.browser.import.clear') }}
          </Button>
          <span class="flex-1" />
          <Button
            variant="outline"
            class="h-auto p-0 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            @click="close"
          >
            {{ t('common.close') }}
          </Button>
          <Button
            variant="default"
            class="h-auto p-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            :disabled="!canImport"
            @click="runImport"
          >
            {{
              busy
                ? t('sessions.workspace.browser.import.running')
                : t('sessions.workspace.browser.import.run')
            }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Import a real browser profile into the agent's Chromium (ADR 0086 phần B).
//
// The pickers are deliberately dumb: main enumerates the installed browsers and
// their profiles, and only the ids travel back over IPC — the renderer never sees
// or sends a filesystem path.
//
// The report is the point of this dialog. Cookie import can fail for a reason
// nobody can fix here (Chrome 127+ app-bound encryption binds the key to the
// signed browser binary), and a jar that imported 0 of 4000 cookies behaves like a
// fresh profile. So every bucket is rendered — imported, app-bound, no-key,
// skipped — instead of a green checkmark.
import { Download, ShieldCheck, X } from 'lucide-vue-next'
import type { AwogBrowserImportReport, AwogBrowserImportSource } from '~/types/awog-bridge'
import { formatBytes } from '~/utils/format-bytes'
import { useConfirm } from '~/composables/useConfirm'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const { confirm } = useConfirm()

const PARTS = ['cookies', 'localStorage', 'indexedDb'] as const

const bridge = computed(() =>
  typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
)
const sources = ref<AwogBrowserImportSource[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const report = ref<AwogBrowserImportReport | null>(null)
const browserId = ref('')
const profileDir = ref('')
const parts = ref({ cookies: true, localStorage: true, indexedDb: true })

const browserOptions = computed(() => sources.value.map((s) => ({ label: s.label, value: s.id })))
const profileOptions = computed(() => {
  const source = sources.value.find((s) => s.id === browserId.value)
  return (source?.profiles ?? []).map((p) => ({
    label: p.email ? `${p.name} · ${p.email}` : p.name,
    value: p.dir,
  }))
})
const canImport = computed(
  () => !busy.value && !!profileDir.value && PARTS.some((part) => parts.value[part]),
)
// Cookies that decrypted or were read but did not make it in, for reasons that are
// not the app-bound wall (already expired, malformed, refused by Chromium).
const skippedOther = computed(() => {
  const c = report.value?.cookies
  return c ? c.expired + c.rejected + c.undecryptable : 0
})

watch(profileOptions, (options) => {
  if (!options.some((o) => o.value === profileDir.value)) {
    profileDir.value = options[0]?.value ?? ''
  }
})

const load = async (): Promise<void> => {
  const api = bridge.value
  if (!api) return
  loading.value = true
  try {
    sources.value = await api.listBrowsers()
    browserId.value = sources.value[0]?.id ?? ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    report.value = null
    error.value = ''
    void load()
  },
  { immediate: true },
)

const close = (): void => emit('close')

const runImport = async (): Promise<void> => {
  const api = bridge.value
  if (!api || !canImport.value) return
  busy.value = true
  error.value = ''
  report.value = null
  try {
    report.value = await api.importProfile(browserId.value, profileDir.value, { ...parts.value })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const restart = async (): Promise<void> => {
  const ok = await confirm({
    title: t('sessions.workspace.browser.import.restartTitle'),
    description: t('sessions.workspace.browser.import.restartDesc'),
    confirmLabel: t('sessions.workspace.browser.import.restart'),
    kind: 'danger',
  })
  if (ok) await bridge.value?.relaunch()
}

const clearAll = async (): Promise<void> => {
  const ok = await confirm({
    title: t('sessions.workspace.browser.import.clearTitle'),
    description: t('sessions.workspace.browser.import.clearDesc'),
    kind: 'danger',
  })
  if (!ok) return
  try {
    await bridge.value?.clearData()
    report.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>
