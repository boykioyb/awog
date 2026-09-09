<template>
  <div>
    <SettingsPaneHeader :title="t('settings.workspace.heading')" />

    <SettingsField
      :name="t('settings.workspace.path.name')"
      :desc="t('settings.workspace.path.desc')"
    >
      <div class="keyrow">
        <input :value="workspaceRoot" class="keyinp mono" readonly />
        <button class="btn sm" :title="t('settings.workspace.path.copy')" @click="onCopy">
          <Icon :name="copied ? 'check' : 'copy'" />
        </button>
      </div>
    </SettingsField>

    <SettingsField
      :name="t('settings.workspace.git.name')"
      :desc="t('settings.workspace.git.desc')"
    >
      <span class="chip">
        <span
          style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--green);
            display: inline-block;
          "
        />
        {{ t('settings.workspace.git.enabled') }}
      </span>
    </SettingsField>

    <!-- Config import from .claude / .agents lives on each library page's toolbar
         (Agents / Skills / Commands / Rules) — one picker per kind, sweeping the
         global tier and every project at once (ADR 0035). -->

    <!-- Where a clicked web link goes. Lives here (not only in the popover's
         "always do this") so a remembered choice has a visible way back. -->
    <SettingsField
      :name="t('settings.workspace.linkOpen.name')"
      :desc="t('settings.workspace.linkOpen.desc')"
    >
      <AppSelect v-model="linkMode" :options="linkModeOptions" width="220px" />
    </SettingsField>

    <SettingsField
      v-if="sidecar.available"
      :name="t('settings.workspace.diagnostics.name')"
      :desc="t('settings.workspace.diagnostics.desc')"
    >
      <button class="btn sm" @click="showLogs = !showLogs">
        <Icon name="clip" />
        {{
          showLogs
            ? t('settings.workspace.diagnostics.hideLogs')
            : t('settings.workspace.diagnostics.viewLogs')
        }}
      </button>
    </SettingsField>

    <SettingsLogTail v-if="sidecar.available && showLogs" @close="showLogs = false" />
  </div>
</template>

<script setup lang="ts">
import type { LinkOpenMode } from '~/composables/useLinkOpen'

// Workspace panel — wires setSecHtml('workspace') to real state + IPC.
//   - Workspace path: READ-ONLY. The sidecar always uses os.homedir()/.awog as
//     its home root (see sidecar util/path.ts `awogHome()`); there is no safe
//     runtime remap, so an editable field would only mislead. We surface the
//     actual root and offer copy instead — resolved from the shell via
//     `app:info` (settings.hydrateAppPaths), so it is right on every machine
//     rather than a baked-in default.
//   - Git versioning: informational read-only status (auto-commit is always on).
//   - Diagnostics: toggles an inline log tail (SettingsLogTail) that streams the
//     app log file into a terminal-style view (Electron only).
// Telemetry/templates rows from the prototype are omitted — no backing store field.
const { t } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()

// The workspace root the sidecar actually uses. Read-only display; the store value
// is filled from the shell's app:info (= the sidecar's awogHome) on mount.
const workspaceRoot = computed(() => settings.workspacePath)
onMounted(() => void settings.hydrateAppPaths())

// Link routing (ADR 0086 phần C). Renderer-side only — it decides which SURFACE a
// link opens in, nothing the engine can see — so it lives in localStorage via
// useLinkOpen, same as the keymap.
// Through setMode, not the raw ref: persistence lives in the setter, so writing
// `mode.value` straight would change the session and forget it on reload.
const { mode, setMode } = useLinkOpen()
const linkMode = computed<string>({
  get: () => mode.value,
  set: (value) => setMode(value as LinkOpenMode),
})
const linkModeOptions = computed(() => [
  { label: t('settings.workspace.linkOpen.ask'), value: 'ask' },
  { label: t('settings.workspace.linkOpen.app'), value: 'app' },
  { label: t('settings.workspace.linkOpen.external'), value: 'external' },
])

const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | null = null
const onCopy = () => {
  void navigator.clipboard?.writeText(workspaceRoot.value).catch(() => {})
  copied.value = true
  if (copyResetTimer) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copied.value = false
  }, 1200)
}

const showLogs = ref(false)
</script>
