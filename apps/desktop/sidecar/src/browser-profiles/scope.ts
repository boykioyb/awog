// Giải "scope trình duyệt → profile" và đẩy kết quả sang Electron main.
//
// Chuỗi ưu tiên (docs/features/browser-profiles-bookmarks.md):
//   phiên:  Session.browserProfileId → Project.browserProfileId → profile mặc định
//   task:   `task:<taskId>[:<nodeId>]` → project của task → profile mặc định
//   không scope / không nhận ra → profile mặc định
// Một id trỏ vào profile ĐÃ XOÁ bị bỏ qua (rơi xuống tầng kế), không ném lỗi.

import { emit, hostRequest } from "../transport/stdio.js";
import { log } from "../util/logger.js";
import { loadProject, listProjects, saveProject } from "../projects/store.js";
import {
  getSessionBrowserRef,
  listSessionBrowserRefs,
  setSessionBrowserProfile,
} from "../sessions/store.js";
import { loadTask } from "../tasks/store.js";
import {
  DEFAULT_PROFILE_ID,
  deleteProfile,
  listProfiles,
  setDefaultProfile,
} from "./profiles.js";
import { dropProfileProxy } from "./proxy.js";

async function projectProfile(
  projectId: string | null,
  valid: Set<string>,
): Promise<string | null> {
  if (!projectId) return null;
  const p = await loadProject(projectId);
  return p?.browserProfileId && valid.has(p.browserProfileId)
    ? p.browserProfileId
    : null;
}

export async function resolveScopeProfile(
  scope: string | undefined,
): Promise<string> {
  const { defaultProfileId, profiles } = await listProfiles();
  const valid = new Set(profiles.map((p) => p.id));
  if (!scope) return defaultProfileId;
  if (scope.startsWith("task:")) {
    const taskId = scope.split(":")[1];
    const task = taskId ? await loadTask(taskId) : null;
    return (
      (await projectProfile(task?.projectId ?? null, valid)) ?? defaultProfileId
    );
  }
  const ref = await getSessionBrowserRef(scope);
  if (!ref) return defaultProfileId;
  if (ref.browserProfileId && valid.has(ref.browserProfileId))
    return ref.browserProfileId;
  return (await projectProfile(ref.projectId, valid)) ?? defaultProfileId;
}

// Đẩy profile hiệu lực của một scope sang main (idempotent, rẻ). Lỗi chỉ log: main
// tự hỏi lại qua `browserProfiles.resolveScope` khi thiếu cache, nên một lần đẩy
// hụt không được làm hỏng lời gọi tool.
export async function pushScopeProfile(scope: string): Promise<void> {
  try {
    const profile = await resolveScopeProfile(scope);
    await hostRequest("browser.setScopeProfile", { scope, profile });
  } catch (err) {
    log.warn("browser-profiles: setScopeProfile push failed", {
      scope,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// Đẩy lại cho nhiều phiên, vài luồng một lúc. Bỏ phiên đã lưu trữ — scope của
// chúng không còn tab; nếu mở lại, `pushScopeProfile` trước lời gọi tool sẽ bù.
async function pushSessions(ids: string[]): Promise<void> {
  const queue = [...ids];
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift())
      await pushScopeProfile(id);
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
}

// Mọi phiên (chưa lưu trữ) có thể đổi profile hiệu lực khi danh sách/ mặc định đổi.
export async function resyncAllScopes(): Promise<void> {
  const refs = await listSessionBrowserRefs();
  await pushSessions(refs.filter((r) => !r.archived).map((r) => r.id));
}

// Project đổi `browserProfileId`: chỉ phiên thuộc project mà KHÔNG tự đặt override.
export async function resyncProjectScopes(projectId: string): Promise<void> {
  const refs = await listSessionBrowserRefs();
  await pushSessions(
    refs
      .filter(
        (r) =>
          r.projectId === projectId &&
          r.browserProfileId === null &&
          !r.archived,
      )
      .map((r) => r.id),
  );
}

export function notifyProfilesChanged(): void {
  emit("browser.profiles-changed", {});
}

export async function changeDefaultProfile(
  id: string,
): Promise<{ defaultProfileId: string }> {
  const res = await setDefaultProfile(id);
  notifyProfilesChanged();
  await resyncAllScopes();
  return res;
}

// Xoá profile: bỏ khỏi danh sách + bookmark → gỡ mọi tham chiếu ở phiên/project →
// đẩy lại scope (main chuyển tab sang profile mới) → CUỐI CÙNG mới xoá partition,
// để tab còn mở trong partition cũ đã được dời đi trước khi dữ liệu bị xoá.
export async function removeProfile(
  id: string,
): Promise<{ defaultProfileId: string }> {
  const hadProxy =
    (await listProfiles()).profiles.find((p) => p.id === id)?.proxy !==
    undefined;
  const res = await deleteProfile(id);
  // Credential proxy ở keychain + bỏ proxy khỏi partition (main giữ trong RAM).
  await dropProfileProxy(id, hadProxy);
  const refs = await listSessionBrowserRefs();
  const affected = refs.filter((r) => r.browserProfileId === id);
  for (const r of affected) await setSessionBrowserProfile(r.id, null);
  for (const p of await listProjects()) {
    if (p.browserProfileId !== id) continue;
    const { browserProfileId: _cleared, ...rest } = p;
    await saveProject(rest);
  }
  notifyProfilesChanged();
  await resyncAllScopes();
  try {
    await hostRequest("browser.wipeProfile", { profile: id });
  } catch (err) {
    log.warn(
      "browser-profiles: wipeProfile failed (partition data left behind)",
      {
        profile: id,
        err: err instanceof Error ? err.message : String(err),
      },
    );
  }
  return res;
}

export { DEFAULT_PROFILE_ID };
