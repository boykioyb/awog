import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { inject } from 'vue'

// Sidebar context — simplified port of the shadcn-vue sidebar contract for the
// AWOG prototype: open flag, icon-collapse mode, toggle. Real migration keeps
// this API surface 1:1 so call sites stay identical.
export interface SidebarContext {
  open: Ref<boolean>
  collapsible: ComputedRef<'icon' | 'offcanvas' | 'none'>
  state: ComputedRef<'expanded' | 'collapsed'>
  toggle: () => void
}

export const sidebarKey: InjectionKey<SidebarContext> = Symbol('awog-sidebar')

export function useSidebar(): SidebarContext {
  const ctx = inject(sidebarKey)
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>')
  return ctx
}

export const SIDEBAR_WIDTH = '216px'
export const SIDEBAR_WIDTH_ICON = '52px'
