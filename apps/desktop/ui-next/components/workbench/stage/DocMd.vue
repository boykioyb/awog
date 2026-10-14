<template>
  <!-- Doc 'md' — markdown: vbar (path + metadata + seg Preview/Edit), mặc định
       Preview. Preview đi qua useMarkdown + SessionMarkdownHtml (render an toàn
       + mermaid block thành MermaidView sống); Edit là Monaco chung một file
       state với DocFile nên ● dirty và ⌘S hoạt động giống nhau. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-[var(--bgEl)]"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="sizeLabel" class="flex-none text-[var(--textFaint)]">· {{ sizeLabel }}</span>
      <span class="ml-auto inline-flex flex-none items-center gap-0.5">
        <!-- Action icon — port từ PreviewModal header (reveal / copy path / copy
             content rendered / copy raw md), gom gọn dạng icon-only. -->
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.preview.reveal')"
          :aria-label="t('common.preview.reveal')"
          @click="onReveal"
        >
          <Icon name="folder" />
        </Button>
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.preview.copyPath')"
          :aria-label="t('common.preview.copyPath')"
          @click="onCopyPath"
        >
          <Icon
            :name="copied === 'path' ? 'check' : 'link'"
            :class="{ 'text-success': copied === 'path' }"
          />
        </Button>
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.copy')"
          :aria-label="t('common.copy')"
          @click="onCopyContent"
        >
          <Icon
            :name="copied === 'content' ? 'check' : 'copy'"
            :class="{ 'text-success': copied === 'content' }"
          />
        </Button>
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.copyMarkdown')"
          :aria-label="t('common.copyMarkdown')"
          @click="onCopyRaw"
        >
          <Icon
            :name="copied === 'raw' ? 'check' : 'code'"
            :class="{ 'text-success': copied === 'raw' }"
          />
        </Button>
      </span>
      <!-- Reading-width stepper (port PreviewToolbar): Fold/Unfold + label,
           chỉ hữu dụng ở Preview — Edit giữ Monaco full-width. -->
      <span v-if="mode === 'preview'" class="inline-flex flex-none items-center gap-0.5">
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.widthNarrower')"
          :aria-label="t('common.widthNarrower')"
          @click="stepWidth(-1)"
        >
          <FoldHorizontal :size="14" />
        </Button>
        <span class="min-w-[30px] text-center text-xs tabular-nums text-[var(--textFaint)]">
          {{ widthLabel }}
        </span>
        <Button
          class="size-6 rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.widthWider')"
          :aria-label="t('common.widthWider')"
          @click="stepWidth(1)"
        >
          <UnfoldHorizontal :size="14" />
        </Button>
      </span>
      <DocReloadButton :doc="props.doc" @reloaded="onReloaded" />
      <DocButtonGroup :options="modeOptions" :active="mode" @select="mode = $event" />
    </div>
    <div
      v-if="st.status === 'loading' || st.status === 'idle'"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.file.loading') }}
    </div>
    <div
      v-else-if="st.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-destructive"
    >
      {{ st.error }}
    </div>
    <div
      v-else-if="st.status === 'ok' && !st.content"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.file.empty') }}
    </div>
    <template v-else>
      <div v-show="mode === 'preview'" class="flex min-h-0 flex-1">
        <!-- TOC aside + collapsed rail — port PreviewModal markdown outline
             (useMarkdownOutline). Click scrolls, scroll highlights active. -->
        <aside
          v-if="headings.length && !outlineCollapsed"
          class="flex-none basis-[220px] overflow-y-auto border-r border-[var(--border)] px-2 py-3.5"
          :style="{ background: 'color-mix(in srgb, var(--muted) 30%, transparent)' }"
        >
          <div class="flex items-center gap-1 px-1 pb-2">
            <div class="min-w-0 flex-1 px-1 text-xs font-semibold text-[var(--textFaint)]">
              {{ t('common.outline') }}
            </div>
            <Button
              class="size-6 flex-none rounded-[var(--r-xs)] text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
              variant="ghost"
              size="iconSm"
              type="button"
              :title="t('common.preview.collapseOutline')"
              :aria-label="t('common.preview.collapseOutline')"
              @click="outlineCollapsed = true"
            >
              <PanelLeftClose :size="14" />
            </Button>
          </div>
          <button
            v-for="h in headings"
            :key="h.id"
            class="block h-auto w-full truncate rounded-[var(--r-xs)] px-2.5 py-[5px] text-left text-sm font-normal"
            :class="
              h.id === activeHeading
                ? 'bg-[var(--accentDim)] text-[var(--accent)]'
                : 'text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]'
            "
            type="button"
            @click="goto(h.id)"
          >
            {{ h.text }}
          </button>
        </aside>
        <Button
          v-else-if="headings.length"
          class="h-auto w-[34px] flex-none items-start self-stretch rounded-none border-r border-[var(--border)] bg-transparent px-0 pt-3 text-dim hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.preview.expandOutline')"
          :aria-label="t('common.preview.expandOutline')"
          @click="outlineCollapsed = false"
        >
          <PanelLeftOpen :size="14" />
        </Button>
        <div
          ref="mdScroll"
          class="flex min-w-0 flex-1 flex-col overflow-auto"
          @scroll="onScroll"
          @mouseup="onSelMouseUp"
          @contextmenu="onSelContextMenu"
        >
          <div
            ref="mdBody"
            data-mdview
            class="mx-auto w-full max-w-[720px] px-6 py-5 text-base text-[var(--text)] [line-height:var(--lh-prose)]"
            :style="{ maxWidth: mdMaxWidth }"
          >
            <template v-for="(seg, i) in segments" :key="i">
              <MermaidView v-if="seg.type === 'mermaid' && seg.closed" :code="seg.code" />
              <pre
                v-else-if="seg.type !== 'html'"
                class="overflow-x-auto whitespace-pre-wrap rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bgPanel)] px-3 py-2.5 font-mono text-xs text-[var(--textMuted)]"
                >{{ seg.code }}</pre
              >
              <SessionMarkdownHtml v-else :html="seg.html" />
            </template>
          </div>
        </div>
      </div>
      <div v-show="mode === 'edit'" class="min-h-0 flex-1 overflow-hidden">
        <MonacoEditor
          ref="edRef"
          :path="props.doc.id"
          @ready="onReady"
          @change="(p) => wbDocs.markEdit(props.doc, p.value)"
          @save="void wbDocs.saveFile(props.doc)"
        />
      </div>
    </template>
    <!-- Bôi đen trong preview → thanh action nổi (Copy / Copy MD / Translate).
         Cùng idiom với .selactions của SessionDetail: fixed, neo vào đỉnh
         selection (mouseup) hoặc con trỏ (chuột phải). -->
    <div
      v-if="sel"
      class="selactions inline-flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--popover)] p-1 shadow-[var(--shadow-lg)]"
      :style="{ '--sel-x': `${sel.x}px`, '--sel-y': `${sel.y}px` }"
      @mousedown.prevent
    >
      <Button
        class="h-auto gap-[5px] rounded-[var(--r-sm)] px-2.5 py-[5px] text-sm font-normal text-[var(--popover-foreground)]"
        variant="ghost"
        type="button"
        @click="onCopyText"
      >
        <Icon
          :name="copied === 'text' ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ copied === 'text' ? t('common.copied') : t('common.copy') }}
      </Button>
      <Button
        class="h-auto gap-[5px] rounded-[var(--r-sm)] px-2.5 py-[5px] text-sm font-normal text-[var(--popover-foreground)]"
        variant="ghost"
        type="button"
        @click="onCopyMarkdown"
      >
        <Icon
          :name="copied === 'md' ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ copied === 'md' ? t('common.copied') : t('common.copyMarkdown') }}
      </Button>
      <Button
        class="h-auto gap-[5px] rounded-[var(--r-sm)] px-2.5 py-[5px] text-sm font-normal text-[var(--popover-foreground)]"
        variant="ghost"
        type="button"
        @click="onTranslate"
      >
        <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('translate.action') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WorkbenchDoc } from '~/types/workbench'
