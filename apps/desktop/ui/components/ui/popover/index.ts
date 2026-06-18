// shadcn-vue Popover (ADR 0044): reka-ui Popover. Root / Trigger / Anchor
// re-exported as-is; Content is a styled, portaled wrapper wearing the AWOG
// glass `menu` surface (hosts the branch-picker filter + tree).
export { PopoverRoot as Popover, PopoverTrigger, PopoverAnchor } from 'reka-ui'
export { default as PopoverContent } from './PopoverContent.vue'
