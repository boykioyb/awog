import { mkdir, writeFile, chmod, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const entry = join(pkgRoot, 'src/index.ts')
const outDir = join(pkgRoot, 'dist')

function targetTriple() {
  const { platform, arch } = process
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  throw new Error(`Unsupported build target: ${platform}/${arch}`)
}

async function main() {
  let nccModule
  try {
    nccModule = await import('@vercel/ncc')
  } catch (err) {
    console.error('[build] Failed to load @vercel/ncc. Run pnpm install first.')
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const ncc = nccModule.default ?? nccModule

  const triple = targetTriple()
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const outFile = join(outDir, `awog-sidecar-${triple}${suffix}`)

  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  console.error(`[build] Bundling ${entry} → ${outFile}`)
  const { code, warnings } = await ncc(entry, {
    cache: false,
    minify: false,
    sourceMap: false,
    target: 'es2022',
    quiet: true,
  })

  if (warnings && warnings.length > 0) {
    for (const w of warnings) console.error('[build][warn]', w)
  }

  const shebang = '#!/usr/bin/env node\n'
  await writeFile(outFile, shebang + code, 'utf8')
  if (process.platform !== 'win32') await chmod(outFile, 0o755)

  console.error(`[build] Done: ${outFile}`)

  // Mirror binary into Tauri externalBin location so `pnpm tauri dev` picks it up.
  const tauriBin = resolve(pkgRoot, '..', 'src-tauri', 'binaries', `awog-sidecar-${triple}${suffix}`)
  await mkdir(dirname(tauriBin), { recursive: true })
  await copyFile(outFile, tauriBin)
  if (process.platform !== 'win32') await chmod(tauriBin, 0o755)
  console.error(`[build] Mirrored → ${tauriBin}`)
}

main().catch((err) => {
  console.error('[build] Fatal:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
