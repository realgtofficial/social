// Checks and cleans everything the admin page sends before it is saved.
// The public page shows these values to every visitor, so only plain text, numbers and YouTube links are allowed.

export class ValidationError extends Error {}

export type SiteConfig = {
  subs: number;
  games: { name: string; count: number; desc: string; url: string }[];
  playlists: { name: string; tag: string; count: number; unit: "videos" | "lessons"; url: string }[];
  videos: { id: string; list: string; title: string; game: string }[];
  day100Thumbnails: { title: string; image: string; link: string }[];
  series: { title: string; desc: string; buttonText: string; buttonUrl: string; image: string };
  communityCards: { title: string; desc: string; buttonText: string; buttonUrl: string; detail: string }[];
  footerText: string;
  footerLinkText: string;
  footerLinkUrl: string;
};

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

function text(v: unknown, max: number, label: string, required = false): string {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new ValidationError(`${label} must be text.`);
  const t = v.trim();
  if (required && !t) throw new ValidationError(`${label} cannot be empty.`);
  if (t.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return t;
}

function whole(v: unknown, min: number, max: number, label: string): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ValidationError(`${label} must be a number.`);
  const r = Math.floor(n);
  if (r < min || r > max) throw new ValidationError(`${label} must be between ${min} and ${max}.`);
  return r;
}

function ytLink(v: unknown, label: string): string {
  const t = text(v, 300, label);
  if (!t) return "";
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ValidationError(`${label} must be a full link starting with https://`);
  }
  if (u.protocol !== "https:" || !YT_HOSTS.has(u.hostname)) throw new ValidationError(`${label} must be a youtube.com link.`);
  return u.toString();
}

function list(v: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(v)) throw new ValidationError(`${label} must be a list.`);
  if (v.length > max) throw new ValidationError(`${label} can have at most ${max} items.`);
  return v;
}

function obj(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ValidationError(`${label} is not valid.`);
  return v as Record<string, unknown>;
}

