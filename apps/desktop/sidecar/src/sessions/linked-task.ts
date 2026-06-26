// Linked-task context (ADR 0055). When a session was opened to discuss a task
// (Session.aboutTaskId), the runtime injects a <linked_task> block into the turn's
// systemPromptAppend so the agent can reason about the task's results — its status,
// workflow, and the latest output of each phase. Bounded so a large task can't
// blow up the context window; built fresh each turn so a still-running task's
// context stays current.
import { loadTask } from '../tasks/store.js'
import type { Task } from '../types/shared.js'

// Per-phase output cap + overall results cap (chars). char/4 ≈ tokens.
const MAX_PHASE_OUTPUT = 4000
const MAX_RESULTS_TOTAL = 8000

// Build the <linked_task> block for a task id, or undefined when the task is
// missing/deleted (treated as no context — the session still works as a normal
// chat). Never throws.
export async function buildLinkedTaskBlock(taskId: string): Promise<string | undefined> {
  let task: Task | null
  try {
    task = await loadTask(taskId)
  } catch {
    return undefined
  }
  if (!task) return undefined

  const meta: string[] = [`Task "${task.title}" — status: ${task.status}.`]
  if (task.workflowSnapshot?.name) meta.push(`Workflow: ${task.workflowSnapshot.name}.`)
  if (task.description?.trim()) meta.push(`Description: ${task.description.trim()}`)

  // Latest output per phase (the meaningful results to discuss). Iterate phases in
  // insertion order; for each take the most recent run that produced output.
  let budget = MAX_RESULTS_TOTAL
  const results: string[] = []
  for (const phase of Object.values(task.phases)) {
    if (budget <= 0) break
    const run = [...phase.runs].reverse().find((r) => r.output && r.output.trim())
    if (!run) continue
    const out = run.output.trim().slice(0, MAX_PHASE_OUTPUT)
    const block = `### ${phase.skillName} (${phase.status})\n${out}`.slice(0, budget)
    results.push(block)
    budget -= block.length
  }

  const body = [
    meta.join(' '),
    results.length ? `\nResults:\n${results.join('\n\n')}` : '\n(No phase output yet.)',
  ].join('\n')

  return `<linked_task>
This session was opened to discuss the AWOG task below. Use its results to answer the user's questions about it. If the user wants changes, suggest re-running the task or a specific phase (you cannot edit the task from here).
${body}
</linked_task>`
}
