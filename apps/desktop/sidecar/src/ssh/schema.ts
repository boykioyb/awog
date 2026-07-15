// Zod schema for SSH Manager persistence — see ADR 0063.
//
// Two entities live on disk (file-per-entity, store song song với Sources):
//   ~/.awog/ssh-hosts/<id>.json       — SshHostConfig
//   ~/.awog/ssh-identities/<id>.json  — SshIdentityConfig
//
// NEITHER file ever holds a secret. Passwords / key passphrases / inline private
// key material live ONLY in the OS keychain (service `awog-ssh`, see
// credentials.ts) — invariant 1. `keyPath` is a filesystem path, NOT a secret,
// so it is persisted as plaintext (mirrors LocalSourceBlock.path in Sources).
//
// Types are exported straight off z.infer (no hand-written shared.ts mirror):
// the SSH module is self-contained, so the zod schema is the single source of
// truth (KISS — avoids a second contract that can drift).

import { z } from 'zod'

// Stable id: filename (sanitizeChild-safe) AND keychain account segment.
export const SSH_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

// Hostname / IP charset (F1). Allowlist that covers FQDN, IPv4, IPv6 (colons +
// optional brackets), and zone id (%). Rejects whitespace, newline, and the
// known_hosts structural chars (`,` `@` `#` `|`) so a host string can never
// inject a second line (or a `@cert-authority *`) when appended to known_hosts.
export const SSH_HOST_RE = /^[A-Za-z0-9._:%[\]-]+$/

export const SshAuthMethodSchema = z.enum(['password', 'key', 'agent'])
export const SshKeyTypeSchema = z.enum(['ed25519', 'rsa', 'ecdsa', 'other'])
export const SshConnectionStatusSchema = z.enum([
  'connected',
  'disconnected',
  'error',
  'unknown',
])

// A saved port-forward definition. Discriminated on `type`. `bindHost` defaults
// to 127.0.0.1 at connect time for `local`/`dynamic` (invariant 6 — no public
// port); a caller wanting 0.0.0.0 must set it explicitly.
export const PortForwardSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal('local'),
    label: z.string().max(120).optional(),
    bindHost: z.string().max(255).optional(),
    bindPort: z.number().int().min(0).max(65535),
    destHost: z.string().min(1).max(255),
    destPort: z.number().int().min(1).max(65535),
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal('remote'),
    label: z.string().max(120).optional(),
    bindHost: z.string().max(255).optional(),
    bindPort: z.number().int().min(0).max(65535),
    destHost: z.string().min(1).max(255),
    destPort: z.number().int().min(1).max(65535),
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal('dynamic'),
    label: z.string().max(120).optional(),
    bindHost: z.string().max(255).optional(),
    bindPort: z.number().int().min(0).max(65535),
  }),
])

export const SshHostOptionsSchema = z.object({
  keepaliveIntervalMs: z.number().int().min(0).max(600_000).optional(),
  compression: z.boolean().optional(),
  // When false, host-key mismatch is downgraded to a warning at connect time.
  // Default (undefined → true) keeps the TOFU verifier strict (ADR 0063).
  strictHostKey: z.boolean().optional(),
})

export const SshHostConfigSchema = z.object({
  id: z.string().regex(SSH_ID_RE, 'id must match [a-z0-9][a-z0-9_-]{0,120}'),
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255).regex(SSH_HOST_RE, 'host has invalid characters'),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().min(1).max(255),
  authMethod: SshAuthMethodSchema.default('agent'),
  // Ref to a SshIdentity when authMethod === 'key'.
  identityId: z.string().regex(SSH_ID_RE).optional(),
  // Grouping path for the card tree, e.g. "prod/web".
  folder: z.string().max(255).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  // Expose this host to session agents as an SSH tool (ADR 0064 unified model).
  // undefined = enabled (backward-compat); false = hidden from agents. Set at
  // create time via the "Available to agents" toggle.
  agentEnabled: z.boolean().optional(),
  // Ref another host used as a bastion (ssh2 native chaining, NOT ProxyCommand).
  jumpHostId: z.string().regex(SSH_ID_RE).optional(),
  portForwards: z.array(PortForwardSchema).max(50).optional(),
  options: SshHostOptionsSchema.optional(),
  // Last-known runtime status (persisted so the card shows something on reload).
  connectionStatus: SshConnectionStatusSchema.optional(),
  connectionError: z.string().max(2000).optional(),
  lastConnectedAt: z.string().max(40).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
})

export const SshIdentityConfigSchema = z.object({
  id: z.string().regex(SSH_ID_RE, 'id must match [a-z0-9][a-z0-9_-]{0,120}'),
  name: z.string().min(1).max(120),
  keyType: SshKeyTypeSchema.optional(),
  // Path to a private key file on disk — plaintext, NOT a secret.
  keyPath: z.string().max(4096).optional(),
  // True when the private key CONTENTS are stored in the keychain (user pasted
  // a key rather than pointing at a file). The material itself never hits disk.
  inlineStored: z.boolean().default(false),
  // UI hint that a passphrase is stored — never the passphrase itself.
  hasPassphrase: z.boolean().default(false),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
})

// Credential shapes stored in the keychain ONLY (never on disk / RPC response).
// Tagged union so a keychain read narrows safely.
export const SshCredentialSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password'), password: z.string().min(1).max(16_384) }),
  z.object({ type: z.literal('passphrase'), passphrase: z.string().min(1).max(16_384) }),
  z.object({
    type: z.literal('inline-key'),
    privateKey: z.string().min(1).max(65_536),
    passphrase: z.string().min(1).max(16_384).optional(),
  }),
])

export type SshAuthMethod = z.infer<typeof SshAuthMethodSchema>
export type SshKeyType = z.infer<typeof SshKeyTypeSchema>
export type SshConnectionStatus = z.infer<typeof SshConnectionStatusSchema>
export type PortForward = z.infer<typeof PortForwardSchema>
export type SshHostOptions = z.infer<typeof SshHostOptionsSchema>
export type SshHostConfig = z.infer<typeof SshHostConfigSchema>
export type SshIdentityConfig = z.infer<typeof SshIdentityConfigSchema>
export type SshCredential = z.infer<typeof SshCredentialSchema>
