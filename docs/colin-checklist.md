# Colin's checklist — what only you can do

Order: the goblin any time. **Supabase first**: Publish, GitHub and payments all keep their secrets in it.
Public keys are fine to paste in chat. **Never paste a secret** (anything called secret, service_role or API token):
those go straight into Supabase › Edge Functions › Secrets.

## 1. Goblin samurai sign-off (phone, ~5 min)
- [ ] Open play.html → 🎬 → **Stadium**
- [ ] Try: run, double jump, katana slash (right-stick flick), wall run (tap beside the tall walls), ledge grab, vault the hurdle
- [ ] Tell me what feels wrong (or add it to FEEDBACK.md). Your notes become the next builds.

## 2. Sign-in + cloud save — Supabase (free, ~20 min)
- [ ] supabase.com → sign up → **New project**
- [ ] Settings › API: copy the **Project URL** and the **anon public key**, and send me both
- [ ] Google sign-in: console.cloud.google.com → new project → APIs & Services
  - [ ] OAuth consent screen → External → fill in the app name and your email
  - [ ] Credentials → Create OAuth client ID → Web application. Under Authorized redirect URI, paste the callback URL shown in Supabase › Authentication › Providers › Google
  - [ ] Paste the Google **Client ID** and **Client secret** into that Supabase Google provider and turn it on
- [ ] Supabase › Authentication › URL Configuration › Redirect URLs: add `https://colinwillow.github.io/scene-companion/`
- [ ] (Later) Apple sign-in needs an Apple Developer account ($99/yr)

## 3. Publish button — Cloudflare Pages (free, ~10 min, after Supabase)
- [ ] cloudflare.com → sign up → Workers & Pages → Create → Pages → **Upload assets**. Name it `scene-companion-games` and upload any one file to create it
- [ ] Send me your **Account ID** (right-hand sidebar of the dashboard)
- [ ] My Profile → API Tokens → Create Token → Custom. Permission: Account › Cloudflare Pages › **Edit**
- [ ] Put the token in Supabase › Edge Functions › Secrets as `CLOUDFLARE_API_TOKEN` (secret: don't send it to me)

## 4. Connect GitHub — a GitHub App (free, ~10 min, after Supabase)
- [ ] github.com/settings/apps → **New GitHub App**
  - Homepage URL and Callback URL: `https://colinwillow.github.io/scene-companion/`
  - Webhook: untick Active
  - Repository permissions: Contents **Read & write**, Pages **Read & write** (Metadata read is automatic)
  - Where can it be installed: Any account, if other people will use it
- [ ] Generate a client secret → Supabase secret `GITHUB_CLIENT_SECRET`
- [ ] Send me the **Client ID** (public)

## 5. Getting paid — paid packs, marketplace, bounties (Stripe)
- [ ] stripe.com → sign up → business details + bank account (it asks for ID verification)
- [ ] Developers › API keys: send me the **publishable key**. Put the **secret key** in Supabase as `STRIPE_SECRET_KEY`
- [ ] Decide: the first paid pack, its price, one-off or subscription
- Know this: inside the iOS/Android apps, Apple and Google require their own in-app purchase for digital items. Selling on the web with Stripe is fine.
- Paying other creators (marketplace, bounties) needs Stripe Connect. That's a later step; nothing to do now.

## 6. Phone apps (already built — only when you want one)
- [ ] iOS: a Mac with Xcode + Apple Developer ($99/yr). Android: Android Studio + Google Play Console ($25 once)
- [ ] Steps: docs/ship-app.md

## 7. Unity / Unreal / Godot export — nothing needed from you
- Godot and Unity exports are done (docs/ship-engines.md); Unreal is my next build
- Optional, to help test: install Godot 4.3+ (free), Unity Personal (free) or Unreal (free) on your computer, open an export and tell me what looks wrong
