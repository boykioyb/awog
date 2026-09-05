<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('ssh.editor.editTitle') : t('ssh.editor.newTitle')"
    :width="600"
    @close="emit('cancel')"
  >
    <div class="sse">
      <div class="sse-grid">
        <div class="sse-field">
          <label class="sse-label">
            {{ t('ssh.editor.name') }}
            <span class="sse-req" aria-hidden="true">*</span>
          </label>
          <input
            v-model="name"
            class="sse-input"
            :class="{ 'has-err': touched.name && nameError }"
            :placeholder="t('ssh.editor.namePh')"
            :aria-invalid="touched.name && !!nameError"
            @blur="touched.name = true"
          />
          <div v-if="touched.name && nameError" class="sse-err">{{ nameError }}</div>
        </div>
        <div class="sse-field">
          <label class="sse-label">{{ t('ssh.editor.folder') }}</label>
          <AppSelect v-model="folderSelect" :options="folderOptions" width="100%" />
          <input
            v-if="folderMode === 'new'"
            v-model="folder"
            class="sse-input mono"
            :placeholder="t('ssh.editor.folderPh')"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="sse-grid sse-grid-host">
        <div class="sse-field">
          <label class="sse-label">
            {{ t('ssh.editor.host') }}
            <span class="sse-req" aria-hidden="true">*</span>
          </label>
          <input
            v-model="hostName"
            class="sse-input mono"
            :class="{ 'has-err': touched.host && hostError }"
            :placeholder="t('ssh.editor.hostPh')"
            spellcheck="false"
            :aria-invalid="touched.host && !!hostError"
            @blur="touched.host = true"
          />
          <div v-if="touched.host && hostError" class="sse-err">{{ hostError }}</div>
        </div>
        <div class="sse-field">
          <label class="sse-label">
            {{ t('ssh.editor.port') }}
            <span class="sse-req" aria-hidden="true">*</span>
          </label>
          <input
            v-model.number="port"
            type="number"
            min="1"
            max="65535"
            class="sse-input mono"
            :class="{ 'has-err': touched.port && portError }"
            :aria-invalid="touched.port && !!portError"
            @blur="touched.port = true"
          />
          <div v-if="touched.port && portError" class="sse-err">{{ portError }}</div>
        </div>
      </div>

      <div class="sse-field">
        <label class="sse-label">
          {{ t('ssh.editor.user') }}
          <span class="sse-req" aria-hidden="true">*</span>
        </label>
        <input
          v-model="user"
          class="sse-input mono"
          :class="{ 'has-err': touched.user && userError }"
          :placeholder="t('ssh.editor.userPh')"
          spellcheck="false"
          :aria-invalid="touched.user && !!userError"
          @blur="touched.user = true"
        />
        <div v-if="touched.user && userError" class="sse-err">{{ userError }}</div>
      </div>

      <div class="sse-field">
        <label class="sse-label">{{ t('ssh.editor.authMethod') }}</label>
        <AppSelect v-model="authMethodSelect" :options="authMethodOptions" width="100%" />
        <div class="sse-hint">{{ t('ssh.editor.authHint') }}</div>
      </div>

      <!-- Identity picker (key auth) — links a saved identity to this host. -->
      <div v-if="authMethod === 'key'" class="sse-field">
        <label class="sse-label">{{ t('ssh.editor.identity') }}</label>
        <AppSelect v-model="identitySelect" :options="identityOptions" width="100%" />
        <div class="sse-hint">{{ t('ssh.editor.identityHint') }}</div>
      </div>

      <!-- Host password (password auth). Prefilled from the keychain when editing and
           revealable behind the eye toggle — the user's own login, shown like a password
           manager. Omitted on save when left blank so it never clobbers a stored value. -->
      <div v-if="authMethod === 'password'" class="sse-secret">
        <div class="sse-secret-head">
          <Icon name="shield" style="width: 13px; height: 13px; color: var(--accent)" />
          <span class="sse-secret-title">{{ t('ssh.editor.password') }}</span>
        </div>
        <div class="sse-pw">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="sse-input mono has-eye"
            :placeholder="t('ssh.editor.passwordPh')"
            spellcheck="false"
            autocomplete="off"
          />
          <button
            type="button"
            class="sse-eye"
            :class="{ on: showPassword }"
            :title="showPassword ? t('ssh.editor.hidePassword') : t('ssh.editor.showPassword')"
            :aria-label="showPassword ? t('ssh.editor.hidePassword') : t('ssh.editor.showPassword')"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <Icon :name="showPassword ? 'eye-off' : 'eye'" style="width: 15px; height: 15px" />
          </button>
        </div>
        <div class="sse-hint">
          {{ isExisting ? t('ssh.editor.secretHintKeep') : t('ssh.editor.secretHint') }}
        </div>
      </div>

      <!-- Jump host (bastion) — optional; excludes this host from the list. -->
      <div class="sse-field">
        <label class="sse-label">{{ t('ssh.editor.jumpHost') }}</label>
        <AppSelect v-model="jumpHostSelect" :options="jumpHostOptions" width="100%" />
      </div>

      <!-- VPN (ADR 0065 P3) — a VpnProfile brought up (shared, ref-counted) before
           ssh2 dials this host, so the host is reachable via OS routing. -->
      <div class="sse-field">
        <label class="sse-label">{{ t('ssh.editor.vpn') }}</label>
        <AppSelect v-model="vpnSelect" :options="vpnOptions" width="100%" />
        <div class="sse-hint">{{ t('ssh.editor.vpnHint') }}</div>
      </div>

      <div class="sse-field">
        <label class="sse-label">{{ t('ssh.editor.tags') }}</label>
        <input
          v-model="tagsText"
          class="sse-input"
          :placeholder="t('ssh.editor.tagsPh')"
          spellcheck="false"
        />
        <div class="sse-hint">{{ t('ssh.editor.tagsHint') }}</div>
      </div>

      <!-- Expose to session agents as an SSH tool (ADR 0064 unified model). -->
      <div class="sse-field">
        <button
          type="button"
          class="sse-toggle"
          :aria-pressed="agentEnabled"
          @click="agentEnabled = !agentEnabled"
        >
          <span class="tog2" :class="{ off: !agentEnabled }" />
          <span>{{ t('ssh.editor.agentEnabled') }}</span>
        </button>
        <div class="sse-hint">{{ t('ssh.editor.agentEnabledHint') }}</div>
      </div>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('ssh.editor.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// SSH host form editor (ADR 0063 P1) — builds a SshHost. authMethod switches the
// auth-dependent controls: 'key' reveals the identity picker; 'password' reveals a
// WRITE-ONLY password field (never read back — emitted separately from the config
// and OMITTED when blank so an empty submit keeps any stored credential). The id is
// auto-generated by the store on create (never shown/edited here).
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSshStore, type SshAuthMethod, type SshHost, type SshIdentity } from '~/stores/ssh'
import { useVpnStore } from '~/stores/vpn'
import type { SshHostSecret } from '~/composables/useSshPage'

