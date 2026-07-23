<template>
  <SshHostKeyModal
    :open="!!ssh.pendingHostKey"
    :prompt="ssh.pendingHostKey"
    @confirm="(accept, remember) => ssh.confirmHostKey(accept, remember)"
  />
</template>

<script setup lang="ts">
// App-wide host of the SSH host-key TOFU prompt. Mounted once in the default
// layout so an SSH connect started from ANY surface (the global terminal dock's
// "+" → Connect SSH, a session panel, …) can surface the unknown/changed-key
// prompt — not only while the /ssh page is open. Reads the ssh store's app-wide
// `pendingHostKey` (parked by its ssh:host-key-prompt subscription). Presentational
// only; the modal itself is unchanged.
import SshHostKeyModal from '~/components/ssh/SshHostKeyModal.vue'
import { useSshStore } from '~/stores/ssh'

const ssh = useSshStore()
</script>
