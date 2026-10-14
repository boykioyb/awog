import { register } from "../transport/rpc.js";
import { syncAllProxies } from "../browser-profiles/proxy.js";

// Electron main gọi khi khởi động / engine restart / profiles-changed: sidecar đẩy
// lại proxy (+ credential từ keychain) của MỌI profile qua `browser.setProfileProxy`.
// Credential không đi trong result — chỉ theo host request sidecar → main.
register("browserProfiles.syncProxies", async () => syncAllProxies());
