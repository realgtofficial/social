import { adminPassword, checkToken } from "../../src/lib/auth.ts";
import { reply, getJSON, setJSON, missingKV, type Env } from "../../src/lib/common.ts";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validId = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(v);
const validVisitor = validId;

const PUBLIC_LIMIT = 100; // newest posts shown on the public board
const ADMIN_LIMIT = 200; // newest posts shown in admin moderation

// Each post is ONE KV entry "post:<id>" holding the post, its reactions and its comments.
// The id starts with an inverted timestamp, so listing keys returns the newest posts first.
const newId = (now: number) => String(9_999_999_999_999 - now).padStart(13, "0") + "-" + crypto.randomUUID();

type Doc = { id: string; name: string; anonymous: boolean; text: string; createdAt: number; visitorId: string; reactions: Record<string, string>; comments: any[] };

const counts = (reactions: Record<string, string>) => {
  const vals = Object.values(reactions || {});
  return { likes: vals.filter((v) => v === "like").length, dislikes: vals.filter((v) => v === "dislike").length };
};

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
        id: p.id, name: p.name || "Anonymous", anonymous: Boolean(p.anonymous), text: p.text, createdAt: p.createdAt,
        ...counts(p.reactions), commentCount: Array.isArray(p.comments) ? p.comments.length : 0,
      })),
    });
  }

  if (req.method === "GET" && !action) {
    let docs: Doc[];
    try { docs = await loadPosts(env, PUBLIC_LIMIT); }
    catch (err) { return reply({ error: `Community posts could not be read: ${err instanceof Error ? err.message : String(err)}` }, 503); }
    const visitorId = url.searchParams.get("visitorId");
    return reply({
      posts: docs.map((p) => ({
        id: p.id, name: p.name, anonymous: p.anonymous, text: p.text, createdAt: p.createdAt,
        myReaction: validVisitor(visitorId) ? (p.reactions || {})[visitorId!] || "" : "",
        ...counts(p.reactions), commentCount: Array.isArray(p.comments) ? p.comments.length : 0,
      })),
    });
  }

  if (req.method === "GET" && action === "comments") {
    const postId = url.searchParams.get("postId");
    if (!validId(postId)) return reply({ error: "Invalid post." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    return reply({ comments: doc && Array.isArray(doc.comments) ? doc.comments.slice(-200) : [] });
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
    const text = clean(body.text, 2000), name = clean(body.name, 30), visitorId = body.visitorId, anonymous = body.anonymous === true;
    if (!text) return reply({ error: "Write something before posting." }, 400);
    if (!anonymous && !name) return reply({ error: "Display name is required unless you post anonymously." }, 400);
    if (!validVisitor(visitorId)) return reply({ error: "Refresh the page and try again." }, 400);
    const now = Date.now(), id = newId(now);
    const doc: Doc = { id, name: anonymous ? "Anonymous" : name, anonymous, text, createdAt: now, visitorId, reactions: {}, comments: [] };
    try {
      await setJSON(env.KV, `post:${id}`, doc);
      const { visitorId: _v, reactions: _r, comments: _c, ...post } = doc;
      return reply({ post }, 201);
    } catch (err) {
      return reply({ error: `Post save failed in storage: ${err instanceof Error ? err.message : String(err)}` }, 503);
    }
  }

  if (action === "comment") {
    const postId = body.postId, text = clean(body.text, 500), name = clean(body.name, 30), visitorId = body.visitorId;
    if (!validId(postId) || !validVisitor(visitorId) || !text) return reply({ error: "Post, name and comment are required." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const comments = Array.isArray(doc.comments) ? doc.comments : [];
    if (comments.length >= 500) return reply({ error: "This post has reached its comment limit." }, 409);
    const comment = { id: crypto.randomUUID(), name: name || "Anonymous", anonymous: !name, text, createdAt: Date.now() };
    comments.push(comment);
    doc.comments = comments;
    await setJSON(env.KV, `post:${postId}`, doc);
    return reply({ comment }, 201);
  }

  if (action === "react") {
    const postId = body.postId, visitorId = body.visitorId, reaction = body.reaction;
    if (!validId(postId) || !validVisitor(visitorId) || !["like", "dislike", "none"].includes(reaction)) return reply({ error: "Invalid reaction." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `post:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const reactions = doc.reactions || {};
    if (reaction === "none") delete reactions[visitorId]; else reactions[visitorId] = reaction;
    doc.reactions = reactions;
    await setJSON(env.KV, `post:${postId}`, doc);
    return reply({ ...counts(reactions), mine: reactions[visitorId] || "" });
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
