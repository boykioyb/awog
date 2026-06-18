import { type VariantProps, cva } from 'class-variance-authority'

export { default as Badge } from './Badge.vue'

// shadcn-vue Badge (ADR 0044). Bridged variants (default/secondary/outline/
// destructive) color via Tailwind tokens; `warning`/`info` are NOT bridged
// shadcn tokens — Badge.vue colors them from `useTheme().t` inline (same subtle
// Bg+fg recipe used across the app for semantic chips).
export const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border font-medium leading-none text-[12px] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        warning: 'border-transparent',
        info: 'border-transparent',
      },
      size: {
        default: 'px-2 py-0.5',
        sm: 'px-1.5 py-0.5 min-w-[18px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
