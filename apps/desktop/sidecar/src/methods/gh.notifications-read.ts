// gh.notificationsRead → mark GitHub notification threads as read
// (docs/features/github-notifications.md). Account-scoped like gh.notifications:
// the inbox spans every repo, so there is no cwd and nothing path-like in args.
//
// Two shapes, one method:
//   { threadId } → PATCH /notifications/threads/<id>  (one thread)
//   {}           → PUT   /notifications               (the WHOLE inbox)
// The whole-inbox form is destructive from the user's point of view (it clears
// threads for repos AWOG never shows), so the UI gates it behind a confirm — this
// layer only enforces the shape.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runGhAccount } from '../github/runner.js'

// GitHub thread ids are decimal strings. Validated (not just typed) because this
// is the one caller-supplied value spliced into the request path.
const Params = z.object({
  account: z.string().optional(),
  threadId: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
})

interface Result {
  ok: true
}

register('gh.notificationsRead', async (raw): Promise<Result> => {
  const params = Params.parse(raw)
  // Both endpoints answer 202/205 with no body — `--silent` keeps gh from trying
  // to pretty-print an empty response.
  const args = params.threadId
    ? ['api', '--silent', '--method', 'PATCH', `notifications/threads/${params.threadId}`]
    : ['api', '--silent', '--method', 'PUT', 'notifications', '-F', 'read=true']
  await runGhAccount(args, params.account)
  return { ok: true }
})
