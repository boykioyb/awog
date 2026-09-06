<template>
  <div class="sshx-kc">
    <div class="sshx-kc-top">
      <span class="sshx-kc-title">{{ t('ssh.nav.keychain') }}</span>
      <span class="sshx-kc-count">{{ identities.length }}</span>
      <button class="btn pri sm sshx-kc-new" :title="t('ssh.identity.new')" @click="emit('new')">
        <Icon name="plus" style="width: 13px; height: 13px" />
        {{ t('ssh.identity.new') }}
      </button>
    </div>

    <div class="sshx-kc-scroll">
      <SshEmptyState
        v-if="!identities.length"
        icon="shield"
        :title="t('ssh.identity.empty')"
        :body="t('ssh.keychain.emptyBody')"
      />
      <div v-else class="sshx-kc-list">
        <div v-for="idn in identities" :key="idn.id" class="sshx-kc-row">
          <span class="sshx-kc-ic"><Icon name="shield" style="width: 15px; height: 15px" /></span>
          <div class="sshx-kc-main">
            <span class="sshx-kc-name">{{ idn.name }}</span>
            <div class="sshx-kc-meta">
              <span v-if="idn.keyType" class="sshx-kc-chip">{{ idn.keyType }}</span>
              <span class="sshx-kc-src mono">
                {{ idn.inlineStored ? t('ssh.detail.inlineKey') : idn.keyPath || '—' }}
              </span>
              <span v-if="idn.hasPassphrase" class="sshx-kc-pp">
                <Icon name="shield" style="width: 10px; height: 10px" />
                {{ t('ssh.detail.passphrase') }}
              </span>
            </div>
          </div>
          <button
            class="sshx-kc-act"
            :title="t('ssh.identity.edit')"
            :aria-label="t('ssh.identity.edit')"
            @click="emit('edit', idn.id)"
          >
            <Icon name="edit" style="width: 13px; height: 13px" />
          </button>
          <button
            class="sshx-kc-act sshx-kc-del"
            :title="t('ssh.identity.delete')"
            :aria-label="t('ssh.identity.delete')"
            @click="emit('delete', idn.id)"
          >
            <Icon name="trash" style="width: 13px; height: 13px" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Keychain section of the SSH workspace — a flat list of every saved identity
// (name + key-type chip + key path/inline source + passphrase chip) with New /
// Edit / Delete. Orphan identities (linked to no host) stay editable/deletable
// here. Presentational: the page wires the events to the same CRUD handlers the
// host editor uses. Nothing reads a secret.
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import type { SshIdentity } from '~/stores/ssh'

defineProps<{ identities: SshIdentity[] }>()

const emit = defineEmits<{ new: []; edit: [id: string]; delete: [id: string] }>()

const { t } = useI18n()
</script>

<style scoped>
.sshx-kc {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sshx-kc-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-kc-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.sshx-kc-count {
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.sshx-kc-new {
  margin-left: auto;
}
.sshx-kc-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sshx-kc-list {
  padding: 8px 12px;
}
.sshx-kc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
}
.sshx-kc-row + .sshx-kc-row {
  margin-top: 8px;
}
.sshx-kc-ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--r-sm);
  color: var(--accent);
  background: var(--accentDim);
  flex: 0 0 auto;
}
.sshx-kc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sshx-kc-name {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  color: var(--text);
}
.sshx-kc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sshx-kc-chip {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.sshx-kc-src {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  word-break: break-all;
}
.sshx-kc-pp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--accent);
  background: var(--accentDim);
}
.sshx-kc-act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshx-kc-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshx-kc-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sshx-kc-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
