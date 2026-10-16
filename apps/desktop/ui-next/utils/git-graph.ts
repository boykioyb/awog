// Xếp làn (lane) cho graph commit kiểu JetBrains / git log --graph — hàm thuần, có
// test (utils/__tests__/git-graph.test.mjs). Dùng ở tab Git Log của workbench.
//
// Đầu vào: commit theo thứ tự CON TRƯỚC CHA (git log --date-order bảo đảm điều đó).
// Mỗi làn là "dòng chờ" một sha: làn j đang đợi commit `lanes[j]` xuất hiện ở hàng
// dưới. Mỗi hàng sinh hai nửa đoạn nối:
//   upper — từ mép TRÊN hàng tới tâm: làn đang chờ chính commit này cong về node,
//           làn khác đi thẳng qua;
//   lower — từ tâm tới mép DƯỚI: node toả xuống các parent, làn khác đi thẳng tiếp.
// Làn giữ chỉ số ổn định (không nén), ô trống được tái dùng — nên đường đi qua luôn
// thẳng, chỉ chỗ rẽ nhánh / merge mới cong.

export type GraphCommit = { sha: string; parents: readonly string[] }

export type GraphSegment = { from: number; to: number; color: number }

export type GraphRow = {
  lane: number
  // Màu của node (= màu của làn nó nằm).
  color: number
  upper: GraphSegment[]
  lower: GraphSegment[]
  // Merge commit (≥ 2 parent) — node vẽ khác.
  merge: boolean
}

export type GraphLayout = { rows: GraphRow[]; width: number }

export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  // lanes[j] = sha làn j đang chờ (null = ô trống); colors[j] = màu đang gán cho làn.
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  let width = 0
  const rows: GraphRow[] = []

  const freeSlot = (): number => {
    const i = lanes.indexOf(null)
    if (i >= 0) return i
    lanes.push(null)
    colors.push(0)
    return lanes.length - 1
  }

  for (const c of commits) {
    // Làn của node: làn đầu tiên đang chờ sha này; không ai chờ (đầu một nhánh) ⇒ ô
    // trống mới, màu mới.
    let lane = lanes.indexOf(c.sha)
    if (lane < 0) {
      lane = freeSlot()
      colors[lane] = nextColor++
    }
    const color = colors[lane] ?? 0

    // ── Nửa trên: mọi làn đang sống trước hàng này ──
    const upper: GraphSegment[] = []
    lanes.forEach((sha, j) => {
      if (sha === null) return
      upper.push({ from: j, to: sha === c.sha ? lane : j, color: colors[j] ?? 0 })
    })
    // Các làn khác cũng đang chờ commit này (nhiều con hội về một cha) hợp vào node.
    lanes.forEach((sha, j) => {
      if (sha === c.sha && j !== lane) lanes[j] = null
    })

    // ── Parent: parent đầu tiếp tục làn của node; parent khác vào làn đang chờ nó,
    // không có thì mở làn mới (màu mới) ──
    const lower: GraphSegment[] = []
    const [first, ...rest] = c.parents
    lanes[lane] = first ?? null
    if (first !== undefined) lower.push({ from: lane, to: lane, color })
    for (const p of rest) {
      let k = lanes.indexOf(p)
      if (k < 0) {
        k = freeSlot()
        lanes[k] = p
        colors[k] = nextColor++
      }
      lower.push({ from: lane, to: k, color: colors[k] ?? 0 })
    }
    // Làn khác đi thẳng qua phần dưới.
    lanes.forEach((sha, j) => {
      if (sha === null || j === lane) return
      if (lower.some((s) => s.to === j && s.from === lane)) return
      lower.push({ from: j, to: j, color: colors[j] ?? 0 })
    })

    // Dọn ô trống ở đuôi để bề ngang không phình mãi.
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }

    const used = Math.max(
      lane,
      ...upper.map((s) => Math.max(s.from, s.to)),
      ...lower.map((s) => Math.max(s.from, s.to)),
    )
    width = Math.max(width, used + 1)
    rows.push({ lane, color, upper, lower, merge: c.parents.length > 1 })
  }
  return { rows, width }
}
