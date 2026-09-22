import { register } from '../transport/rpc.js'
import { loadSettings } from '../logtime/store.js'

register('logtime.settings-get', async () => ({ settings: await loadSettings() }))
