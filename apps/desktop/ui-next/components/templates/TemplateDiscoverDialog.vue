<template>
  <LibraryEntityModal
    :open="open"
    :title="inspection ? t('templatesDiscover.consent.title') : t('templatesDiscover.title')"
    :lock-scrim="installing"
    :width="620"
    @close="emit('close')"
  >
    <TemplateConsentPanel v-if="inspection" :inspection="inspection" :homepage="pickedHomepage" />

    <div v-else class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <Icon name="search" class="size-3.5 shrink-0 text-dim" />
        <Input v-model="query" type="text" :placeholder="t('templatesDiscover.search')" />
        <Button
          variant="outline"
          size="iconMd"
          class="shrink-0 text-dim"
          :title="t('templatesDiscover.refresh')"
          :disabled="loading"
          @click="load(true)"
        >
          <Icon name="refresh" />
        </Button>
      </div>

      <p class="text-xs leading-relaxed" :class="result.stale ? 'text-warning' : 'text-dim'">
        {{ originText }}
      </p>

      <div class="flex max-h-85 flex-col gap-1.5 overflow-y-auto">
        <p v-if="loading" class="text-xs leading-relaxed text-dim">
          {{ t('templatesDiscover.loading') }}
        </p>
        <p v-else-if="!result.entries.length" class="text-xs leading-relaxed text-dim">
          {{ emptyText }}
        </p>
        <template v-else>
          <Button
            v-for="e in result.entries"
            :key="e.id"
            variant="outline"
            class="h-auto w-full items-start justify-start gap-2.5 rounded-lg bg-muted px-3 py-2 text-left font-normal whitespace-normal hover:border-primary disabled:opacity-60"
            :disabled="inspectingId !== ''"
            @click="onPick(e)"
          >
            <Icon name="templates" class="mt-0.5 text-dim" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                {{ e.name }}
                <Badge v-if="e.version" variant="outline" class="rounded-sm text-muted-foreground">
                  {{ e.version }}
                </Badge>
                <Badge
                  v-for="kind in e.kinds"
                  :key="kind"
                  variant="outline"
                  class="rounded-sm text-muted-foreground"
                >
                  {{ t('templates.kind.' + kind) }}
                </Badge>
              </span>
              <span class="truncate text-xs text-dim">{{ e.description || e.id }}</span>
              <span v-if="e.author" class="truncate text-xs text-muted-foreground">
                {{ t('templatesDiscover.by', { author: e.author }) }}
              </span>
            </span>
            <Icon name="chev-right" class="mt-0.5 text-dim" />
          </Button>
        </template>
      </div>

      <p class="text-xs leading-relaxed text-dim">{{ t('templatesDiscover.curatedNote') }}</p>
    </div>

    <div
      v-if="error"
      class="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive"
    >
      {{ error }}
    </div>

    <template #footer>
      <Button v-if="inspection" :disabled="installing" variant="outline" @click="back">
        {{ t('templatesDiscover.consent.back') }}
      </Button>
      <Button v-else variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button
        v-if="inspection"
        :disabled="installing || !inspection.entities.length"
        variant="default"
        @click="onInstall"
      >
        {{ installing ? t('templatesDiscover.installing') : installLabel }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Khám phá template từ danh mục AWOG công bố (gói #37) — hai bước trong một hộp
// thoại: DUYỆT (tìm + danh sách) rồi ĐỒNG Ý (nội dung thật của bundle).
//
// Bấm một mục KHÔNG cài gì: nó gọi `marketplaceInspect` để đọc `template.json`
// của bundle và dựng màn hình đồng ý. Chỉ nút ở màn hình đó mới ghi, và nó gửi
// kèm `token` của bản kiểm tra — engine từ chối nếu nguồn đã đổi từ lúc đó và trả
// về bản mới, thứ ta hiển thị lại thay vì nuốt.
//
// Offline giảm cấp đúng như bản MCP: cache cũ + banner nói rõ, rồi tới danh sách
// rỗng có giải thích.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import TemplateConsentPanel from '~/components/templates/TemplateConsentPanel.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import {
  useTemplatesStore,
  type MarketplaceEntry,
  type MarketplaceInspection,
  type MarketplaceResult,
} from '~/stores/templates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; installed: [{ name: string; templateId: string }] }>()

const { t } = useI18n()
const store = useTemplatesStore()

const SEARCH_DEBOUNCE_MS = 300

const query = ref('')
const loading = ref(false)
const error = ref('')
const inspectingId = ref('')
const installing = ref(false)
const inspection = ref<MarketplaceInspection | null>(null)
// Trang chủ người xuất bản khai — chỉ có ở ENTRY của danh mục, `inspection` không
// mang nó. Giữ lại của đúng entry vừa bấm để màn hình đồng ý hiện được.
const pickedHomepage = ref('')
const result = ref<MarketplaceResult>({
  entries: [],
  origin: 'offline',
  fetchedAt: null,
  stale: false,
})

async function load(refresh = false): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    result.value = await store.marketplaceList({
      query: query.value.trim(),
      ...(refresh ? { refresh: true } : {}),
    })
  } catch (err) {
    result.value = {
      entries: [],
      origin: 'offline',
      fetchedAt: null,
      stale: true,
      error: err instanceof Error ? err.message : 'catalog unavailable',
    }
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    error.value = ''
    inspection.value = null
    pickedHomepage.value = ''
    installing.value = false
    inspectingId.value = ''
    void load()
  },
  { immediate: true },
)

