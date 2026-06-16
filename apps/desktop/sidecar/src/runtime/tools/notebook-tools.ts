// Jupyter notebook (.ipynb) AgentTools for the Pi runtime — NotebookRead +
// NotebookEdit, mirroring the Claude Code built-ins so the OAuth model can edit
// notebooks instead of hitting "Tool not found". All I/O is gated by
// assertInsideWorkspace (security invariant #2) and scoped to the session cwd.
//
// nbformat: a cell's `source` may be a string OR an array of lines (Jupyter
// stores arrays, each line keeping its trailing "\n" except the last). We read
// both shapes and write back the line-array shape Jupyter expects, preserving
// the rest of the notebook structure (metadata/outputs/nbformat) untouched.

import { readFile, writeFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertInsideWorkspace } from '../../git/path-sanitize.js'

const SOURCE_PREVIEW_MAX = 4_000
const OUTPUT_PREVIEW_MAX = 1_000
const READ_MAX_CHARS = 100_000

type NotebookCell = {
  cell_type: string
  id?: string
  source: string | string[]
  metadata?: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
}

type Notebook = {
  cells: NotebookCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

type NotebookDetails = { path: string }

function textResult(text: string, path: string): AgentToolResult<NotebookDetails> {
  return { content: [{ type: 'text', text }], details: { path } }
}

function isCell(value: unknown): value is NotebookCell {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return typeof c.cell_type === 'string' && (typeof c.source === 'string' || Array.isArray(c.source))
}

// Parse + validate the .ipynb JSON at the boundary (L1 file input).
async function loadNotebook(absPath: string, relPath: string): Promise<Notebook> {
  const raw = await readFile(absPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Not valid JSON: ${relPath}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { cells?: unknown }).cells)) {
    throw new Error(`Not a valid notebook (missing cells array): ${relPath}`)
  }
  const nb = parsed as Notebook
  if (!nb.cells.every(isCell)) throw new Error(`Notebook has malformed cells: ${relPath}`)
  return nb
}

function sourceToString(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source
}

// Jupyter stores `source` as an array where each line keeps its trailing "\n"
// except the last. Reproduce that so diffs against Jupyter-saved files stay clean.
function stringToSourceLines(text: string): string[] {
  if (text === '') return []
  const parts = text.split('\n')
  const lines = parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line))
  // Drop the trailing empty element produced when text ends with "\n".
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// Resolve a cell by its nbformat `id`, falling back to a 0-based index when
// cell_id is a plain integer (older notebooks lack ids).
function findCellIndex(nb: Notebook, cellId: string): number {
  const byId = nb.cells.findIndex((c) => c.id === cellId)
  if (byId !== -1) return byId
  if (/^\d+$/.test(cellId)) {
    const idx = Number(cellId)
    if (idx >= 0 && idx < nb.cells.length) return idx
  }
  return -1
}

function summarizeOutputs(outputs: unknown[] | undefined): string {
  if (!outputs || outputs.length === 0) return ''
  const parts: string[] = []
  for (const out of outputs) {
    if (typeof out !== 'object' || out === null) continue
    const o = out as Record<string, unknown>
    const kind = typeof o.output_type === 'string' ? o.output_type : 'output'
    if (kind === 'stream') {
      parts.push(`[stream ${String(o.name ?? '')}] ${sourceToString((o.text as string | string[]) ?? '')}`)
    } else if (kind === 'error') {
      parts.push(`[error] ${String(o.ename ?? '')}: ${String(o.evalue ?? '')}`)
    } else if (o.data && typeof o.data === 'object') {
      parts.push(`[${kind}] ${Object.keys(o.data as Record<string, unknown>).join(', ')}`)
    } else {
      parts.push(`[${kind}]`)
    }
  }
  const joined = parts.join('\n')
  return joined.length > OUTPUT_PREVIEW_MAX ? `${joined.slice(0, OUTPUT_PREVIEW_MAX)}\n…(truncated)` : joined
}

function renderCell(cell: NotebookCell, index: number): string {
  const id = cell.id ?? String(index)
  const src = sourceToString(cell.source)
  const srcClipped = src.length > SOURCE_PREVIEW_MAX ? `${src.slice(0, SOURCE_PREVIEW_MAX)}\n…(truncated)` : src
  const header = `── Cell ${index} [${cell.cell_type}] id=${id} ──`
  const outputs = cell.cell_type === 'code' ? summarizeOutputs(cell.outputs) : ''
  return [header, srcClipped, outputs ? `--- outputs ---\n${outputs}` : ''].filter(Boolean).join('\n')
}

