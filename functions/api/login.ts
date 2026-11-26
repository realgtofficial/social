import { adminPassword, makeToken, safeEqual } from "../../src/lib/auth.ts";
import { reply, type Env } from "../../src/lib/common.ts";

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

  const password = adminPassword(env);
  if (!password) {
    return reply({ error: "The admin password is not set up yet. Add ADMIN_PASSWORD in Cloudflare (at least 8 characters) and redeploy." }, 503);
  }

  let given = "";
  try {
    const body: any = await request.json();
    if (body && typeof body.password === "string") given = body.password;
  } catch {
    // Not valid JSON: treated as a wrong password below.
  }

  if (given.length > 200 || !(await safeEqual(given, password))) {
    await new Promise((r) => setTimeout(r, 1000)); // slows down guessing
    return reply({ error: "Wrong password." }, 401);
  }

  const { token, exp } = await makeToken(password);
  return reply({ token, exp });
};
