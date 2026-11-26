// Password login helpers. The password lives only in the ADMIN_PASSWORD secret/environment variable.
// After a correct password the server hands out a signed token that expires in 12 hours.
// The token is signed with the password itself, so changing the password logs everyone out.

const enc = new TextEncoder();
const dec = new TextDecoder();
const TOKEN_HOURS = 12;

function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(text: string): Uint8Array {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

// Compares two texts in constant time by comparing their fixed-length digests.
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac("compare", a), hmac("compare", b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Returns the password, or null when it is missing or too short to be safe.
export function adminPassword(env: { ADMIN_PASSWORD?: string }): string | null {
  const p = env.ADMIN_PASSWORD;
  return p && p.length >= 8 ? p : null;
}

export async function makeToken(password: string, now: number = Date.now()): Promise<{ token: string; exp: number }> {
  const exp = now + TOKEN_HOURS * 3600 * 1000;
  const body = toB64u(enc.encode(JSON.stringify({ exp })));
  const sig = toB64u(await hmac("gt-admin|" + password, body));
  return { token: body + "." + sig, exp };
}

export async function checkToken(req: Request, password: string): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return false;
  const [body, sig, extra] = m[1].split(".");
  if (!body || !sig || extra !== undefined) return false;
  const want = toB64u(await hmac("gt-admin|" + password, body));
  if (!(await safeEqual(sig, want))) return false;
  try {
    const { exp } = JSON.parse(dec.decode(fromB64u(body)));
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}
