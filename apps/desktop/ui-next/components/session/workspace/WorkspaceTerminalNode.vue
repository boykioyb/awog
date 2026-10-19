<template>
  <!-- Leaf → one pane box. For a tab with a single pane this renders exactly the
       pre-grid box (no grip / close / drop overlay, plain `flex: 1 1 0`) so existing
       consumers stay byte-identical. Grip + close + drop overlay only appear once a
       tab has been split (paneCount > 1).
       NO padding on the box: xterm's FitAddon measures its clientHeight (padding
       INCLUSIVE) — padding would add a row that renders into it and gets clipped. The
       gutter lives on the parent layer in WorkspaceTerminal (not measured), which also
       paints the terminal bg behind this box.
       `.wsterm-box` là hook: WorkspaceTerminal tìm hộp của pane bằng closest('.wsterm-box'). -->
  <div
    v-if="leaf"
    :ref="(el) => leaf && ctx.setContainer(leaf.paneId, el)"
    class="wsterm-box group/pane relative min-h-0 min-w-0 flex-[1_1_0] overflow-hidden"
    :class="{
      'ring-1 ring-primary ring-inset': multi && leaf.paneId === ctx.activePaneId(tabId),
      'opacity-55': ctx.isDragSource(leaf.paneId),
    }"
    :data-pane-id="leaf.paneId"
    @mousedown="ctx.setActivePane(tabId, leaf.paneId)"
  >
    <!-- Per-pane controls (drag handle + close) — hover-revealed, never over the
         terminal body so xterm keeps its own mouse; one floating chip. `right-4.5`
         clears xterm's 14px scrollbar gutter (what FitAddon reserves) so the thumb
         stays grabbable; z-12 sits above xterm's own scrollbar (z 11). Hidden ≠ inert:
         pointer-events off while invisible so the corner keeps text selection. -->
    <div
      v-if="multi"
      class="pointer-events-none absolute top-1 right-4.5 z-12 flex gap-0.5 rounded-sm border border-border bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-hover/pane:pointer-events-auto group-hover/pane:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
    >
      <Button
        variant="ghost"
        size="iconSm"
        class="h-5.5 w-5.5 cursor-grab text-muted-foreground active:cursor-grabbing [&_svg]:size-3.5"
        :title="t('sessions.workspace.terminal.dragPane')"
        :aria-label="t('sessions.workspace.terminal.dragPane')"
        @mousedown.stop
        @pointerdown.stop="ctx.onGripDown(tabId, leaf!.paneId, $event)"
      >
        <Move />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="h-5.5 w-5.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5"
        :title="t('sessions.workspace.terminal.closePane')"
        :aria-label="t('sessions.workspace.terminal.closePane')"
        @mousedown.stop
        @click="ctx.closePane(tabId, leaf!.paneId)"
      >
        <X />
      </Button>
    </div>

    <!-- Drop-zone overlay — shown only on the leaf currently under a dragged pane.
         Purely visual (pointer-events off so hit-testing sees the box underneath);
         the band marks where the drop will land (edge = split, center = swap). -->
    <div v-if="dropZone" class="pointer-events-none absolute inset-0 z-7">
      <div
        class="absolute rounded-sm border border-primary bg-primary/20"
        :class="DROP_BAND[dropZone]"
      />
    </div>
  </div>

  <!-- Split → a flex row/col of children, each sized by `flex-grow: sizes[i]`, with a
       draggable 1px splitter between adjacent children (grab target widened past the
       line by a ::before, without taking layout space). -->
  <div
    v-else-if="split"
    class="relative flex min-h-0 min-w-0 flex-[1_1_0]"
    :class="split.dir === 'row' ? 'flex-row' : 'flex-col'"
  >
    <template v-for="(child, i) in split.children" :key="nodeKey(child)">
      <div
        v-if="i > 0"
        class="relative z-4 flex-none bg-border before:absolute before:content-['']"
        :class="
          split.dir === 'row'
            ? 'w-px cursor-col-resize before:inset-y-0 before:-inset-x-0.75'
            : 'h-px cursor-row-resize before:inset-x-0 before:-inset-y-0.75'
        "
        role="separator"
        :aria-orientation="split.dir === 'row' ? 'vertical' : 'horizontal'"
        @pointerdown="ctx.onSplitterDown(split!, i, $event)"
      />
      <WorkspaceTerminalNode :node="child" :tab-id="tabId" :style="{ flexGrow: split.sizes[i] }" />
    </template>
  </div>
