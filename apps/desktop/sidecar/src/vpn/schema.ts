// Zod schema for VPN Manager persistence — see ADR 0065.
//
// One entity lives on disk (file-per-entity, store song song với SSH):
//   ~/.awog/vpn-profiles/<id>.json  — VpnProfileConfig
//
// The file NEVER holds a secret. VPN credentials (username / password / key
// passphrase) live ONLY in the OS keychain (service `awog-vpn`, see
// credentials.ts) and are pushed to openvpn via its management interface, never
// written to disk — invariant 1. `configPath` is a filesystem path to the .ovpn
// file, NOT a secret, so it is persisted as plaintext (mirrors SshIdentity.keyPath).
//
// Types are exported straight off z.infer — the VPN module is self-contained so
// the zod schema is the single source of truth (KISS).

import { z } from 'zod'

// Stable id: filename (sanitizeChild-safe) AND keychain account segment.
export const VPN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

export const VpnTypeSchema = z.enum(['openvpn'])
// `none` = credentials are embedded in the .ovpn / certs; `user-pass` = username
// + password pushed to openvpn via the management interface at connect time.
export const VpnAuthModeSchema = z.enum(['none', 'user-pass'])
export const VpnStatusSchema = z.enum(['up', 'connecting', 'down', 'error'])

export const VpnProfileConfigSchema = z.object({
  id: z.string().regex(VPN_ID_RE, 'id must match [a-z0-9][a-z0-9_-]{0,120}'),
  name: z.string().min(1).max(120),
  type: VpnTypeSchema.default('openvpn'),
  // Absolute path to the .ovpn config (plaintext, NOT a secret). Validated at
  // connect time (P1): absolute, exists, readable.
  configPath: z.string().min(1).max(4096),
  authMode: VpnAuthModeSchema.default('none'),
  // UI hints only — hydrated from the keychain at list time (never trusted from
  // disk, never the secret itself).
  hasUserPass: z.boolean().default(false),
  hasKeyPassphrase: z.boolean().default(false),
  // Auto-restart the tunnel when the process/pid dies (P2). Default on.
  keepalive: z.boolean().default(true),
  // Tear the VPN down when the SSH ref-count hits 0 (P3). Default off = keep up.
  autoDown: z.boolean().default(false),
  // Grouping path for the card tree, e.g. "prod".
  folder: z.string().max(255).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  // Last-known runtime status (persisted so the card shows something on reload).
  status: VpnStatusSchema.optional(),
  statusError: z.string().max(2000).optional(),
  lastUpAt: z.string().max(40).optional(),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
})

// Credential blob stored in the keychain ONLY (never on disk / RPC response). A
// VPN can carry a username/password AND a key passphrase, so this is a flat
// optional bag rather than a discriminated union (unlike SshCredential).
export const VpnCredentialSchema = z
  .object({
    username: z.string().max(1024).optional(),
    password: z.string().max(16_384).optional(),
    keyPassphrase: z.string().max(16_384).optional(),
  })
  .refine((c) => c.username || c.password || c.keyPassphrase, {
    message: 'at least one of username / password / keyPassphrase is required',
  })

export type VpnType = z.infer<typeof VpnTypeSchema>
export type VpnAuthMode = z.infer<typeof VpnAuthModeSchema>
export type VpnStatus = z.infer<typeof VpnStatusSchema>
export type VpnProfileConfig = z.infer<typeof VpnProfileConfigSchema>
export type VpnCredential = z.infer<typeof VpnCredentialSchema>
