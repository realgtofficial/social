import { adminPassword, checkToken } from "../../src/lib/auth.ts";
import { reply, type Env } from "../../src/lib/common.ts";

// GET /api/session  needs login: tells the admin page its login is still valid
export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== "GET") return reply({ error: "Method not allowed." }, 405);
  const password = adminPassword(env);
  if (!password) return reply({ error: "The admin password is not set up yet." }, 503);
  if (!(await checkToken(request, password))) return reply({ error: "Please log in again." }, 401);
  return reply({ ok: true });
};
