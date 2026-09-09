// Derive the "media · links · docs" index of ONE session — everything that flowed
// through its transcript, grouped the way a chat app's info panel groups it
// (WhatsApp's "Media, links and docs"). Feeds the Info tab section of the same name.
//
// Sources (all derived from the transcript already in memory — no IPC, no fs here):
//   - attachment : files/images the user attached to a turn (dropped folders are
//                  skipped — the Context files section already lists the cwd)
//   - written    : files the session wrote/edited (its Write/Edit steps)
//   - shared     : files the model handed over (send_user_file → FilesBlock)
//   - links      : http(s) URLs in any message text, in a tool step's target
//                  (WebFetch/WebSearch), plus the session's linked issue/PR
//
// A file lands in Media (image/video/audio, by the preview kind usePreview already
// owns) or Docs (a document a person READS — see DOC_EXT). A source/config file is
// neither, so it is not listed at all: the files a session wrote are the Diff and
// Files tabs' job, and an attached one is a Context files row right above this
// section. Listing `repository.py` under "Docs" was just the label lying.
// Order is newest-first — the most recent turn is what a user is looking for.
//
// SoC: pure derivation + the open wiring. Files open through the SHARED preview
// infrastructure (attachments inline, workspace files via useFilePreview so the
// root resolution + image gallery stay in one place); links open in the OS browser.

import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import type { Session, SessionAttachment } from '~/composables/useSessionsData'
import {
  usePreview,
  previewKindFromPath,
  previewRefFromAttachment,
  imageSiblingsFromAttachments,
} from '~/composables/usePreview'
import { useFilePreview } from '~/composables/useFilePreview'
import { WRITE_LABELS, workspaceRelative } from '~/composables/useSessionTouchedPaths'

export type SessionFileOrigin = 'attachment' | 'written' | 'shared'
export type SessionFileItem = {
  key: string
  name: string
  origin: SessionFileOrigin
  // Media (image/video/audio) → the Media grid; everything else → the Docs list.
  isMedia: boolean
  // Image kind specifically: only these get a thumbnail in the grid.
  isImage: boolean
  // Subtitle: the workspace-relative path, or the attachment name when there is none.
  detail: string
  size?: number
  at?: string
  // Exactly one of the two is set: a workspace file (path) or an in-memory attachment.
  path?: string
  att?: SessionAttachment
}

export type SessionLinkOrigin = 'message' | 'tool' | 'about'
export type SessionLinkItem = {
  key: string
  url: string
  // What the row shows: a markdown link's own text when the URL was written as
  // `[title](url)`, else the URL's path (or its host, for a bare origin).
  label: string
  host: string
  origin: SessionLinkOrigin
  at?: string
}

// What "Docs" promises: prose, tables, slides, notebooks — things opened to be read,
// not compiled. Deliberately closed: an unknown extension is NOT a document.
const DOC_EXT = /\.(md|markdown|mdx|txt|rtf|pdf|csv|tsv|docx?|dotx|xlsx?|xlsm|pptx?|ipynb|html?)$/i

// Which bucket a file belongs to, or null when it belongs to neither.
type FileBucket = { isMedia: boolean; isImage: boolean }
function bucketOf(name: string, forceImage = false): FileBucket | null {
  const kind = forceImage ? 'image' : previewKindFromPath(name)
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    return { isMedia: true, isImage: kind === 'image' }
  }
  return DOC_EXT.test(name) ? { isMedia: false, isImage: false } : null
}

// Bare URL, same shape SessionLinkedText uses for the transcript — plus the backtick,
// which closes an inline-code span (`https://…/login`) and is never part of the URL.
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g
// `[title](url)` — the title is the better row label when the model wrote one.
const MD_LINK_RE = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g
// Trailing sentence punctuation (and a closing backtick) is not part of the URL.
const trimUrl = (u: string): string => u.replace(/[.,;:!?)\]}'"`]+$/, '')

// Bound the walk: a very long session should not turn the Info tab into a wall.
const MAX_FILES = 400
const MAX_LINKS = 400

