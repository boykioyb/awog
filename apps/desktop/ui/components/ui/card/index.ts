import { type VariantProps, cva } from 'class-variance-authority'

export { default as Card } from './Card.vue'
export { default as CardHeader } from './CardHeader.vue'
export { default as CardTitle } from './CardTitle.vue'
export { default as CardDescription } from './CardDescription.vue'
export { default as CardContent } from './CardContent.vue'
export { default as CardFooter } from './CardFooter.vue'

// shadcn-vue Card (ADR 0044). `flat` (default) is the new app surface: hairline
// `border` + `bg-card` + subtle shadow, consistent `rounded-lg`. `glass` opts
// into the AWOG liquid-glass look via useGlass().elevated (honors the toggle) —
// reserved for raised/floating surfaces. See ADR 0044 + the redesign plan.
export const cardVariants = cva('text-card-foreground', {
  variants: {
    variant: {
      flat: 'rounded-lg border border-border bg-card shadow-sm',
      glass: 'rounded-lg border',
    },
  },
  defaultVariants: {
    variant: 'flat',
  },
})

export type CardVariants = VariantProps<typeof cardVariants>
