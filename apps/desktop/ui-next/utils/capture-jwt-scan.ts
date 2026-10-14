// Quét JWT trong một entry (URL, header, body text) để tab JWT của inspector hiển thị.
// Chỉ gom token; giải mã + kiểm `alg: none`/hết hạn là việc của `decodeJwt` (capture-export).

import type { CaptureEntry } from '~/types/network-capture'
import { findJwts } from '~/utils/capture-export'

export type JwtSource = 'url' | 'requestHeader' | 'responseHeader' | 'requestBody' | 'responseBody'
export type JwtHit = { source: JwtSource; name?: string; token: string }

export function jwtsInEntry(e: CaptureEntry): JwtHit[] {
  const hits: JwtHit[] = []
  const seen = new Set<string>()
  const scan = (source: JwtSource, text: string, name?: string): void => {
    for (const token of findJwts(text)) {
      if (seen.has(token)) continue
      seen.add(token)
      hits.push({ source, name, token })
    }
  }
  scan('url', e.url)
  for (const [k, v] of e.requestHeaders) scan('requestHeader', v, k)
  for (const [k, v] of e.responseHeaders) scan('responseHeader', v, k)
  if (e.requestBody && !e.requestBody.base64) scan('requestBody', e.requestBody.text)
  if (e.responseBody && !e.responseBody.base64) scan('responseBody', e.responseBody.text)
  return hits
}
