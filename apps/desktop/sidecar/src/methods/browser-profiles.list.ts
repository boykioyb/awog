import { register } from "../transport/rpc.js";
import { listProfiles } from "../browser-profiles/profiles.js";

// Danh sách profile trình duyệt nhúng + profile mặc định toàn app.
register("browserProfiles.list", async () => listProfiles());
