import { register } from '../transport/rpc.js'
import pkg from '../../package.json' with { type: 'json' }

register('ping', () => ({
  pong: true,
  version: pkg.version,
  ts: Date.now(),
}))
