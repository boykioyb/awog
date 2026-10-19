<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
      <div class="grid size-6.5 shrink-0 place-items-center rounded-sm bg-selected text-primary">
        <Icon name="templates" class="size-4" />
      </div>
      <div class="min-w-0 truncate text-lg font-semibold">{{ template.name }}</div>
      <Badge
        v-if="template.entities.length"
        variant="outline"
        class="rounded-sm text-muted-foreground"
      >
        {{ t('templates.detail.entityCount', { n: template.entities.length }) }}
      </Badge>
      <span class="flex-1" />
      <Button
        v-if="template.sourceUrl"
        :title="t('templatesUpdate.check')"
        variant="outline"
        size="iconMd"
        @click="emit('check-update')"
      >
        <Icon name="refresh" />
      </Button>
      <Button
        :title="t('templates.detail.install')"
        variant="default"
        size="sm"
        @click="emit('install')"
      >
        <Icon name="act" />
        {{ t('templates.detail.install') }}
      </Button>
      <Button
        :title="t('templates.detail.delete')"
        class="hover:border-destructive hover:text-destructive"
        variant="outline"
        size="iconMd"
        @click="emit('delete')"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto p-5">
      <p v-if="template.description" class="mb-4 text-base leading-relaxed text-muted-foreground">
        {{ template.description }}
      </p>

      <!-- Trang chủ do người xuất bản khai, giữ lại từ lúc cài (`.install.json`).
           Chỉ hiện khi nó là link https thật — hỏng thì KHÔNG hiện dòng nào. -->
      <div v-if="safeHomepage" class="mb-4 flex items-baseline gap-2 text-sm">
        <span class="shrink-0 text-dim">{{ t('templates.detail.homepage') }}</span>
        <Button
          variant="link"
          class="h-auto p-0 text-left text-sm font-normal wrap-anywhere whitespace-normal"
          :title="safeHomepage"
          @click="openHomepage"
        >
          {{ safeHomepage }}
        </Button>
      </div>

      <div>
        <div class="mb-3 text-xs font-semibold text-dim">{{ t('templates.detail.entities') }}</div>
        <div v-if="!groups.length" class="text-sm text-dim">
          {{ t('templates.detail.noEntities') }}
        </div>
        <div v-for="g in groups" :key="String(g.kind)" class="mb-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-sm font-medium text-foreground">
              {{ t('templates.kind.' + g.kind) }}
            </span>
            <Badge variant="outline" class="rounded-sm tabular-nums text-muted-foreground">
              {{ g.entities.length }}
            </Badge>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="e in g.entities"
              :key="e.kind + '/' + e.id"
              variant="outline"
              class="rounded-sm font-mono text-muted-foreground"
            >
              {{ e.id }}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Template detail pane — header (install / delete) + the bundled manifest grouped
// by kind (header row + scroll body), matching the skills/agents detail markup. Grouping is derived from the `template` prop so it
// always reflects the row LibraryView has selected (which owns its own selection
// state); the page owns dialog + delete state.
import { computed } from 'vue'
import Button from '~/components/ui/button/Button.vue'
import {
  KIND_ORDER,
  type ConfigKind,
  type ProjectTemplate,
  type TemplateEntityRef,
} from '~/stores/templates'

const props = defineProps<{ template: ProjectTemplate }>()

// `check-update` chỉ phát khi bundle có `sourceUrl` — template tự tạo tại chỗ
// không có nguồn để đối chiếu.
const emit = defineEmits<{ install: []; delete: []; 'check-update': [] }>()

const { t } = useI18n()

// Trang chủ đến từ danh mục do người lạ xuất bản ⇒ L1. Sidecar đã lọc lúc ghi và
// lúc đọc `.install.json` (`templates/homepage.ts`), nhưng đây là bề mặt biến nó
// thành một cú bấm nên tự kiểm lại — cùng luật, cùng lý do như
// `TemplateConsentPanel`: chỉ https, sai hoặc thiếu ⇒ chuỗi rỗng ⇒ không render.
const safeHomepage = computed<string>(() => {
  const raw = props.template.homepage?.trim()
  if (!raw) return ''
  try {
    return new URL(raw).protocol === 'https:' ? raw : ''
  } catch {
    return ''
  }
})

// Mở qua bộ chọn dùng chung (trong app / ra ngoài), rồi mới tới
// shell.openExternal ở main process (gate theo scheme lần nữa ở đó).
// KHÔNG <a target="_blank">.
function openHomepage(): void {
  const url = safeHomepage.value
  if (!url) return
  void useLinkOpen().openLink(url)
}

// Manifest grouped by kind, in canonical kind order, with a count chip per group.
type Group = { kind: ConfigKind; entities: TemplateEntityRef[] }
const groups = computed<Group[]>(() => {
  const byKind = new Map<ConfigKind, TemplateEntityRef[]>()
  for (const e of props.template.entities) {
    const list = byKind.get(e.kind) ?? []
    list.push(e)
    byKind.set(e.kind, list)
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    entities: byKind.get(kind) ?? [],
  }))
})
</script>
