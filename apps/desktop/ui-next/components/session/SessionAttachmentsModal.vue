<template>
  <div v-if="open" class="ovl on amovl" @click.self="emit('close')">
    <div class="amcard">
      <div class="amhead">
        <Icon name="clip" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <span class="amtitle">
          {{ t('sessions.attachment.allTitle', { n: attachments.length }) }}
        </span>
        <span style="flex: 1" />
        <button class="amxbtn" :title="t('common.close')" @click="emit('close')">
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <div class="amgrid">
        <div
          v-for="(a, i) in attachments"
          :key="i"
          class="amitem"
          :title="t('sessions.attachment.preview')"
          @click="emit('preview', i)"
        >
          <span class="amthumb">
            <img v-if="a.img && a.src" :src="a.src" class="amimg" :alt="a.name" />
            <span v-else-if="a.img" class="thumb" />
            <Icon v-else name="rules" style="width: var(--icon-md); height: var(--icon-md)" />
          </span>
          <span class="aminfo">
            <span class="amname">{{ a.name }}</span>
            <span v-if="fmtSize(a.size)" class="ammeta">{{ fmtSize(a.size) }}</span>
          </span>
          <button
            class="amrm"
            :title="t('sessions.attachment.remove')"
            @click.stop="emit('remove', i)"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Overflow modal: lists ALL pending attachments when the composer has too many to
// show inline. Each row → click previews, × removes. Reuses the prototype .ovl scrim.
import type { SessionAttachment } from '~/composables/useSessionsData'

const props = defineProps<{ open: boolean; attachments: SessionAttachment[] }>()
const emit = defineEmits<{ close: []; preview: [i: number]; remove: [i: number] }>()
const { t } = useI18n()

function fmtSize(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function onKey(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.amovl {
  align-items: center;
  padding: 48px;
  cursor: default;
}
.amcard {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 680px;
  max-height: 80vh;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.amhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.amtitle {
  font-weight: 600;
}
.amxbtn {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
}
.amxbtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.amgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
  padding: 14px;
  overflow: auto;
  min-height: 0;
}
.amitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgActive);
  cursor: pointer;
  min-width: 0;
}
.amitem:hover {
  border-color: var(--accentBorder);
}
.amthumb {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: var(--r-xs);
  overflow: hidden;
  color: var(--textDim);
}
.amimg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb {
  width: 20px;
  height: 20px;
  border-radius: var(--r-xs);
  background: linear-gradient(135deg, var(--blue), var(--violet));
}
.aminfo {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.amname {
  /* mono-ok: attachment file name */
  font-family: var(--code);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ammeta {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.amrm {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--r-xs);
  flex: 0 0 auto;
  color: var(--textDim);
  cursor: pointer;
}
.amrm:hover {
  background: var(--dangerBg);
  color: var(--danger);
}
</style>
