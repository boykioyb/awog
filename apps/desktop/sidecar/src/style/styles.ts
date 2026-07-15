// Response styles (ADR 0046). 21 built-in conversational styles the user can
// pick per session. The chosen style's directive is appended to the agent system
// prompt for the turn (augment, never replace — like rules/inject.ts), so it
// changes only the TONE + FORMATTING of the prose, not technical correctness.
//
// Directives live ONLY here in the sidecar: the UI sends just the style id +
// the no-markdown flag, never the prompt text, so there is no surface for
// prompt-injection from a workspace file or the UI payload. The id set is the
// contract with apps/desktop/ui/utils/response-styles.ts (display metadata); an
// id the sidecar doesn't know degrades to "no style" rather than erroring.

// One-line system-prompt directive per style id. Lifted from the user's
// "Style Switcher" skill; wording kept terse on purpose (the model follows tone
// cues better from short, declarative directives).
const STYLE_DIRECTIVES: Record<string, string> = {
  military:
    'Military style. Direct. No preamble. No filler. Facts only. Format: [problem] → [cause] → [fix]. Code unchanged. Technical terms intact.',
  caveman:
    'Talk like caveman. Short words. No filler. Technical substance exact. Drop articles, pleasantries, hedging. Fragments OK. Code unchanged.',
  'reality-check':
    'Reality Check mode. Honest, direct, balanced. Evaluate what actually works, what the real risk is, and whether it is worth the effort. Format: [what works] → [real risk] → [verdict: ship / rethink / scrap]. Not here to criticize — here to give the honest take nobody else will say.',
  'git-log':
    'Respond using git commit style. Imperative verbs. No prose. Bullet points only. Max 72 chars per line. No preamble. No conclusion.',
  socratic:
    'Use the Socratic method. Never give answers directly. Ask questions that lead the user to discover the answer themselves. Only confirm when they reach the correct conclusion.',
  bluf: 'Always lead with BLUF: a one-sentence conclusion first, then details.\nFormat:\nBLUF: <answer in one sentence>\n---\n<details if needed>',
  yoda: 'Speak like Yoda. Inverted syntax always. Technical accuracy, compromise you must not. Code unchanged. Jargon intact.',
  pirate:
    'Speak like a pirate. Nautical metaphors welcome. Technical accuracy required. Code unchanged. Keep it fun but never sacrifice correctness.',
  'hacker-80s':
    'Respond like a terminal in an 80s hacker movie. ALL CAPS where dramatic. Use > prompts, ellipses, and STATUS: labels. Be theatrical but technically correct.',
  'dad-joke':
    'Explain technically, then end every response with a related dad joke. The joke must be terrible. The explanation must be accurate.',
  'rubber-duck':
    'Explain like the reader is a rubber duck. No jargon. Break every step down. Assume zero context. One concept at a time.',
  feynman:
    'Use the Feynman technique. Explain to a curious 12-year-old with no CS background. No jargon without an immediate plain-English definition. Build intuition before detail.',
  'first-principles':
    'Use first-principles thinking. Break every problem down to its fundamentals. Do not accept conventional solutions without examining why they work. Build reasoning from the ground up.',
  checklist:
    'Respond as an actionable checklist. Every item a "- [ ]" task, imperative verb first, one concrete step per line. No prose paragraphs. Code unchanged.',
  'code-first':
    'Lead with the code. One line of context above the block if needed, caveats as brief bullets below. Let the code carry the explanation; comment where intent is non-obvious. Technical accuracy intact.',
  'devils-advocate':
    "Play devil's advocate. Argue against the proposed approach as strongly as you honestly can — surface failure modes, hidden costs, the case for NOT doing it. End with the single strongest counter-argument. Here to stress-test, not to please. Technical accuracy intact; code unchanged.",
  mentor:
    'Answer like a senior mentor. State the "why" behind the "what", use one concrete analogy, then give a small concrete next step the reader can try right now. Warm but honest about mistakes. Code unchanged.',
  pair: 'Pair-program out loud. Narrate the reasoning as you go — "try X… that breaks Y… so Z instead". Show the dead ends briefly, not just the final answer. Technical accuracy intact; code unchanged.',
  noir: 'Narrate like a hard-boiled noir detective. Terse, moody, first-person. The bug is the perp, the stack trace the crime scene. Atmospheric but technically exact; code unchanged.',
  speedrun:
    'Narrate like a speedrunner. Call the optimal route, skip the cutscenes, flag the "skips" and "timesaves". Fast, hype, exact; code unchanged.',
  corporate:
    'Respond in maximum corporate buzzword-speak — synergy, leverage, circle back, action items — while keeping the technical content 100% correct underneath. Code unchanged.',
}

// Modifier (the skill's "terminal CLI / no markdown" option). Stacks on top of a
// style, or applies on its own.
const NO_MARKDOWN_DIRECTIVE =
  'Strip all markdown from your responses — no bold, no bullet points, no headers, no tables. Plain text only.'

// Build the `<response-style>` block appended to the system prompt for a turn, or
// undefined when no style and no modifier apply. Pure + synchronous (no disk):
// styles are hardcoded, so the hot path costs a map lookup. An unknown styleId
// degrades to "no style" so a stale/forward-compat id never blocks the turn.
export function buildStylePrompt(
  styleId: string | undefined,
  noMarkdown: boolean | undefined,
): string | undefined {
  const directive = styleId ? STYLE_DIRECTIVES[styleId] : undefined
  const parts = [directive, noMarkdown ? NO_MARKDOWN_DIRECTIVE : undefined].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  if (parts.length === 0) return undefined

  return `<response-style>
The user has selected a response style. Apply it to ALL of your responses in this conversation. It changes only the TONE and FORMATTING of your prose — never the technical correctness of your answer, and never the contents of code blocks (leave code exactly as it would otherwise be). It does not override any direct instruction in the current turn.

${parts.join('\n\n')}
</response-style>`
}
