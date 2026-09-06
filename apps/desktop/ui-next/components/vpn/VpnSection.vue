<template>
  <div class="vpnx">
    <div class="vpnx-top">
      <span class="vpnx-title">{{ t('vpn.section.title') }}</span>
      <span class="vpnx-count">{{ store.profiles.length }}</span>
      <div class="vpnx-actions">
        <button v-if="canPick" class="btn sm" :title="t('vpn.import.button')" @click="openImport">
          <Icon name="download" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('vpn.import.button') }}
        </button>
        <button class="btn pri sm" :title="t('vpn.new')" @click="openNew">
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('vpn.new') }}
        </button>
      </div>
    </div>

    <div class="vpnx-scroll">
      <VpnEmptyState
        v-if="!store.profiles.length"
        icon="globe"
        :title="t('vpn.empty.title')"
        :body="t('vpn.empty.body')"
      />
      <div v-else class="vpnx-list">
        <VpnCard
          v-for="p in store.profiles"
          :key="p.id"
          :profile="p"
          :status="store.statusOf(p.id)"
          :error="store.errorOf(p.id)"
          @edit="openEdit(p)"
          @delete="askDelete(p)"
          @connect="onConnect(p)"
          @disconnect="onDisconnect(p)"
          @log="openLog(p)"
        />
      </div>
    </div>

    <VpnEditor
      :open="editorOpen"
      :profile="editing"
      :profiles="store.profiles"
      :draft="importDraft"
      @save="onSave"
      @cancel="editorOpen = false"
    />

    <VpnLogModal
      :id="logProfile?.id ?? null"
      :open="logOpen"
      :name="logProfile?.name ?? ''"
      :status="logProfile ? store.statusOf(logProfile.id) : 'down'"
      @close="logOpen = false"
    />

    <VpnChallengeModal
      v-if="activeChallenge"
      :open="true"
      :name="store.profileById(activeChallenge.id)?.name ?? activeChallenge.id"
      :prompt="activeChallenge.prompt"
      :echo="activeChallenge.echo"
      @submit="onChallengeSubmit"
      @cancel="onChallengeCancel"
    />
  </div>
</template>

<script setup lang="ts">
// VPN section of the SSH workspace (ADR 0065 P0) — a self-contained CRUD pane
// (mirrors SshSnippetsSection's structure: it owns its editor + delete confirm +
// toasts rather than bubbling to a page controller). Lists every OpenVPN profile
// as a card with New / Edit / Delete. Live up/down control is P1 — the persisted
// status is shown as a badge only. Nothing reads a secret.
import { computed, onMounted, ref } from 'vue'
import VpnCard from '~/components/vpn/VpnCard.vue'
import VpnChallengeModal from '~/components/vpn/VpnChallengeModal.vue'
import VpnEditor, { type VpnCredentialSecret } from '~/components/vpn/VpnEditor.vue'
import VpnEmptyState from '~/components/vpn/VpnEmptyState.vue'
import VpnLogModal from '~/components/vpn/VpnLogModal.vue'
import { useConfirm } from '~/composables/useConfirm'
import { pushActionToast } from '~/composables/useActionToasts'
import { pickFile } from '~/composables/useFolderPicker'
import { useVpnStore, type VpnImportDraft, type VpnProfile } from '~/stores/vpn'

const { t } = useI18n()
const store = useVpnStore()
const { confirm } = useConfirm()

// --- editor ----------------------------------------------------------------
const editorOpen = ref(false)
const editing = ref<VpnProfile | null>(null)
// Seed for a NEW profile parsed from a .ovpn import (P4); cleared on every other open
// so a stale draft never bleeds into a fresh New/Edit.
const importDraft = ref<VpnImportDraft | null>(null)

function openNew(): void {
  importDraft.value = null
  editing.value = null
  editorOpen.value = true
}
function openEdit(profile: VpnProfile): void {
  importDraft.value = null
  editing.value = profile
  editorOpen.value = true
}

// --- log viewer ------------------------------------------------------------
const logOpen = ref(false)
const logProfile = ref<VpnProfile | null>(null)
function openLog(profile: VpnProfile): void {
  logProfile.value = profile
  logOpen.value = true
}

