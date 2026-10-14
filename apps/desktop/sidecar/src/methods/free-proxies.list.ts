import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import { listFreeProxies } from "../browser-profiles/free-proxies.js";

// Biên tin cậy: chỉ hình dạng. Không có URL nào đi vào — hai nguồn là hằng số trong module.
const Params = z.object({
  countries: z
    .array(z.string().regex(/^[A-Za-z]{2}$/))
    .max(300)
    .optional(),
  types: z.array(z.enum(["http", "socks5"])).optional(),
  anonymity: z.array(z.enum(["elite", "anonymous"])).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  refresh: z.boolean().optional(),
});

register("freeProxies.list", async (raw) => {
  const params = Params.parse(raw ?? {});
  try {
    return await listFreeProxies(params);
  } catch (err) {
    throw new RpcError(
      -32000,
      err instanceof Error ? err.message : String(err),
    );
  }
});
