// Đọc thông tin kế hoạch của issue/PR trên GitHub cho sidebar issue của board
// (docs/features/session-issue-tracking.md §3.6): milestone (+ hạn của nó), sprint =
// field Iteration của GitHub Projects v2, và các field ngày (start / target date).
//
// MỘT lời `gh api graphql` cho mọi ref, alias theo chỉ số. SECURITY: owner / name /
// number đi bằng BIẾN GraphQL, không bao giờ ghép vào text query (cùng khuôn
// gh.subjectAuthors) — phần sinh ra duy nhất là alias `a0, a1…` mà caller không chạm
// tới được. Account-scoped, không cwd.
//
// `projectItems` cần scope `read:project` của token gh. Thiếu scope thì GitHub trả
// data một phần + errors (gh exit 1) — runGhAccountAllowPartial vẫn giữ phần đọc được
// (milestone), và caller báo cho người dùng biết sprint không đọc được vì sao.
import { z } from 'zod'
import { runGhAccountAllowPartial } from './runner.js'

export type GhRef = { owner: string; name: string; kind: 'issues' | 'pull'; number: number }

export type GhTracking = {
  ref: GhRef
  url: string
  state?: string
  milestone?: { title: string; dueOn?: string }
  // Mọi giá trị Iteration của item trên các Project (tên field + tiêu đề + khoảng).
  iterations: { field: string; title: string; startDate: string; duration: number }[]
  // Field Date của Projects (vd "Start date", "Target date").
  dates: { field: string; date: string }[]
  // PR → issue nó đóng (closingIssuesReferences): nơi sprint/milestone thường nằm.
  closingIssues: string[]
}

const PART = /^[A-Za-z0-9._-]{1,100}$/
export const GH_REF_RE = /https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(issues|pull)\/(\d+)/g

export function refUrl(r: GhRef): string {
  return `https://github.com/${r.owner}/${r.name}/${r.kind}/${r.number}`
}

const FIELDS = `
  url state
  milestone { title dueOn }
  projectItems(first: 10) { nodes { fieldValues(first: 30) { nodes {
    __typename
    ... on ProjectV2ItemFieldIterationValue { title startDate duration field { ... on ProjectV2IterationField { name } } }
    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
  } } } }`

const SELECTION = `__typename
  ... on Issue { ${FIELDS} }
  ... on PullRequest { ${FIELDS} closingIssuesReferences(first: 5) { nodes { url } } }`

const FieldValue = z
  .object({
    __typename: z.string().optional(),
    title: z.string().optional(),
    startDate: z.string().optional(),
    duration: z.number().optional(),
    date: z.string().optional(),
    field: z.object({ name: z.string().optional() }).nullable().optional(),
  })
  .passthrough()

const Node = z
  .object({
    url: z.string(),
    state: z.string().optional(),
    milestone: z.object({ title: z.string(), dueOn: z.string().nullable().optional() }).nullable().optional(),
    projectItems: z
      .object({
        nodes: z
          .array(
            z
              .object({ fieldValues: z.object({ nodes: z.array(FieldValue.nullable()) }).nullable().optional() })
              .nullable(),
          )
          .nullable(),
      })
      .nullable()
      .optional(),
    closingIssuesReferences: z
      .object({ nodes: z.array(z.object({ url: z.string() }).nullable()).nullable() })
      .nullable()
      .optional(),
  })
  .passthrough()

const Body = z
  .object({
    data: z
      .record(z.object({ issueOrPullRequest: Node.nullable().optional() }).nullable())
      .nullable()
      .optional(),
    errors: z.array(z.object({ message: z.string().optional(), type: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough()

export type GhTrackingResult = { items: GhTracking[]; missingProjectScope: boolean }

export async function fetchGhTracking(refs: readonly GhRef[], account?: string): Promise<GhTrackingResult> {
  const valid = refs.filter((r) => PART.test(r.owner) && PART.test(r.name) && r.number > 0)
  if (!valid.length) return { items: [], missingProjectScope: false }
  const vars: string[] = []
  const selections = valid.map((r, i) => {
    vars.push('-f', `o${i}=${r.owner}`, '-f', `n${i}=${r.name}`, '-F', `num${i}=${r.number}`)
    return `a${i}: repository(owner:$o${i},name:$n${i}){issueOrPullRequest(number:$num${i}){${SELECTION}}}`
  })
  const varDefs = valid.map((_, i) => `$o${i}:String!,$n${i}:String!,$num${i}:Int!`).join(',')
  const query = `query(${varDefs}){${selections.join(' ')}}`
  const stdout = await runGhAccountAllowPartial(['api', 'graphql', '-f', `query=${query}`, ...vars], account)
  const body = Body.parse(JSON.parse(stdout))
  // Thiếu scope read:project ⇒ GitHub báo INSUFFICIENT_SCOPES cho projectItems.
  const missingProjectScope = (body.errors ?? []).some(
    (e) => e.type === 'INSUFFICIENT_SCOPES' || /read:project/i.test(e.message ?? ''),
  )
  const items: GhTracking[] = []
  valid.forEach((ref, i) => {
    const node = body.data?.[`a${i}`]?.issueOrPullRequest
    if (!node) return
    const values = (node.projectItems?.nodes ?? []).flatMap((pi) => pi?.fieldValues?.nodes ?? [])
    const iterations: GhTracking['iterations'] = []
    const dates: GhTracking['dates'] = []
    for (const v of values) {
      if (!v) continue
      if (v.__typename === 'ProjectV2ItemFieldIterationValue' && v.title && v.startDate) {
        iterations.push({ field: v.field?.name ?? '', title: v.title, startDate: v.startDate, duration: v.duration ?? 0 })
      } else if (v.__typename === 'ProjectV2ItemFieldDateValue' && v.date) {
        dates.push({ field: v.field?.name ?? '', date: v.date })
      }
    }
    items.push({
      ref,
      url: node.url,
      ...(node.state ? { state: node.state } : {}),
      ...(node.milestone
        ? { milestone: { title: node.milestone.title, ...(node.milestone.dueOn ? { dueOn: node.milestone.dueOn } : {}) } }
        : {}),
      iterations,
      dates,
      closingIssues: (node.closingIssuesReferences?.nodes ?? []).flatMap((n) => (n ? [n.url] : [])),
    })
  })
  return { items, missingProjectScope }
}
