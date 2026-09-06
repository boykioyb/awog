<template>
  <section
    class="page on wikipage"
    data-page="wiki"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <WikiSidebar
      :tree="tree"
      :selected-key="selectedKey"
      :query="query"
      :is-collapsed="isCollapsed"
      :context-page-count="store.contextPageCount"
      :index-chars="store.indexChars"
      :width="sidebarWidth"
      @resize="setSidebarWidth"
      @open="open"
      @toggle-space="toggleSpace"
      @context-page="onContextPage"
      @new-child="onNewChild"
      @update:query="(v) => (query = v)"
      @search="runSearch"
      @clear-search="clearSearch"
      @new-page="onNewPage"
      @new-space="onNewSpace"
      @import-files="onImportFiles"
    />

    <div class="wk-main">
      <!-- search results take over the pane while a query is active -->
      <div v-if="hits.length > 0 || (query.trim() !== '' && !searching)" class="wk-hits">
        <div class="wk-hitshead">
          <span class="sech">{{ t('wiki.search.results', { n: hits.length }) }}</span>
          <button class="btn sm" @click="clearSearch">{{ t('common.clear') }}</button>
        </div>
        <div v-if="hits.length === 0" class="wk-empty" :style="{ color: 'var(--textFaint)' }">
          {{ t('wiki.search.none', { q: query }) }}
        </div>
        <!-- keyed with the tier: the global and a project wiki can hold the same slug,
             and a hit on the same line of both would otherwise collide -->
        <button
          v-for="hit in hits"
          :key="`${hit.source}|${hit.projectId ?? ''}|${hit.path}:${hit.line}`"
          class="wk-hit"
          @click="openHit(hit)"
        >
          <span class="wk-hittitle">{{ hit.title }}</span>
          <span class="wk-hitpath" :style="{ color: 'var(--textFaint)' }">
            {{ hit.path }}:{{ hit.line }}
          </span>
          <span class="wk-hitprev" :style="{ color: 'var(--textDim)' }">{{ hit.preview }}</span>
        </button>
      </div>

      <WikiEditor
        v-else-if="mode === 'edit' && content"
        :path="draftPath"
        :draft="draft"
        :dirty="dirty"
        :saving="saving"
        :derived-description="derivedDescription"
        @update:draft="(d) => (draft = d)"
        @save="onSave"
        @cancel="cancelEdit"
      />

      <WikiReader
        v-else-if="content"
        :page="content.page"
        :body="content.body"
        :truncated="content.truncated"
        :backlinks="content.backlinks"
        @edit="startEdit"
        @delete="onDelete"
        @toggle-context="onToggleContext"
        @open="open"
        @follow-link="onFollowLink"
      />

      <div v-else class="wk-blank">
        <div v-if="loadingPage" :style="{ color: 'var(--textFaint)' }">
          {{ t('common.loading') }}
        </div>
        <template v-else-if="store.pages.length === 0">
          <Icon name="file" :size="40" :style="{ color: 'var(--textFaint)' }" />
          <h2 class="wk-blanktitle">{{ t('wiki.empty.title') }}</h2>
          <p class="wk-blanktext" :style="{ color: 'var(--textDim)' }">
            {{ t('wiki.empty.body') }}
          </p>
          <div class="wk-blankcta">
            <button class="btn pri" @click="onImportFiles">
              <Icon name="download" :size="13" />
              {{ t('wiki.import.files') }}
            </button>
            <button class="btn" @click="onImportFolder">
              <Icon name="folder" :size="13" />
              {{ t('wiki.import.folder') }}
            </button>
            <button class="btn" @click="onNewPage">
              <Icon name="plus" :size="13" />
              {{ t('wiki.newPage') }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="wk-blanktext" :style="{ color: 'var(--textDim)' }">
            {{ t('wiki.selectPage') }}
          </p>
        </template>
      </div>
    </div>

    <div v-if="dragging" class="wk-drop" :style="{ borderColor: 'var(--accent)' }">
      {{ t('wiki.import.dropHint') }}
    </div>

    <WikiImportModal
      :open="importOpen"
      :spaces="spaceOptions"
      :projects="projectOptions"
      @close="importOpen = false"
      @pick-files="onPickFiles"
      @pick-folder="onPickFolder"
    />

    <ContextMenu
      :open="menu.pos.value !== null"
      :position="menu.pos.value ?? { x: 0, y: 0 }"
      :items="menuItems"
      @close="menu.close()"
      @select="onMenuSelect"
    />

    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: toastColor(tt.kind) }"
    >
      {{ tt.text }}
    </div>
  </section>
