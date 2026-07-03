<template>
  <div class="pvbar">
    <!-- transient action feedback (copied / saved / error) -->
    <div v-if="actionMsg" class="pvmsg" :class="{ err: actionErr }">{{ actionMsg }}</div>

    <!-- image: zoom / rotate / flip -->
    <template v-if="item?.kind === 'image'">
      <button
        class="pvtb"
        :title="t('common.zoomOut')"
        :aria-label="t('common.zoomOut')"
        @click="zoomBy(-0.2)"
      >
        <ZoomOut :size="15" />
      </button>
      <span class="pvz">{{ Math.round(scale * 100) }}%</span>
      <button
        class="pvtb"
        :title="t('common.zoomIn')"
        :aria-label="t('common.zoomIn')"
        @click="zoomBy(0.2)"
      >
        <ZoomIn :size="15" />
      </button>
      <button
        class="pvtb"
        :title="t('common.zoomReset')"
        :aria-label="t('common.zoomReset')"
        @click="resetView()"
      >
        <Maximize2 :size="15" />
      </button>
      <span class="pvsep" />
      <button
        class="pvtb"
        :title="t('common.rotateLeft')"
        :aria-label="t('common.rotateLeft')"
        @click="rotate -= 90"
      >
        <RotateCcw :size="15" />
      </button>
      <button
        class="pvtb"
        :title="t('common.rotateRight')"
        :aria-label="t('common.rotateRight')"
        @click="rotate += 90"
      >
        <RotateCw :size="15" />
      </button>
      <span class="pvsep" />
      <button
        class="pvtb"
        :title="t('common.flipH')"
        :aria-label="t('common.flipH')"
        @click="flipH = !flipH"
      >
        <FlipHorizontal2 :size="15" />
      </button>
      <button
        class="pvtb"
        :title="t('common.flipV')"
        :aria-label="t('common.flipV')"
        @click="flipV = !flipV"
      >
        <FlipVertical2 :size="15" />
      </button>
    </template>

    <!-- markdown: render/raw + copy + reading width -->
    <template v-else-if="item?.kind === 'markdown'">
      <button
        class="pvtb"
        :class="{ on: view === 'render' }"
        :title="t('common.render')"
        @click="view = 'render'"
      >
        <Icon name="rules" style="width: 14px; height: 14px" />
      </button>
      <button
        class="pvtb"
        :class="{ on: view === 'raw' }"
        :title="t('common.raw')"
        @click="view = 'raw'"
      >
        <Icon name="commands" style="width: 14px; height: 14px" />
      </button>
      <span class="pvsep" />
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: 13px; height: 13px" />
      </button>
      <template v-if="view === 'render'">
        <span class="pvsep" />
        <button
          class="pvtb"
          :title="t('common.widthNarrower')"
          :aria-label="t('common.widthNarrower')"
          @click="stepWidth(-1)"
        >
          <FoldHorizontal :size="15" />
        </button>
        <span class="pvz">{{ widthLabel }}</span>
        <button
          class="pvtb"
          :title="t('common.widthWider')"
          :aria-label="t('common.widthWider')"
          @click="stepWidth(1)"
        >
          <UnfoldHorizontal :size="15" />
        </button>
      </template>
    </template>

    <!-- html: render/raw toggle + reload (render) + copy -->
    <template v-else-if="item?.kind === 'html'">
      <button
        class="pvtb"
        :class="{ on: view === 'render' }"
        :title="t('common.render')"
        @click="view = 'render'"
      >
        <Icon name="globe" style="width: 14px; height: 14px" />
      </button>
      <button
        class="pvtb"
        :class="{ on: view === 'raw' }"
        :title="t('common.raw')"
        @click="view = 'raw'"
      >
        <Icon name="commands" style="width: 14px; height: 14px" />
      </button>
      <span class="pvsep" />
      <button v-if="view === 'render'" class="pvtb" :title="t('common.reload')" @click="reload()">
        <Icon name="refresh" style="width: 13px; height: 13px" />
      </button>
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: 13px; height: 13px" />
      </button>
    </template>

    <!-- text: copy -->
    <template v-else-if="item?.kind === 'text'">
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: 13px; height: 13px" />
      </button>
    </template>

    <!-- theme picker — only when the Monaco viewer is showing (code / raw markdown) -->
    <template v-if="showCode">
      <span class="pvsep" />
      <div class="pvdd">
        <button class="pvtb wide" :title="t('common.preview.theme')" @click="toggle('theme')">
          <Icon name="palette" style="width: 14px; height: 14px" />
          <span class="pvz auto">{{ currentThemeLabel }}</span>
        </button>
        <div v-if="open === 'theme'" class="pvmenu up" @click.stop>
          <template v-for="g in themeGroups" :key="g.key">
            <div v-if="g.items.length" class="pvmhd">{{ t(`common.preview.group.${g.key}`) }}</div>
            <button
              v-for="opt in g.items"
              :key="opt.id"
              class="pvmi"
              :class="{ on: current === opt.id }"
              @click="pickTheme(opt.id)"
            >
              <Icon v-if="current === opt.id" name="check" style="width: 13px; height: 13px" />
              <span v-else class="pvmidot" />
              {{ opt.id === FOLLOW_APP ? t('common.preview.followApp') : opt.label }}
            </button>
          </template>
        </div>
      </div>
    </template>

    <!-- edit / save -->
    <template v-if="isEditableFile">
      <span class="pvsep" />
      <button v-if="!editMode" class="pvtb" :title="t('common.preview.edit')" @click="startEdit()">
        <Icon name="edit" style="width: 13px; height: 13px" />
      </button>
      <template v-else>
        <button
          class="pvtb"
          :class="{ on: dirty }"
          :title="t('common.preview.save')"
          @click="save()"
        >
          <Icon name="save" style="width: 14px; height: 14px" />
        </button>
        <button class="pvtb" :title="t('common.cancel')" @click="cancelEdit()">
          <Icon name="x" style="width: 13px; height: 13px" />
        </button>
      </template>
    </template>

    <!-- actions menu (workspace-file ops + add-to-chat) -->
    <template v-if="hasWorkspaceFile || canAddToChat">
      <span class="pvsep" />
      <div class="pvdd">
        <button class="pvtb" :title="t('common.preview.actions')" @click="toggle('menu')">
          <Icon name="dots" style="width: 16px; height: 16px" />
        </button>
        <div v-if="open === 'menu'" class="pvmenu up right" @click.stop>
          <button v-if="canAddToChat" class="pvmi" @click="run(addToChat)">
            <Icon name="clip" style="width: 13px; height: 13px" />
            {{ t('common.preview.addToChat') }}
          </button>
          <template v-if="hasWorkspaceFile">
            <div v-if="canAddToChat" class="pvmsep" />
            <button class="pvmi" @click="run(reveal)">
              <Icon name="folder" style="width: 13px; height: 13px" />
              {{ t('common.preview.reveal') }}
            </button>
            <button class="pvmi" @click="run(openInBrowser)">
              <Icon name="globe" style="width: 13px; height: 13px" />
              {{ t('common.preview.openBrowser') }}
            </button>
            <button class="pvmi" @click="run(copyPath)">
              <Icon name="copy" style="width: 13px; height: 13px" />
              {{ t('common.preview.copyPath') }}
            </button>
            <div class="pvmsep" />
            <button class="pvmi" @click="run(() => openRename('rename'))">
              <Icon name="edit" style="width: 13px; height: 13px" />
              {{ t('common.preview.rename') }}
            </button>
            <button class="pvmi" @click="run(() => openRename('move'))">
              <Icon name="move" style="width: 13px; height: 13px" />
              {{ t('common.preview.move') }}
            </button>
            <div class="pvmsep" />
            <button class="pvmi danger" @click="run(askDelete)">
              <Icon name="trash" style="width: 13px; height: 13px" />
              {{ t('common.delete') }}
            </button>
          </template>
        </div>
      </div>
    </template>

    <!-- click-away backdrop for whichever dropdown is open -->
    <div v-if="open" class="pvddback" @click="open = null" />
  </div>