// ─── NotebookRead ─────────────────────────────────────────────────────────────
const NotebookReadParams = Type.Object({
  notebook_path: Type.String({ description: 'Absolute or workspace-relative .ipynb path.' }),
  cell_id: Type.Optional(Type.String({ description: 'Read only this cell (by id or index). Omit for all cells.' })),
})

export function createNotebookReadTool(cwd: string): AgentTool<typeof NotebookReadParams, NotebookDetails> {
  return {
    name: 'NotebookRead',
    label: 'Read notebook',
    description: 'Read a Jupyter notebook (.ipynb): returns its cells with source and a summary of outputs.',
    parameters: NotebookReadParams,
    async execute(_id, params): Promise<AgentToolResult<NotebookDetails>> {
      const abs = assertInsideWorkspace(cwd, params.notebook_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.notebook_path}`)
      const nb = await loadNotebook(abs, params.notebook_path)
      if (params.cell_id !== undefined) {
        const idx = findCellIndex(nb, params.cell_id)
        if (idx === -1) throw new Error(`Cell not found: ${params.cell_id}`)
        return textResult(renderCell(nb.cells[idx], idx), params.notebook_path)
      }
      const body = nb.cells.map((c, i) => renderCell(c, i)).join('\n\n')
      const text = body.length > READ_MAX_CHARS ? `${body.slice(0, READ_MAX_CHARS)}\n…(truncated)` : body
      return textResult(text || '(empty notebook)', params.notebook_path)
    },
  }
}

// ─── NotebookEdit ─────────────────────────────────────────────────────────────
const NotebookEditParams = Type.Object({
  notebook_path: Type.String({ description: 'Absolute or workspace-relative .ipynb path.' }),
  new_source: Type.String({ description: 'New cell source (full replacement / inserted content).' }),
  cell_id: Type.Optional(
    Type.String({
      description:
        'Target cell id (or index). For insert: the new cell goes AFTER this one (omit to prepend). Required for replace/delete.',
    }),
  ),
  cell_type: Type.Optional(
    Type.Union([Type.Literal('code'), Type.Literal('markdown')], {
      description: 'Cell type. Required for insert; for replace it changes the type if given.',
    }),
  ),
  edit_mode: Type.Optional(
    Type.Union([Type.Literal('replace'), Type.Literal('insert'), Type.Literal('delete')], {
      description: 'replace (default) | insert | delete.',
    }),
  ),
})

function makeCell(cellType: 'code' | 'markdown', source: string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    id: randomUUID().slice(0, 8),
    metadata: {},
    source: stringToSourceLines(source),
  }
  if (cellType === 'code') {
    cell.outputs = []
    cell.execution_count = null
  }
  return cell
}

export function createNotebookEditTool(cwd: string): AgentTool<typeof NotebookEditParams, NotebookDetails> {
  return {
    name: 'NotebookEdit',
    label: 'Edit notebook',
    description:
      'Edit a Jupyter notebook (.ipynb) cell: replace a cell source, insert a new cell, or delete a cell. Preserves the rest of the notebook structure.',
    parameters: NotebookEditParams,
    async execute(_id, params): Promise<AgentToolResult<NotebookDetails>> {
      const abs = assertInsideWorkspace(cwd, params.notebook_path)
      const st = await stat(abs)
      if (st.isDirectory()) throw new Error(`Path is a directory: ${params.notebook_path}`)
      const nb = await loadNotebook(abs, params.notebook_path)
      const mode = params.edit_mode ?? 'replace'

      if (mode === 'insert') {
        if (!params.cell_type) throw new Error('cell_type is required for insert')
        const cell = makeCell(params.cell_type, params.new_source)
        if (params.cell_id === undefined) {
          nb.cells.unshift(cell)
        } else {
          const idx = findCellIndex(nb, params.cell_id)
          if (idx === -1) throw new Error(`Cell not found: ${params.cell_id}`)
          nb.cells.splice(idx + 1, 0, cell)
        }
      } else {
        if (params.cell_id === undefined) throw new Error(`cell_id is required for ${mode}`)
        const idx = findCellIndex(nb, params.cell_id)
        if (idx === -1) throw new Error(`Cell not found: ${params.cell_id}`)
        if (mode === 'delete') {
          nb.cells.splice(idx, 1)
        } else {
          const cell = nb.cells[idx]
          cell.source = stringToSourceLines(params.new_source)
          if (params.cell_type) cell.cell_type = params.cell_type
        }
      }

      await writeFile(abs, `${JSON.stringify(nb, null, 1)}\n`, 'utf8')
      return textResult(`${mode} on ${params.notebook_path} (now ${nb.cells.length} cells)`, params.notebook_path)
    },
  }
}
