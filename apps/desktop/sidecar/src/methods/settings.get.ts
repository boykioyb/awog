import { register } from '../transport/rpc.js'
import { loadSettings } from '../settings/store.js'

register('settings.get', async () => {
  return await loadSettings()
})