const props = defineProps<{
  open: boolean
  host: SshHost | null
  identities: SshIdentity[]
  hosts: SshHost[]
  // Folder pre-seeded when adding within a group header (new host only).
  seedFolder?: string
}>()

const emit = defineEmits<{
  save: [host: SshHost, secret?: SshHostSecret]
  cancel: []
}>()

const { t } = useI18n()
const vpnStore = useVpnStore()
const sshStore = useSshStore()

const isExisting = computed(() => !!props.host)

// --- form state ------------------------------------------------------------
const name = ref('')
const hostName = ref('')
const port = ref(22)
const user = ref('')
const authMethod = ref<SshAuthMethod>('agent')
const identityId = ref('')
const jumpHostId = ref('')
const vpnId = ref('')
const folder = ref('')
const tagsText = ref('')
// Whether session agents can use this host as an SSH tool (default on for new hosts).
const agentEnabled = ref(true)
const password = ref('')
// Reveal toggle for the host password (shown like a password manager, prefilled below).
const showPassword = ref(false)
// Which required fields have been blurred — gates when their inline error appears.
const touched = reactive({ name: false, host: false, user: false, port: false })

const authMethodOptions = computed<AppSelectOption[]>(() => [
  { value: 'agent', label: t('ssh.auth.agent') },
  { value: 'key', label: t('ssh.auth.key') },
  { value: 'password', label: t('ssh.auth.password') },
])
const identityOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('ssh.editor.identityNone') },
  ...props.identities.map((i) => ({ value: i.id, label: i.name })),
])
const jumpHostOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('ssh.editor.jumpHostNone') },
  ...props.hosts
    .filter((h) => h.id !== props.host?.id)
    .map((h) => ({ value: h.id, label: h.name })),
])
const vpnOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('ssh.editor.vpnNone') },
  ...vpnStore.profiles.map((p) => ({ value: p.id, label: p.name })),
])

