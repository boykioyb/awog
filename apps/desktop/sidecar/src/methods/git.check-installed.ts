// Bootstrap method. Does NOT need workspaceRoot — invoked at app boot to
// decide whether to render the "install git" banner.
//
// Không tự parse `git --version` nữa: `gitVersion()`/`gitAtLeast()` trong git/runner.ts
// đã là chỗ parse duy nhất của sidecar (các capability gate khác dùng chung), nên hai
// bản regex song song chỉ tạo cơ hội lệch nhau. Đổi lại, probe được cache theo vòng
// đời tiến trình: cài git trong lúc app đang chạy thì phải khởi động lại mới hết banner
// — chấp nhận được cho một phép đo bootstrap.
import { register } from '../transport/rpc.js'
import { gitAtLeast, gitVersion } from '../git/runner.js'

const REQUIRED = '2.20'

interface Result {
  installed: boolean
  version: string
  supported: boolean
  required: string
}

register('git.checkInstalled', async (): Promise<Result> => {
  // Cả hai helper đều không throw: git vắng mặt hoặc không parse được ⇒ version ''
  // ⇒ installed:false, đúng như nhánh catch cũ.
  const version = await gitVersion()
  return {
    installed: version.length > 0,
    version,
    supported: version.length > 0 && (await gitAtLeast(REQUIRED)),
    required: REQUIRED,
  }
})
