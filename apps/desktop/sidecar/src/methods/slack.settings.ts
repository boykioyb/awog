// slack.settings.get / slack.settings.set → cài đặt Slack (`~/.awog/slack/settings.json`,
// slack/settings.ts). Một nguồn cho cả modal lẫn cửa sổ Slack riêng: ghi xong phát
// `slack.settings-changed` để bề mặt còn lại nạp bản mới + bỏ bản dịch theo cài đặt cũ.
import { z } from 'zod'
import { emit } from '../transport/stdio.js'
import { registerSlack } from '../slack/rpc.js'
import {
  getSlackSettings,
  SLACK_SETTINGS_CHANGED_EVENT,
  SlackTranslatePatchSchema,
  updateSlackSettings,
  type SlackSettings,
  type SlackSettingsChangedEvent,
} from '../slack/settings.js'

const SetParams = z.object({ translate: SlackTranslatePatchSchema })

registerSlack('slack.settings.get', async (): Promise<SlackSettings> => getSlackSettings())

registerSlack('slack.settings.set', async (raw): Promise<SlackSettings> => {
  const p = SetParams.parse(raw)
  const { settings, changed } = await updateSlackSettings(p.translate)
  if (changed) {
    const payload: SlackSettingsChangedEvent = { settings, reason: 'settings' }
    emit(SLACK_SETTINGS_CHANGED_EVENT, payload)
  }
  return settings
})