// Folder = pick an existing one (reused across hosts) OR add a new one. Existing
// folders are derived from the inventory; a `__new__` sentinel reveals a text
// input so you don't retype a known folder every time.
const FOLDER_NEW = '__new__'
const folderMode = ref<'select' | 'new'>('select')
const existingFolders = computed<string[]>(() => {
  const set = new Set<string>()
  for (const h of props.hosts) {
    const f = h.folder?.trim()
    if (f) set.add(f)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})
const folderOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('ssh.editor.folderNone') },
  ...existingFolders.value.map((f) => ({ value: f, label: f })),
  { value: FOLDER_NEW, label: t('ssh.editor.folderNew') },
])
const folderSelect = computed<string>({
  get: () => (folderMode.value === 'new' ? FOLDER_NEW : folder.value),
  set: (v) => {
    if (v === FOLDER_NEW) {
      folderMode.value = 'new'
      folder.value = ''
    } else {
      folderMode.value = 'select'
      folder.value = v
    }
  },
})

// Bridge the union-typed authMethod to AppSelect's string model.
const authMethodSelect = computed<string>({
  get: () => authMethod.value,
  set: (v) => {
    authMethod.value = v as SshAuthMethod
  },
})
const identitySelect = computed<string>({
  get: () => identityId.value,
  set: (v) => {
    identityId.value = v
  },
})
const jumpHostSelect = computed<string>({
  get: () => jumpHostId.value,
  set: (v) => {
    jumpHostId.value = v
  },
})
const vpnSelect = computed<string>({
  get: () => vpnId.value,
  set: (v) => {
    vpnId.value = v
  },
})

// Re-seed every time the modal opens or the edit target / seed folder changes.
watch(
  () => [props.open, props.host, props.seedFolder] as const,
  ([isOpen]) => {
    if (!isOpen) return
    // Populate the VPN picker on demand — the store is only loaded when the VPN tab
    // is opened, so an edit that never visited it would otherwise show an empty list.
    if (!vpnStore.loaded) void vpnStore.loadAll()
    const h = props.host
    name.value = h?.name ?? ''
    hostName.value = h?.host ?? ''
    port.value = h?.port ?? 22
    user.value = h?.user ?? ''
    authMethod.value = h?.authMethod ?? 'agent'
    identityId.value = h?.identityId ?? ''
    jumpHostId.value = h?.jumpHostId ?? ''
    vpnId.value = h?.vpnId ?? ''
    folder.value = h?.folder ?? props.seedFolder ?? ''
    // Existing folder (incl. a seeded group) → pick mode; the AppSelect shows it.
    folderMode.value = 'select'
    tagsText.value = (h?.tags ?? []).join(', ')
    // undefined (legacy host) → enabled; explicit false → off.
    agentEnabled.value = h?.agentEnabled !== false
    password.value = ''
    // Re-mask on every open so a previously revealed secret doesn't linger visible.
    showPassword.value = false
    // Fresh form → clear validation touch state so no error shows before interaction.
    touched.name = false
    touched.host = false
    touched.user = false
    touched.port = false
    // Editing an existing password-auth host → prefill its stored password (the user's
    // own login, like a password manager). Guarded so a fast open→switch can't apply a
    // stale credential to the wrong host.
    if (h && h.authMethod === 'password') {
      const forId = h.id
      void sshStore.getCredential('host', forId).then((cred) => {
        if (!props.open || props.host?.id !== forId) return
        password.value = cred.password ?? ''
      })
    }
  },
  { immediate: true },
)

