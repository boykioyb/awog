<template>
  <Teleport to="body">
    <div v-if="error" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card gae" role="dialog" aria-modal="true">
        <div class="gae-head">
          <Icon name="shield" class="gae-headicn" />
          <div class="gae-headtext">
            <div class="gpm-title">{{ t('git.auth.title') }}</div>
            <div class="gae-lead">{{ t('git.auth.lead', { op: error.op }) }}</div>
          </div>
        </div>

        <p class="gae-hint">{{ hintCopy }}</p>

        <!-- Suggested fix command (copy → paste in a terminal) -->
        <div class="gae-cmd">
          <span class="gae-prompt">$</span>
          <code class="gae-cmdtext mono">{{ fixCommand }}</code>
          <button class="gae-copy" :title="t('git.auth.copyCommand')" @click="copyCommand">
            <Icon :name="copied ? 'check' : 'copy'" style="width: 13px; height: 13px" />
          </button>
        </div>

        <!-- Raw (sanitized) git stderr, for the curious / for filing bugs -->
        <pre v-if="error.message" class="gae-err mono">{{ error.message }}</pre>

        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.close') }}</button>
          <button class="btn pri" @click="openGithub">
            <Icon name="globe" style="width: 13px; height: 13px" />
            {{ error.hint === 'ssh-key' ? t('git.auth.openSshKeys') : t('git.auth.openTokens') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Rich auth-failure modal — shown when fetch/pull/push fails to authenticate
// (gitCode AUTH_FAILED). The sidecar tags the error with an `authHint` (SSH key
// vs HTTPS token) which drives actionable copy + a one-click fix command + a
// link to the right GitHub settings page. Mirrors production
// apps/desktop/ui/components/git/GitAuthErrorModal.vue (ported to prototype styling).
type GitAuthHint = 'ssh-key' | 'https-token' | 'unknown'

const props = defineProps<{
  error: { op: string; hint: GitAuthHint; message: string } | null
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { openExternal } = useSidecar()

const hintCopy = computed(() => {
  switch (props.error?.hint) {
    case 'ssh-key':
      return t('git.auth.hint.sshKey')
    case 'https-token':
      return t('git.auth.hint.httpsToken')
    default:
      return t('git.auth.hint.unknown')
  }
})

// SSH → reload the agent; HTTPS/unknown → re-auth gh (covers the keychain token).
const fixCommand = computed(() => (props.error?.hint === 'ssh-key' ? 'ssh-add' : 'gh auth login'))

const githubUrl = computed(() =>
  props.error?.hint === 'ssh-key'
    ? 'https://github.com/settings/keys'
    : 'https://github.com/settings/tokens',
)

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyCommand() {
  try {
    await navigator.clipboard?.writeText(fixCommand.value)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard unavailable — the command is visible to copy by hand.
  }
}

function openGithub() {
  void openExternal(githubUrl.value)
}

// Reset the transient "copied" tick whenever a fresh error opens the modal.
watch(
  () => props.error,
  () => {
    copied.value = false
  },
)

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<style scoped>
/* Overlay + card mirror the other git modals (.gpm-*). Auth-specific rows below. */
.gpm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.gpm-card {
  width: 460px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gpm-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gae-head {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.gae-headicn {
  width: 20px;
  height: 20px;
  flex: none;
  margin-top: 1px;
  color: var(--danger);
}
.gae-headtext {
  min-width: 0;
}
.gae-lead {
  margin-top: 3px;
  font-size: 1em;
  color: var(--textMuted);
}
.gae-hint {
  font-size: 1em;
  line-height: 1.5;
  color: var(--textDim);
}
.gae-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.gae-prompt {
  flex: none;
  color: var(--textFaint);
  font-family: var(--mono);
  user-select: none;
}
.gae-cmdtext {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  color: var(--text);
  font-size: 0.9231rem;
}
.gae-copy {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border-radius: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.gae-copy:hover {
  color: var(--text);
  background: var(--bgHover);
}
.gae-err {
  max-height: 128px;
  overflow: auto;
  margin: 0;
  padding: 9px 11px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--textDim);
  font-size: 0.8462rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.gpm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}
</style>