const back = () => {
  inspection.value = null
  pickedHomepage.value = ''
  error.value = ''
}

// Đọc nội dung thật của bundle. Không ghi gì — đây chỉ là bước dựng màn hình đồng ý.
async function onPick(entry: MarketplaceEntry): Promise<void> {
  if (inspectingId.value) return
  inspectingId.value = entry.id
  error.value = ''
  try {
    inspection.value = await store.marketplaceInspect(entry.id)
    pickedHomepage.value = entry.homepage ?? ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('templatesDiscover.inspectFailed')
  } finally {
    inspectingId.value = ''
  }
}

async function onInstall(): Promise<void> {
  const current = inspection.value
  if (!current || installing.value) return
  installing.value = true
  error.value = ''
  try {
    const res = await store.marketplaceInstall({
      id: current.entryId,
      token: current.token,
      overwrite: current.alreadyInstalled,
    })
    if (res.status === 'changed') {
      // Nguồn đổi giữa lúc đọc và lúc bấm: không ghi gì, hiện lại nội dung MỚI.
      inspection.value = res.inspection
      error.value = t('templatesDiscover.consent.sourceChanged')
      return
    }
    if (res.status === 'exists') {
      error.value = t('templatesDiscover.consent.exists', { id: res.templateId })
      return
    }
    emit('installed', { name: res.template.name, templateId: res.template.id })
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('templatesDiscover.installFailed')
  } finally {
    installing.value = false
  }
}

const installLabel = computed(() =>
  inspection.value?.alreadyInstalled
    ? t('templatesDiscover.consent.reinstall')
    : t('templatesDiscover.consent.confirm'),
)

const emptyText = computed(() => {
  const r = result.value
  if (query.value.trim() && r.entries.length === 0 && r.origin !== 'offline') {
    return t('templatesDiscover.emptySearch', { query: query.value.trim() })
  }
  return r.origin === 'offline' ? t('templatesDiscover.emptyOffline') : t('templatesDiscover.empty')
})

const originText = computed(() => {
  const r = result.value
  if (r.stale && r.error) return t('templatesDiscover.stale', { error: r.error })
  if (r.origin === 'offline') return t('templatesDiscover.origin.offline')
  if (r.origin === 'cache') {
    return t('templatesDiscover.origin.cache', {
      when: r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : '—',
    })
  }
  return t('templatesDiscover.origin.network')
})
</script>
