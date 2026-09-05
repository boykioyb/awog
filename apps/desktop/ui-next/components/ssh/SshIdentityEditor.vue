<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('ssh.identity.editTitle') : t('ssh.identity.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="ssi">
      <div class="ssi-field">
        <label class="ssi-label">{{ t('ssh.identity.name') }}</label>
        <input v-model="name" class="ssi-input" :placeholder="t('ssh.identity.namePh')" />
      </div>

      <div class="ssi-field">
        <label class="ssi-label">{{ t('ssh.identity.keyType') }}</label>
        <AppSelect v-model="keyTypeSelect" :options="keyTypeOptions" width="100%" />
      </div>

      <!-- Key source: a path to a file on disk, OR pasted inline material (stored
           in the keychain). -->
      <div class="ssi-field">
        <label class="ssi-label">{{ t('ssh.identity.keySource') }}</label>
        <div class="seg ssi-seg">
          <span :class="{ on: keySource === 'file' }" @click="keySource = 'file'">
            {{ t('ssh.identity.sourceFile') }}
          </span>
          <span :class="{ on: keySource === 'inline' }" @click="keySource = 'inline'">
            {{ t('ssh.identity.sourceInline') }}
          </span>
        </div>
      </div>

      <div v-if="keySource === 'file'" class="ssi-field">
        <label class="ssi-label">{{ t('ssh.identity.keyPath') }}</label>
        <div class="ssi-path-row">
          <input
            v-model="keyPath"
            class="ssi-input mono"
            :placeholder="t('ssh.identity.keyPathPh')"
            spellcheck="false"
            @blur="autodetectPath"
          />
          <button v-if="canBrowse" type="button" class="btn sm ssi-browse" @click="browseKey">
            <Icon name="folder" style="width: 12px; height: 12px" />
            {{ t('ssh.identity.browse') }}
          </button>
        </div>
        <div class="ssi-hint">{{ t('ssh.identity.keyPathHint') }}</div>
      </div>

      <div v-else class="ssi-field">
        <label class="ssi-label">{{ t('ssh.identity.privateKey') }}</label>
        <textarea
          v-model="privateKey"
          class="ssi-input ssi-ta mono"
          rows="5"
          :placeholder="t('ssh.identity.privateKeyPh')"
          spellcheck="false"
          autocomplete="off"
          @blur="autodetectInline"
        />
        <div class="ssi-hint">
          {{ isExisting ? t('ssh.identity.privateKeyHintKeep') : t('ssh.identity.privateKeyHint') }}
        </div>
      </div>

      <!-- Write-only passphrase — blank on open, omitted when blank. -->
      <div class="ssi-secret">
        <div class="ssi-secret-head">
          <Icon name="shield" style="width: 13px; height: 13px; color: var(--accent)" />
          <span class="ssi-secret-title">{{ t('ssh.identity.passphrase') }}</span>
        </div>
        <input
          v-model="passphrase"
          type="password"
          class="ssi-input mono"
          :placeholder="t('ssh.identity.passphrasePh')"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="ssi-hint">
          {{ isExisting ? t('ssh.identity.secretHintKeep') : t('ssh.identity.secretHint') }}
        </div>
      </div>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('ssh.identity.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// SSH identity editor (ADR 0063 P1) — builds a SshIdentity. The key can be a path
// on disk (plaintext keyPath, not a secret) OR pasted inline material (stored in
// the keychain → inlineStored). The passphrase is WRITE-ONLY: blank on open,
// omitted when blank. Both secret parts are emitted separately from the config;
// the page maps them to the keychain mode.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { pickFile } from '~/composables/useFolderPicker'
import { useSshApi } from '~/composables/useSshApi'
import type { SshIdentity, SshKeyType } from '~/stores/ssh'
import type { SshIdentitySecret } from '~/composables/useSshPage'

const props = defineProps<{
  open: boolean
  identity: SshIdentity | null
}>()

const emit = defineEmits<{
  save: [identity: SshIdentity, secret?: SshIdentitySecret]
  cancel: []
}>()

const { t } = useI18n()

const isExisting = computed(() => !!props.identity)

const name = ref('')
const keyType = ref<SshKeyType | ''>('')
const keySource = ref<'file' | 'inline'>('file')
const keyPath = ref('')
const privateKey = ref('')
const passphrase = ref('')

const keyTypeOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('ssh.identity.keyTypeNone') },
  { value: 'ed25519', label: 'ed25519' },
  { value: 'rsa', label: 'rsa' },
  { value: 'ecdsa', label: 'ecdsa' },
  { value: 'other', label: t('ssh.identity.keyTypeOther') },
])
const keyTypeSelect = computed<string>({
  get: () => keyType.value,
  set: (v) => {
    keyType.value = v as SshKeyType | ''
  },
})

