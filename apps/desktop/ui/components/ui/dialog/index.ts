// shadcn-vue Dialog (ADR 0044): reka-ui Dialog. Root / Trigger / Close
// re-exported; Content is a portaled, glass-overlay wrapper. BaseModal is rebuilt
// on top of this so every modal in the app shares one form + a11y (focus trap,
// escape, aria) — see components/BaseModal.vue.
export { DialogRoot as Dialog, DialogTrigger, DialogClose } from 'reka-ui'

export { default as DialogContent } from './DialogContent.vue'
export { default as DialogHeader } from './DialogHeader.vue'
export { default as DialogFooter } from './DialogFooter.vue'
export { default as DialogTitle } from './DialogTitle.vue'
export { default as DialogDescription } from './DialogDescription.vue'