</template>

<script setup lang="ts">
// Wiki page (ADR 0073) — the in-app documentation surface that is also the LLM's
// context source. Thin template: all state + handlers live in useWikiManager
// (nuxt-vue page-controller rule); this file wires it to the three panes and the
// import/create/delete confirmations.
import ContextMenu from '~/components/common/ContextMenu.vue'
import WikiEditor from '~/components/wiki/WikiEditor.vue'
import WikiImportModal, { type WikiImportTarget } from '~/components/wiki/WikiImportModal.vue'
import WikiReader from '~/components/wiki/WikiReader.vue'
import WikiSidebar from '~/components/wiki/WikiSidebar.vue'
import { useWikiManager, type WikiTreeNode } from '~/composables/useWikiManager'
import { useConfirm } from '~/composables/useConfirm'
import { useContextMenu } from '~/composables/useContextMenu'
import { useTextPrompt } from '~/composables/useTextPrompt'
import { useToasts } from '~/composables/useToasts'
import type { MenuItem } from '~/composables/useContextMenu'
import type { WikiPage, WikiSearchHit } from '~/stores/wiki'

const { t } = useI18n()
const { confirm } = useConfirm()
const { prompt } = useTextPrompt()
const { toasts, pushToast, toastColor } = useToasts()

const {
  store,
  tree,
  selectedKey,
  selectedPage,
  content,
  loadingPage,
  isCollapsed,
  toggleSpace,
  open,
  mode,
  draft,
  draftPath,
  dirty,
  saving,
  startEdit,
  cancelEdit,
  derivedDescription,
  save,
  createPage,
  createSpace,
  removePage,
  toggleContext,
  resolveLink,
  query,
  hits,
  searching,
  runSearch,
  importTarget,
  lastImport,
  importFilesViaDialog,
  importFolderViaDialog,
  importDrop,
  spaceOptions,
  projectOptions,
  renamePage,
  backlinkCount,
  sidebarWidth,
  setSidebarWidth,
} = useWikiManager()

const dragging = ref(false)

function clearSearch(): void {
  query.value = ''
  hits.value = []
}

async function openHit(hit: WikiSearchHit): Promise<void> {
  clearSearch()
  await open(hit)
}

async function onSave(): Promise<void> {
  const ok = await save()
  pushToast(
    ok ? t('wiki.toast.saved') : store.lastError || t('wiki.toast.saveFailed'),
    ok ? 'success' : 'error',
  )
}

// "+" on a tree row (or the context menu) — create a page nested under that node.
// The parent decides the tier, so a child of a project page stays in the project
// wiki. Notion-style: any page can have children, and a container node can gain one
// even when it has no page of its own.
// The typed name is a TITLE; the path segment is its slug. Typing "Data Flow" should
// give the page that title and the file `data-flow.md`, not a slug with a capital and
// a space in it.
function slugifyName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .toLowerCase()
}

async function onNewChild(node: WikiTreeNode): Promise<void> {
  const name = await prompt({
    title: t('wiki.newChildPrompt.title', { parent: node.title }),
    placeholder: t('wiki.newChildPrompt.placeholder'),
    submitLabel: t('common.create'),
  })
  if (!name) return
  const slug = slugifyName(name)
  if (!slug) {
    pushToast(t('wiki.toast.badName'), 'error')
    return
  }
  const page = await createPage({
    source: node.source,
    ...(node.projectId ? { projectId: node.projectId } : {}),
    path: `${node.path}/${slug}`,
    title: name.trim(),
  })
  if (!page) pushToast(store.lastError || t('wiki.toast.createFailed'), 'error')
}