export function sanitizeConfig(input: unknown): SiteConfig {
  const c = obj(input, "Data");
  const games = list(c.games, 8, "Pick your game cards").map((g, i) => {
    const o = obj(g, `Game card ${i + 1}`);
    return {
      name: text(o.name, 60, `Game card ${i + 1} name`, true),
      count: whole(o.count, 0, 10_000_000, `Game card ${i + 1} video count`),
      desc: text(o.desc, 140, `Game card ${i + 1} text`),
      url: ytLink(o.url, `Game card ${i + 1} link`),
    };
  });
  const playlists = list(c.playlists, 100, "Playlists").map((p, i) => {
    const o = obj(p, `Playlist ${i + 1}`);
    const tag = text(o.tag, 30, `Playlist ${i + 1} filter`).toLowerCase().replace(/\s+/g, " ");
    if (tag && !/^[a-z0-9][a-z0-9 -]*$/.test(tag)) throw new ValidationError(`Playlist ${i + 1} filter can only use letters, numbers, spaces and hyphens.`);
    const unit = o.unit === "lessons" ? "lessons" : "videos";
    return {
      name: text(o.name, 100, `Playlist ${i + 1} name`, true),
      tag,
      count: whole(o.count, 0, 10_000_000, `Playlist ${i + 1} video count`),
      unit: unit as "videos" | "lessons",
      url: ytLink(o.url, `Playlist ${i + 1} link`),
    };
  });
  const day100Thumbnails = list(c.day100Thumbnails ?? [], 12, "Day 100 thumbnails").map((v, i) => {
    const o = obj(v, `Day 100 thumbnail ${i + 1}`);
    const image = text(o.image, 1000, `Thumbnail ${i + 1} image URL`, true);
    let iu: URL; try { iu = new URL(image); } catch { throw new ValidationError(`Thumbnail ${i + 1} image must be a valid HTTPS URL.`); }
    if (iu.protocol !== "https:") throw new ValidationError(`Thumbnail ${i + 1} image must use HTTPS.`);
    return { title: text(o.title, 150, `Thumbnail ${i + 1} title`), image, link: ytLink(o.link, `Thumbnail ${i + 1} YouTube link`) };
  });
  const seriesInput = obj(c.series ?? { title: "100 Days in Pixelmon and Cobblemon", desc: "Catch, train and survive in Minecraft's Pokémon-style mods, one day at a time. Edit this card to point to your current series.", buttonText: "VIEW PLAYLISTS", buttonUrl: "https://www.youtube.com/@gtofficial/playlists", image: "" }, "Featured series");
  const series = { title: text(seriesInput.title, 120, "Featured series title", true), desc: text(seriesInput.desc, 300, "Featured series description"), buttonText: text(seriesInput.buttonText, 60, "Featured series button label"), buttonUrl: text(seriesInput.buttonUrl, 500, "Featured series button URL"), image: text(seriesInput.image, 1000, "Featured series thumbnail URL") };
  if (series.buttonUrl) { let su: URL; try { su = new URL(series.buttonUrl); } catch { throw new ValidationError("Featured series button URL must be a valid HTTPS link."); } if (su.protocol !== "https:") throw new ValidationError("Featured series button URL must use HTTPS."); }
  if (series.image) { let si: URL; try { si = new URL(series.image); } catch { throw new ValidationError("Featured series thumbnail must be a valid HTTPS URL."); } if (si.protocol !== "https:") throw new ValidationError("Featured series thumbnail must use HTTPS."); }
  const communityCards = list(c.communityCards ?? [], 12, "Community cards").map((v, i) => {
    const o = obj(v, `Community card ${i + 1}`);
    const buttonUrl = text(o.buttonUrl, 500, `Community card ${i + 1} link`);
    if (buttonUrl) { let u: URL; try { u = new URL(buttonUrl); } catch { throw new ValidationError(`Community card ${i + 1} link must be a valid HTTPS URL.`); } if (u.protocol !== "https:") throw new ValidationError(`Community card ${i + 1} link must use HTTPS.`); }
    return { title: text(o.title, 60, `Community card ${i + 1} title`, true), desc: text(o.desc, 200, `Community card ${i + 1} description`), buttonText: text(o.buttonText, 60, `Community card ${i + 1} button`), buttonUrl, detail: text(o.detail, 100, `Community card ${i + 1} detail`) };
  });
  const footerText = text(c.footerText ?? "© 2026 GT Official. Fan content, not affiliated with Mojang, Microsoft, Roblox or Supercell.", 250, "Footer text");
  const footerLinkText = text(c.footerLinkText ?? "youtube.com/@gtofficial", 80, "Footer link label");
  const footerLinkUrl = text(c.footerLinkUrl ?? "https://www.youtube.com/@gtofficial", 500, "Footer link URL");
  if (footerLinkUrl) { let fu: URL; try { fu = new URL(footerLinkUrl); } catch { throw new ValidationError("Footer link must be a valid HTTPS URL."); } if (fu.protocol !== "https:") throw new ValidationError("Footer link must use HTTPS."); }
  const videos = list(c.videos, 30, "Latest videos").map((v, i) => {
    const o = obj(v, `Video ${i + 1}`);
    const id = text(o.id, 11, `Video ${i + 1} ID`, true);
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new ValidationError(`Video ${i + 1} ID must be the 11 characters after v= in the YouTube link.`);
    const pl = text(o.list, 64, `Video ${i + 1} playlist ID`);
    if (pl && !/^[A-Za-z0-9_-]{10,64}$/.test(pl)) throw new ValidationError(`Video ${i + 1} playlist ID is not valid.`);
    return { id, list: pl, title: text(o.title, 150, `Video ${i + 1} title`, true), game: text(o.game, 30, `Video ${i + 1} game`) };
  });
  return { subs: whole(c.subs, 0, 2_000_000_000, "Subscriber count"), games, playlists, videos, day100Thumbnails, series, communityCards, footerText, footerLinkText, footerLinkUrl };
}
