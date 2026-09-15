// State của ba form con trong AwsProfileEditor.vue (Mốc 1, việc A3).
//
// VÌ SAO Ở ĐÂY chứ không ở chính SFC con: `<script setup>` không được mang
// `export` (rule `vue/no-export-in-script-setup`), mà cha cần dựng state rỗng
// TRƯỚC khi component con mount (v-model là `required`). Tách ra một file tri
// thức thuần: không i18n, không RPC, không reactivity.
//
// Mọi trường là CHUỖI — kể cả `durationSeconds` — vì đây là state của ô nhập;
// cha parse sang số rồi đổi lại thành chuỗi khi dựng payload (`config` phía
// sidecar là `Record<string, string>`). Rỗng ⇒ không gửi khoá đó ⇒ giá trị cũ
// trên đĩa được giữ nguyên.

export type StaticFormState = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
  output: string
}

export function emptyStaticForm(): StaticFormState {
  return { accessKeyId: '', secretAccessKey: '', sessionToken: '', region: '', output: '' }
}

export type SsoFormState = {
  // Hai nhánh loại trừ nhau: dùng lại `[sso-session x]` đã có (nhập ở A5), hoặc
  // điền thủ công start URL + sso region (định dạng SSO cũ, không có block đó).
  source: 'session' | 'manual'
  ssoSession: string
  ssoStartUrl: string
  ssoRegion: string
  ssoAccountId: string
  ssoRoleName: string
  region: string
}

export function emptySsoForm(): SsoFormState {
  return {
    source: 'session',
    ssoSession: '',
    ssoStartUrl: '',
    ssoRegion: '',
    ssoAccountId: '',
    ssoRoleName: '',
    region: '',
  }
}

export type AssumeRoleFormState = {
  roleArn: string
  sourceProfile: string
  mfaSerial: string
  externalId: string
  durationSeconds: string
}

export function emptyAssumeRoleForm(): AssumeRoleFormState {
  return { roleArn: '', sourceProfile: '', mfaSerial: '', externalId: '', durationSeconds: '' }
}
