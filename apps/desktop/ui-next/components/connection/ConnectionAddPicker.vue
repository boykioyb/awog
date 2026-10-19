<template>
  <LibraryEntityModal
    :open="open"
    :title="t('connections.picker.title')"
    :width="640"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <!-- Hai khu: catalog tĩnh có sẵn (luôn dùng được, kể cả offline) và khu
           Khám phá lấy danh sách động từ MCP Registry (gói #38). Tab Khám phá chỉ
           được mount khi người dùng bấm vào — không có request nào chạy ngầm.
           Chỉ dùng Tabs cho dải chọn: nội dung bên dưới giữ v-if/v-show riêng để
           Khám phá mount lười rồi giữ nguyên. -->
      <Tabs
        :model-value="tab"
        @update:model-value="
          (v: string | number) => (v === 'discover' ? openDiscover() : (tab = 'presets'))
        "
      >
        <TabsList>
          <TabsTrigger value="presets">{{ t('connectionsDiscover.tab.presets') }}</TabsTrigger>
          <TabsTrigger value="discover">{{ t('connectionsDiscover.tab.discover') }}</TabsTrigger>
        </TabsList>
      </Tabs>

      <ConnectionDiscoverPanel
        v-if="discoverMounted"
        v-show="tab === 'discover'"
        @pick="emit('pick', $event)"
        @quick="(id, entry) => emit('quick', id, entry)"
      />

      <div v-show="tab === 'presets'" class="flex flex-col gap-4">
        <!-- Two "how do you want to start" options: hand-build, or describe with AI. -->
        <div class="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            class="h-auto justify-start gap-3 rounded-lg p-3 text-left font-normal hover:border-primary"
            @click="emit('scratch')"
          >
            <span
              class="grid size-8 flex-none place-items-center rounded-md border bg-muted text-muted-foreground"
            >
              <Icon name="plus" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5 whitespace-normal">
              <span class="text-sm font-semibold text-foreground">
                {{ t('connections.picker.scratch') }}
              </span>
              <span class="text-xs text-muted-foreground">
                {{ t('connections.picker.scratchSub') }}
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            class="h-auto justify-start gap-3 rounded-lg p-3 text-left font-normal hover:border-primary"
            @click="emit('ai')"
          >
            <span
              class="grid size-8 flex-none place-items-center rounded-md border bg-muted text-primary"
            >
              <Icon name="sparkles" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5 whitespace-normal">
              <span class="text-sm font-semibold text-foreground">
                {{ t('connections.picker.ai') }}
              </span>
              <span class="text-xs text-muted-foreground">{{ t('connections.picker.aiSub') }}</span>
            </span>
          </Button>
        </div>

        <!-- Catalog of common providers → pre-filled config. -->
        <Separator />
        <div class="-mt-2 text-xs font-medium text-muted-foreground">
          {{ t('connections.picker.orPick') }}
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <Button
            v-for="p in presets"
            :key="p.id"
            variant="outline"
            class="h-auto items-start justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal hover:border-primary"
            @click="emit('quick', p.id)"
          >
            <SourceAvatar :source="pseudoSource(p)" size="md" />
            <span class="flex min-w-0 flex-col gap-1 whitespace-normal">
              <span class="flex items-center gap-2 text-sm font-semibold text-foreground">
                {{ p.name }}
                <Badge variant="secondary" class="px-1.5 py-0 uppercase">
                  {{ t('connections.typeBadge.' + p.type) }}
                </Badge>
              </span>
              <span class="text-xs text-muted-foreground">{{ p.tagline }}</span>
            </span>
          </Button>
        </div>
        <div v-if="!presets.length" class="py-3 text-center text-sm text-muted-foreground">
          {{ t('connections.picker.empty') }}
        </div>
      </div>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// "Add a connection" picker (UI-parity area 3) — the first step of the add-source
// flow, opened by the LibraryView "+" trigger. Offers two quick starts (blank form
// / AI creator) plus a catalog of common providers. Picking a provider emits its
// catalog id; the page fetches the pre-filled draft (source.discoverPreset) and
// seeds ConnectionEditor. Craft-parity "add a known service → pre-filled config".
//
// Gói #38 thêm tab "Khám phá": danh sách ĐỘNG lấy từ MCP Registry công khai, để
// catalog không còn bị đóng băng theo bản release. Cả hai tab dùng CHUNG một
// đường ra — `pick` mang id (preset tĩnh hoặc `reg:<name>`) và
// `source.discoverPreset` giải cả hai — nên luồng đồng ý của người dùng không đổi.
import { ref } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import ConnectionDiscoverPanel from '~/components/connection/ConnectionDiscoverPanel.vue'
import { brandIcon } from '~/utils/brand-icons'
import type { RegistryEntry, Source, SourcePresetMeta } from '~/stores/connections'

defineProps<{
  open: boolean
  presets: SourcePresetMeta[]
}>()

const emit = defineEmits<{
  close: []
  scratch: []
  ai: []
  pick: [id: string]
  // "Kết nối" — đường nhanh: preset card click và nút Kết nối của màn đồng ý đều
  // đi qua đây. `entry` chỉ có khi đến từ registry (kèm secretFields để quick
  // connect đánh dấu ô bắt buộc); trang quyết định quick hay editor theo kind.
  quick: [id: string, entry?: RegistryEntry]
}>()

const { t } = useI18n()

// Tab Khám phá chỉ mount khi được bấm lần đầu (rồi giữ nguyên bằng v-show): mở
// picker để chọn preset KHÔNG được kéo theo một lượt gọi mạng nào.
const tab = ref<'presets' | 'discover'>('presets')
const discoverMounted = ref(false)
const openDiscover = () => {
  tab.value = 'discover'
  discoverMounted.value = true
}

// A minimal Source built from the preset meta so SourceAvatar can render the row
// icon. For a known brand the emoji is dropped so the bundled brand mark wins;
// providers without a mark keep their emoji fast path (source.resolveIcon is
// never hit either way — presets aren't persisted yet).
function pseudoSource(p: SourcePresetMeta): Source {
  const base = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    provider: p.provider,
    enabled: true,
    icon: brandIcon(p.provider) ? undefined : p.icon,
    tagline: p.tagline,
    timeoutMs: 30000,
    trust: 'prompt' as const,
  }
  if (p.type === 'api') return { ...base, type: 'api', api: { baseUrl: '', authType: 'none' } }
  if (p.type === 'local') return { ...base, type: 'local', local: { path: '' } }
  return { ...base, type: 'mcp', mcp: {} }
}
</script>
