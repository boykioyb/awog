<template>
  <ConnectionDiscoverDetail
    v-if="selected"
    :entry="selected"
    @back="selected = null"
    @use="emit('pick', $event)"
    @connect="emit('quick', $event.id, $event)"
  />

  <div v-else class="flex flex-col gap-3">
    <!-- Gợi ý theo ngữ cảnh: chỉ hiện khi chưa gõ tìm kiếm, và chỉ khi có bằng
         chứng thật. Không có tín hiệu ⇒ nói thẳng là không có, không bịa. -->
    <section v-if="!query.trim()" class="flex flex-col gap-2 border-b pb-3">
      <div class="flex items-center justify-between gap-2.5">
        <span class="text-xs font-medium text-muted-foreground">
          {{ t('connectionsDiscover.suggest.title') }}
        </span>
        <AppSelect
          v-if="projectOptions.length"
          v-model="projectId"
          :options="projectOptions"
          width="190px"
        />
      </div>
      <p v-if="!projectOptions.length" class="m-0 text-xs leading-relaxed text-muted-foreground">
        {{ t('connectionsDiscover.suggest.noProject') }}
      </p>
      <p v-else-if="!suggestions.length" class="m-0 text-xs leading-relaxed text-muted-foreground">
        {{ t('connectionsDiscover.suggest.none') }}
      </p>
      <template v-else>
        <Button
          v-for="s in suggestions"
          :key="s.id"
          variant="outline"
          class="h-auto w-full items-start justify-start gap-2.5 rounded-lg px-3 py-2 text-left font-normal hover:border-primary [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          @click="onSuggestion(s)"
        >
          <Icon name="bulb" />
          <span class="flex min-w-0 flex-auto flex-col gap-1">
            <span class="flex items-center gap-2 text-sm font-semibold text-foreground">
              {{ s.name }}
              <Badge v-if="s.kind === 'preset'" variant="secondary" class="px-1.5 py-0">
                {{ t('connectionsDiscover.badge.curated') }}
              </Badge>
            </span>
            <span class="truncate text-xs text-muted-foreground">{{ reasonText(s.reason) }}</span>
          </span>
        </Button>
      </template>
    </section>

    <!-- Tìm kiếm registry -->
    <div class="flex items-center gap-2">
      <Icon name="search" class="size-3.5 flex-none text-muted-foreground" />
      <Input v-model="query" type="text" :placeholder="t('connectionsDiscover.search')" />
      <Button
        variant="outline"
        size="iconMd"
        class="flex-none text-muted-foreground [&_svg]:size-3.5"
        :title="t('connectionsDiscover.refresh')"
        :aria-label="t('connectionsDiscover.refresh')"
        :disabled="loading"
        @click="load(true)"
      >
        <Icon name="refresh" />
      </Button>
    </div>

    <p
      class="m-0 text-xs leading-relaxed"
      :class="result.stale ? 'text-warning' : 'text-muted-foreground'"
    >
      {{ originText }}
    </p>

    <div class="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
      <p v-if="loading" class="m-0 text-xs leading-relaxed text-muted-foreground">
        {{ t('connectionsDiscover.loading') }}
      </p>
      <p
        v-else-if="!result.entries.length"
        class="m-0 text-xs leading-relaxed text-muted-foreground"
      >
        {{
          query.trim()
            ? t('connectionsDiscover.emptySearch', { query: query.trim() })
            : t('connectionsDiscover.empty')
        }}
      </p>
      <template v-else>
        <Button
          v-for="e in result.entries"
          :key="e.id"
          variant="outline"
          class="h-auto w-full items-start justify-start gap-2.5 rounded-lg px-3 py-2 text-left font-normal hover:border-primary [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          @click="selected = e"
        >
          <Icon name="conn" />
          <span class="flex min-w-0 flex-auto flex-col gap-1">
            <span class="flex items-center gap-2 text-sm font-semibold text-foreground">
              {{ e.title }}
              <Badge
                :variant="e.install.kind === 'unsupported' ? 'warning' : 'secondary'"
                class="px-1.5 py-0"
              >
                {{ badgeFor(e) }}
              </Badge>
            </span>
            <span class="truncate text-xs text-muted-foreground">
              {{ e.description || e.name }}
            </span>
          </span>
          <Icon name="chev-right" />
        </Button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tab "Khám phá" của picker thêm connection (gói #38).
//
// Catalog tĩnh trong `preset-catalog.ts` là hằng số biên dịch — không cập nhật
// được nếu không release app. Panel này đọc danh sách ĐỘNG từ MCP Registry công
// khai qua `source.discoverRegistry` (sidecar lo SSRF + cache + validate), cộng
// một khu gợi ý theo project đang chọn (`source.suggestSources`).
//
// Panel KHÔNG tự cài gì. Bấm một entry mở màn hình chi tiết (đủ command/args/url)
// và chỉ từ đó mới đi tiếp, theo hai đường:
//  - `emit('quick', id, entry)` — nút "Kết nối": guided flow (useQuickConnect)
//    upsert → hỏi secrets → test → OAuth nếu cần, không qua editor.
//  - `emit('pick', id)` — nút "Tuỳ chỉnh": trang gọi `source.discoverPreset` để
//    lấy bản nháp và mở ConnectionEditor (đường tay đầy đủ).
import { computed, onMounted, ref, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import ConnectionDiscoverDetail from '~/components/connection/ConnectionDiscoverDetail.vue'
import { useI18n } from '~/composables/useI18n'
import {
  useConnectionsStore,
  type RegistryEntry,
  type RegistryResult,
  type SourceSuggestion,
  type SourceSuggestionReason,
} from '~/stores/connections'
import { useProjectsStore } from '~/stores/projects'
import Input from '~/components/ui/input/Input.vue'

const emit = defineEmits<{ pick: [id: string]; quick: [id: string, entry?: RegistryEntry] }>()

const { t } = useI18n()
const store = useConnectionsStore()
const projects = useProjectsStore()

const SEARCH_DEBOUNCE_MS = 350

const query = ref('')
const loading = ref(false)
const selected = ref<RegistryEntry | null>(null)
const result = ref<RegistryResult>({
  entries: [],
  origin: 'offline',
  fetchedAt: null,
  stale: false,
})
const suggestions = ref<SourceSuggestion[]>([])
const projectId = ref('')

const projectOptions = computed(() =>
  projects.projects.map((p) => ({ label: p.name, value: p.id })),
)

async function load(refresh = false): Promise<void> {
  loading.value = true
  try {
    result.value = await store.discoverRegistry({ query: query.value.trim(), refresh })
  } catch (err) {
    result.value = {
      entries: [],
      origin: 'offline',
      fetchedAt: null,
      stale: true,
      error: err instanceof Error ? err.message : 'registry unavailable',
    }
  } finally {
    loading.value = false
  }
}

async function loadSuggestions(): Promise<void> {
  const project = projects.projects.find((p) => p.id === projectId.value)
  if (!project) {
    suggestions.value = []
    return
  }
  try {
    suggestions.value = await store.suggestSources(project.path)
  } catch {
    // Gợi ý là phần thêm — hỏng thì im lặng bỏ, không chặn phần khám phá.
    suggestions.value = []
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
})

watch(projectId, () => void loadSuggestions())

onMounted(async () => {
  await projects.hydrate()
  projectId.value = projects.projects[0]?.id ?? ''
  await Promise.all([load(), loadSuggestions()])
})

function badgeFor(e: RegistryEntry): string {
  if (e.install.kind === 'remote') return t('connectionsDiscover.badge.remote')
  if (e.install.kind === 'stdio') return t('connectionsDiscover.badge.stdio')
  return t('connectionsDiscover.badge.unsupported')
}

// Lý do gợi ý luôn kèm bằng chứng cụ thể — người dùng phải hiểu vì sao thấy nó.
function reasonText(reason: SourceSuggestionReason): string {
  return t(`connectionsDiscover.reason.${reason.code}`, { evidence: reason.evidence })
}

// Gợi ý preset tĩnh đi thẳng vào editor (đã là catalog của AWOG, không cần soi
// lại); gợi ý từ registry phải qua màn hình chi tiết như mọi entry bên thứ ba.
function onSuggestion(s: SourceSuggestion): void {
  if (s.kind === 'preset') {
    emit('pick', s.id)
    return
  }
  const hit = result.value.entries.find((e) => e.id === s.id)
  if (hit) selected.value = hit
  else emit('pick', s.id)
}

const originText = computed(() => {
  const r = result.value
  if (r.stale && r.error) return t('connectionsDiscover.stale', { error: r.error })
  if (r.origin === 'offline') return t('connectionsDiscover.origin.offline')
  if (r.origin === 'cache') {
    return t('connectionsDiscover.origin.cache', {
      when: r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : '—',
    })
  }
  return t('connectionsDiscover.origin.network')
})
</script>