import { useDocMd } from '~/composables/useDocMd'
import MonacoEditor from '~/components/common/MonacoEditor.vue'
import SessionMarkdownHtml from '~/components/session/SessionMarkdownHtml.vue'
import MermaidView from '~/components/common/MermaidView.vue'
import Icon from '~/components/Icon.vue'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'
import DocButtonGroup from '~/components/workbench/stage/DocButtonGroup.vue'
import { FoldHorizontal, UnfoldHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

const props = defineProps<{ doc: WorkbenchDoc }>()

// Logic + state: useDocMd (page-controller — file vượt ~250 dòng). Template
// ref (`mdScroll` của useMarkdownOutline + `mdBody`/`edRef` ở đây) đăng ký trên
// instance này.
const {
  t,
  wbDocs,
  st,
  rel,
  mode,
  modeOptions,
  onReloaded,
  sizeLabel,
  segments,
  outlineCollapsed,
  headings,
  activeHeading,
  goto,
  onScroll,
  mdMaxWidth,
  widthLabel,
  stepWidth,
  edRef,
  onReady,
  sel,
  copied,
  onSelMouseUp,
  onSelContextMenu,
  onCopyText,
  onCopyMarkdown,
  onTranslate,
  onReveal,
  onCopyPath,
  onCopyContent,
  onCopyRaw,
} = useDocMd(props.doc)
</script>

<style scoped>
/* Selection action bar — same idiom as SessionDetail .selactions: fixed,
   anchored to the selection top (mouseup) or the cursor (right-click). Layout
   đã Tailwind ở template; scoped chỉ giữ phần Tailwind không diễn đạt: transform
   translate(clamp/max) neo vào --sel-x/--sel-y. */
.selactions {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 80;
  transform: translate(
    clamp(8px, calc(var(--sel-x, 0px) - 50%), calc(100vw - 100% - 8px)),
    max(8px, calc(var(--sel-y, 0px) - 100%))
  );
}
</style>
