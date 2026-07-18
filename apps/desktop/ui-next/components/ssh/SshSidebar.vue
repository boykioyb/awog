<template>
  <nav class="sshx-side" :aria-label="t('ssh.nav.hosts')">
    <button
      v-for="item in items"
      :key="item.key"
      class="sshx-side-item"
      :class="{ on: store.sshSection === item.key }"
      :title="t(item.label)"
      :aria-label="t(item.label)"
      :aria-current="store.sshSection === item.key ? 'page' : undefined"
      @click="store.setSection(item.key)"
    >
      <Icon :name="item.icon" style="width: 15px; height: 15px" />
      <span class="sshx-side-label">{{ t(item.label) }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
// Left inner nav of the SSH workspace's Hosts view — one row per section
// (Hosts / Keychain / Port Forwarding / Snippets / Known Hosts / Logs). The active
// row is driven by `store.sshSection`; clicking switches it (also forces the Hosts
// top-tab active, via the store action). Purely a navigation control.
import { useSshStore, type SshSection } from '~/stores/ssh'

const { t } = useI18n()
const store = useSshStore()

const items: { key: SshSection; icon: string; label: string }[] = [
  { key: 'hosts', icon: 'conn', label: 'ssh.nav.hosts' },
  { key: 'vpn', icon: 'globe', label: 'vpn.nav.section' },
  { key: 'keychain', icon: 'shield', label: 'ssh.nav.keychain' },
  { key: 'forwarding', icon: 'forward', label: 'ssh.nav.forwarding' },
  { key: 'snippets', icon: 'commands', label: 'ssh.nav.snippets' },
  { key: 'known-hosts', icon: 'folder', label: 'ssh.nav.knownHosts' },
  { key: 'logs', icon: 'act', label: 'ssh.nav.logs' },
]
</script>

<style scoped>
.sshx-side {
  flex: 0 0 188px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 10px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.sshx-side-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  font-size: 0.9231rem;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshx-side-item:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshx-side-item.on {
  background: var(--accentDim);
  color: var(--accent);
}
.sshx-side-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sshx-side-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
