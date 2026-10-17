// Ngôn ngữ chọn được trong Cài đặt dịch Slack. `value` là tên tiếng Anh đi thẳng vào prompt
// dịch (khớp regex `targetLang` của sidecar và cách prompt nhận diện tiếng Nhật/tiếng Việt);
// `code` cho nhãn nút ngắn ở composer ("Dịch sang JA").
export const SLACK_LANGS = [
  { value: 'Vietnamese', code: 'VI', labelKey: 'slack.settings.lang.vi' },
  { value: 'English', code: 'EN', labelKey: 'slack.settings.lang.en' },
  { value: 'Japanese', code: 'JA', labelKey: 'slack.settings.lang.ja' },
] as const

/** Mã ngắn của một ngôn ngữ; giá trị lạ (sửa tay file cài đặt) thì hiện nguyên tên. */
export function slackLangCode(lang: string): string {
  return SLACK_LANGS.find((l) => l.value === lang)?.code ?? lang
}

// Lựa chọn "dịch tin gửi đi sang" — đơn ngữ hoặc song ngữ (Nhật + Anh hay dùng với khách).
// `id` = các `value` nối bằng '+', dùng làm value của ô chọn.
export const SLACK_SEND_CHOICES = [
  { langs: ['Japanese'], labelKey: 'slack.settings.lang.ja' },
  { langs: ['English'], labelKey: 'slack.settings.lang.en' },
  { langs: ['Vietnamese'], labelKey: 'slack.settings.lang.vi' },
  { langs: ['Japanese', 'English'], labelKey: 'slack.settings.lang.jaEn' },
] as const

export const sendChoiceId = (langs: readonly string[]): string => langs.join('+')

/** Nhãn ngắn cho nút composer: "JA", "JA + EN". */
export function slackLangCodes(langs: readonly string[]): string {
  return langs.map(slackLangCode).join(' + ')
}
