<template>
  <Dialog :open="ctx.settingsOpen.value" @update:open="(v) => (ctx.settingsOpen.value = v)">
    <!-- Hộp cao hơn màn hình nhỏ ⇒ thân cuộn, đầu hộp đứng yên. -->
    <DialogContent class="max-h-[88vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ t('slack.settings.title') }}</DialogTitle>
        <DialogDescription>{{ t('slack.settings.desc') }}</DialogDescription>
      </DialogHeader>

      <div class="grid min-h-0 gap-5 overflow-y-auto pr-1">
        <!-- Model dịch -->
        <section class="grid gap-2">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('slack.settings.model.heading') }}
          </h3>
          <div role="radiogroup" class="grid grid-cols-2 gap-2">
            <SlackChoiceCard
              :title="t('slack.settings.model.inherit')"
              :desc="t('slack.settings.model.inheritDesc', { llm: p.inheritedLabel.value })"
              :selected="p.llmMode.value === 'inherit'"
              @select="p.llmMode.value = 'inherit'"
            />
            <SlackChoiceCard
              :title="t('slack.settings.model.pinned')"
              :desc="t('slack.settings.model.pinnedDesc')"
              :selected="p.llmMode.value === 'pinned'"
              @select="p.llmMode.value = 'pinned'"
            />
          </div>
          <div v-if="p.llmMode.value === 'pinned'" class="grid grid-cols-3 gap-2">
            <label class="grid min-w-0 gap-1 text-sm text-dim">
              <span>{{ t('slack.settings.model.provider') }}</span>
              <AppSelect
                v-model="p.provider.value"
                :options="p.providerOptions.value"
                width="100%"
              />
            </label>
            <label class="grid min-w-0 gap-1 text-sm text-dim">
              <span>{{ t('slack.settings.model.account') }}</span>
              <AppSelect
                v-model="p.accountId.value"
                :options="p.accountOptions.value"
                width="100%"
              />
            </label>
            <label class="grid min-w-0 gap-1 text-sm text-dim">
              <span>{{ t('slack.settings.model.model') }}</span>
              <AppSelect
                v-model="p.modelId.value"
                :options="p.modelOptions.value"
                width="100%"
                searchable
              />
            </label>
          </div>
        </section>

        <!-- Phong cách dịch -->
        <section class="grid gap-2">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('slack.settings.style.heading') }}
          </h3>
          <div role="radiogroup" class="grid grid-cols-3 gap-2">
            <SlackChoiceCard
              v-for="s in SLACK_TRANSLATE_STYLES"
              :key="s"
              :title="t(`slack.settings.style.${s}`)"
              :desc="t(`slack.settings.style.${s}Desc`)"
              :selected="p.style.value === s"
              @select="p.style.value = s"
            />
          </div>
        </section>

        <!-- Ngôn ngữ -->
        <section class="grid gap-2">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('slack.settings.lang.heading') }}
          </h3>
          <div class="grid grid-cols-2 gap-2">
            <label class="grid min-w-0 gap-1 text-sm text-dim">
              <span>{{ t('slack.settings.lang.read') }}</span>
              <AppSelect
                v-model="p.readLang.value"
                :options="p.readLangOptions.value"
                width="100%"
              />
            </label>
            <label class="grid min-w-0 gap-1 text-sm text-dim">
              <span>{{ t('slack.settings.lang.send') }}</span>
              <AppSelect v-model="p.sendChoice.value" :options="p.sendOptions.value" width="100%" />
            </label>
          </div>
        </section>

        <!-- Thuật ngữ -->
        <section class="grid gap-2">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('slack.settings.terms.heading') }}
          </h3>
          <div class="flex items-start gap-3">
            <div class="grid flex-1 gap-0.5">
              <span class="text-sm">{{ t('slack.settings.terms.keep') }}</span>
              <span class="text-xs text-dim">{{ t('slack.settings.terms.keepDesc') }}</span>
            </div>
            <Switch
              :checked="p.keepJapaneseTerms.value"
              @update:checked="(v: boolean) => (p.keepJapaneseTerms.value = v)"
            />
          </div>
          <div class="grid gap-1">
            <span class="text-sm">{{ t('slack.settings.terms.glossary') }}</span>
            <span class="text-xs text-dim">{{ t('slack.settings.terms.glossaryDesc') }}</span>
          </div>
          <!-- mono-ok: bảng thuật ngữ là file chữ người dùng sửa như code (`日本語 = bản dịch`). -->
          <Textarea
            v-model="p.glossaryText.value"
            class="min-h-32 resize-y font-mono text-sm"
            :placeholder="t('slack.settings.terms.placeholder')"
            :maxlength="GLOSSARY_MAX_CHARS"
            spellcheck="false"
          />
          <div class="flex items-center gap-2">
            <!-- mono-ok: đường dẫn file, người dùng copy để mở bằng editor. -->
            <span
              v-if="p.glossaryPath.value"
              class="min-w-0 flex-1 truncate font-mono text-xs text-dim"
            >
              {{ p.glossaryPath.value }}
            </span>
            <span v-else class="flex-1" />
            <Button
              size="sm"
              :disabled="!p.glossaryDirty.value || p.glossarySaving.value"
              @click="p.saveGlossary"
            >
              {{
                p.glossarySaving.value
                  ? t('slack.settings.terms.saving')
                  : t('slack.settings.terms.save')
              }}
            </Button>
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Bảng Cài đặt dịch Slack (docs/features/slack-threads.md): model dịch, phong cách,
// ngôn ngữ đọc/gửi, thuật ngữ. Mở từ nút bánh răng ở đầu SlackWorkspace. Toàn bộ state +
// lưu ở useSlackSettingsPanel; đây chỉ bind. Dialog shadcn mang `role="dialog"` nên đã
// nằm trong OVERLAYS của trình duyệt nhúng.
import { useSlackCtx } from '~/composables/useSlackManager'
import { SLACK_TRANSLATE_STYLES, useSlackSettingsPanel } from '~/composables/useSlackSettingsPanel'

// Cùng trần với `slack.glossary.set` của sidecar.
const GLOSSARY_MAX_CHARS = 20_000

const { t } = useI18n()
const ctx = useSlackCtx()
const p = useSlackSettingsPanel(ctx.settingsOpen, () => ctx.selected.value?.projectId ?? null)
</script>
