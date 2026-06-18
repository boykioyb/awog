// shadcn-vue Sheet / drawer (ADR 0044): reka-ui Dialog positioned to a screen
// edge (slide-in). Same a11y as Dialog (focus trap, escape, scroll-lock). Root /
// Trigger / Close re-exported; Title/Description reuse the Dialog primitives.
export {
  DialogRoot as Sheet,
  DialogTrigger as SheetTrigger,
  DialogClose as SheetClose,
} from 'reka-ui'
export { DialogTitle as SheetTitle, DialogDescription as SheetDescription } from '../dialog'
export { default as SheetContent } from './SheetContent.vue'
