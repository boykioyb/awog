// Bài kiểm cho utils/settings-index.ts — trích cài đặt từ mã nguồn component Settings
// cho tìm kiếm ⌘K. JS thuần `.mjs` vì lý do ghi ở composer-trigger.test.mjs. Chạy:
// `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  childSettingsComponents,
  extractSettingsEntries,
  matchesAllWords,
} from '../settings-index.ts'

const SRC = `<template>
  <SettingsPaneHeader :title="t('settings.git.heading')" />
  <SettingsField
    :name="t('settings.git.autoFetch.name')"
    :desc="t('settings.git.autoFetch.desc')"
  >
    <SettingsTog v-model="x" />
  </SettingsField>
  <SettingsField :desc="t('settings.appearance.accent.desc')">
    <template #name>
      {{ t('settings.appearance.accent.name') }}
      <span>{{ t('settings.appearance.accent.live') }}</span>
    </template>
  </SettingsField>
  <div class="sech">{{ t('settings.git.pr.heading') }}</div>
  <SettingsPrReviewLlm />
</template>
<script setup lang="ts">
const x = ref(false)
</script>`

test('lấy tên/mô tả của SettingsField (thuộc tính lẫn slot #name) + tiêu đề nhóm', () => {
  assert.deepEqual(extractSettingsEntries(SRC), [
    {
      kind: 'field',
      nameKey: 'settings.git.autoFetch.name',
      descKey: 'settings.git.autoFetch.desc',
    },
    {
      kind: 'field',
      nameKey: 'settings.appearance.accent.name',
      descKey: 'settings.appearance.accent.desc',
    },
    { kind: 'heading', nameKey: 'settings.git.pr.heading' },
  ])
})

test('component Settings con được nhúng — bỏ qua SettingsField/PaneHeader', () => {
  assert.deepEqual(childSettingsComponents(SRC), ['SettingsTog', 'SettingsPrReviewLlm'])
})

test('khớp không dấu, mọi từ, thứ tự tự do', () => {
  assert.equal(matchesAllWords('giao dien sang', 'Giao diện · Chế độ sáng tối'), true)
  assert.equal(matchesAllWords('fetch tu dong', 'Tự động fetch remote'), true)
  assert.equal(matchesAllWords('proxy', 'Giao diện'), false)
})