</template>

<script lang="ts">
// Split-tree model + pure tree helpers, exported so WorkspaceTerminal (the host)
// shares the exact same types + mutations. Kept in a plain <script> because
// <script setup> cannot contain ES module exports. This is the ONLY `vue` import in
// the file (`inject` / `computed` come from Nuxt auto-import in <script setup>) so
// the two script blocks never collide on a duplicate-import autofix.
import type { InjectionKey } from 'vue'
// lucide icons live here too (module scope is shared with <script setup>).
import { Move, X } from 'lucide-vue-next'

// A tab's panes form a binary/n-ary split tree. A single-pane tab is a lone `leaf`
// → it renders one full box, identical to the pre-grid terminal. A `split` lays its
// children out along one axis; `sizes` are percentages (summing to 100) used as
// flex-grow weights so the leftover space (minus splitter widths) divides cleanly.
export type LayoutLeaf = { kind: 'leaf'; paneId: string }
export type LayoutSplit = {
  kind: 'split'
  dir: 'row' | 'col'
  children: LayoutNode[]
  sizes: number[]
}
export type LayoutNode = LayoutLeaf | LayoutSplit

// Where a dragged pane will land on the hovered target leaf.
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

// Callbacks + reactive lookups injected from WorkspaceTerminal so the recursive node
// can render/interact without prop-drilling through every split level.
export type TerminalNodeCtx = {
  paneCount: (tabId: string) => number
  activePaneId: (tabId: string) => string | null
  setContainer: (paneId: string, el: unknown) => void
  setActivePane: (tabId: string, paneId: string) => void
  closePane: (tabId: string, paneId: string) => void
  onGripDown: (tabId: string, paneId: string, e: PointerEvent) => void
  onSplitterDown: (node: LayoutSplit, index: number, e: PointerEvent) => void
  dragTargetZone: (paneId: string) => DropZone | null
  isDragSource: (paneId: string) => boolean
}

export const TERM_CTX = Symbol('workspace-terminal-ctx') as InjectionKey<TerminalNodeCtx>

// All pane ids contained in a subtree (drives paneCount, keying, disposal).
export const collectPaneIds = (node: LayoutNode): string[] =>
  node.kind === 'leaf' ? [node.paneId] : node.children.flatMap(collectPaneIds)

// Locate a leaf: its parent split (null when the leaf is the tree root) + its index
// within that parent's children. Used by every tree mutation.
export const locateLeaf = (
  node: LayoutNode,
  paneId: string,
  parent: LayoutSplit | null = null,
  index = -1,
): { parent: LayoutSplit | null; index: number } | null => {
  if (node.kind === 'leaf') return node.paneId === paneId ? { parent, index } : null
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (!child) continue
    const found = locateLeaf(child, paneId, node, i)
    if (found) return found
  }
  return null
}

// Rescale a split's sizes so they sum to 100 (after inserting/removing a child).
const normalizeSizes = (sizes: number[]): void => {
  const sum = sizes.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    sizes.fill(100 / sizes.length)
    return
  }
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i]
    if (s !== undefined) sizes[i] = (s / sum) * 100
  }
}

// Collapse any split left with a single child into that child; renormalize sizes.
// Post-order so collapses propagate bottom-up. Returns the (possibly new) root.
const prune = (node: LayoutNode): LayoutNode => {
  if (node.kind === 'leaf') return node
  node.children = node.children.map(prune)
  if (node.children.length === 1) return node.children[0] ?? node
  normalizeSizes(node.sizes)
  return node
}

