import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import {
  FreeProxyError,
  startProbe,
} from "../browser-profiles/free-proxies.js";

// Chỉ nhận id trong danh mục hiện tại (kiểm trong startProbe) — UI không dò được host tuỳ ý.
const Params = z.object({ ids: z.array(z.string().max(300)).min(1).max(60) });

register("freeProxies.probe", async (raw) => {
  const { ids } = Params.parse(raw);
  try {
    return startProbe(ids);
  } catch (err) {
    if (err instanceof FreeProxyError) throw new RpcError(-32602, err.message);
    throw err;
  }
});