// --- import (.ovpn dry-run, P4) --------------------------------------------
// Native picker → dry-run parse (sidecar validates + rejects a hostile config) →
// open the editor pre-filled in new-profile mode. Nothing is written until the user
// saves. The button is hidden without a native picker (browser-dev), so this only
// runs inside the Electron shell.
const canPick = ref(typeof window !== 'undefined' && !!window.awog)
async function openImport(): Promise<void> {
  const picked = await pickFile({
    title: t('vpn.import.pickTitle'),
    filters: [{ name: 'OpenVPN', extensions: ['ovpn', 'conf'] }],
  })
  if (!picked) return
  try {
    importDraft.value = await store.importOvpn(picked)
    editing.value = null
    editorOpen.value = true
  } catch (err) {
    pushActionToast(t('vpn.import.failed', { error: errText(err) }), 'error')
  }
}

// Save the profile, then (only when a credential was actually entered) persist it
// to the keychain keyed by the SAVED id, and re-hydrate so the has* flags reflect
// the keychain truth. The credential is OMITTED when blank so an empty submit never
// clobbers a stored one.
async function onSave(profile: VpnProfile, secret?: VpnCredentialSecret): Promise<void> {
  const mode = editing.value ? 'update' : 'create'
  try {
    const saved = await store.saveProfile(profile, mode)
    if (secret) {
      await store.setCredential({ id: saved.id, ...secret })
      await store.loadAll()
    }
    pushActionToast(t('vpn.toast.saved', { name: saved.name }), 'success')
  } catch (err) {
    pushActionToast(t('vpn.toast.saveFailed', { error: errText(err) }), 'error')
    return
  }
  editorOpen.value = false
}

// --- delete ----------------------------------------------------------------
async function askDelete(profile: VpnProfile): Promise<void> {
  const ok = await confirm({
    title: t('vpn.delete.title'),
    description: t('vpn.delete.hint', { name: profile.name }),
    kind: 'danger',
  })
  if (!ok) return
  try {
    await store.deleteProfile(profile.id)
    pushActionToast(t('vpn.toast.deleted', { name: profile.name }), 'success')
  } catch (err) {
    pushActionToast(t('vpn.toast.deleteFailed', { error: errText(err) }), 'error')
  }
}

// --- live control (P1) -----------------------------------------------------
// Bring a tunnel up (the OS admin prompt happens sidecar-side; the card flips to
// 'connecting' via the vpn:status-changed event while this awaits readiness).
async function onConnect(profile: VpnProfile): Promise<void> {
  try {
    await store.up(profile.id)
    pushActionToast(t('vpn.toast.connected', { name: profile.name }), 'success')
  } catch (err) {
    pushActionToast(t('vpn.toast.connectFailed', { error: errText(err) }), 'error')
  }
}

async function onDisconnect(profile: VpnProfile): Promise<void> {
  try {
    await store.down(profile.id)
    pushActionToast(t('vpn.toast.disconnected', { name: profile.name }), 'success')
  } catch (err) {
    pushActionToast(t('vpn.toast.disconnectFailed', { error: errText(err) }), 'error')
  }
}

// --- MFA/OTP challenge -------------------------------------------------------
// At most one tunnel connects at a time, so surface the first pending challenge.
const activeChallenge = computed(() => {
  for (const p of store.profiles) {
    const ch = store.challengeOf(p.id)
    if (ch) return ch
  }
  return undefined
})

async function onChallengeSubmit(code: string): Promise<void> {
  const ch = activeChallenge.value
  if (!ch) return
  try {
    await store.submitChallenge(ch.id, code)
  } catch (err) {
    pushActionToast(t('vpn.toast.connectFailed', { error: errText(err) }), 'error')
  }
}

// Cancel = give up on this connection (openvpn is parked at AUTH waiting for the code).
async function onChallengeCancel(): Promise<void> {
  const ch = activeChallenge.value
  if (!ch) return
  await store.down(ch.id)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

onMounted(() => {
  void store.loadAll()
})
</script>

<style scoped>
.vpnx {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.vpnx-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.vpnx-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.vpnx-count {
  font-size: 12px;
  line-height: 12px;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.vpnx-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.vpnx-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.vpnx-list {
  padding: 8px 12px;
}
</style>
