// browser_tool AgentTool (ADR 0043) — lets the agent drive an embedded Chromium
// window. The tool runs in the sidecar (no Chromium here); it routes each action
// to the Electron main process over the reverse host-request channel
// (transport/stdio hostRequest → engine.ts → electron/browser.ts).
//
// Lean command set: navigate / click / fill / screenshot / extract. The URL for
// navigate is model output (L1) → SSRF-guarded with the shared assertSafeUrl
// (DNS-resolving). Screenshots are written to a file inside the workspace
// (invariant #2) and only the path is returned — raw PNG bytes never enter the
// model-facing tool text.

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { assertInsideWorkspace } from '../../git/path-sanitize.js'
import { hostRequest } from '../../transport/stdio.js'
import { assertSafeUrl } from './ssrf.js'

export const BROWSER_TOOL_NAME = 'browser_tool'

// Mutating actions that should be permission-gated (see runtime/permission.ts).
const MUTATING_ACTIONS = new Set(['navigate', 'click', 'fill'])

export function isMutatingBrowserAction(args: unknown): boolean {
  const action = (args as { action?: unknown } | null)?.action
  return typeof action === 'string' && MUTATING_ACTIONS.has(action)
}

const MAX_OUTPUT_CHARS = 50_000

const BrowserParams = Type.Object(
  {
    action: Type.Union(
      [
        Type.Literal('navigate'),
        Type.Literal('click'),
        Type.Literal('fill'),
        Type.Literal('screenshot'),
        Type.Literal('extract'),
      ],
      { description: 'The browser action to perform.' },
    ),
    url: Type.Optional(Type.String({ description: 'For navigate: absolute http/https URL.' })),
    selector: Type.Optional(Type.String({ description: 'CSS selector for click/fill/extract.' })),
    value: Type.Optional(Type.String({ description: 'For fill: the text to enter.' })),
    mode: Type.Optional(
      Type.Union([Type.Literal('text'), Type.Literal('dom')], {
        description: 'For extract: text (innerText) or dom (outerHTML). Default text.',
      }),
    ),
  },
  { additionalProperties: true },
)

interface BrowserDetails {
  action: string
  url?: string
  path?: string
}

function textResult(text: string, details: BrowserDetails): AgentToolResult<BrowserDetails> {
  return { content: [{ type: 'text', text }], details }
}

function requireString(value: unknown, action: string, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`browser_tool '${action}' requires '${key}'`)
  }
  return value
}

export function createBrowserTool(cwd: string): AgentTool<typeof BrowserParams, BrowserDetails> {
  return {
    name: BROWSER_TOOL_NAME,
    label: 'Browser',
    description:
      'Drive an embedded Chromium browser. Actions: navigate (open a URL), click (CSS selector), fill (selector + value), extract (page text or DOM), screenshot (saved to the workspace). Private/loopback URLs are blocked.',
    parameters: BrowserParams,
    async execute(_id, params): Promise<AgentToolResult<BrowserDetails>> {
      const action = params.action
      switch (action) {
        case 'navigate': {
          const url = requireString(params.url, action, 'url')
          await assertSafeUrl(url) // SSRF: protocol + literal host + DNS resolve
          const res = (await hostRequest('browser.navigate', { url })) as { url: string; title: string }
          return textResult(`Navigated to ${res.url} — "${res.title}"`, { action, url: res.url })
        }
        case 'click': {
          const selector = requireString(params.selector, action, 'selector')
          const res = (await hostRequest('browser.click', { selector })) as { found: boolean }
          return textResult(
            res.found ? `Clicked ${selector}` : `No element matched ${selector}`,
            { action },
          )
        }
        case 'fill': {
          const selector = requireString(params.selector, action, 'selector')
          const value = requireString(params.value, action, 'value')
          const res = (await hostRequest('browser.fill', { selector, value })) as { found: boolean }
          return textResult(
            res.found ? `Filled ${selector}` : `No element matched ${selector}`,
            { action },
          )
        }
        case 'extract': {
          const mode = params.mode === 'dom' ? 'dom' : 'text'
          const selector = typeof params.selector === 'string' ? params.selector : undefined
          const res = (await hostRequest('browser.extract', { mode, selector })) as { content: string }
          const body = res.content.length > MAX_OUTPUT_CHARS
            ? `${res.content.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`
            : res.content
          return textResult(body || '(no content)', { action })
        }
        case 'screenshot': {
          const res = (await hostRequest('browser.screenshot', {})) as {
            base64: string
            width: number
            height: number
          }
          if (!cwd) {
            return textResult(
              `Screenshot captured (${res.width}x${res.height}); no workspace to save it.`,
              { action },
            )
          }
          const relPath = `.awog/screenshots/screenshot-${Date.now()}.png`
          const abs = assertInsideWorkspace(cwd, relPath)
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, Buffer.from(res.base64, 'base64'))
          return textResult(`Saved screenshot to ${relPath} (${res.width}x${res.height})`, {
            action,
            path: relPath,
          })
        }
        default:
          throw new Error(`Unknown browser_tool action: ${String(action)}`)
      }
    },
  }
}
