// Fetch the bundled RTK binary (ADR 0031) for the HOST platform+arch into
// electron/resources/rtk/. Run as a pack.mjs prestep (and once in dev). The
// release CI builds per host OS, so fetching the host triple is enough.
//
// Supply-chain control: the version is pinned and every download is verified
// against a committed SHA256 (from the release `checksums.txt`). A mismatch is a
// hard failure — we never ship an unverified binary. Update VERSION + ASSETS
// together when bumping RTK.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = 'v0.42.3'

// platform-arch -> { file: release asset, sha256: from checksums.txt, bin: member }
const ASSETS = {
  'darwin-arm64': {
    file: 'rtk-aarch64-apple-darwin.tar.gz',
    sha256: 'd47823afb25919e4e60838c5622e88ffa6536bc0b36a34a3f928bdccac40f614',
    bin: 'rtk',
  },
  'darwin-x64': {
    file: 'rtk-x86_64-apple-darwin.tar.gz',
    sha256: '7c72d05cfc71b7e2f20755b3754b728acecc7c0b1fbbb08757828f9e7bedd81a',
    bin: 'rtk',
  },
  'linux-arm64': {
    file: 'rtk-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '2b7fa09d06f8dbf334c55482fad2e7ce4a1f8564bc9ed1f65d9f5992db8e5527',
    bin: 'rtk',
  },
  'linux-x64': {
    file: 'rtk-x86_64-unknown-linux-musl.tar.gz',
    sha256: '5df764a633709cb85d248258d085d24ec95faa8bca0e6835a93cd57cadc4eb9e',
    bin: 'rtk',
  },
  'win32-x64': {
    file: 'rtk-x86_64-pc-windows-msvc.zip',
    sha256: '334d05a6662576a84a78b771aee0749202eacabd87acbb9fd266e6a5466f700a',
    bin: 'rtk.exe',
  },
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources', 'rtk')

const key = `${process.platform}-${process.arch}`
const asset = ASSETS[key]
if (!asset) {
  console.error(`[fetch-rtk] no RTK asset mapped for ${key}; supported: ${Object.keys(ASSETS).join(', ')}`)
  process.exit(1)
}

const binPath = join(outDir, asset.bin)
const stampPath = join(outDir, '.rtk-version')

// Idempotent: skip if the binary is already present for the pinned version.
if (existsSync(binPath) && existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === VERSION) {
  console.error(`[fetch-rtk] ${asset.bin} ${VERSION} already present (${key}) — skipping`)
  process.exit(0)
}

const url = `https://github.com/rtk-ai/rtk/releases/download/${VERSION}/${asset.file}`
console.error(`[fetch-rtk] downloading ${url}`)

const res = await fetch(url)
if (!res.ok) {
  console.error(`[fetch-rtk] download failed: HTTP ${res.status}`)
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())

const digest = createHash('sha256').update(buf).digest('hex')
if (digest !== asset.sha256) {
  console.error(`[fetch-rtk] SHA256 mismatch for ${asset.file}\n  expected ${asset.sha256}\n  got      ${digest}`)
  process.exit(1)
}
console.error(`[fetch-rtk] checksum OK (${digest.slice(0, 12)}…)`)

mkdirSync(outDir, { recursive: true })
const archivePath = join(outDir, asset.file)
writeFileSync(archivePath, buf)

// Extract the single binary member. bsdtar (`tar`) handles both .tar.gz and .zip
// on macOS/Windows; Linux only ever sees .tar.gz. Avoids an extra unzip dep.
const ex = spawnSync('tar', ['-xf', archivePath, '-C', outDir, asset.bin], { stdio: 'inherit' })
if (ex.status !== 0) {
  console.error(`[fetch-rtk] extraction failed (exit ${ex.status})`)
  process.exit(ex.status ?? 1)
}
rmSync(archivePath, { force: true })

if (process.platform !== 'win32') chmodSync(binPath, 0o755)
writeFileSync(stampPath, `${VERSION}\n`)

console.error(`[fetch-rtk] installed ${binPath}`)
