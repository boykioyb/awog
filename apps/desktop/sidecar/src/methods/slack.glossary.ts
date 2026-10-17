// slack.glossary.get / slack.glossary.set → bảng thuật ngữ dịch Slack
// (`~/.awog/slack/glossary.md`, mỗi dòng `日本語 = bản dịch`). Ghi atomic; đường dẫn cố
// định (không nhận path từ renderer). Đổi bảng ⇒ khoá cache dịch đổi (slack/translate.ts)
// và phát `slack.settings-changed` để mọi bề mặt dịch lại tin đang hiện.
import { z } from 'zod'
import { emit } from '../transport/stdio.js'
import { registerSlack } from '../slack/rpc.js'
import {
  getSlackSettings,
  SLACK_SETTINGS_CHANGED_EVENT,
  type SlackSettingsChangedEvent,
} from '../slack/settings.js'
import {
  GLOSSARY_MAX_CHARS,
  glossaryPath,
  readGlossaryFile,
  writeGlossaryFile,
} from '../slack/translate-prompt.js'

const SetParams = z.object({ text: z.string().max(GLOSSARY_MAX_CHARS) })

registerSlack(
  'slack.glossary.get',
  async (): Promise<{ text: string; path: string }> => ({
    text: await readGlossaryFile(),
    path: glossaryPath(),
  }),
)

registerSlack('slack.glossary.set', async (raw): Promise<{ ok: true }> => {
  const p = SetParams.parse(raw)
  if (p.text === (await readGlossaryFile())) return { ok: true }
  await writeGlossaryFile(p.text)
  const payload: SlackSettingsChangedEvent = {
    settings: await getSlackSettings(),
    reason: 'glossary',
  }
  emit(SLACK_SETTINGS_CHANGED_EVENT, payload)
  return { ok: true }
})
