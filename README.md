# GT Official – Site + Private Admin

Static site with a private admin panel, built for Netlify (Netlify Functions + Netlify Blobs).

## Features
- **Public homepage** (`public/index.html`)
- **Private admin** at `/admin` – password login, signed tokens (12h expiry)
- **Day 100 thumbnail carousel** – up to 12 entries, auto-rotates every 3s (1280×720 recommended), managed from admin
- **Let's Discuss community board** – posts (named or anonymous), likes/dislikes (one per browser visitor ID), comments, stored in Netlify Blobs
  - Limits: post 2,000 chars, comment 500 chars, display name 30 chars
  - Admin moderation: refresh and delete posts (with their comments and reactions)

## Structure
```
public/               Site files (publish dir)
  index.html
  admin/index.html
netlify/
  functions/          config, discuss, login
  lib/                auth, defaults, sanitize
netlify.toml
package.json
```

## Setup
1. Set the environment variable `ADMIN_PASSWORD` (min 8 characters) in Netlify:
   *Site configuration → Environment variables* (make sure it's available to Functions), then redeploy.
2. **Never commit the password** – use `.env.example` only as a template.

## Deploy
**Via GitHub (recommended):** push this repo, then in Netlify choose *Add new site → Import from Git*. Publish directory `public` and functions directory `netlify/functions` are already set in `netlify.toml`.

**Via CLI:**
```bash
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

## Local development
```bash
npm install
cp .env.example .env   # then edit the password
npx netlify-cli dev
```

## Auth notes
Tokens are HMAC-signed using the admin password, so changing `ADMIN_PASSWORD` logs out all existing sessions.
