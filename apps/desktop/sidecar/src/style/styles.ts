// Response styles (ADR 0046). 21 built-in conversational styles the user can
// pick per session, plus an `auto` meta-style (see AUTO_CANDIDATES below) that
// lets the model self-select the fitting style each turn. The chosen style's
// directive is appended to the agent system
// prompt for the turn (augment, never replace — like rules/inject.ts), so it
// changes only the TONE + FORMATTING of the prose, not technical correctness.
//
// Directives live ONLY here in the sidecar: the UI sends just the style id +
// the no-markdown flag, never the prompt text, so there is no surface for
// prompt-injection from a workspace file or the UI payload. The id set is the
// contract with apps/desktop/ui-next/composables/useSessionModelConfig.ts (display metadata); an
// id the sidecar doesn't know degrades to "no style" — but LOUDLY (see
// resolveDirective): a style the user believes is on while it silently isn't is
// worse than an error.
//
// WP11: on top of these 21, the user can write their OWN styles as Markdown
// files (./store.ts — `~/.awog/styles/<id>.md` and `{project}/.awog/styles/`).
// A user style with the same id WINS over the built-in of that id. That is the
// one place style text does come from disk: it is authored by the user, not by
// the model or the UI payload — see docs/features/response-styles.md.

import { log } from '../util/logger.js'
import { resolveUserStyleSync } from './resolve.js'

// One-line system-prompt directive per style id. Lifted from the user's
// "Style Switcher" skill; wording kept terse on purpose (the model follows tone
// cues better from short, declarative directives).
export const STYLE_DIRECTIVES: Record<string, string> = {
  military:
    'Military style. Direct. No preamble. No filler. Facts only. Format: [problem] → [cause] → [fix]. Code unchanged. Technical terms intact.',
  caveman:
    'Talk like caveman. Short words. No filler. Technical substance exact. Drop articles, pleasantries, hedging. Fragments OK. Code unchanged.',
  'reality-check':
    'Reality Check mode. Honest, direct, balanced. Evaluate what actually works, what the real risk is, and whether it is worth the effort. Format: [what works] → [real risk] → [verdict: ship / rethink / scrap]. Not here to criticize — here to give the honest take nobody else will say.',
  'step-by-step':
    'Respond as a numbered, sequential walkthrough. One step per line, numbered "1.", "2.", "3."… Each step is a single concrete action in the exact order it must be done — earlier steps are prerequisites for later ones. Append a short "→ expected result" only where it removes doubt. No prose paragraphs, no preamble. Code unchanged.',
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
    'Answer like a senior mentor. Lead with the "why" behind the "what". Use an analogy only when it truly aids understanding — draw it from the same domain as the question or the problem at hand (or just restate in plainer terms), keeping it close and intuitive; never reach for an unrelated real-world metaphor. Prefer a clear, direct explanation over a clever comparison. End with one small, concrete next step the reader can try right now. Warm but honest about mistakes. Code unchanged.',
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

// The `auto` meta-style: instead of one fixed directive, the model picks the
// single best-fitting style PER TURN from a curated menu. Only the "serious"
// styles are offered — the "fun" personas (pirate/yoda/dad-joke/noir/speedrun/
// corporate) and the gimmicky `caveman` are opt-in novelty and must never be
// auto-applied to a real task. Order mirrors the UI catalog (fast group, then
// deep group); directives are reused verbatim from STYLE_DIRECTIVES so there is
// a single source of truth. Normal is the implicit fallback ("if none fits").
export const AUTO_STYLE_ID = 'auto'
const AUTO_CANDIDATES = [
  'military',
  'reality-check',
  'step-by-step',
  'socratic',
  'bluf',
  'checklist',
  'code-first',
  'rubber-duck',
  'feynman',
  'first-principles',
  'devils-advocate',
  'mentor',
  'pair',
] as const

// Sentinels the UI may send for "no style" (normalizeStyleSlug emits 'Default';
// older payloads / per-project defaults may carry 'Normal'). They are NOT unknown
// ids — resolving them must stay silent, hence the explicit set. They are also
// reserved in store.ts so a user style can never take one of these ids.
const NO_STYLE_IDS = new Set(['Default', 'Normal', 'normal', 'default'])

// Resolve the directive for a style id: a USER style (project tier, then global)
// wins over the built-in of the same id; a built-in is the fallback.
//
// Nothing found ⇒ log a warning and run the turn with NO style. Silence here was
// the WP11 complaint: the user picks a style, the sidecar quietly drops it, and
// the only symptom is prose that doesn't obey — indistinguishable from a model
// that ignored the instruction.
function resolveDirective(styleId: string, projectId: string | undefined): string | undefined {
  const userStyle = resolveUserStyleSync(styleId, projectId)
  if (userStyle) return userStyle.body

  const builtIn = STYLE_DIRECTIVES[styleId]
  if (builtIn) return builtIn

  log.warn('styles: unresolved style id — this turn runs with NO style directive', {
    styleId,
    projectId,
    hint: 'expected a built-in id or a style file at ~/.awog/styles/<id>.md (or {project}/.awog/styles/<id>.md)',
  })
  return undefined
}

// Build the `<response-style>` block appended to the system prompt for a turn, or
// undefined when no style and no modifier apply. Synchronous: built-ins are a map
// lookup, and a user style costs at most two small file reads per turn (./resolve.ts
// explains why that beats a cache here).
//
// `projectId` is what makes the PROJECT tier of user styles reachable; omit it and
// only global user styles + built-ins resolve.
export function buildStylePrompt(
  styleId: string | undefined,
  noMarkdown: boolean | undefined,
  projectId?: string,
): string | undefined {
  const noMdDirective = noMarkdown ? NO_MARKDOWN_DIRECTIVE : undefined

  // Auto: the model self-selects the fitting style each turn from the curated
  // menu. Directives are flattened to one line each for a scannable menu.
  if (styleId === AUTO_STYLE_ID) {
    const menu = AUTO_CANDIDATES.map(
      (id) => `- [${id}] ${STYLE_DIRECTIVES[id].replace(/\s*\n\s*/g, ' ')}`,
    ).join('\n')
    return `<response-style>
Adaptive style. For EACH of your responses in this conversation, silently pick the SINGLE style below that best fits the user's current message and the nature of the task, then answer in that style. Your choice may change from turn to turn as the task changes. Do NOT announce or label which style you picked — just answer in it. A style changes only the TONE and FORMATTING of your prose — never the technical correctness of your answer, and never the contents of code blocks (leave code exactly as it would otherwise be). It does not override any direct instruction in the current turn. If none clearly fits, answer normally: plain, direct, no forced persona.

Styles to choose from:
${menu}${noMdDirective ? `\n\n${noMdDirective}` : ''}
</response-style>`
  }

  const directive =
    styleId && !NO_STYLE_IDS.has(styleId) ? resolveDirective(styleId, projectId) : undefined
  const parts = [directive, noMdDirective].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  if (parts.length === 0) return undefined

  return `<response-style>
The user has selected a response style. Apply it to ALL of your responses in this conversation. It changes only the TONE and FORMATTING of your prose — never the technical correctness of your answer, and never the contents of code blocks (leave code exactly as it would otherwise be). It does not override any direct instruction in the current turn.

${parts.join('\n\n')}
</response-style>`
}
