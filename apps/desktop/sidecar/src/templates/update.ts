// Cập nhật một template đã cài từ nguồn GitHub của nó (WP10) — biến bundle
// "import một lần" thành plugin cài lại được.
//
// Mô hình 3 phía, so bằng **git blob SHA-1** (xem install-meta.ts):
//
//   baseline  — nội dung NGUỒN tại lần đồng bộ gần nhất (`.install.json`)
//   disk      — nội dung đang nằm trên đĩa
//   remote    — nguồn BÂY GIỜ, lấy từ `sha` trong tree GitHub (KHÔNG tải blob)
//
//   remote ≠ baseline            ⇒ nguồn có bản mới cho entity đó  (status)
//   disk   ≠ baseline            ⇒ người dùng đã sửa cục bộ        (localModified)
//   cả hai cùng đúng             ⇒ **xung đột** — KHÔNG bao giờ ghi đè im lặng,
//                                  phải có quyết định keepLocal / takeRemote.
//
// Áp dụng luôn dựng bundle mới trong thư mục tạm rồi đổi chỗ bằng rename
// (`swapBundle`), nên hỏng giữa chừng không để lại trạng thái nửa vời.

import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { sanitizeChild } from '../util/path.js'
import {
  entityFiles,
  entityKeyOf,
  hashBundleFiles,
  pickHashes,
  readInstallMeta,
  sameHashes,
  type HashMap,
  type TemplateInstallMeta,
} from './install-meta.js'
import {
  bundleUrl,
  downloadFilesInto,
  finalizeBundleDir,
  planSingleBundle,
  type PlannedBundle,
  type PlannedFile,
} from './remote.js'
import { getTemplate, isInside, stagingDir, swapBundle, templateDir } from './store.js'
import type { ConfigKind, ProjectTemplate, TemplateEntityRef } from '../types/shared.js'

// ─── Contract ───────────────────────────────────────────────────────────────

export type TemplateEntityStatus = 'added' | 'changed' | 'removed' | 'unchanged'

export interface TemplateEntityDiff {
  kind: ConfigKind
  id: string
  status: TemplateEntityStatus
  // File của entity trên đĩa khác bản đã cài ⇒ người dùng sửa tay.
  localModified: boolean
  // Vừa sửa cục bộ vừa bị nguồn đổi/xoá ⇒ cần người dùng chọn.
  conflict: boolean
}

export interface TemplateUpdateCheck {
  id: string
  // Bundle có `.install.json` hợp lệ (export tại chỗ thì không) — không có thì
  // không có nguồn để hỏi.
  hasRemote: boolean
  hasUpdate: boolean
  conflicts: number
  currentVersion?: string
  remoteVersion?: string
  sourceUrl?: string
  sourceRef?: string
  installedAt?: string
  checkedAt: string
  entities: TemplateEntityDiff[]
}

export type ConflictChoice = 'keepLocal' | 'takeRemote'

export interface TemplateUpdateResolution {
  kind: ConfigKind
  id: string
  choice: ConflictChoice
}

export type TemplateEntityAction = 'added' | 'updated' | 'removed' | 'keptLocal'

export interface TemplateEntityChange {
  kind: ConfigKind
  id: string
  action: TemplateEntityAction
}

export type TemplateUpdateResult =
  | { status: 'no-remote' }
  | { status: 'up-to-date' }
  // Còn xung đột chưa có quyết định ⇒ KHÔNG ghi gì cả.
  | { status: 'conflicts'; conflicts: TemplateEntityDiff[] }
  | { status: 'updated'; version?: string; applied: TemplateEntityChange[] }

// ─── Diff ───────────────────────────────────────────────────────────────────

function remoteHashes(bundle: PlannedBundle, key: string): HashMap {
  const out: HashMap = {}
  for (const f of bundle.files) if (f.entityKey === key) out[f.relPath] = f.sha
  return out
}

