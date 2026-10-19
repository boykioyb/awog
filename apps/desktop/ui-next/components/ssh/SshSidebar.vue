<template>
  <nav
    class="flex w-47 shrink-0 flex-col gap-0.5 overflow-y-auto border-r px-2.5 py-3"
    :aria-label="t('ssh.nav.hosts')"
  >
    <Button
      v-for="item in items"
      :key="item.key"
      variant="ghost"
      size="sm"
      class="w-full justify-start gap-2.5 border border-transparent px-2.5 text-sm text-muted-foreground"
      :class="{
        'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary':
          store.sshSection === item.key,
      }"
      :title="t(item.label)"
      :aria-label="t(item.label)"
      :aria-current="store.sshSection === item.key ? 'page' : undefined"
      @click="store.setSection(item.key)"
    >
      <Icon :name="item.icon" />
      <span class="min-w-0 flex-1 truncate text-left">{{ t(item.label) }}</span>
    </Button>
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