// Split the target leaf along `dir`, inserting a new leaf before/after it. When the
// target's parent already runs the same axis the new leaf joins as a sibling (so
// three-across panes stay flat, like iTerm/tmux); otherwise the target is wrapped in
// a fresh split. Returns the (possibly new) root.
export const splitLeaf = (
  root: LayoutNode,
  targetPaneId: string,
  newPaneId: string,
  dir: 'row' | 'col',
  before: boolean,
): LayoutNode => {
  const loc = locateLeaf(root, targetPaneId)
  if (!loc) return root
  const newLeaf: LayoutLeaf = { kind: 'leaf', paneId: newPaneId }
  const { parent, index } = loc
  if (parent && parent.dir === dir) {
    const half = (parent.sizes[index] ?? 50) / 2
    parent.children.splice(before ? index : index + 1, 0, newLeaf)
    parent.sizes.splice(index, 1, half, half)
    return root
  }
  const targetNode = parent ? (parent.children[index] ?? root) : root
  const wrapped: LayoutSplit = {
    kind: 'split',
    dir,
    children: before ? [newLeaf, targetNode] : [targetNode, newLeaf],
    sizes: [50, 50],
  }
  if (parent) {
    parent.children[index] = wrapped
    return root
  }
  return wrapped
}

// Remove a leaf from the tree (no-op for the root leaf — the caller closes the tab
// instead). Collapses single-child splits + renormalizes. Returns the pruned root.
export const removeLeaf = (root: LayoutNode, paneId: string): LayoutNode => {
  const loc = locateLeaf(root, paneId)
  if (!loc || !loc.parent) return root
  loc.parent.children.splice(loc.index, 1)
  loc.parent.sizes.splice(loc.index, 1)
  return prune(root)
}

// Swap two leaves' positions by exchanging their paneIds in place — the cheapest,
// structure-preserving "move to center" (Vue re-keys the boxes and their live xterms
// travel with them).
export const swapPanes = (root: LayoutNode, aId: string, bId: string): void => {
  const la = locateLeaf(root, aId)
  const lb = locateLeaf(root, bId)
  if (!la || !lb) return
  const leafA = la.parent ? la.parent.children[la.index] : root
  const leafB = lb.parent ? lb.parent.children[lb.index] : root
  if (leafA?.kind === 'leaf' && leafB?.kind === 'leaf') {
    const tmp = leafA.paneId
    leafA.paneId = leafB.paneId
    leafB.paneId = tmp
  }
}
</script>

<script setup lang="ts">
// Recursive renderer for one node of a terminal tab's split tree (the model + tree
// helpers live in the plain <script> above). Splits render a resizable flex
// container; leaves render the pane box wired back to WorkspaceTerminal via the
// injected context. The component refers to itself recursively for nested splits.
// No imports here (vue APIs auto-imported; lucide icons are imported in the plain
// <script> above) so that block stays the sole import site — otherwise eslint's
// import/first fights the two-block layout.

defineOptions({ name: 'WorkspaceTerminalNode' })

const props = defineProps<{ node: LayoutNode; tabId: string }>()

const { t } = useI18n()

const ctx = inject(TERM_CTX)
if (!ctx) throw new Error('WorkspaceTerminalNode must be rendered inside WorkspaceTerminal')

const leaf = computed(() => (props.node.kind === 'leaf' ? props.node : null))
const split = computed(() => (props.node.kind === 'split' ? props.node : null))
const multi = computed(() => ctx.paneCount(props.tabId) > 1)
const dropZone = computed(() => (leaf.value ? ctx.dragTargetZone(leaf.value.paneId) : null))

// Vị trí dải tô của drop-zone: mép = split về phía đó, giữa = đổi chỗ hai pane.
const DROP_BAND: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 w-1/3',
  right: 'inset-y-0 right-0 w-1/3',
  top: 'inset-x-0 top-0 h-1/3',
  bottom: 'inset-x-0 bottom-0 h-1/3',
  center: 'inset-[20%]',
}

// Stable-per-content key: a leaf keys on its pane; a split keys on the set of panes
// it holds so pure resizes (same panes) never remount, while structural changes do.
const nodeKey = (node: LayoutNode): string =>
  node.kind === 'leaf' ? `l:${node.paneId}` : `s:${collectPaneIds(node).join('|')}`
</script>
