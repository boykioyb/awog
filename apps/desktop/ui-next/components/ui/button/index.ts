import { cva, type VariantProps } from 'class-variance-authority'

// shadcn-vue Button — stock new-york variants. Colors/size come straight from
// the standard var set via the tailwind bridge, so the look is whatever the
// active theme layer says (proto: real shadcn neutral).
export const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        // Outlined-danger — bản .btn.gdanger của prototype: chữ/nền/viền đỏ
        // nhẹ thay vì khối đỏ đặc. Cho abort-merge / drop-stash / hành động
        // nguy hiểm vẫn cần đọc được cạnh nút thường.
        danger:
          'border-destructive/40 bg-destructive/10 text-destructive shadow-sm hover:border-destructive',
        outline:
          'border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[var(--ctrl-h)] px-4 py-2',
        xs: 'h-[var(--ctrl-h-xs)] rounded-md px-2 text-xs',
        sm: 'h-[var(--ctrl-h-sm)] rounded-md px-3 text-xs',
        lg: 'h-[var(--ctrl-h-lg)] rounded-md px-8',
        icon: 'h-[var(--ctrl-h)] w-[var(--ctrl-h)]',
        // 32px vuông — đúng kích thước .iconbtn prototype cũ (giữa icon 36 và
        // iconSm 28), cho toolbar row-dense.
        iconMd: 'h-[var(--ctrl-h-sm)] w-[var(--ctrl-h-sm)] rounded-md',
        iconSm: 'h-[var(--ctrl-h-xs)] w-[var(--ctrl-h-xs)] rounded-md [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
