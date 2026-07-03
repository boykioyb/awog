// Resolve the GitHub (gh) account a project authenticates as — the single
// source of truth shared by git push/fetch/pull and the GH Issues/PR tabs.
// Inputs are the project-level setting (Project.githubAccount, edited in the
// project's Overview) and the app-level default (settings.githubAccount).
//
// Precedence: the per-project setting wins; `undefined` on it means "inherit"
// → fall back to the app default. A value of '' (either level) means "use the
// active gh account" → we return undefined so the caller omits the account and
// git/gh use their default identity.
export function resolveGhAccount(
  projectAccount: string | undefined,
  globalAccount: string,
): string | undefined {
  // `??` (not `||`) so an explicit '' on the project setting (active account) is
  // honored instead of falling through to the app default.
  const chosen = projectAccount ?? globalAccount
  return chosen.trim() || undefined
}
