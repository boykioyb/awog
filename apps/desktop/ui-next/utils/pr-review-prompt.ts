// The prompt behind the PR detail's "Start review" button. The template lives in
// Settings → Git; this fills its placeholders at click time so the session that
// opens carries the actual PR, not a template.

// Substituted tokens, in the order the Settings hint lists them. `{link-pr}` is
// the one that matters (it is what the reviewer has to fetch); the other two just
// save the model a round-trip for the obvious framing.
export const PR_REVIEW_TOKENS = ['{link-pr}', '{number}', '{title}'] as const

export interface PrReviewVars {
  url: string
  number: number
  title: string
}

// Replace every occurrence of each token. Unknown braces are left alone — a
// template may legitimately contain them (a code snippet, another tool's syntax).
export function fillPrReviewPrompt(template: string, vars: PrReviewVars): string {
  const map: Record<(typeof PR_REVIEW_TOKENS)[number], string> = {
    '{link-pr}': vars.url,
    '{number}': String(vars.number),
    '{title}': vars.title,
  }
  let out = template
  for (const token of PR_REVIEW_TOKENS) out = out.split(token).join(map[token])
  return out.trim()
}
