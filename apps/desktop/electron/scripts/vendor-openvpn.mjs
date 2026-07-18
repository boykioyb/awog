// Vendor a RELOCATABLE openvpn into vendor/openvpn/<platform>-<arch>/ so the app can
// ship it (VPN Manager, ADR 0065) and end users don't have to install openvpn.
//
// Run once per build platform (e.g. in CI on each OS runner, or locally before
// `pnpm dist`):  pnpm vendor:openvpn
//
// It SOURCES an openvpn binary from the build machine — set AWOG_OPENVPN_SRC to a
// path, else it auto-detects (`brew --prefix openvpn` / PATH on unix, the standard
// install dir on Windows). The BUILD machine needs openvpn available; END USERS do
// not. A dynamically-linked binary is made portable by copying its non-system
// libraries alongside and rewriting the load paths to be relative:
//   macOS  → copy dylibs + `install_name_tool` → @loader_path
//   Linux  → copy .so deps + `patchelf --set-rpath '$ORIGIN'`  (needs patchelf)
//   Windows→ copy the DLLs sitting next to openvpn.exe
//
// NOTE: bundling removes the *install* step only — the tunnel still needs an admin
// prompt (openvpn must be root/admin to create the tun device).

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const electronDir = resolve(here, '..')
const slot = `${process.platform}-${process.arch}`
const destDir = join(electronDir, 'vendor', 'openvpn', slot)

function fail(msg) {
  console.error(`[vendor-openvpn] ERROR: ${msg}`)
  process.exit(1)
}
function info(msg) {
  console.error(`[vendor-openvpn] ${msg}`)
}
function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' })
}

// ── Locate the source openvpn on the build machine ──────────────────────────
function locateSource() {
  if (process.env.AWOG_OPENVPN_SRC) {
    const p = process.env.AWOG_OPENVPN_SRC
    if (!existsSync(p)) fail(`AWOG_OPENVPN_SRC does not exist: ${p}`)
    return p
  }
  if (process.platform === 'win32') {
    for (const p of [
      'C:\\Program Files\\OpenVPN\\bin\\openvpn.exe',
      'C:\\Program Files (x86)\\OpenVPN\\bin\\openvpn.exe',
    ]) {
      if (existsSync(p)) return p
    }
    fail('openvpn.exe not found — install the OpenVPN Community client or set AWOG_OPENVPN_SRC')
  }
  // unix: prefer a Homebrew keg (so its dylibs are predictable), else PATH.
  if (process.platform === 'darwin') {
    const brew = spawnSync('brew', ['--prefix', 'openvpn'], { encoding: 'utf8' })
    if (brew.status === 0) {
      const p = join(brew.stdout.trim(), 'sbin', 'openvpn')
      if (existsSync(p)) return p
    }
  }
  const which = spawnSync(process.platform === 'darwin' ? 'which' : 'command', ['-v', 'openvpn'], {
    encoding: 'utf8',
    shell: process.platform !== 'darwin',
  })
  const found = (which.stdout || '').trim().split('\n')[0]
  if (found && existsSync(found)) return found
  fail('openvpn not found — install it (e.g. `brew install openvpn`) or set AWOG_OPENVPN_SRC')
}

function resetDest() {
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
}

