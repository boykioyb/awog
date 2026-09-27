// SSH surface for the remote PWA (sidecar ssh.* — ADR 0063). Saved hosts never
// carry secrets (they live in the desktop keychain); the phone sees config +
// live connIds. Every ssh.* method is UNATTENDED_ONLY on the gateway — calls
// fail with a clear error while the desktop switch is off.

import { computed, ref } from 'vue'
import { gateway } from './gateway'
import type {
  SshActiveForward,
  SshConnection,
  SshExecResult,
  SshHost,
  SshIdentity,
} from './types'

export const sshHosts = ref<SshHost[]>([])
export const sshIdentities = ref<SshIdentity[]>([])
export const sshConns = ref<SshConnection[]>([])
export const sshLoading = ref(false)
export const sshError = ref('')

// hostId → live connId (one host can hold several, but the UI drives one).
export const connByHost = computed(() => {
  const m = new Map<string, string>()
  for (const c of sshConns.value) m.set(c.hostId, c.connId)
  return m
})

export function hostById(id: string): SshHost | undefined {
  return sshHosts.value.find((h) => h.id === id)
}

export function identityName(id?: string): string {
  if (!id) return ''
  return sshIdentities.value.find((x) => x.id === id)?.name ?? id
}

export async function loadSsh(): Promise<void> {
  sshLoading.value = true
  sshError.value = ''
  try {
    const [l, c] = await Promise.all([
      gateway.request('ssh.list', {}) as Promise<{ hosts: SshHost[]; identities: SshIdentity[] }>,
      gateway.request('ssh.connections', {}) as Promise<{ connections: SshConnection[] }>,
    ])
    sshHosts.value = l.hosts
    sshIdentities.value = l.identities
    sshConns.value = c.connections
  } catch (e) {
    sshError.value = e instanceof Error ? e.message : String(e)
  } finally {
    sshLoading.value = false
  }
}

export async function sshConnect(hostId: string): Promise<string> {
  const res = (await gateway.request('ssh.connect', { hostId, cols: 80, rows: 24 })) as {
    connId: string
  }
  await loadSsh()
  return res.connId
}

export async function sshDisconnect(connId: string): Promise<void> {
  await gateway.request('ssh.disconnect', { connId })
  await loadSsh()
}

export async function sshTest(hostId: string): Promise<{ status: string; error?: string }> {
  return (await gateway.request('ssh.test', { hostId })) as { status: string; error?: string }
}

export async function sshExec(connId: string, command: string): Promise<SshExecResult> {
  return (await gateway.request('ssh.exec', { connId, command })) as SshExecResult
}

export async function listForwards(connId: string): Promise<SshActiveForward[]> {
  const res = (await gateway.request('ssh.forward.list', { connId })) as {
    forwards: SshActiveForward[]
  }
  return res.forwards
}
