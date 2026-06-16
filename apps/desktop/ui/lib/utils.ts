import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn-vue class merge helper (ADR 0044): clsx conditionals + tailwind-merge
// de-dup so later utility classes win over earlier conflicting ones.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
