# AWOG Template Registry

Đây là **registry** các Project Template tái dùng cho AWOG ([ADR 0036](../docs/decisions/0036-project-templates.md)).
Mỗi thư mục con là **một bundle tự chứa**: file `template.json` (manifest) + config chia rõ theo loại
(`agents/ skills/ hooks/ rules/ commands/`).

## Cách dùng

Trong AWOG → trang **Templates** → nút **Github** → dán link folder này:

```
https://github.com/boykioyb/awog/tree/main/templates
```

AWOG sẽ tải mọi bundle (mỗi subfolder có `template.json`) về `~/.awog/templates/`, rồi cho **Install**
vào tier project của một dự án. Chỉ repo **public**; fetch theo [ADR 0037](../docs/decisions/0037-remote-template-fetch-github.md).

## Các template

| Bundle | Mô tả | Gồm |
|---|---|---|
| [`awog-delivery-guild`](./awog-delivery-guild) | Pipeline đầy đủ PO→BA→PM→TL→dev→QA→reviewer(+infosec) | 8 agents · 8 skills · 4 rules · 2 commands · 1 hook |
| [`web-app-team`](./web-app-team) | Giao feature frontend | 4 agents · 3 skills · 4 rules |
| [`spec-driven-planning`](./spec-driven-planning) | Discovery → spec → task plan | 3 agents · 3 skills · 1 rule |

## Layout một bundle

```
<bundle-id>/
  template.json          # manifest: id, name, description, entities[]
  agents/<id>.md         # YAML frontmatter (name/description/tools…) + system prompt
  skills/<id>/SKILL.md   # frontmatter + hướng dẫn skill
  hooks/<id>.json        # cấu hình hook (event, command, runMode…) — install xong land UNTRUSTED
  rules/<id>.md          # frontmatter (name/description/enabled) + instruction
  commands/<id>.md       # frontmatter (name/description/argument-hint…) + prompt template
```

> Template **không** chứa giá trị secret — chỉ ref `${secret:KEY}`. Hook khi install vào project ở
> trạng thái **chưa tin cậy** (phải duyệt trước khi chạy — [ADR 0032](../docs/decisions/0032-hook-execution-engine-ipc-contract.md) D-8).