const baseName = (p: string): string => p.split('/').pop() || p

export function useSessionMediaIndex(
  session: MaybeRefOrGetter<Session>,
  root: MaybeRefOrGetter<string | null>,
) {
  const { open: openPreview } = usePreview()
  const filePreview = useFilePreview()

  // One pass over the transcript producing both lists, oldest → newest; the
  // getters below reverse them so the newest item is on top.
  const index = computed<{ files: SessionFileItem[]; links: SessionLinkItem[] }>(() => {
    const s = toValue(session)
    const files: SessionFileItem[] = []
    const links: SessionLinkItem[] = []
    const seenFile = new Set<string>()
    const seenLink = new Set<string>()

    const addFile = (item: SessionFileItem): void => {
      if (files.length >= MAX_FILES || seenFile.has(item.key)) return
      seenFile.add(item.key)
      files.push(item)
    }
    const addPathFile = (path: string, origin: SessionFileOrigin, at?: string, size?: number) => {
      const rel = workspaceRelative(path, toValue(root))
      if (!rel) return
      const bucket = bucketOf(rel)
      if (!bucket) return // source/config file — not media, not a document
      addFile({
        key: `p:${rel}`,
        name: baseName(rel),
        origin,
        ...bucket,
        detail: rel,
        ...(size != null ? { size } : {}),
        ...(at ? { at } : {}),
        path: rel,
      })
    }
    const addLink = (url: string, origin: SessionLinkOrigin, at?: string, title?: string) => {
      // `…/issues/86` and `…/issues/86/` are one link, not two.
      const clean = trimUrl(url).replace(/\/+$/, '')
      if (links.length >= MAX_LINKS || !clean || seenLink.has(clean)) return
      let host = ''
      let path = ''
      try {
        const u = new URL(clean)
        host = u.host
        // The #hash stays in the label: two links to the same issue, one pointing at a
        // comment, are different links and must not render as two identical rows.
        path = `${u.pathname}${u.search}${u.hash}`.replace(/\/(?=$|#)/, '')
      } catch {
        return // not a URL we can present — skip rather than show a broken row
      }
      seenLink.add(clean)
      links.push({
        key: clean,
        url: clean,
        label: title?.trim() || (path && path !== '/' ? path.replace(/^\//, '') : host),
        host,
        origin,
        ...(at ? { at } : {}),
      })
    }
    // Markdown links first (they carry a title), then whatever bare URLs remain.
    const scanText = (text: string, at?: string): void => {
      if (!text) return
      let rest = text
      for (const m of text.matchAll(MD_LINK_RE)) {
        addLink(m[2] ?? '', 'message', at, m[1])
        rest = rest.replace(m[0], ' ')
      }
      for (const m of rest.matchAll(URL_RE)) addLink(m[0], 'message', at)
    }

    for (const m of s.msgs) {
      if (m.role === 'user') {
        scanText(m.text, m.at)
        for (const a of m.att ?? []) {
          if (a.folder) continue // the working folder is a Context files row
          const bucket = bucketOf(a.name, a.img)
          if (!bucket) continue // e.g. a dropped .py — it is a Context files row
          addFile({
            key: `a:${a.name}::${a.size ?? ''}`,
            name: a.name,
            origin: 'attachment',
            ...bucket,
            detail: a.name,
            ...(a.size != null ? { size: a.size } : {}),
            ...(m.at ? { at: m.at } : {}),
            att: a,
          })
        }
        continue
      }
      if (m.role === 'system') {
        scanText(m.text, m.at)
        continue
      }
      for (const b of m.blocks) {
        if (b.kind === 'text') scanText(b.text, m.at)
        else if (b.kind === 'files') {
          for (const f of b.files) addPathFile(f.path, 'shared', m.at, f.size)
        } else if (b.kind === 'step') {
          if (WRITE_LABELS.has(b.tool)) addPathFile(b.target, 'written', m.at)
          else if (/^https?:\/\//i.test(b.target)) addLink(b.target, 'tool', m.at)
          for (const sub of b.sub?.steps ?? []) {
            if (WRITE_LABELS.has(sub.tool)) addPathFile(sub.target, 'written', m.at)
            else if (/^https?:\/\//i.test(sub.target)) addLink(sub.target, 'tool', m.at)
          }
        }
      }
    }
    // The linked issue/PR is session metadata, not transcript text — add it last so
    // it sits at the TOP of the newest-first list, where the session is "about" it.
    if (s.aboutGhUrl) addLink(s.aboutGhUrl, 'about')

    return { files, links }
  })

  // ── existence gate ──────────────────────────────────────────────────────────
  // A step NAMING a file is not proof of a file: the model anchors paths at the wrong
  // base, writes then deletes, or names a file it never wrote. Listing those gave rows
  // that open nothing, so every workspace path is checked against the real filesystem
  // (`verifyPaths`) and either corrected to its true path or dropped. Attachments carry
  // their own bytes — there is nothing to check.
  //
  // A path not yet checked stays VISIBLE: the check is one directory listing per
  // directory and lands in the same breath, and hiding first would blank a list that is
  // usually entirely valid. Only a checked miss removes a row.
  const verified = ref<Record<string, string | null>>({})
  const pathsKey = computed(() => index.value.files.map((f) => f.path ?? '').join('\n'))
  let verifyToken = 0
  async function runVerify(): Promise<void> {
    const token = ++verifyToken
    const paths = index.value.files.flatMap((f) => (f.path ? [f.path] : []))
    if (!paths.length) {
      verified.value = {}
      return
    }
    const checked = await filePreview.verifyPaths(paths)
    if (token !== verifyToken) return // a newer pass started while this one was in flight
    verified.value = Object.fromEntries(checked)
  }
  // Re-check when the set of paths changes, and again at every turn boundary — the turn
  // that just ended may have deleted a file that was real when we last looked
  // (`imagesVersion` is bumped there, after the directory cache is dropped).
  watch([pathsKey, filePreview.imagesVersion], () => void runVerify(), { immediate: true })

  // The index as it should be SHOWN: corrected paths, phantom rows dropped, and two
  // written paths that turned out to be the same real file merged into one row.
  const presentFiles = computed<SessionFileItem[]>(() => {
    const out: SessionFileItem[] = []
    const seen = new Set<string>()
    for (const f of index.value.files) {
      if (!f.path) {
        out.push(f) // attachment
        continue
      }
      const real = verified.value[f.path]
      if (real === null) continue // checked: no such file
      const path = real ?? f.path // undefined = not checked yet → show as written
      if (seen.has(path)) continue
      seen.add(path)
      out.push(path === f.path ? f : { ...f, path, detail: path, name: baseName(path) })
    }
    return out
  })

  const media = computed<SessionFileItem[]>(() =>
    presentFiles.value.filter((f) => f.isMedia).reverse(),
  )
  const docs = computed<SessionFileItem[]>(() =>
    presentFiles.value.filter((f) => !f.isMedia).reverse(),
  )
  const links = computed<SessionLinkItem[]>(() => [...index.value.links].reverse())

  // Attachments currently listed as media — the gallery an attachment preview steps
  // through, so ‹ › walks this panel's set, not a folder on disk.
  const mediaAttachments = (): SessionAttachment[] =>
    media.value.flatMap((f) => (f.att ? [f.att] : []))

  function openFile(item: SessionFileItem): void {
    if (item.att) {
      openPreview(
        previewRefFromAttachment(item.att),
        imageSiblingsFromAttachments(mediaAttachments()),
      )
      return
    }
    // Workspace file: useFilePreview resolves the root, matches the real path and
    // hands an image its session gallery.
    if (item.path) filePreview.open(item.path)
  }

  function openLink(item: SessionLinkItem): void {
    void useLinkOpen().openLink(item.url)
  }

  return { media, docs, links, openFile, openLink }
}
