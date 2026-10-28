# Cloud setup — what Colin needs to create (blocks the tier 1–3 roadmap items)

> The step-by-step version with tick boxes is **docs/colin-checklist.md**.

Build runs can't make accounts, so these items wait on a few minutes of setup from Colin. Once the values below are
in `settings/cloud.json` (public keys only, never secrets), the next run can build against them.

## Accounts + cloud save → Supabase (recommended)
Why Supabase over Firebase: plain REST (fetch, no 200 KB SDK on a phone), Postgres rows with row-level security for
"each user sees only their projects", built-in Google + Apple sign-in, and a Storage bucket for GLBs (or R2 later).
1. supabase.com → New project. Copy the **Project URL** and the **anon public key**.
2. Authentication › Providers: turn on **Google** (needs a Google Cloud OAuth client) and **Apple** (needs an Apple
   developer account; can come later — Google first).
3. Add the editor's URL(s) to Authentication › URL configuration › Redirect URLs.

## Publish → Cloudflare Pages direct upload
1. Cloudflare dashboard → Workers & Pages → create a Pages project (e.g. `scene-companion-games`).
2. An API token with **Cloudflare Pages: Edit**. This is a secret: it must live in a small server function
   (Supabase Edge Function), not in the browser. Needs the Supabase project above first.

## Hosted connector (tier 2)
Needs the cloud projects above; then the MCP server runs as a hosted function with Supabase sign-in.

## Connect GitHub (tier 3)
1. github.com/settings/apps → New GitHub App (repo contents + Pages: read/write; callback = the editor URL).
2. Its client secret goes in a server function (same as above), never in the page.
