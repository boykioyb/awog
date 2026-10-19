<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('vpn.editor.editTitle') : t('vpn.editor.newTitle')"
    :width="600"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="gap-1 text-xs font-semibold text-foreground">
            {{ t('vpn.editor.name') }}
            <span class="font-semibold text-destructive" aria-hidden="true">*</span>
          </Label>
          <Input
            v-model="name"
            :class="{ 'border-destructive': touched.name && nameError }"
            :placeholder="t('vpn.editor.namePh')"
            :aria-invalid="touched.name && !!nameError"
            @blur="touched.name = true"
          />
          <div v-if="touched.name && nameError" class="mt-1 text-sm text-destructive">
            {{ nameError }}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="gap-1 text-xs font-semibold text-foreground">
            {{ t('vpn.editor.folder') }}
          </Label>
          <AppSelect v-model="folderSelect" :options="folderOptions" width="100%" />
          <Input
            v-if="folderMode === 'new'"
            v-model="folder"
            :placeholder="t('vpn.editor.folderPh')"
            spellcheck="false"
            class="font-mono"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="gap-1 text-xs font-semibold text-foreground">
          {{ t('vpn.editor.configPath') }}
          <span class="font-semibold text-destructive" aria-hidden="true">*</span>
        </Label>
        <div class="flex items-center gap-2">
          <Input
            v-model="configPath"
            :class="{ 'border-destructive': touched.configPath && configError }"
            :placeholder="t('vpn.editor.configPathPh')"
            spellcheck="false"
            :aria-invalid="touched.configPath && !!configError"
            class="min-w-0 flex-1 font-mono"
            @blur="touched.configPath = true"
          />
          <Button
            v-if="canBrowse"
            type="button"
            class="shrink-0"
            variant="outline"
            size="sm"
            @click="browseConfig"
          >
            <Icon name="folder" />
            {{ t('vpn.editor.browse') }}
          </Button>
        </div>
        <div v-if="touched.configPath && configError" class="mt-1 text-sm text-destructive">
          {{ configError }}
        </div>
        <div class="text-xs text-muted-foreground">{{ t('vpn.editor.configPathHint') }}</div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="gap-1 text-xs font-semibold text-foreground">
          {{ t('vpn.editor.authMode') }}
        </Label>
        <AppSelect v-model="authModeSelect" :options="authModeOptions" width="100%" />
        <div class="text-xs text-muted-foreground">{{ t('vpn.editor.authModeHint') }}</div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="gap-1 text-xs font-semibold text-foreground">
          {{ t('vpn.editor.tags') }}
        </Label>
        <Input v-model="tagsText" :placeholder="t('vpn.editor.tagsPh')" spellcheck="false" />
        <div class="text-xs text-muted-foreground">{{ t('vpn.editor.tagsHint') }}</div>
      </div>

      <!-- Write-only credentials — blank on open, OMITTED when blank so an empty
           submit never clobbers a stored value. All three go straight to the OS
           keychain via vpn.setCredential; never written to the config or git. -->
      <div
        class="flex flex-col gap-3 rounded-lg border border-selected-border bg-selected px-3 py-3"
      >
        <div class="flex items-center gap-2">
          <Icon name="shield" class="size-3.5 text-primary" />
          <span class="text-sm font-semibold text-foreground">
            {{ t('vpn.editor.creds.title') }}
          </span>
        </div>

        <!-- Username + password apply ONLY to "Username & password" auth. In "config /
             cert" mode the tunnel authenticates via its embedded cert, so showing these
             would be misleading (this is exactly the mode where they must NOT appear). -->
        <template v-if="authMode === 'user-pass'">
          <div class="flex flex-col gap-1.5">
            <Label class="gap-1 text-xs font-semibold text-foreground">
              {{ t('vpn.editor.creds.username') }}
            </Label>
            <Input
              v-model="username"
              :placeholder="t('vpn.editor.creds.usernamePh')"
              spellcheck="false"
              autocomplete="off"
              class="font-mono"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label class="gap-1 text-xs font-semibold text-foreground">
              {{ t('vpn.editor.creds.password') }}
            </Label>
            <div class="relative">
              <Input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="t('vpn.editor.creds.passwordPh')"
                spellcheck="false"
                autocomplete="off"
                class="pr-10 font-mono"
              />
              <Button
                variant="ghost"
                size="iconSm"
                class="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-70 hover:opacity-100"
                :class="{ 'text-foreground opacity-100': showPassword }"
                :title="showPassword ? t('vpn.editor.creds.hide') : t('vpn.editor.creds.reveal')"
                :aria-label="
                  showPassword ? t('vpn.editor.creds.hide') : t('vpn.editor.creds.reveal')
                "
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                <Icon :name="showPassword ? 'eye-off' : 'eye'" />
              </Button>
            </div>
          </div>
        </template>

        <div class="flex flex-col gap-1.5">
          <Label class="gap-1 text-xs font-semibold text-foreground">
            {{ t('vpn.editor.creds.keyPassphrase') }}
          </Label>
          <div class="relative">
            <Input
              v-model="keyPassphrase"
              :type="showPassphrase ? 'text' : 'password'"
              :placeholder="t('vpn.editor.creds.keyPassphrasePh')"
              spellcheck="false"
              autocomplete="off"
              class="pr-10 font-mono"
            />
            <Button
              variant="ghost"
              size="iconSm"
              class="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-70 hover:opacity-100"
              :class="{ 'text-foreground opacity-100': showPassphrase }"
              :title="showPassphrase ? t('vpn.editor.creds.hide') : t('vpn.editor.creds.reveal')"
              :aria-label="
                showPassphrase ? t('vpn.editor.creds.hide') : t('vpn.editor.creds.reveal')
              "
              :aria-pressed="showPassphrase"
              @click="showPassphrase = !showPassphrase"
            >
              <Icon :name="showPassphrase ? 'eye-off' : 'eye'" />
            </Button>
          </div>
        </div>

        <div class="text-xs text-muted-foreground">{{ t('vpn.editor.creds.hint') }}</div>
      </div>
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('vpn.editor.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// VPN profile form editor (ADR 0065 P0) — builds a VpnProfile. The .ovpn path is a
// plaintext filesystem path (not a secret, mirrors SshIdentity.keyPath). The three
// credential fields prefill from the keychain when editing (the user's own VPN
// login, shown like a password manager — masked behind a reveal toggle) and are
// emitted separately from the config so the page persists them via vpn.setCredential.
// The id is auto-generated by the store on create (never shown).
import { computed, reactive, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { pickFile } from '~/composables/useFolderPicker'
import { useVpnStore, type VpnAuthMode, type VpnImportDraft, type VpnProfile } from '~/stores/vpn'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// The editor emits its raw secret parts; the section maps them to vpn.setCredential.
export type VpnCredentialSecret = { username?: string; password?: string; keyPassphrase?: string }

const props = defineProps<{
  open: boolean
  profile: VpnProfile | null
  profiles: VpnProfile[]
  // NEW-profile seed from a .ovpn import (P4). Only used when `profile` is null; seeds
  // name / configPath / authMode, leaving folder / tags / credentials for the user.
  draft?: VpnImportDraft | null
}>()

const emit = defineEmits<{
  save: [profile: VpnProfile, secret?: VpnCredentialSecret]
  cancel: []
}>()

const { t } = useI18n()
const store = useVpnStore()

const isExisting = computed(() => !!props.profile)

// --- form state ------------------------------------------------------------
const name = ref('')
const configPath = ref('')
const authMode = ref<VpnAuthMode>('none')
const folder = ref('')
const tagsText = ref('')
const username = ref('')
const password = ref('')
const keyPassphrase = ref('')
// Which required fields have been blurred — gates when their inline error appears.
const touched = reactive<{ name: boolean; configPath: boolean }>({ name: false, configPath: false })
// Reveal toggles for the two masked secret fields (eye button).
const showPassword = ref(false)
const showPassphrase = ref(false)

const authModeOptions = computed<AppSelectOption[]>(() => [
  { value: 'none', label: t('vpn.auth.none') },
  { value: 'user-pass', label: t('vpn.auth.userPass') },
])
const authModeSelect = computed<string>({
  get: () => authMode.value,
  set: (v) => {
    authMode.value = v as VpnAuthMode
  },
})

// Folder = pick an existing one (reused across profiles) OR add a new one. Existing
// folders are derived from the inventory; a `__new__` sentinel reveals a text input.
const FOLDER_NEW = '__new__'
const folderMode = ref<'select' | 'new'>('select')
const existingFolders = computed<string[]>(() => {
  const set = new Set<string>()
  for (const p of props.profiles) {
    const f = p.folder?.trim()
    if (f) set.add(f)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
})
const folderOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('vpn.editor.folderNone') },
  ...existingFolders.value.map((f) => ({ value: f, label: f })),
  { value: FOLDER_NEW, label: t('vpn.editor.folderNew') },
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

// Re-seed every time the modal opens or the edit target changes.
watch(
  () => [props.open, props.profile, props.draft] as const,
  ([isOpen]) => {
    if (!isOpen) return
    const p = props.profile
    // An import draft seeds a NEW profile only (an existing profile always wins).
    const d = p ? null : props.draft
    name.value = p?.name ?? d?.name ?? ''
    configPath.value = p?.configPath ?? d?.configPath ?? ''
    authMode.value = p?.authMode ?? d?.authMode ?? 'none'
    folder.value = p?.folder ?? ''
    folderMode.value = 'select'
    tagsText.value = (p?.tags ?? []).join(', ')
    username.value = ''
    password.value = ''
    keyPassphrase.value = ''
    // Re-mask on every open so a previously revealed secret doesn't linger visible.
    showPassword.value = false
    showPassphrase.value = false
    // Fresh form → clear validation touch state so no error shows before interaction.
    touched.name = false
    touched.configPath = false
    // Editing an existing profile → prefill its stored credential (the user's own
    // VPN login, like a password manager). Guarded so a fast open→switch can't apply
    // a stale credential to the wrong profile.
    if (p) {
      const forId = p.id
      void store.getCredential(forId).then((cred) => {
        if (!props.open || props.profile?.id !== forId) return
        username.value = cred.username ?? ''
        password.value = cred.password ?? ''
        keyPassphrase.value = cred.keyPassphrase ?? ''
      })
    }
  },
  { immediate: true },
)

// Native file picker is only present inside the Electron shell; in browser-dev the
// field falls back to manual text entry (button hidden).
const canBrowse = ref(typeof window !== 'undefined' && !!window.awog)
const browseConfig = async (): Promise<void> => {
  const picked = await pickFile({
    title: t('vpn.editor.browseTitle'),
    filters: [{ name: 'OpenVPN', extensions: ['ovpn', 'conf'] }],
  })
  if (picked) configPath.value = picked
}

// Required-field validation. The error only surfaces once a field has been touched
// (blurred) so a freshly opened form isn't shouting — the red `*` already flags that
// it's required. `touched` is declared up with the form state (the re-seed watch resets
// it). Empty check mirrors canSave.
const nameError = computed(() => (name.value.trim() ? '' : t('vpn.editor.nameRequired')))
const configError = computed(() => (configPath.value.trim() ? '' : t('vpn.editor.configRequired')))

const canSave = computed(() => name.value.trim().length > 0 && configPath.value.trim().length > 0)

const buildProfile = (): VpnProfile => {
  const now = new Date().toISOString()
  const enteredUserPass = username.value.trim().length > 0 || password.value.trim().length > 0
  const enteredPassphrase = keyPassphrase.value.trim().length > 0
  const base: VpnProfile = {
    id: props.profile?.id ?? '',
    name: name.value.trim(),
    type: 'openvpn',
    configPath: configPath.value.trim(),
    authMode: authMode.value,
    // Optimistic flags — the list re-hydrates from the keychain after save.
    hasUserPass: enteredUserPass || (props.profile?.hasUserPass ?? false),
    hasKeyPassphrase: enteredPassphrase || (props.profile?.hasKeyPassphrase ?? false),
    keepalive: props.profile?.keepalive ?? true,
    autoDown: props.profile?.autoDown ?? false,
    createdAt: props.profile?.createdAt ?? now,
    updatedAt: now,
  }
  if (folder.value.trim()) base.folder = folder.value.trim()
  const tags = parseTags(tagsText.value)
  if (tags.length) base.tags = tags
  // Carry over runtime fields the P0 form doesn't edit so an edit never drops them.
  if (props.profile) {
    if (props.profile.status) base.status = props.profile.status
    if (props.profile.statusError) base.statusError = props.profile.statusError
    if (props.profile.lastUpAt) base.lastUpAt = props.profile.lastUpAt
  }
  return base
}

const onSave = () => {
  if (!canSave.value) return
  const u = username.value.trim()
  const pw = password.value.trim()
  const kp = keyPassphrase.value.trim()
  const secret: VpnCredentialSecret | undefined =
    u || pw || kp
      ? {
          ...(u ? { username: u } : {}),
          ...(pw ? { password: pw } : {}),
          ...(kp ? { keyPassphrase: kp } : {}),
        }
      : undefined
  emit('save', buildProfile(), secret)
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
