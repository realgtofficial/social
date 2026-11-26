// Minimal Cloudflare types (so no extra packages are needed).
export interface KVNamespaceLike {
  get(key: string, opts?: any): Promise<any>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}
export interface Env {
  KV: KVNamespaceLike;
  ADMIN_PASSWORD?: string;
}

export const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const getJSON = (kv: KVNamespaceLike, key: string) => kv.get(key, { type: "json" });
export const setJSON = (kv: KVNamespaceLike, key: string, value: unknown) => kv.put(key, JSON.stringify(value));

export function missingKV(env: Env): Response | null {
  return env.KV ? null : reply({ error: "Storage is not connected. Bind a KV namespace named KV in Cloudflare (see README)." }, 503);
}
