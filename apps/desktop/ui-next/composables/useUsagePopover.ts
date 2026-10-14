import { ref } from 'vue'

// Usage-donut popover state — module singleton so exactly ONE account card is
// pinned open across every ring on the status bar(s) (global bar + workbench
// bar + any future mount). Mirrors useStatusConfig's single-open contract but
// keyed by ACCOUNT id rather than chip kind. Bare ref on purpose: reads and
// writes inline better at call sites than one-line open/close wrappers.
export const usagePopoverOpenId = ref<string | null>(null)
