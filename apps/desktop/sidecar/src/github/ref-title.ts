// Lấy TIÊU ĐỀ của một PR/issue trên GitHub — dùng bởi Logtime compose để cho model
// biết PR/issue đó là việc gì (tính năng), thay vì chỉ có số. Đây là nguồn duy nhất
// mang phần nghiệp vụ: title phiên thường chỉ là URL, còn digest cuối toàn quy trình.
//
// Dùng `gh api repos/{owner}/{repo}/…` với repo ghi tường minh trong path — không cần
// cwd repo (link.githubRepo đã mang "owner/name"). Chạy qua runGhAccount để gh dùng
// account active; lỗi (gh thiếu, không quyền, repo private) trả null — caller lùi về
// không có refTitle chứ không làm hỏng lượt compose.

import { z } from "zod";
import { runGhAccount } from "./runner.js";

const RefSchema = z.object({ title: z.string().min(1).max(300) });

// `owner/repo` từ git remote — ép chặt pattern trước khi đưa vào path của gh api.
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export async function fetchGhRefTitle(
  repo: string,
  kind: "issue" | "pull",
  n: number,
): Promise<string | null> {
  if (!REPO_RE.test(repo)) return null;
  try {
    const out = await runGhAccount([
      "api",
      `repos/${repo}/${kind === "pull" ? "pulls" : "issues"}/${n}`,
    ]);
    const parsed = RefSchema.safeParse(JSON.parse(out));
    return parsed.success ? parsed.data.title : null;
  } catch {
    return null;
  }
}
