// List the preset catalog metadata for the "add a source" picker (UI-parity area
// 3). Static, no I/O — display + routing metadata only (id / slug / name /
// provider / type / tagline / icon / setupHint). The full draft for a chosen
// preset comes from source.discoverPreset. No secret is ever involved.

import { register } from '../transport/rpc.js'
import { listPresetMetas } from '../sources/preset-catalog.js'

register('source.listPresets', async () => ({ presets: listPresetMetas() }))
