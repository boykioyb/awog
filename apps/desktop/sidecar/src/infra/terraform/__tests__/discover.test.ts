// Bảng ca cho dò thư mục Terraform — việc 12 / P1 (ADR 0088 §7).
//
// Trọng tâm: đọc ĐÚNG `required_version` + block `backend` ở cả dạng một dòng và
// nhiều dòng, chỉ lấy khoá ĐỊA CHỈ, và bỏ mọi thứ chứa credential. `listTerraformDirs`
// được đo trên cây thư mục thật (thư mục tạm) vì luật "≤ 2 cấp" chỉ kiểm được bằng
// cây thật.
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTerraformDirs, parseTerraformFile } from '../discover.js'

describe('parseTerraformFile', () => {
  it('reads required_version and an s3 backend', () => {
    const meta = parseTerraformFile(`terraform {
  required_version = ">= 1.5.0"

  backend "s3" {
    bucket         = "acme-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "acme-tf-lock"
  }
}
`)
    expect(meta.requiredVersion).toBe('>= 1.5.0')
    expect(meta.backendType).toBe('s3')
    expect([...meta.backendKeys].sort()).toEqual([
      'bucket',
      'dynamodb_table',
      'key',
      'region',
    ])
    expect(meta.backendValues.get('bucket')).toBe('acme-tfstate')
    expect(meta.backendValues.get('key')).toBe('prod/terraform.tfstate')
  })

  it('never captures credential-shaped backend keys', () => {
    const meta = parseTerraformFile(`terraform {
  backend "s3" {
    bucket     = "b"
    access_key = "AKIAEXAMPLE"
    secret_key = "SUPERSECRET"
    password   = "hunter2"
  }
}
`)
    const dump = JSON.stringify([...meta.backendKeys, [...meta.backendValues]])
    expect(dump).not.toContain('AKIAEXAMPLE')
    expect(dump).not.toContain('SUPERSECRET')
    expect(dump).not.toContain('hunter2')
    expect(meta.backendValues.has('bucket')).toBe(true)
  })

  it('recognises `cloud` blocks and ignores commented-out backends', () => {
    const meta = parseTerraformFile(`# backend "s3" {
terraform {
  cloud {
    organization = "acme"
  }
}
`)
    expect(meta.backendType).toBe('cloud')
    expect(meta.backendValues.get('organization')).toBe('acme')
  })

  it('returns empty metadata for a plain .tf file', () => {
    const meta = parseTerraformFile(`resource "aws_s3_bucket" "web" {
  bucket = "x"
}
`)
    expect(meta.backendType).toBe('')
    expect(meta.requiredVersion).toBe('')
  })
})

describe('listTerraformDirs', () => {
  it('finds *.tf up to 2 levels deep and skips noise directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'awog-tf-'))
    await writeFile(join(root, 'main.tf'), 'terraform {\n  backend "local" {}\n}\n', 'utf8')
    await mkdir(join(root, 'infra', 'prod'), { recursive: true })
    await writeFile(join(root, 'infra', 'prod', 'main.tf'), 'resource "aws_vpc" "v" {}\n', 'utf8')
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'main.tf'), 'x\n', 'utf8')
    // Cấp 3 — phải KHÔNG được thấy.
    await mkdir(join(root, 'a', 'b', 'c'), { recursive: true })
    await writeFile(join(root, 'a', 'b', 'c', 'main.tf'), 'x\n', 'utf8')

    const dirs = await listTerraformDirs(root)
    expect(dirs.map((d) => d.label)).toEqual(['.', 'infra/prod'])
    expect(dirs[0].backendType).toBe('local')
    expect(dirs[0].fileCount).toBe(1)
    expect(dirs[1].path).toBe(join(root, 'infra', 'prod'))
    expect(dirs[1].initialized).toBe(false)
  })

  it('marks a directory as initialised when .terraform/ exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'awog-tf-'))
    await writeFile(join(root, 'main.tf'), '\n', 'utf8')
    await mkdir(join(root, '.terraform'), { recursive: true })
    const dirs = await listTerraformDirs(root)
    expect(dirs[0].initialized).toBe(true)
  })
})