// ── macOS: bundle dylibs + rewrite install names to @loader_path ────────────
function isSystemDylibMac(p) {
  return p.startsWith('/usr/lib/') || p.startsWith('/System/')
}
function otoolDeps(file) {
  // Skip line 0 (the file itself) and the LC_ID line; keep the dependency paths.
  return sh('otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(' (')[0].trim())
    .filter(Boolean)
}
// Resolve a dependency load-path to the absolute SOURCE file. Absolute paths are
// used verbatim; @loader_path/@rpath are resolved relative to the referrer's own
// source dir (Homebrew keeps a keg's sibling dylibs, e.g. libssl → libcrypto, in the
// same lib dir), with ../lib as a fallback for @rpath.
function resolveDepSrc(dep, referrerSrcDir) {
  if (dep.startsWith('/')) return dep
  if (dep.startsWith('@loader_path/')) return join(referrerSrcDir, dep.slice('@loader_path/'.length))
  if (dep.startsWith('@rpath/')) {
    const rest = dep.slice('@rpath/'.length)
    for (const cand of [join(referrerSrcDir, rest), join(referrerSrcDir, '..', 'lib', rest)]) {
      if (existsSync(cand)) return cand
    }
  }
  return null
}
function macRelocate(srcBin) {
  const mainDest = join(destDir, 'openvpn')
  copyFileSync(srcBin, mainDest)
  chmodSync(mainDest, 0o755)
  // Track each copied file's ORIGINAL dir so @loader_path deps resolve correctly.
  const queue = [{ dest: mainDest, srcDir: dirname(srcBin) }]
  const copied = new Set() // basenames already bundled
  const modified = [mainDest] // files whose signature install_name_tool invalidated
  while (queue.length) {
    const { dest, srcDir } = queue.shift()
    for (const dep of otoolDeps(dest)) {
      if (isSystemDylibMac(dep)) continue
      const base = basename(dep)
      if (!copied.has(base)) {
        const src = resolveDepSrc(dep, srcDir)
        if (!src || !existsSync(src)) {
          info(`WARN: could not resolve ${dep} (from ${basename(dest)}) — skipping`)
          continue
        }
        const destLib = join(destDir, base)
        copyFileSync(src, destLib)
        chmodSync(destLib, 0o644)
        sh('install_name_tool', ['-id', `@loader_path/${base}`, destLib])
        copied.add(base)
        modified.push(destLib)
        queue.push({ dest: destLib, srcDir: dirname(src) })
      }
      // Point this reference at the bundled sibling (skip if already correct).
      if (dep !== `@loader_path/${base}`) {
        sh('install_name_tool', ['-change', dep, `@loader_path/${base}`, dest])
      }
    }
  }
  // CRITICAL on Apple Silicon: install_name_tool invalidates each file's ad-hoc code
  // signature, and arm64 dyld REFUSES to load an unsigned/invalidly-signed Mach-O
  // (the process is killed → exit=null). Re-sign every modified file ad-hoc; sign the
  // main executable last (after its dylibs).
  for (const f of [...modified].reverse()) sh('codesign', ['--force', '--sign', '-', f])
  return mainDest
}

// ── Linux: copy .so deps + rpath $ORIGIN (needs patchelf) ───────────────────
function linuxRelocate(srcBin) {
  if (spawnSync('patchelf', ['--version']).status !== 0) {
    fail('patchelf is required on Linux — install it (e.g. `sudo apt install patchelf`)')
  }
  const mainDest = join(destDir, 'openvpn')
  copyFileSync(srcBin, mainDest)
  chmodSync(mainDest, 0o755)
  const ldd = sh('ldd', [srcBin])
  for (const line of ldd.split('\n')) {
    const m = line.match(/=>\s*(\/\S+)/)
    if (!m) continue
    const lib = m[1]
    // Skip the loader + core glibc (present on every target system).
    if (/\/(ld-linux|libc|libm|libpthread|libdl|librt|libresolv)\b/.test(lib)) continue
    if (lib.startsWith('/lib') || lib.startsWith('/usr/lib/x86_64-linux-gnu/libc')) continue
    const destLib = join(destDir, basename(lib))
    if (!existsSync(destLib)) copyFileSync(lib, destLib)
  }
  sh('patchelf', ['--set-rpath', '$ORIGIN', mainDest])
  return mainDest
}

// ── Windows: copy openvpn.exe + the DLLs sitting beside it ──────────────────
function winCopy(srcExe) {
  const destExe = join(destDir, 'openvpn.exe')
  copyFileSync(srcExe, destExe)
  const srcDir = dirname(srcExe)
  for (const f of readdirSync(srcDir)) {
    if (f.toLowerCase().endsWith('.dll')) copyFileSync(join(srcDir, f), join(destDir, f))
  }
  return destExe
}

// ── main ────────────────────────────────────────────────────────────────────
const src = locateSource()
info(`sourcing openvpn from: ${src}`)
resetDest()
let out
if (process.platform === 'darwin') out = macRelocate(src)
else if (process.platform === 'linux') out = linuxRelocate(src)
else if (process.platform === 'win32') out = winCopy(src)
else fail(`unsupported platform: ${process.platform}`)

// Smoke test: the relocated binary must at least report its version standalone.
const ver = spawnSync(out, ['--version'], { encoding: 'utf8' })
const first = (ver.stdout || ver.stderr || '').split('\n')[0]
info(`bundled → ${out}`)
info(`smoke test: ${first || '(no version output)'}  exit=${ver.status}`)
if (ver.status !== 0 && ver.status !== 1) {
  // openvpn --version exits 1 by design; anything else (e.g. a dyld load error) fails.
  fail('the bundled binary did not run standalone — check the library relocation above')
}
info('done.')
