// Detect an SSH key's type from a keyPath (prefers the sibling .pub) or pasted
// private-key material (ADR 0063 P5). Returns ONLY the coarse type — the key
// content never leaves the sidecar. Used by the identity editor to auto-fill the
// key-type field on import.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { detectKeyType } from '../ssh/key-detect.js'

const Params = z.object({
  keyPath: z.string().min(1).max(4096).optional(),
  privateKey: z.string().min(1).max(65_536).optional(),
})

register('ssh.detectKeyType', async (raw) => {
  const p = Params.parse(raw)
  return { keyType: await detectKeyType(p) }
})
