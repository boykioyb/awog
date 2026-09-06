<template>
  <Teleport to="body">
    <div v-if="open && prompt" class="ovl on skh-ovl" @click.self="reject">
      <div class="skh-card" role="dialog" aria-modal="true">
        <div class="skh-head">
          <Icon
            name="shield"
            class="skh-icn"
            :style="{ color: changed ? 'var(--danger)' : 'var(--accent)' }"
          />
          <span class="skh-title">
            {{ changed ? t('ssh.hostKey.titleChanged') : t('ssh.hostKey.title') }}
          </span>
        </div>

        <div class="skh-body" :class="{ warn: changed }">
          {{ changed ? t('ssh.hostKey.bodyChanged') : t('ssh.hostKey.body') }}
        </div>

        <div class="skh-kv">
          <div class="skh-row">
            <span class="skh-k">{{ t('ssh.hostKey.endpoint') }}</span>
            <span class="skh-v mono">{{ prompt.host }}:{{ prompt.port }}</span>
          </div>
          <div class="skh-row">
            <span class="skh-k">{{ t('ssh.hostKey.keyType') }}</span>
            <span class="skh-v mono">{{ prompt.keyType }}</span>
          </div>
          <div class="skh-row">
            <span class="skh-k">{{ t('ssh.hostKey.fingerprint') }}</span>
            <span class="skh-v mono skh-fp">{{ prompt.fingerprint }}</span>
          </div>
        </div>

        <label class="skh-remember">
          <input v-model="remember" type="checkbox" />
          <span>{{ t('ssh.hostKey.remember') }}</span>
        </label>

        <div class="skh-foot">
          <button class="btn" @click="reject">{{ t('ssh.hostKey.reject') }}</button>
          <button
            class="btn"
            :class="{ pri: !changed }"
            :style="
              changed
                ? { background: 'var(--danger)', color: 'var(--bg)', borderColor: 'transparent' }
                : undefined
            "
            @click="accept"
          >
            {{ t('ssh.hostKey.accept') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Host-key TOFU prompt (ADR 0063 P2). Shown when the sidecar parks a connect on
// an unknown / changed host key. Accept → verify(true) (+ optionally append to
// known_hosts); Reject → the pending connect fails closed. A `changed` key is
// treated as a red warning (possible MITM). Presentational — the page binds it to
// the ssh store's pendingHostKey + confirmHostKey.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SshHostKeyPrompt } from '~/stores/ssh'

const props = defineProps<{ open: boolean; prompt: SshHostKeyPrompt | null }>()
const emit = defineEmits<{ confirm: [accept: boolean, remember: boolean] }>()

const { t } = useI18n()

const remember = ref(true)
const changed = computed(() => props.prompt?.status === 'changed')

// Default to NOT remembering a changed key (safer — the user must opt in).
watch(
  () => props.prompt,
  (p) => {
    remember.value = p?.status !== 'changed'
  },
)

const accept = () => emit('confirm', true, remember.value)
const reject = () => emit('confirm', false, false)

const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') reject()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.skh-ovl {
  align-items: center;
  padding-top: 0;
  /* Topmost dialog band (matches LibraryConfirmDelete) — stacks above any modal. */
  z-index: 200;
}
.skh-card {
  width: 460px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.skh-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.skh-icn {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
}
.skh-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.skh-body {
  font-size: var(--fs-sm);
  color: var(--textMuted);
  line-height: 1.6;
}
.skh-body.warn {
  color: var(--danger);
}
.skh-kv {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgInput);
  overflow: hidden;
}
.skh-row {
  display: flex;
  gap: 12px;
  padding: 9px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.skh-row + .skh-row {
  border-top: 1px solid var(--border);
}
.skh-k {
  flex: 0 0 auto;
  min-width: 130px;
  color: var(--textDim);
}
.skh-v {
  flex: 1;
  min-width: 0;
  color: var(--text);
  word-break: break-all;
  user-select: text;
}
.skh-fp {
  color: var(--accent);
}
.skh-remember {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  cursor: pointer;
}
.skh-remember input {
  accent-color: var(--accent);
  cursor: pointer;
}
.skh-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
