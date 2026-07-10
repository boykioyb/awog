// Test a Source's connection (ADR 0060 D-6). Successor to mcp.test. Loads the
// persisted source by slug, runs the per-kind connectivity probe (mcp handshake +
// optional auth probe / api testEndpoint / local path reachable — P4), persists
// the outcome onto the config (connectionStatus/isAuthenticated/connectionError/
// lastTestedAt) and auto-enables a clean run.
//
// Contract note (P1): unlike mcp.test (which accepted an unsaved draft), this
// operates on a PERSISTED source — the outcome is written back, so the UI must
// save the source before testing.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { SOURCE_SLUG_RE } from '../sources/schema.js'
import { testAndPersistSource } from '../sources/test.js'

const Params = z.object({
  slug: z.string().regex(SOURCE_SLUG_RE),
})

register('source.test', async (raw) => {
  const { slug } = Params.parse(raw)
  const { source, outcome } = await testAndPersistSource(slug)
  if (!source && !outcome.supported && outcome.error?.startsWith('source not found')) {
    throw new RpcError(-32602, `source not found: ${slug}`)
  }
  return { source, outcome }
})
