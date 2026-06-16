import { type VariantProps, cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

// shadcn-vue Button variants (ADR 0044), cva over the bridged shadcn color tokens
// (tailwind.config maps them to AWOG theme via --awog-* CSS vars, set in useTheme).
// Sizes/variants extend the stock shadcn set to AWOG's scale: compact heights,
// `xs` micro-control (byline), `ghostDanger` (destructive icon at rest-neutral).
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[1em] font-medium select-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        ghostDanger: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        xs: 'h-auto rounded px-1.5 py-0.5 gap-1',
        sm: 'h-7 px-2.5',
        lg: 'h-9 px-4',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