// Per-field validation. Errors only surface once a field is touched (blurred) so a
// fresh form isn't shouting — the red `*` already flags that it's required.
const nameError = computed(() => (name.value.trim() ? '' : t('ssh.editor.nameRequired')))
const hostError = computed(() => (hostName.value.trim() ? '' : t('ssh.editor.hostRequired')))
const userError = computed(() => (user.value.trim() ? '' : t('ssh.editor.userRequired')))
const portError = computed(() => {
  const p = port.value
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? '' : t('ssh.editor.portInvalid')
})

const canSave = computed(
  () => !nameError.value && !hostError.value && !userError.value && !portError.value,
)

const buildHost = (): SshHost => {
  const now = new Date().toISOString()
  const base: SshHost = {
    id: props.host?.id ?? '',
    name: name.value.trim(),
    host: hostName.value.trim(),
    port: port.value,
    user: user.value.trim(),
    authMethod: authMethod.value,
    createdAt: props.host?.createdAt ?? now,
    updatedAt: now,
  }
  if (authMethod.value === 'key' && identityId.value) base.identityId = identityId.value
  if (jumpHostId.value) base.jumpHostId = jumpHostId.value
  if (vpnId.value) base.vpnId = vpnId.value
  if (folder.value.trim()) base.folder = folder.value.trim()
  const tags = parseTags(tagsText.value)
  if (tags.length) base.tags = tags
  // Persist only the opt-OUT (false); undefined stays = enabled (keeps files clean).
  if (!agentEnabled.value) base.agentEnabled = false
  // Carry over fields the P1 form doesn't edit so an edit never drops them.
  if (props.host) {
    if (props.host.portForwards) base.portForwards = props.host.portForwards
    if (props.host.options) base.options = props.host.options
    if (props.host.connectionStatus) base.connectionStatus = props.host.connectionStatus
    if (props.host.connectionError) base.connectionError = props.host.connectionError
    if (props.host.lastConnectedAt) base.lastConnectedAt = props.host.lastConnectedAt
  }
  return base
}

const onSave = () => {
  if (!canSave.value) return
  const secret =
    authMethod.value === 'password' && password.value.trim()
      ? { password: password.value }
      : undefined
  emit('save', buildHost(), secret)
}

// Split a comma-separated tag string into a trimmed, de-duplicated array.
function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(',')) {
    const tag = raw.trim()
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      out.push(tag)
    }
  }
  return out
}
</script>

<style scoped>
.sse {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sse-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.sse-grid-host {
  grid-template-columns: 1fr minmax(90px, 0.4fr);
}
.sse-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sse-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text);
}
.sse-input {
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
.sse-input.mono {
  font-family: var(--code);
}
.sse-input:focus {
  border-color: var(--accent);
}
.sse-input.has-err,
.sse-input.has-err:focus {
  border-color: var(--danger);
}
/* Required-field marker + inline validation error. */
.sse-req {
  color: var(--danger);
  font-weight: 700;
}
.sse-err {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.3;
  color: var(--danger);
}
/* Masked password field + its reveal toggle (mirrors VpnEditor's .vpe-eye). */
.sse-pw {
  position: relative;
}
.sse-input.has-eye {
  padding-right: 38px;
}
.sse-eye {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  opacity: 0.7;
  transition:
    opacity 0.12s ease,
    color 0.12s ease;
}
.sse-eye:hover,
.sse-eye.on {
  opacity: 1;
  color: var(--text);
}
.sse-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
}
/* Toggle row (reuses the global .tog2 switch) — a clickable label + switch. */
.sse-toggle {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
/* Secret callout — a subtle accent-tinted card (mirrors SshDetail's .ssh-err dim
   bg + matching border idiom), signalling "write-only, goes to the keychain". */
.sse-secret {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
}
.sse-secret-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.sse-secret-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}
</style>
