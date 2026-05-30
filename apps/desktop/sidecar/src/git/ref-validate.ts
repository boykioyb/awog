// Ref / branch name validators per ADR 0017. Defense-in-depth: UI also
// validates with the same rule set (utils/branch-tree.ts), and Git itself
// enforces `git check-ref-format` — but every method that accepts a ref name
// runs this first so we never spawn `git` with an attacker-controlled token.
import { RpcError } from '../transport/rpc.js'
import { GIT_RPC_CODE, GitErrorCode } from './error-map.js'

const REF_INVALID_CHARS = /[\s~^:?*[\\]/
// `from` refs accept a strict subset: alphanumerics + `.`, `_`, `/`, `-`.
// Excludes `^` and `~` on purpose — branchCreate doesn't need ancestor syntax.
const SAFE_FROM_REF = /^[a-zA-Z0-9._/-]+$/
// Free-form refs (history navigation, file revert) — `^`, `~` allowed.
const SAFE_GENERIC_REF = /^[a-zA-Z0-9._/^~-]{1,200}$/

function reject(message: string): never {
  throw new RpcError(GIT_RPC_CODE, message, { gitCode: GitErrorCode.INVALID_REF })
}

export function assertValidBranchName(name: string): void {
  if (!name) reject('Branch name không được rỗng')
  if (REF_INVALID_CHARS.test(name)) reject('Branch name chứa ký tự không hợp lệ')
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) reject('Branch name chứa control char')
  }
  if (name.includes('..')) reject('Branch name không được chứa ".."')
  if (name.includes('@{')) reject('Branch name không được chứa "@{"')
  if (name.startsWith('-')) reject('Branch name không được bắt đầu bằng "-"')
  if (name.startsWith('/') || name.endsWith('/')) reject('Branch name không được bắt đầu / kết thúc bằng "/"')
  if (name.endsWith('.')) reject('Branch name không được kết thúc bằng "."')
  if (name.endsWith('.lock')) reject('Branch name không được kết thúc bằng ".lock"')
}

export function assertValidFromRef(ref: string): void {
  if (!SAFE_FROM_REF.test(ref)) reject('Ref không hợp lệ')
}

export function assertValidGenericRef(ref: string): void {
  if (!SAFE_GENERIC_REF.test(ref)) reject('Ref không hợp lệ')
}
