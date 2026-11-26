# GT Official – Site + Private Admin (Cloudflare Pages)

Website with a private admin panel, hosted **free on Cloudflare Pages**.
Backend = Pages Functions (`functions/api`), storage = Cloudflare KV.

## Features
- Public homepage (`public/index.html`)
- Private admin at `/admin` – password login, signed tokens (12h expiry)
- Day 100 thumbnail carousel (up to 12 entries, 1280×720 recommended)
- Downloads page at `/downloads/` – only the admin posts (title + links, up to 10 per post) from /admin → Downloads; visitors react with any emoji
- Let's Discuss board – posts (named/anonymous), like/dislike, comments
  - Limits: post 2,000 chars, comment 500, name 30. Newest 100 posts are shown.
  - Admin moderation under /admin → Discuss moderation (delete post with its comments/reactions)

## Structure
```
public/            site files (+ _headers for the admin page); public/downloads/ is the Downloads page
functions/api/     backend: config, discuss, downloads, login, session
src/lib/           auth, sanitize, defaults, shared helpers
package.json
```

## Deploy (all from the browser, free)
1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings: **Framework preset: None**, **Build command: (empty)**, **Build output directory: `public`**. Deploy.
4. Create storage: **Storage & Databases → KV → Create namespace** (any name, e.g. `gtofficial`).
5. Open your Pages project → **Settings → Bindings → Add → KV namespace**: Variable name **`KV`** (exactly), choose the namespace. Add for Production (and Preview if you want).
6. **Settings → Variables and Secrets → Add**: name `ADMIN_PASSWORD`, type **Secret**, value = your password (min 8 chars).
7. **Deployments → Retry deployment** (or push any commit) so the new settings apply.
8. Site: `https://<project>.pages.dev` · Admin: `https://<project>.pages.dev/admin`

Never commit the password to Git.

## Local development
```bash
npm install
cp .dev.vars.example .dev.vars   # edit the password
npm run dev
```

## Notes
- KV is eventually consistent: a change made in one region can take up to ~60s to show elsewhere.
- Rate limiting: not in code. In Cloudflare use *Security → WAF → Rate limiting rules* on `/api/login` if you want it.
- Changing `ADMIN_PASSWORD` logs out all existing admin sessions.