async function onNewPage(): Promise<void> {
  const path = await prompt({
    title: t('wiki.newPagePrompt.title'),
    placeholder: 'architecture/system-overview',
    submitLabel: t('common.create'),
  })
  if (!path) return
  // A new page lands in the tier the current selection is in, so creating from
  // inside a project wiki stays in that project.
  const current = selectedPage.value
  const page = await createPage({
    source: current?.source ?? 'global',
    ...(current?.projectId ? { projectId: current.projectId } : {}),
    path,
  })
  if (!page) pushToast(store.lastError || t('wiki.toast.createFailed'), 'error')
}

// "Nhập" now opens the target picker; the OS dialog comes after the destination is
// known. Guessing the destination from the current selection is what silently dropped
// an imported file at the wiki root.
const importOpen = ref(false)
function onImportFiles(): void {
  importOpen.value = true
}
function onImportFolder(): void {
  importOpen.value = true
}

async function onPickFiles(target: WikiImportTarget): Promise<void> {
  importOpen.value = false
  await importFilesViaDialog(target)
  reportImport()
}

async function onPickFolder(target: WikiImportTarget): Promise<void> {
  importOpen.value = false
  await importFolderViaDialog(target)
  reportImport()
}

async function onNewSpace(): Promise<void> {
  const name = await prompt({
    title: t('wiki.newSpace.prompt'),
    placeholder: t('wiki.newSpace.placeholder'),
    submitLabel: t('common.create'),
  })
  if (!name) return
  // A new space follows the tier of the current selection, so creating one from
  // inside a project wiki stays in that project.
  const current = selectedPage.value
  const id = await createSpace({
    name,
    source: current?.source ?? 'global',
    ...(current?.projectId ? { projectId: current.projectId } : {}),
  })
  pushToast(
    id ? t('wiki.toast.spaceCreated') : store.lastError || t('wiki.toast.spaceFailed'),
    id ? 'success' : 'error',
  )
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  const current = selectedPage.value
  importTarget.value = {
    source: current?.source ?? 'global',
    ...(current?.projectId ? { projectId: current.projectId } : {}),
    space: current?.space ?? '',
  }
  await importDrop(files)
  reportImport()
}

// Import never fails silently: the toast names how many pages landed and how many
// were skipped, because a partial import that looks complete is the failure mode
// that bites later (ADR 0073 spec).
function reportImport(): void {
  const report = lastImport.value
  if (!report) {
    if (store.lastError) pushToast(store.lastError, 'error')
    return
  }
  if (report.imported === 0 && report.skipped.length === 0) return
  const skipped = report.skipped.length
  pushToast(
    skipped > 0
      ? t('wiki.toast.importedPartial', {
          n: report.imported,
          skipped,
          reason: report.skipped[0]?.reason ?? '',
        })
      : t('wiki.toast.imported', { n: report.imported }),
    skipped > 0 ? 'info' : 'success',
  )
}

async function onDelete(): Promise<void> {
  const page = content.value?.page
  if (!page) return
  const ok = await confirm({
    title: t('wiki.deletePrompt.title'),
    description: t('wiki.deletePrompt.body', { path: page.path }),
    confirmLabel: t('common.delete'),
  })
  if (!ok) return
  await removePage(page)
}

async function onToggleContext(): Promise<void> {
  const page = content.value?.page
  if (!page) return
  await toggleContext(page)
}

async function onFollowLink(target: string): Promise<void> {
  const page = resolveLink(target)
  if (page) {
    await open(page)
    return
  }
  const create = await confirm({
    title: t('wiki.deadLink.title'),
    description: t('wiki.deadLink.body', { target }),
    confirmLabel: t('common.create'),
    kind: 'primary',
  })
  if (!create) return
  const current = selectedPage.value
  const space = current?.space ?? ''
  const path = target.includes('/') || space === '' ? target : `${space}/${target}`
  await createPage({
    source: current?.source ?? 'global',
    ...(current?.projectId ? { projectId: current.projectId } : {}),
    path,
  })
}

// ── Tree context menu ─────────────────────────────────────────────────────
const menu = useContextMenu<WikiPage>()

