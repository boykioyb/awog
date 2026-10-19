import { register } from '../transport/rpc.js'
import { listSnippets } from '../terminal/snippets.js'

// Cả thư viện (mọi project + Global) — rail của UI tự lọc theo project đang mở.
register('terminalSnippets.list', async () => ({ snippets: await listSnippets() }))
