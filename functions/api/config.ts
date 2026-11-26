import { adminPassword, checkToken } from "../../src/lib/auth.ts";
import { sanitizeConfig, ValidationError } from "../../src/lib/sanitize.ts";
import { DEFAULTS } from "../../src/lib/defaults.ts";
import { reply, getJSON, setJSON, missingKV, type Env } from "../../src/lib/common.ts";

// GET /api/config   public: the values the website shows
// PUT /api/config   needs login: saves new values
export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method === "GET") {
    if (!env.KV) return reply(DEFAULTS); // site still works with default values
    const saved = await getJSON(env.KV, "config");
    return reply(saved ?? DEFAULTS);
  }

  if (request.method !== "PUT") return reply({ error: "Method not allowed." }, 405);

  const password = adminPassword(env);
  if (!password) return reply({ error: "The admin password is not set up yet." }, 503);
  if (!(await checkToken(request, password))) return reply({ error: "Please log in again." }, 401);
  const noKV = missingKV(env);
  if (noKV) return noKV;

  const raw = await request.text();
  if (raw.length > 200_000) return reply({ error: "That is too much data to save." }, 413);
  let clean;
  try {
    clean = sanitizeConfig(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ValidationError) return reply({ error: err.message }, 400);
    return reply({ error: "The data could not be read." }, 400);
  }
  await setJSON(env.KV, "config", clean);
  return reply(clean);
};
