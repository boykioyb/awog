import { register, listMethods } from '../transport/rpc.js'

// Return the names of all registered RPC methods. Used by the Remote Gateway
// (mobile-remote-control, ADR 0067) to validate its method allowlist at boot —
// a mismatch means a typo'd allowlist entry, caught fail-fast. This is host-only
// metadata (method names, no params/data); it is NOT on the remote allowlist, so
// a paired phone can never call it.
register('system.methods', async () => ({ methods: listMethods() }))