</template>

<script setup lang="ts">
// Floating control bar for the PreviewModal (extracted so the modal SFC stays
// thin). Presentational: it receives the modal's controller and drives it; the
// only state it owns is which dropdown (theme/actions) is open. The theme list is
// read straight from useMonacoTheme (module-level shared state).
import {
  FlipHorizontal2,
  FlipVertical2,
  FoldHorizontal,
  Maximize2,
  RotateCcw,
  RotateCw,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next'
import { FOLLOW_APP, useMonacoTheme } from '~/composables/useMonacoTheme'
import type { PreviewController } from '~/composables/usePreviewModal'

const props = defineProps<{ ctrl: PreviewController }>()

const { t } = useI18n()

// Destructure stable ref/fn members so they unwrap in the template (the controller
// object is created once in the parent, so its members are stable).
const {
  item,
  showCode,
  isEditableFile,
  editMode,
  dirty,
  hasWorkspaceFile,
  canAddToChat,
  view,
  scale,
  rotate,
  flipH,
  flipV,
  zoomBy,
  resetView,
  copyContent,
  reload,
  startEdit,
  save,
  cancelEdit,
  reveal,
  openInBrowser,
  copyPath,
  addToChat,
  openRename,
  askDelete,
  actionMsg,
  actionErr,
} = props.ctrl
const { widthValue, stepWidth } = props.ctrl.outline

const { themes, current, setTheme } = useMonacoTheme()

const open = ref<'theme' | 'menu' | null>(null)
function toggle(which: 'theme' | 'menu') {
  open.value = open.value === which ? null : which
}
// Run a menu action then close the dropdown.
function run(fn: () => void) {
  open.value = null
  fn()
}
function pickTheme(id: string) {
  void setTheme(id)
  open.value = null
}

const widthLabel = computed(() =>
  widthValue.value === 0 ? t('common.full') : String(widthValue.value),
)
const currentThemeLabel = computed(() => {
  if (current.value === FOLLOW_APP) return t('common.preview.followApp')
  return themes.find((o) => o.id === current.value)?.label ?? current.value
})
const themeGroups = [
  { key: 'app', items: themes.filter((o) => o.group === 'app') },
  { key: 'dark', items: themes.filter((o) => o.group === 'dark') },
  { key: 'light', items: themes.filter((o) => o.group === 'light') },
]
</script>

<style scoped>
/* Floating control bar — horizontally centered near the bottom of the window. */
.pvbar {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
/* Icon button — sized to match the workspace-panel buttons (.wpib, 28px) so the
   preview controls read as the same family as the rest of the app's chrome. */
.pvtb {
  display: grid;
  grid-auto-flow: column;
  place-items: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border-radius: 8px;
  color: var(--textDim);
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
}
.pvtb.wide {
  padding: 0 10px;
}
.pvtb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pvtb.on {
  background: var(--accent);
  color: var(--bg);
}
.pvz {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  min-width: 40px;
  text-align: center;
}
.pvz.auto {
  min-width: 0;
  color: inherit;
}
.pvsep {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 3px;
}

/* dropdown (theme picker / actions) */
.pvdd {
  position: relative;
  display: flex;
}
.pvmenu {
  position: absolute;
  z-index: 7;
  min-width: 188px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 5px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}
.pvmenu.up {
  bottom: calc(100% + 8px);
}
.pvmenu.right {
  right: 0;
}
.pvmhd {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  padding: 6px 8px 3px;
}
.pvmi {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: 7px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
}
.pvmi:hover {
  background: var(--bgHover);
}
.pvmi.on {
  color: var(--accent);
}
.pvmi.danger {
  color: var(--danger);
}
.pvmi.danger:hover {
  background: var(--dangerBg);
}
.pvmidot {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}
.pvmsep {
  height: 1px;
  background: var(--border);
  margin: 4px 2px;
}
.pvddback {
  position: fixed;
  inset: 0;
  z-index: 6;
  cursor: default;
}

/* transient action feedback pill, floating above the bar */
.pvmsg {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 5px 11px;
  border-radius: 8px;
  font-size: 12px;
  font-family: var(--code);
  background: var(--bgActive);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
}
.pvmsg.err {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