const menuItems = computed<MenuItem[]>(() => {
  const page = menu.target.value
  if (!page) return []
  return [
    { id: 'open', label: t('wiki.menu.open'), icon: 'file' },
    { id: 'child', label: t('wiki.menu.newChild'), icon: 'plus' },
    { id: 'rename', label: t('wiki.menu.rename'), icon: 'edit' },
    {
      id: 'context',
      label: page.context ? t('wiki.menu.hideFromLlm') : t('wiki.menu.showToLlm'),
      icon: page.context ? 'eye-off' : 'eye',
    },
    { id: 'copy', label: t('wiki.menu.copyPath'), icon: 'copy' },
    { separator: true },
    { id: 'delete', label: t('wiki.menu.delete'), icon: 'trash', danger: true },
  ]
})

function onContextPage(event: MouseEvent, page: WikiPage): void {
  // Right-click: no `.stop` needed — ContextMenu closes on document CLICK, and a
  // contextmenu event is not one (see the ui-next ContextMenu contract).
  menu.open(event, page)
}

async function onMenuSelect(id: string): Promise<void> {
  const page = menu.target.value
  menu.close()
  if (!page) return
  if (id === 'open') {
    await open(page)
    return
  }
  if (id === 'child') {
    // The clicked page becomes the parent: its slug is the child's prefix.
    await onNewChild({
      key: '',
      path: page.path,
      title: page.title,
      description: page.description,
      source: page.source,
      ...(page.projectId ? { projectId: page.projectId } : {}),
      depth: page.path.split('/').length - 1,
      children: [],
      pageCount: 0,
    })
    return
  }
  if (id === 'rename') {
    await onRename(page)
    return
  }
  if (id === 'context') {
    await toggleContext(page)
    return
  }
  if (id === 'copy') {
    try {
      await navigator.clipboard.writeText(page.path)
      pushToast(t('wiki.toast.pathCopied'), 'success')
    } catch {
      pushToast(t('wiki.toast.copyFailed'), 'error')
    }
    return
  }
  if (id === 'delete') {
    const ok = await confirm({
      title: t('wiki.deletePrompt.title'),
      description: t('wiki.deletePrompt.body', { path: page.path }),
      confirmLabel: t('common.delete'),
    })
    if (ok) await removePage(page)
  }
}

// Rename warns about dead backlinks BEFORE moving: v1 does not rewrite `[[links]]`
// pointing at the old slug, and silently breaking them would be the worse default.
async function onRename(page: WikiPage): Promise<void> {
  const links = await backlinkCount(page)
  const next = await prompt({
    title:
      links > 0
        ? t('wiki.renamePrompt.titleWithLinks', { n: links })
        : t('wiki.renamePrompt.title'),
    value: page.path,
    submitLabel: t('wiki.menu.rename'),
  })
  if (!next || next === page.path) return
  const ok = await renamePage(page, next)
  pushToast(
    ok ? t('wiki.toast.renamed') : store.lastError || t('wiki.toast.renameFailed'),
    ok ? 'success' : 'error',
  )
}
</script>

<style scoped>
.wikipage {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 0;
  position: relative;
}
.wk-main {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.wk-blank {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  text-align: center;
}
.wk-blanktitle {
  font-size: 1.3em;
  font-weight: 600;
  margin: 4px 0 0;
}
.wk-blanktext {
  max-width: 420px;
  line-height: 1.6;
  font-size: 1em;
  margin: 0;
}
.wk-blankcta {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.wk-hits {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 10px 12px;
}
.wk-hitshead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.wk-hit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  color: var(--text);
}
.wk-hit:hover {
  background: var(--bgHover);
}
.wk-hittitle {
  font-weight: 500;
  font-size: 1em;
}
.wk-hitpath {
  /* mono-ok: search hit — page path */
  font-family: var(--code);
  font-size: 12px;
  line-height: 18px;
}
.wk-hitprev {
  /* mono-ok: search hit — matching source line */
  font-family: var(--code);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wk-empty {
  padding: 20px 4px;
  font-size: 1em;
}
.wk-drop {
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--accent);
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  color: var(--text);
  font-size: 1em;
  pointer-events: none;
  z-index: 61;
}
</style>
