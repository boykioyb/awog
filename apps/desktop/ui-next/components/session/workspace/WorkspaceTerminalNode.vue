<template>
  <!-- Leaf → one pane box. For a tab with a single pane this renders exactly the
       pre-grid box (no grip / close / drop overlay, plain `flex: 1 1 0`) so existing
       consumers stay byte-identical. Grip + close + drop overlay only appear once a
       tab has been split (paneCount > 1). -->
  <div
    v-if="leaf"
    :ref="(el) => leaf && ctx.setContainer(leaf.paneId, el)"
    class="wsterm-box"
    :class="{
      'pane-active': multi && leaf.paneId === ctx.activePaneId(tabId),
      'pane-dragging': ctx.isDragSource(leaf.paneId),
    }"
    :data-pane-id="leaf.paneId"
    @mousedown="ctx.setActivePane(tabId, leaf.paneId)"
  >
    <div v-if="multi" class="wsterm-pane-tools">
      <button
        class="wsterm-pane-grip"
        :title="t('sessions.workspace.terminal.dragPane')"
        :aria-label="t('sessions.workspace.terminal.dragPane')"
        @mousedown.stop
        @pointerdown.stop="ctx.onGripDown(tabId, leaf!.paneId, $event)"
      >
        <Icon name="move" style="width: 13px; height: 13px" />
      </button>
      <button
        class="wsterm-pane-close"
        :title="t('sessions.workspace.terminal.closePane')"
        :aria-label="t('sessions.workspace.terminal.closePane')"
        @mousedown.stop
        @click="ctx.closePane(tabId, leaf!.paneId)"
      >
        <Icon name="x" style="width: 13px; height: 13px" />
      </button>
    </div>

    <!-- Drop-zone overlay — shown only on the leaf currently under a dragged pane.
         The band marks where the drop will land (edge = split, center = swap). -->
    <div v-if="dropZone" class="wsterm-drop">
      <div class="wsterm-drop-band" :class="dropZone" />
    </div>
  </div>

  <!-- Split → a flex row/col of children, each sized by `flex-grow: sizes[i]`, with a
       draggable 1px splitter between adjacent children. -->
  <div v-else-if="split" class="wsterm-split" :class="split.dir">
    <template v-for="(child, i) in split.children" :key="nodeKey(child)">
      <div
        v-if="i > 0"
        class="wsterm-splitter"
        :class="split.dir"
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
// No imports here (icons via the auto-imported <Icon>, vue APIs auto-imported) so
// the plain <script> above stays the sole import site — otherwise eslint's
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

// Stable-per-content key: a leaf keys on its pane; a split keys on the set of panes
// it holds so pure resizes (same panes) never remount, while structural changes do.
const nodeKey = (node: LayoutNode): string =>
  node.kind === 'leaf' ? `l:${node.paneId}` : `s:${collectPaneIds(node).join('|')}`
</script>

<style scoped>
/* One pane. `flex: 1 1 0` (grow overridden inline by the parent split's size weight)
   + min-0 so it can shrink below xterm's intrinsic size. Identical to the pre-grid
   box for a lone leaf. */
.wsterm-box {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* NO padding here: xterm's FitAddon measures this box's clientHeight (padding
     INCLUSIVE), so padding is consumed by the fit — it adds an extra row that renders
     into the padding and gets clipped by overflow:hidden. The breathing-room gutter
     lives on the parent `.wsterm-panes` (which xterm does NOT measure). */
  background: var(--wsterm-bg, var(--bg));
}
.wsterm-box.pane-active {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.wsterm-box.pane-dragging {
  opacity: 0.55;
}

/* Split container: lays children along one axis; children are sized via inline
   flex-grow weights, splitters take a fixed 1px. */
.wsterm-split {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}
.wsterm-split.row {
  flex-direction: row;
}
.wsterm-split.col {
  flex-direction: column;
}

.wsterm-splitter {
  position: relative;
  z-index: 4;
  flex: 0 0 1px;
  background: var(--border);
}
.wsterm-splitter.row {
  cursor: col-resize;
}
.wsterm-splitter.col {
  cursor: row-resize;
}
/* Widen the grab target past the 1px line without taking layout space. */
.wsterm-splitter.row::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  right: -3px;
}
.wsterm-splitter.col::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -3px;
  bottom: -3px;
}

/* Per-pane controls (drag handle + close) — hover-revealed, never over the terminal
   body so xterm keeps its own mouse. Rendered as one floating chip: over live output
   two naked 18px squares were hard to read AND hard to hit. */
.wsterm-pane-tools {
  position: absolute;
  top: 4px;
  /* Clear of xterm's scrollbar gutter (14px — exactly what FitAddon reserves on the
     right, `overviewRuler.width || 14`). Sitting ON that gutter, the chip covered the
     top of the scroll track, so the thumb could not be grabbed where it rests when
     the buffer is scrolled to the bottom. */
  right: 18px;
  /* Above xterm's own scrollbar (z-index 11 inside `.xterm`, which is not a stacking
     context — at 6 the slider painted straight over these buttons). */
  z-index: 12;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgPanel);
  box-shadow: 0 2px 8px rgb(0 0 0 / 28%);
  opacity: 0;
  /* Hidden ≠ inert: at opacity 0 the buttons still hit-tested, swallowing clicks and
     text selection in the pane's top-right corner. */
  pointer-events: none;
  transition: opacity 0.12s;
}
.wsterm-box:hover .wsterm-pane-tools,
.wsterm-pane-tools:focus-within {
  opacity: 1;
  pointer-events: auto;
}
.wsterm-pane-grip,
.wsterm-pane-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 22px = the dock header's button size (.gterm-btn) — same house target. */
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.wsterm-pane-grip {
  cursor: grab;
}
.wsterm-pane-grip:active {
  cursor: grabbing;
}
.wsterm-pane-grip:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wsterm-pane-close:hover {
  background: var(--dangerBg, var(--bgHover));
  color: var(--danger, var(--text));
}
.wsterm-pane-grip:focus-visible,
.wsterm-pane-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

/* Drop-zone overlay — purely visual (pointer-events off so hit-testing sees the box
   underneath). The band tints the edge/center the drop will target. */
.wsterm-drop {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
}
.wsterm-drop-band {
  position: absolute;
  border-radius: var(--r-xs);
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border: 1px solid var(--accent);
}
.wsterm-drop-band.left {
  left: 0;
  top: 0;
  bottom: 0;
  width: 33%;
}
.wsterm-drop-band.right {
  right: 0;
  top: 0;
  bottom: 0;
  width: 33%;
}
.wsterm-drop-band.top {
  top: 0;
  left: 0;
  right: 0;
  height: 33%;
}
.wsterm-drop-band.bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 33%;
}
.wsterm-drop-band.center {
  inset: 20%;
}
</style>