interface DiffContext {
  diffs: TemplateEntityDiff[]
  // Tính một lần, dùng lại ở bước áp dụng.
  localRefs: Map<string, TemplateEntityRef>
  remoteRefs: Map<string, TemplateEntityRef>
  localFiles: Map<string, string[]>
  // Entity nguồn đã bỏ nhưng người dùng từng chọn giữ ⇒ thuần local, không còn
  // nằm trong hợp đồng đồng bộ (không báo "removed" nữa) nhưng vẫn ở lại bundle.
  localOnly: TemplateEntityRef[]
}

async function diffBundle(
  local: ProjectTemplate,
  meta: TemplateInstallMeta,
  bundle: PlannedBundle,
): Promise<DiffContext> {
  const dir = templateDir(local.id)
  const diskHashes = await hashBundleFiles(dir)

  const localRefs = new Map<string, TemplateEntityRef>()
  const localFiles = new Map<string, string[]>()
  for (const ref of local.entities) {
    const key = entityKeyOf(ref.kind, ref.id)
    localRefs.set(key, ref)
    // eslint-disable-next-line no-await-in-loop
    localFiles.set(key, await entityFiles(dir, ref.file))
  }

  const remoteRefs = new Map<string, TemplateEntityRef>()
  for (const ref of bundle.entities) remoteRefs.set(entityKeyOf(ref.kind, ref.id), ref)

  const baselineOf = (key: string): HashMap => meta.entities[key] ?? {}
  const isLocalModified = (key: string): boolean =>
    !sameHashes(pickHashes(diskHashes, localFiles.get(key) ?? []), baselineOf(key))

  const diffs: TemplateEntityDiff[] = []
  const localOnly: TemplateEntityRef[] = []

  for (const [key, ref] of remoteRefs) {
    if (!localRefs.has(key)) {
      diffs.push({
        kind: ref.kind,
        id: ref.id,
        status: 'added',
        localModified: false,
        conflict: false,
      })
      continue
    }
    const localModified = isLocalModified(key)
    const status: TemplateEntityStatus = sameHashes(remoteHashes(bundle, key), baselineOf(key))
      ? 'unchanged'
      : 'changed'
    diffs.push({
      kind: ref.kind,
      id: ref.id,
      status,
      localModified,
      conflict: localModified && status === 'changed',
    })
  }

  for (const [key, ref] of localRefs) {
    if (remoteRefs.has(key)) continue
    // Không còn liên hệ với nguồn (đã chọn giữ ở lần trước) ⇒ để yên.
    if (Object.keys(baselineOf(key)).length === 0) {
      localOnly.push(ref)
      continue
    }
    const localModified = isLocalModified(key)
    diffs.push({
      kind: ref.kind,
      id: ref.id,
      status: 'removed',
      localModified,
      conflict: localModified,
    })
  }

  diffs.sort((a, b) => entityKeyOf(a.kind, a.id).localeCompare(entityKeyOf(b.kind, b.id)))
  return { diffs, localRefs, remoteRefs, localFiles, localOnly }
}

function hasRealChange(diffs: TemplateEntityDiff[]): boolean {
  return diffs.some((d) => d.status !== 'unchanged')
}

// ─── templates.checkUpdate ──────────────────────────────────────────────────

export async function checkTemplateUpdate(id: string): Promise<TemplateUpdateCheck> {
  const local = await getTemplate(id)
  if (!local) throw new RpcError(-32602, `Template not found: ${id}`)
  const meta = await readInstallMeta(templateDir(id))
  const checkedAt = new Date().toISOString()
  if (!meta) return { id, hasRemote: false, hasUpdate: false, conflicts: 0, checkedAt, entities: [] }

  const { bundle } = await planSingleBundle(meta.sourceUrl)
  const { diffs } = await diffBundle(local, meta, bundle)
  return {
    id,
    hasRemote: true,
    hasUpdate: hasRealChange(diffs),
    conflicts: diffs.filter((d) => d.conflict).length,
    ...(local.version ? { currentVersion: local.version } : {}),
    ...(bundle.version ? { remoteVersion: bundle.version } : {}),
    sourceUrl: meta.sourceUrl,
    sourceRef: meta.sourceRef,
    installedAt: meta.installedAt,
    checkedAt,
    entities: diffs,
  }
}

