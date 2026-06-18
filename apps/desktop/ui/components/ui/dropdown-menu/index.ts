// shadcn-vue DropdownMenu (ADR 0044): reka-ui DropdownMenu primitives. Root /
// Trigger / Group re-exported as-is; Content / Item / Separator / Label are
// styled wrappers (Content portals + wears the AWOG glass `menu` surface).
export { DropdownMenuRoot as DropdownMenu, DropdownMenuTrigger, DropdownMenuGroup } from 'reka-ui'

export { default as DropdownMenuContent } from './DropdownMenuContent.vue'
export { default as DropdownMenuItem } from './DropdownMenuItem.vue'
export { default as DropdownMenuSeparator } from './DropdownMenuSeparator.vue'
export { default as DropdownMenuLabel } from './DropdownMenuLabel.vue'
