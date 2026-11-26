import { adminPassword, checkToken } from "../../src/lib/auth.ts";
import { reply, getJSON, setJSON, missingKV, type Env } from "../../src/lib/common.ts";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validId = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(v);
const validVisitor = validId;

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const PUBLIC_LIMIT = 100; // newest threads shown on the public board
const ADMIN_LIMIT = 200; // newest threads shown in admin moderation
const MAX_REPLIES = 500;
const MAX_VIEWERS = 20000;

// Each thread is ONE KV entry "post:<id>" holding the post, its reactions, replies and viewers.
// The id starts with an inverted timestamp, so listing keys returns the newest threads first.
// Approximate visitor state/region from Cloudflare (IP based, no permission popup). Shown for anonymous posts too.
const regionOf = (req: Request) => clean((req as any).cf?.region, 40);

// Names that only the real admin may use (posting from /admin).
const reservedName = (name: string) => /admin|gtofficial|moderator/.test(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
const isAdmin = async (req: Request, env: Env) => {
  const password = adminPassword(env);
  return !!password && (await checkToken(req, password));
};

const newId = (now: number) => String(9_999_999_999_999 - now).padStart(13, "0") + "-" + crypto.randomUUID();

type Doc = {
  id: string; name: string; region?: string; admin?: boolean; anonymous: boolean; text: string; createdAt: number; visitorId: string;
  reactions: Record<string, string[]>; // emoji -> visitor ids
  comments: any[]; // replies
  views: Record<string, number>; // visitor id -> 1 (unique viewers)
};

const reactionList = (d: Doc, visitorId: string | null) =>
  EMOJIS.map((emoji) => {
    const ids = (d.reactions && d.reactions[emoji]) || [];
    return { emoji, count: ids.length, mine: !!visitorId && ids.includes(visitorId) };
  });
const viewCount = (d: Doc) => Object.keys(d.views || {}).length;
const replyCount = (d: Doc) => (Array.isArray(d.comments) ? d.comments.length : 0);

async function loadPosts(env: Env, limit: number): Promise<Doc[]> {
  const listed = await env.KV.list({ prefix: "post:", limit });
  const docs = await Promise.all(listed.keys.map((k) => getJSON(env.KV, k.name)));
  return docs.filter((d: any) => d && typeof d === "object");
}

export const onRequest = async ({ request: req, env }: { request: Request; env: Env }) => {
  const url = new URL(req.url), action = url.searchParams.get("action") || "";
  const noKV = missingKV(env);
  if (noKV) return noKV;

  if (req.method === "GET" && action === "moderate") {
    const password = adminPassword(env);
    if (!password || !(await checkToken(req, password))) return reply({ error: "Admin login required." }, 401);
    const docs = await loadPosts(env, ADMIN_LIMIT);
    return reply({
      posts: docs.map((p) => ({
        id: p.id, name: p.name || "Anonymous", region: p.region || "", admin: !!p.admin, anonymous: Boolean(p.anonymous), text: p.text, createdAt: p.createdAt,
        reactionTotal: reactionList(p, null).reduce((n, r) => n + r.count, 0), views: viewCount(p), replyCount: replyCount(p),
      })),
    });
  }

  if (req.method === "GET" && !action) {
    let docs: Doc[];
    try { docs = await loadPosts(env, PUBLIC_LIMIT); }
    catch (err) { return reply({ error: `Community posts could not be read: ${err instanceof Error ? err.message : String(err)}` }, 503); }
    const raw = url.searchParams.get("visitorId");
    const visitorId = validVisitor(raw) ? raw : null;
    return reply({
      posts: docs.map((p) => ({
        id: p.id, name: p.name, region: p.region || "", admin: !!p.admin, anonymous: p.anonymous, text: p.text, createdAt: p.createdAt,
        reactions: reactionList(p, visitorId), views: viewCount(p), replyCount: replyCount(p),
      })),
    });
  }

  if (req.method === "GET" && action === "comments") {
    const postId = url.searchParams.get("postId");
    if (!validId(postId)) return reply({ error: "Invalid post." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    return reply({ comments: Array.isArray(doc.comments) ? doc.comments.slice(-200) : [], views: viewCount(doc), replyCount: replyCount(doc) });
  }

  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  // Reject cross-origin write requests where an Origin header is present.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== url.host.toLowerCase()) return reply({ error: "Cross-origin request blocked." }, 403);
    } catch { return reply({ error: "Invalid origin." }, 403); }
  }

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON." }, 400); }

  if (action === "create") {
    const asAdmin = body.asAdmin === true;
    if (asAdmin && !(await isAdmin(req, env))) return reply({ error: "Admin login required." }, 401);
    const text = clean(body.text, 2000), name = asAdmin ? "Admin" : clean(body.name, 30), anonymous = asAdmin ? false : body.anonymous === true;
    const visitorId = asAdmin ? "admin_console" : body.visitorId;
    if (!text) return reply({ error: "Write something before posting." }, 400);
    if (!anonymous && !name) return reply({ error: "Display name is required unless you post anonymously." }, 400);
    if (!asAdmin && !anonymous && reservedName(name)) return reply({ error: "That name is reserved. Please choose another name." }, 400);
    if (!validVisitor(visitorId)) return reply({ error: "Refresh the page and try again." }, 400);
    const now = Date.now(), id = newId(now);
    const region = asAdmin ? "" : regionOf(req);
    const doc: Doc = { id, name: anonymous ? "Anonymous" : name, region, admin: asAdmin, anonymous, text, createdAt: now, visitorId, reactions: {}, comments: [], views: {} };
    try {
      await setJSON(env.KV, `post:${id}`, doc);
      return reply({ post: { id, name: doc.name, region, admin: asAdmin, anonymous, text, createdAt: now } }, 201);
    } catch (err) {
      return reply({ error: `Post save failed in storage: ${err instanceof Error ? err.message : String(err)}` }, 503);
    }
  }

  if (action === "comment") { // a reply in the thread
    const asAdmin = body.asAdmin === true;
    if (asAdmin && !(await isAdmin(req, env))) return reply({ error: "Admin login required." }, 401);
    const postId = body.postId, text = clean(body.text, 500), name = asAdmin ? "Admin" : clean(body.name, 30), visitorId = asAdmin ? "admin_console" : body.visitorId, anonymous = asAdmin ? false : body.anonymous === true;
    if (!validId(postId) || !validVisitor(visitorId)) return reply({ error: "Invalid reply." }, 400);
    if (!text) return reply({ error: "Write a reply first." }, 400);
    if (!anonymous && !name) return reply({ error: "Display name is required unless you reply anonymously." }, 400);
    if (!asAdmin && !anonymous && reservedName(name)) return reply({ error: "That name is reserved. Please choose another name." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const comments = Array.isArray(doc.comments) ? doc.comments : [];
    if (comments.length >= MAX_REPLIES) return reply({ error: "This thread has reached its reply limit." }, 409);
    const comment = { id: crypto.randomUUID(), name: anonymous ? "Anonymous" : name, region: asAdmin ? "" : regionOf(req), admin: asAdmin, anonymous, text, createdAt: Date.now() };
    comments.push(comment);
    doc.comments = comments;
    await setJSON(env.KV, `post:${postId}`, doc);
    return reply({ comment, replyCount: comments.length }, 201);
  }

  if (action === "react") { // toggle one emoji reaction (Discord style)
    const postId = body.postId, visitorId = body.visitorId, emoji = body.emoji;
    if (!validId(postId) || !validVisitor(visitorId) || !EMOJIS.includes(emoji)) return reply({ error: "Invalid reaction." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const reactions = doc.reactions || {};
    const ids = reactions[emoji] || [];
    reactions[emoji] = ids.includes(visitorId) ? ids.filter((v) => v !== visitorId) : [...ids, visitorId];
    doc.reactions = reactions;
    await setJSON(env.KV, `post:${postId}`, doc);
    return reply({ reactions: reactionList(doc, visitorId) });
  }

  if (action === "view") { // count a unique viewer when a thread is opened
    const postId = body.postId, visitorId = body.visitorId;
    if (!validId(postId) || !validVisitor(visitorId)) return reply({ error: "Invalid view." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const views = doc.views || {};
    if (!views[visitorId] && Object.keys(views).length < MAX_VIEWERS) {
      views[visitorId] = 1;
      doc.views = views;
      await setJSON(env.KV, `post:${postId}`, doc);
    }
    return reply({ views: viewCount(doc) });
  }

  if (action === "delete") {
    const password = adminPassword(env);
    if (!password || !(await checkToken(req, password))) return reply({ error: "Admin login required." }, 401);
    const postId = body.postId;
    if (!validId(postId)) return reply({ error: "Invalid post ID." }, 400);
    const doc = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    await env.KV.delete(`post:${postId}`);
    return reply({ ok: true });
  }

  return reply({ error: "Unknown action." }, 400);
};