watch(
  () => [props.open, props.identity] as const,
  ([isOpen]) => {
    if (!isOpen) return
    const i = props.identity
    name.value = i?.name ?? ''
    keyType.value = i?.keyType ?? ''
    keySource.value = i?.inlineStored ? 'inline' : 'file'
    keyPath.value = i?.keyPath ?? ''
    privateKey.value = ''
    passphrase.value = ''
  },
  { immediate: true },
)

// Native file picker is only present inside the Electron shell; in browser-dev
// the field falls back to manual text entry (button hidden).
const api = useSshApi()
const canBrowse = ref(typeof window !== 'undefined' && !!window.awog)

// Auto-detect the key type on import (browse / manual path / pasted key) so the
// user doesn't have to pick it. Best-effort: sidecar inspects the key (prefers
// the sibling .pub) and returns only the type; leaves the field untouched when
// undetectable or offline. The key content never round-trips to the UI.
const autodetect = async (opts: { keyPath?: string; privateKey?: string }): Promise<void> => {
  if (!canBrowse.value) return
  const r = await api.detectKeyType(opts).catch(() => null)
  if (r?.keyType) keyType.value = r.keyType
}
const browseKey = async (): Promise<void> => {
  const p = await pickFile({ title: t('ssh.identity.browseTitle'), defaultPath: '~/.ssh' })
  if (!p) return
  keyPath.value = p
  await autodetect({ keyPath: p })
}
const autodetectPath = (): void => {
  const p = keyPath.value.trim()
  if (p) void autodetect({ keyPath: p })
}
const autodetectInline = (): void => {
  const pk = privateKey.value.trim()
  if (pk) void autodetect({ privateKey: pk })
}

const canSave = computed(() => name.value.trim().length > 0)

const buildIdentity = (): SshIdentity => {
  const now = new Date().toISOString()
  const inline = keySource.value === 'inline'
  // inlineStored reflects whether key material lives in the keychain: keep the
  // prior flag on edit unless the user pasted a new key here.
  const inlineStored = inline
    ? privateKey.value.trim().length > 0 || (props.identity?.inlineStored ?? false)
    : false
  const hasPassphrase =
    passphrase.value.trim().length > 0 || (props.identity?.hasPassphrase ?? false)
  const base: SshIdentity = {
    id: props.identity?.id ?? '',
    name: name.value.trim(),
    inlineStored,
    hasPassphrase,
    createdAt: props.identity?.createdAt ?? now,
    updatedAt: now,
  }
  if (keyType.value) base.keyType = keyType.value
  if (!inline && keyPath.value.trim()) base.keyPath = keyPath.value.trim()
  return base
}

const onSave = () => {
  if (!canSave.value) return
  const pk = keySource.value === 'inline' ? privateKey.value.trim() : ''
  const pp = passphrase.value.trim()
  const secret: SshIdentitySecret | undefined =
    pk || pp ? { ...(pk ? { privateKey: pk } : {}), ...(pp ? { passphrase: pp } : {}) } : undefined
  emit('save', buildIdentity(), secret)
}
</script>

<style scoped>
.ssi {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ssi-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ssi-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text);
}
.ssi-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  outline: none;
}
.ssi-input.mono {
  font-family: var(--code);
}
.ssi-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ssi-path-row .ssi-input {
  flex: 1;
  min-width: 0;
}
.ssi-browse {
  flex: 0 0 auto;
}
.ssi-input:focus {
  border-color: var(--accent);
}
.ssi-ta {
  resize: vertical;
  min-height: 6rem;
  line-height: 1.5;
}
.ssi-seg {
  align-self: flex-start;
}
.ssi-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
}
/* Secret callout — subtle accent-tinted card (mirrors SshDetail's .ssh-err idiom):
   the passphrase is write-only + goes straight to the keychain. */
.ssi-secret {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
}
.ssi-secret-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ssi-secret-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}
</style>