// ─── templates.update ───────────────────────────────────────────────────────

// Sao chép file của một entity từ bundle hiện tại sang thư mục dựng tạm, giữ
// nguyên cây thư mục. Path đi qua sanitizeChild + isInside (invariant #2).
async function copyLocalEntity(
  fromDir: string,
  toDir: string,
  files: string[],
): Promise<void> {
  for (const rel of files) {
    const src = join(fromDir, ...rel.split('/').map(sanitizeChild))
    const dest = join(toDir, ...rel.split('/').map(sanitizeChild))
    if (!isInside(src, fromDir) || !isInside(dest, toDir))
      throw new RpcError(-32010, `unsafe path: ${rel}`)
    // eslint-disable-next-line no-await-in-loop
    await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
    // eslint-disable-next-line no-await-in-loop
    await cp(src, dest, { recursive: false, force: true, dereference: false })
  }
}

export async function updateTemplate(
  id: string,
  resolutions: TemplateUpdateResolution[],
): Promise<TemplateUpdateResult> {
  const local = await getTemplate(id)
  if (!local) throw new RpcError(-32602, `Template not found: ${id}`)
  const meta = await readInstallMeta(templateDir(id))
  if (!meta) return { status: 'no-remote' }

  // Tính lại diff ngay trước khi ghi: nguồn có thể đã đổi kể từ lúc check.
  const { ref, bundle } = await planSingleBundle(meta.sourceUrl)
  const ctx = await diffBundle(local, meta, bundle)
  if (!hasRealChange(ctx.diffs)) return { status: 'up-to-date' }

  const choiceBy = new Map<string, ConflictChoice>()
  for (const r of resolutions) choiceBy.set(entityKeyOf(r.kind, r.id), r.choice)

  const unresolved = ctx.diffs.filter((d) => d.conflict && !choiceBy.has(entityKeyOf(d.kind, d.id)))
  if (unresolved.length > 0) return { status: 'conflicts', conflicts: unresolved }

  // ── Lên kế hoạch: mỗi entity lấy từ nguồn hay giữ bản local ──
  const fromDir = templateDir(id)
  const takeRemote: TemplateEntityRef[] = []
  // Entity giữ bản local + baseline nguồn tương ứng ({} = thuần local).
  const keepLocal: { ref: TemplateEntityRef; baseline: HashMap }[] = []
  const applied: TemplateEntityChange[] = []

  // Entity nguồn đã bỏ mà lần trước người dùng chọn giữ: mang sang nguyên trạng.
  for (const ref of ctx.localOnly) keepLocal.push({ ref, baseline: {} })

  for (const d of ctx.diffs) {
    const key = entityKeyOf(d.kind, d.id)
    const choice = choiceBy.get(key)
    const localRef = ctx.localRefs.get(key)
    const remoteRef = ctx.remoteRefs.get(key)

    if (d.status === 'removed') {
      // Nguồn bỏ entity. Người dùng đã sửa + chọn giữ ⇒ ở lại bundle, từ nay là
      // entity thuần local (baseline rỗng) nên lần sau không hỏi lại.
      if (d.conflict && choice === 'keepLocal' && localRef) {
        keepLocal.push({ ref: localRef, baseline: {} })
        applied.push({ kind: d.kind, id: d.id, action: 'keptLocal' })
      } else {
        applied.push({ kind: d.kind, id: d.id, action: 'removed' })
      }
      continue
    }

    if (!remoteRef) continue
    const baseline = remoteHashes(bundle, key)
    // Nguồn không đổi ⇒ giữ nguyên file trên đĩa (bằng bản nguồn nếu người dùng
    // chưa sửa; đã sửa thì cũng không có lý do gì để đụng vào).
    // Nguồn có đổi ⇒ chỉ giữ local khi người dùng chọn keepLocal cho xung đột.
    let keep = false
    if (d.status === 'unchanged') keep = !!localRef
    else if (d.conflict) keep = choice === 'keepLocal'

    if (keep && localRef) {
      keepLocal.push({ ref: localRef, baseline })
      if (d.status !== 'unchanged') applied.push({ kind: d.kind, id: d.id, action: 'keptLocal' })
      continue
    }
    takeRemote.push(remoteRef)
    applied.push({ kind: d.kind, id: d.id, action: d.status === 'added' ? 'added' : 'updated' })
  }

  // ── Dựng bundle mới trong thư mục tạm rồi mới đổi chỗ ──
  const takeKeys = new Set(takeRemote.map((r) => entityKeyOf(r.kind, r.id)))
  const downloads: PlannedFile[] = bundle.files.filter((f) => takeKeys.has(f.entityKey))

  const staging = stagingDir(id)
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    for (const item of keepLocal) {
      const key = entityKeyOf(item.ref.kind, item.ref.id)
      // eslint-disable-next-line no-await-in-loop
      await copyLocalEntity(fromDir, staging, ctx.localFiles.get(key) ?? [])
    }
    await downloadFilesInto(ref, downloads, staging)

    // Manifest mới = entity lấy từ nguồn + entity giữ local. Bản giữ local mang
    // path CỦA NÓ (nguồn có thể đã đổi chỗ file).
    const entities: TemplateEntityRef[] = [...takeRemote, ...keepLocal.map((k) => k.ref)].sort(
      (a, b) => entityKeyOf(a.kind, a.id).localeCompare(entityKeyOf(b.kind, b.id)),
    )

    // Baseline mới = ảnh chụp NGUỒN lúc này cho mọi entity còn liên hệ với nguồn
    // (kể cả bản người dùng chọn giữ local — nhờ vậy nó vẫn ở trạng thái "đã sửa"
    // và lần nguồn đổi tiếp sẽ hỏi lại thay vì âm thầm đè). Entity thuần local
    // nhận baseline rỗng.
    const baselines: Record<string, HashMap> = {}
    for (const entity of entities) {
      const key = entityKeyOf(entity.kind, entity.id)
      const kept = keepLocal.find((k) => entityKeyOf(k.ref.kind, k.ref.id) === key)
      baselines[key] = kept ? kept.baseline : remoteHashes(bundle, key)
    }

    const template: ProjectTemplate & { version?: string } = {
      id,
      name: bundle.name || local.name,
      description: bundle.description || local.description,
      createdAt: local.createdAt || new Date().toISOString(),
      ...(bundle.version ? { version: bundle.version } : {}),
      ...(local.sourceProjectId ? { sourceProjectId: local.sourceProjectId } : {}),
      entities,
    }
    await finalizeBundleDir(staging, template, {
      sourceUrl: bundleUrl(ref, bundle.bundleDir),
      sourceRef: ref.ref,
      ...(bundle.version ? { version: bundle.version } : {}),
      // Trang chủ đến từ danh mục chứ không từ bundle, nên bước cập nhật không
      // đọc lại được — mang nguyên từ `.install.json` cũ sang, kẻo cập nhật một
      // phát là mất field (nó đã qua `safeHomepage` lúc đọc).
      ...(meta.homepage ? { homepage: meta.homepage } : {}),
      entities: baselines,
    })
    await swapBundle(staging, id)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }

  log.info('templates: updated from source', {
    id,
    version: bundle.version,
    applied: applied.length,
  })
  return { status: 'updated', ...(bundle.version ? { version: bundle.version } : {}), applied }
}
