<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('ssh.identity.editTitle') : t('ssh.identity.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">{{ t('ssh.identity.name') }}</Label>
        <Input v-model="name" :placeholder="t('ssh.identity.namePh')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">{{ t('ssh.identity.keyType') }}</Label>
        <AppSelect v-model="keyTypeSelect" :options="keyTypeOptions" width="100%" />
      </div>

      <!-- Key source: a path to a file on disk, OR pasted inline material (stored
           in the keychain). Bấm lại mục đang bật thì ToggleGroup emit rỗng — bỏ qua. -->
      <div class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">
          {{ t('ssh.identity.keySource') }}
        </Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="self-start rounded-lg bg-muted p-0.5"
          :model-value="keySource"
          @update:model-value="
            (v) => {
              if (v === 'file' || v === 'inline') keySource = v
            }
          "
        >
          <ToggleGroupItem value="file" :class="SEG_ITEM">
            {{ t('ssh.identity.sourceFile') }}
          </ToggleGroupItem>
          <ToggleGroupItem value="inline" :class="SEG_ITEM">
            {{ t('ssh.identity.sourceInline') }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div v-if="keySource === 'file'" class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">{{ t('ssh.identity.keyPath') }}</Label>
        <div class="flex items-center gap-2">
          <Input
            v-model="keyPath"
            :placeholder="t('ssh.identity.keyPathPh')"
            spellcheck="false"
            class="min-w-0 flex-1 font-mono"
            @blur="autodetectPath"
          />
          <Button
            v-if="canBrowse"
            type="button"
            class="shrink-0"
            variant="outline"
            size="sm"
            @click="browseKey"
          >
            <Icon name="folder" />
            {{ t('ssh.identity.browse') }}
          </Button>
        </div>
        <div class="text-xs text-muted-foreground">{{ t('ssh.identity.keyPathHint') }}</div>
      </div>

      <div v-else class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">
          {{ t('ssh.identity.privateKey') }}
        </Label>
        <Textarea
          v-model="privateKey"
          class="min-h-24 resize-y font-mono"
          rows="5"
          :placeholder="t('ssh.identity.privateKeyPh')"
          spellcheck="false"
          autocomplete="off"
          @blur="autodetectInline"
        />
        <div class="text-xs text-muted-foreground">
          {{ isExisting ? t('ssh.identity.privateKeyHintKeep') : t('ssh.identity.privateKeyHint') }}
        </div>
      </div>

      <!-- Write-only passphrase — blank on open, omitted when blank. Khung nhấn accent:
           passphrase chỉ ghi, đi thẳng vào keychain. -->
      <div class="flex flex-col gap-2 rounded-lg border border-selected-border bg-selected p-3">
        <div class="flex items-center gap-2">
          <Icon name="shield" class="size-3.5 text-primary" />
          <span class="text-sm font-semibold text-foreground">
            {{ t('ssh.identity.passphrase') }}
          </span>
        </div>
        <Input
          v-model="passphrase"
          type="password"
          :placeholder="t('ssh.identity.passphrasePh')"
          spellcheck="false"
          autocomplete="off"
          class="font-mono"
        />
        <div class="text-xs text-muted-foreground">
          {{ isExisting ? t('ssh.identity.secretHintKeep') : t('ssh.identity.secretHint') }}
        </div>
      </div>
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('ssh.identity.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  open: boolean
  identity: SshIdentity | null
}>()

const emit = defineEmits<{
  save: [identity: SshIdentity, secret?: SshIdentitySecret]
  cancel: []
}>()

const { t } = useI18n()

// Item của segmented control (ToggleGroup) chọn nguồn key.
const SEG_ITEM =
  'h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

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
