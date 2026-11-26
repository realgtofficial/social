import { adminPassword, checkToken } from "../../src/lib/auth.ts";
import { reply, getJSON, setJSON, missingKV, type Env } from "../../src/lib/common.ts";

// Downloads page backend.
// GET  /api/downloads?visitorId=…        public: list of download posts with emoji reaction counts
// POST /api/downloads?action=react       public: toggle ANY single emoji reaction
// POST /api/downloads?action=create      admin only: new post (title + links)
// POST /api/downloads?action=update      admin only: edit a post (reactions are kept)
// POST /api/downloads?action=delete      admin only: remove a post
// Each post is ONE KV entry "dl:<id>". The id starts with an inverted timestamp so listing returns newest first.

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validId = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(v);

const LIST_LIMIT = 200;
const MAX_LINKS = 10;
const MAX_EMOJI_KINDS = 40; // different emojis allowed on one post
const MAX_PER_VISITOR = 12; // different emojis one visitor can leave on one post

// Exactly ONE emoji: flag, keycap, or a pictographic (with optional skin tone / variation selector / ZWJ chain).
// This accepts every emoji the phone keyboards (Android and iOS) can type, and nothing else.
const ONE_EMOJI = new RegExp(
  "^(?:" +
    "\\p{Regional_Indicator}{2}" + // 🇮🇳 flags
    "|\\u{1F3F4}[\\u{E0020}-\\u{E007E}]+\\u{E007F}" + // 🏴󠁧󠁢󠁥󠁮󠁧󠁿 subdivision flags
    "|[0-9#*]\\uFE0F?\\u20E3" + // 1️⃣ keycaps
    "|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*\\uFE0F?" +
  ")$",
  "u",
);
const isEmoji = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 40 && ONE_EMOJI.test(v);

const newId = (now: number) => String(9_999_999_999_999 - now).padStart(13, "0") + "-" + crypto.randomUUID();

type Link = { label: string; url: string };
type Doc = { id: string; title: string; links: Link[]; createdAt: number; updatedAt?: number; reactions: Record<string, string[]> };

class Bad extends Error {}

function parseLinks(raw: unknown): Link[] {
  if (!Array.isArray(raw)) throw new Bad("Add at least one link.");
  const out: Link[] = [];
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as any) : {};
    const urlText = clean(o.url, 600);
    if (!urlText) continue;
    let u: URL;
    try { u = new URL(urlText); } catch { throw new Bad(`"${urlText.slice(0, 60)}" is not a valid link.`); }
    if (u.protocol !== "https:") throw new Bad(`Links must start with https:// (${urlText.slice(0, 60)}).`);
    if (u.href.length > 500) throw new Bad("A link is too long (max 500 characters).");
    out.push({ label: clean(o.label, 60), url: u.href });
  }
  if (!out.length) throw new Bad("Add at least one link.");
  if (out.length > MAX_LINKS) throw new Bad(`You can add up to ${MAX_LINKS} links per post.`);
  return out;
}

function parsePost(body: any): { title: string; links: Link[] } {
  const title = clean(body.title, 120);
  if (!title) throw new Bad("Title is required.");
  return { title, links: parseLinks(body.links) };
}

const reactionList = (d: Doc, visitorId: string | null) =>
  Object.entries(d.reactions || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([emoji, ids]) => ({ emoji, count: ids.length, mine: !!visitorId && ids.includes(visitorId) }))
    .sort((a, b) => b.count - a.count);

const view = (d: Doc, visitorId: string | null) => ({
  id: d.id, title: d.title, links: d.links, createdAt: d.createdAt, updatedAt: d.updatedAt || 0, reactions: reactionList(d, visitorId),
});

export const onRequest = async ({ request: req, env }: { request: Request; env: Env }) => {
  const url = new URL(req.url), action = url.searchParams.get("action") || "";
  const noKV = missingKV(env);
  if (noKV) return noKV;

  if (req.method === "GET") {
    let docs: Doc[];
    try {
      const listed = await env.KV.list({ prefix: "dl:", limit: LIST_LIMIT });
      docs = (await Promise.all(listed.keys.map((k) => getJSON(env.KV, k.name)))).filter((d: any) => d && typeof d === "object");
    } catch (err) {
      return reply({ error: `Downloads could not be read: ${err instanceof Error ? err.message : String(err)}` }, 503);
    }
    const raw = url.searchParams.get("visitorId");
    const visitorId = validId(raw) ? raw : null;
    return reply({ posts: docs.map((d) => view(d, visitorId)) });
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
  if (!body || typeof body !== "object") return reply({ error: "Invalid JSON." }, 400);

  if (action === "react") { // open to every visitor
    const { postId, visitorId, emoji } = body;
    if (!validId(postId) || !validId(visitorId) || !isEmoji(emoji)) return reply({ error: "Invalid reaction." }, 400);
    const doc: Doc | null = await getJSON(env.KV, `dl:${postId}`);
    if (!doc) return reply({ error: "Post not found." }, 404);
    const reactions = doc.reactions || {};
    const ids = reactions[emoji] || [];
    if (ids.includes(visitorId)) {
      reactions[emoji] = ids.filter((v) => v !== visitorId);
      if (!reactions[emoji].length) delete reactions[emoji];
    } else {
      const kinds = Object.keys(reactions);
      if (!reactions[emoji] && kinds.length >= MAX_EMOJI_KINDS) return reply({ error: "This post already has the maximum number of different emojis." }, 409);
      const mine = kinds.filter((k) => reactions[k].includes(visitorId)).length;
      if (mine >= MAX_PER_VISITOR) return reply({ error: `You can use up to ${MAX_PER_VISITOR} different emojis on one post. Tap one of yours to remove it.` }, 409);
      reactions[emoji] = [...ids, visitorId];
    }
    doc.reactions = reactions;
    await setJSON(env.KV, `dl:${postId}`, doc);
    return reply({ reactions: reactionList(doc, visitorId) });
  }

  // Everything below is admin only.
  const password = adminPassword(env);
  if (!password || !(await checkToken(req, password))) return reply({ error: "Admin login required." }, 401);

  try {
    if (action === "create") {
      const { title, links } = parsePost(body);
      const now = Date.now(), id = newId(now);
      const doc: Doc = { id, title, links, createdAt: now, reactions: {} };
      await setJSON(env.KV, `dl:${id}`, doc);
      return reply({ post: view(doc, null) }, 201);
    }

    if (action === "update") {
      if (!validId(body.postId)) return reply({ error: "Invalid post ID." }, 400);
      const doc: Doc | null = await getJSON(env.KV, `dl:${body.postId}`);
      if (!doc) return reply({ error: "Post not found." }, 404);
      const { title, links } = parsePost(body);
      doc.title = title; doc.links = links; doc.updatedAt = Date.now();
      await setJSON(env.KV, `dl:${doc.id}`, doc);
      return reply({ post: view(doc, null) });
    }

    if (action === "delete") {
      if (!validId(body.postId)) return reply({ error: "Invalid post ID." }, 400);
      const doc = await getJSON(env.KV, `dl:${body.postId}`);
      if (!doc) return reply({ error: "Post not found." }, 404);
      await env.KV.delete(`dl:${body.postId}`);
      return reply({ ok: true });
    }
  } catch (err) {
    if (err instanceof Bad) return reply({ error: err.message }, 400);
    return reply({ error: `Saving failed in storage: ${err instanceof Error ? err.message : String(err)}` }, 503);
  }

  return reply({ error: "Unknown action." }, 400);
};
