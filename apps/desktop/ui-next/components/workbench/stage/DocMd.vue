<template>
  <!-- Doc 'md' — markdown: vbar (path + metadata + seg Preview/Edit), mặc định
       Preview. Preview đi qua useMarkdown + SessionMarkdownHtml (render an toàn
       + mermaid block thành MermaidView sống); Edit là Monaco chung một file
       state với DocFile nên ● dirty và ⌘S hoạt động giống nhau. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-card"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="sizeLabel" class="flex-none text-faint">· {{ sizeLabel }}</span>
      <span class="ml-auto inline-flex flex-none items-center gap-0.5">
        <!-- Action icon — port từ PreviewModal header (reveal / copy path / copy
             content rendered / copy raw md), gom gọn dạng icon-only. -->
        <Button
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
          variant="ghost"
          size="iconSm"
          type="button"
          :title="t('common.widthNarrower')"
          :aria-label="t('common.widthNarrower')"
          @click="stepWidth(-1)"
        >
          <FoldHorizontal :size="14" />
        </Button>
        <span class="min-w-7.5 text-center text-xs tabular-nums text-faint">
          {{ widthLabel }}
        </span>
        <Button
          class="size-6 rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
      class="grid min-h-0 flex-1 place-items-center text-sm text-faint"
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
      class="grid min-h-0 flex-1 place-items-center text-sm text-faint"
    >
      {{ t('workbench.file.empty') }}
    </div>
    <template v-else>
      <div v-show="mode === 'preview'" class="flex min-h-0 flex-1">
        <!-- TOC aside + collapsed rail — port PreviewModal markdown outline
             (useMarkdownOutline). Click scrolls, scroll highlights active. -->
        <aside
          v-if="headings.length && !outlineCollapsed"
          class="flex-none basis-55 overflow-y-auto border-r border-border bg-muted/30 px-2 py-3.5"
        >
          <div class="flex items-center gap-1 px-1 pb-2">
            <div class="min-w-0 flex-1 px-1 text-xs font-semibold text-faint">
              {{ t('common.outline') }}
            </div>
            <Button
              class="size-6 flex-none rounded-sm text-dim hover:bg-accent hover:text-foreground"
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
          <Button
            v-for="h in headings"
            :key="h.id"
            variant="ghost"
            class="block h-auto w-full truncate rounded-sm px-2.5 py-1 text-left text-sm font-normal"
            :class="
              h.id === activeHeading
                ? 'bg-selected text-primary'
                : 'text-dim hover:bg-accent hover:text-foreground'
            "
            type="button"
            @click="goto(h.id)"
          >
            {{ h.text }}
          </Button>
        </aside>
        <Button
          v-else-if="headings.length"
          class="h-auto w-8.5 flex-none items-start self-stretch rounded-none border-r border-border bg-transparent px-0 pt-3 text-dim hover:bg-accent hover:text-foreground"
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
            class="mx-auto w-full max-w-180 px-6 py-5 text-base text-foreground leading-(--lh-prose)"
            :style="{ maxWidth: mdMaxWidth }"
          >
            <template v-for="(seg, i) in segments" :key="i">
              <MermaidView v-if="seg.type === 'mermaid' && seg.closed" :code="seg.code" />
              <pre
                v-else-if="seg.type !== 'html'"
                class="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-sidebar px-3 py-2.5 font-mono text-xs text-muted-foreground"
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
         selection (mouseup) hoặc con trỏ (chuột phải) qua --sel-x/--sel-y; transform
         kẹp trong khung nhìn (cách mép 8px). -->
    <div
      v-if="sel"
      class="fixed left-0 top-0 z-80 inline-flex max-w-[calc(100vw-16px)] items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg [transform:translate(clamp(8px,calc(var(--sel-x,0px)_-_50%),calc(100vw_-_100%_-_8px)),max(8px,calc(var(--sel-y,0px)_-_100%)))]"
      :style="{ '--sel-x': `${sel.x}px`, '--sel-y': `${sel.y}px` }"
      @mousedown.prevent
    >
      <Button
        class="h-auto gap-1 rounded-md px-2.5 py-1 text-sm font-normal text-popover-foreground"
        variant="ghost"
        type="button"
        @click="onCopyText"
      >
        <Icon class="size-3.5" :name="copied === 'text' ? 'check' : 'copy'" />
        {{ copied === 'text' ? t('common.copied') : t('common.copy') }}
      </Button>
      <Button
        class="h-auto gap-1 rounded-md px-2.5 py-1 text-sm font-normal text-popover-foreground"
        variant="ghost"
        type="button"
        @click="onCopyMarkdown"
      >
        <Icon class="size-3.5" :name="copied === 'md' ? 'check' : 'copy'" />
        {{ copied === 'md' ? t('common.copied') : t('common.copyMarkdown') }}
      </Button>
      <Button
        class="h-auto gap-1 rounded-md px-2.5 py-1 text-sm font-normal text-popover-foreground"
        variant="ghost"
        type="button"
        @click="onTranslate"
      >
        <Icon class="size-3.5" name="globe" />
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
