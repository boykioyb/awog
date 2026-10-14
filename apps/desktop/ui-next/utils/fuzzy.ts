// Fuzzy matcher dùng chung (bảng lệnh ⌘K + tìm file của Explorer Workbench).
// Không dùng thư viện ngoài: so khớp DÃY CON (ký tự của query xuất hiện theo thứ tự),
// cộng điểm cho chuỗi liền nhau và cho ký tự ngay sau dấu phân tách, nên "gs" xếp
// "Go to Sessions" cao và "wbm" khớp "useWorkbenchMenu".

export type FuzzyResult = { score: number; positions: number[] }

export function fuzzy(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return { score: 0, positions: [] }

  const positions: number[] = []
  let score = 0
  let ti = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti
        break
      }
    }
    if (found === -1) return null
    positions.push(found)
    // Thưởng chuỗi liền nhau + ký tự đầu từ (đầu chuỗi hoặc sau dấu phân tách).
    if (found === prevMatch + 1) score += 5
    const prevCh = found > 0 ? t[found - 1] : ' '
    if (prevCh === ' ' || prevCh === '/' || prevCh === '-' || prevCh === '_' || prevCh === '.')
      score += 8
    prevMatch = found
    ti = found + 1
  }
  // Ưu tiên chuỗi ngắn (mật độ khớp cao hơn).
  score += Math.max(0, 20 - target.length)
  return { score, positions }
}

// Khớp CHỈ theo TÊN FILE (phần sau dấu "/" cuối) — thư mục chứa không tham gia, nên
// "issue" không kéo theo mọi file nằm trong thư mục `issues/`. Tên bắt đầu bằng chữ đang
// gõ xếp cao hơn tên chỉ chứa nó. `positions` là chỉ số trong TÊN FILE để tô sáng.
export function scoreFileName(query: string, path: string): FuzzyResult | null {
  const q = query.trim()
  if (!q) return { score: 0, positions: [] }
  const base = path.slice(path.lastIndexOf('/') + 1)
  const m = fuzzy(q, base)
  if (!m) return null
  const prefix = base.toLowerCase().startsWith(q.toLowerCase()) ? 50 : 0
  return { score: m.score + prefix, positions: m.positions }
}

// Tách nhãn thành đoạn khớp / không khớp để tô sáng.
export type LabelSegment = { text: string; match: boolean }
export function highlightSegments(label: string, positions: number[]): LabelSegment[] {
  if (positions.length === 0) return [{ text: label, match: false }]
  const set = new Set(positions)
  const segs: LabelSegment[] = []
  let buf = ''
  let bufMatch = set.has(0)
  for (let i = 0; i < label.length; i++) {
    const ch = label[i] ?? ''
    const m = set.has(i)
    if (m === bufMatch) {
      buf += ch
    } else {
      if (buf) segs.push({ text: buf, match: bufMatch })
      buf = ch
      bufMatch = m
    }
  }
  if (buf) segs.push({ text: buf, match: bufMatch })
  return segs
}
