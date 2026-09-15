<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="close">
      <div class="wbi-card" role="dialog" aria-modal="true">
        <div class="wbi-head">
          <Icon name="download" class="icn" />
          <span class="wbi-title">{{ t('sessions.workspace.browser.import.title') }}</span>
          <button class="wbi-x" :title="t('common.close')" @click="close">
            <Icon name="x" class="icn" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <!-- What this hands over. Stated before the pickers, not after: importing a
             whole profile gives the agent every session in it. -->
        <div class="wbi-warn">
          <Icon name="shield" class="icn" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <div>
            <p>{{ t('sessions.workspace.browser.import.warn') }}</p>
            <p class="wbi-warn-dim">{{ t('sessions.workspace.browser.import.excluded') }}</p>
            <!-- Not politeness: Local Storage / IndexedDB are LevelDB stores, and
                 copying one mid-write yields a torn store that loads empty. -->
            <p class="wbi-warn-dim">{{ t('sessions.workspace.browser.import.quitHint') }}</p>
          </div>
        </div>

        <div v-if="loading" class="wbi-row">{{ t('common.loading') }}</div>
        <div v-else-if="!sources.length" class="wbi-row">
          {{ t('sessions.workspace.browser.import.noBrowsers') }}
        </div>

        <template v-else>
          <label class="wbi-row">
            <span class="wbi-label">{{ t('sessions.workspace.browser.import.browser') }}</span>
            <AppSelect v-model="browserId" :options="browserOptions" width="100%" />
          </label>

          <label class="wbi-row">
            <span class="wbi-label">{{ t('sessions.workspace.browser.import.profile') }}</span>
            <AppSelect
              v-model="profileDir"
              :options="profileOptions"
              width="100%"
              :disabled="!profileOptions.length"
            />
          </label>

          <div class="wbi-row wbi-parts">
            <span class="wbi-label">{{ t('sessions.workspace.browser.import.parts') }}</span>
            <!-- Nhãn "cần khởi động lại" đứng NGAY cạnh hai phần gây ra nó, chứ
                 không chỉ hiện trong báo cáo sau khi nhập: cookie vào ngay, còn
                 Local Storage/IndexedDB là store LevelDB nên phải chờ boot. Người
                 dùng chọn được cái giá đó trước khi trả, thay vì biết sau. -->
            <label v-for="part in PARTS" :key="part" class="wbi-check">
              <input v-model="parts[part]" type="checkbox" />
              <span>{{ t(`sessions.workspace.browser.import.part.${part}`) }}</span>
              <span v-if="part !== 'cookies'" class="wbi-tag">
                {{ t('sessions.workspace.browser.import.needsRestartTag') }}
              </span>
            </label>
          </div>

          <!-- Result. Every bucket is shown, including the ones that failed: a
               half-imported jar looks exactly like a working one until the agent
               hits a login wall. -->
          <div v-if="report" class="wbi-report">
            <div class="wbi-report-head">
              {{ t('sessions.workspace.browser.import.done', { profile: report.profile }) }}
            </div>
            <ul>
              <li v-if="report.cookies">
                {{
                  t('sessions.workspace.browser.import.cookieLine', {
                    imported: report.cookies.imported,
                    total: report.cookies.total,
                  })
                }}
              </li>
              <li v-if="report.cookies?.appBound" class="wbi-bad">
                {{
                  t('sessions.workspace.browser.import.appBound', {
                    count: report.cookies.appBound,
                  })
                }}
              </li>
              <li v-if="report.cookies?.keyUnavailable" class="wbi-bad">
                {{ t('sessions.workspace.browser.import.noKey') }}
              </li>
              <li v-if="skippedOther" class="wbi-dim">
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
            <button v-if="report.needsRestart" class="btn pri" @click="restart">
              {{ t('sessions.workspace.browser.import.restart') }}
            </button>
          </div>

          <div v-if="error" class="wbi-error">{{ error }}</div>
        </template>

        <div class="wbi-foot">
          <button class="wbi-clear" @click="clearAll">
            {{ t('sessions.workspace.browser.import.clear') }}
          </button>
          <span style="flex: 1" />
          <button class="btn" @click="close">{{ t('common.close') }}</button>
          <button class="btn pri" :disabled="!canImport" @click="runImport">
            {{
              busy
                ? t('sessions.workspace.browser.import.running')
                : t('sessions.workspace.browser.import.run')
            }}
          </button>
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
import type { AwogBrowserImportReport, AwogBrowserImportSource } from '~/types/awog-bridge'
import { formatBytes } from '~/utils/format-bytes'
import { useConfirm } from '~/composables/useConfirm'

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

<style scoped>
.wbi-card {
  width: min(560px, 92vw);
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
.wbi-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wbi-title {
  flex: 1;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}
.wbi-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-sm);
}
.wbi-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wbi-warn {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--dangerBg);
  border: 1px solid var(--danger);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.wbi-warn-dim {
  margin-top: 6px;
  color: var(--textDim);
}
.wbi-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.wbi-label {
  color: var(--textDim);
}
.wbi-parts {
  gap: 8px;
}
.wbi-check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  cursor: pointer;
}
.wbi-tag {
  padding: 1px 7px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.wbi-report {
  padding: 10px 12px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wbi-report ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wbi-report-head {
  color: var(--text);
}
.wbi-bad {
  color: var(--amber);
}
.wbi-dim {
  color: var(--textDim);
}
.wbi-error {
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.wbi-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wbi-clear {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-decoration: underline;
  padding: 0;
}
.wbi-clear:hover {
  color: var(--danger);
}
</style>
