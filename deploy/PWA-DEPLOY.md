# PWA install + authenticated deploy (optional)

> **You do not need any of this to run the app.** `npm run dev` runs the whole
> thing locally on `127.0.0.1` with no Coolify, no OAuth, and no auth at all —
> that's the default, single-user, localhost design. This folder is an **optional**
> recipe for the day you want the app installable on a phone and reachable over
> the internet. Coolify, oauth2-proxy, and Google OAuth are never hard
> dependencies of the codebase.

This runbook gets the app onto a phone as an installable PWA, served through
Coolify behind its own oauth2-proxy instance, **locked to a single account**. The
example uses a wildcard domain + Caddy + Coolify, but the shape applies to any
reverse proxy that can put oauth2-proxy in front of a container.

Placeholders to substitute throughout:

| Placeholder | Meaning |
|-------------|---------|
| `you@example.com` | the one account allowed in |
| `fitness.example.com` | the public hostname you'll serve from |
| `<coolify-host>` | host/IP where the Coolify API answers |
| `<oauth2-port>` | host port your oauth2-proxy instance listens on |

---

## Why a single-account lock needs an explicit allowlist

A common setup gates oauth2-proxy with `OAUTH2_PROXY_EMAIL_DOMAINS=example.com`
and leans on Google "Testing mode" to restrict which accounts. But if more than
one account is a test user on that Google OAuth client, a domain rule lets them
all in — it can't tell accounts apart. To lock to **one** account, use an
explicit `authenticated-emails-file`, optionally backed by an app-level header
check.

---

## Phase 1 — Coolify app + oauth2-proxy + reverse proxy

### 1a. Create the app in Coolify

- New application → from this repo, **Dockerfile** build (the repo `Dockerfile`
  serves web + API on one port, `3001`).
- Network: your shared proxy network.
- **Custom network alias:** `fitness-visualiser` (stable across redeploys — the
  oauth2-proxy upstream points at this, so it survives deploys with no edits).
- Persistent volume mounted at `/data` (holds `garmin_sync.db`; the app creates
  `visualiser-events.db` there).
- Env vars (in the Coolify UI, never on disk):

  | Variable | Value |
  |----------|-------|
  | `GARMIN_DB_PATH` | `/data/garmin_sync.db` |
  | `EVENTS_DB_PATH` | `/data/visualiser-events.db` |
  | `HOST` | `0.0.0.0` |
  | `PORT` | `3001` |
  | `WEB_DIST_PATH` | `/app/web/dist` |
  | `OPENROUTER_API_KEY` | _(optional — enables the Chat tab)_ |
  | `ALLOWED_EMAILS` | `you@example.com,partner@example.com` _(the account gate, 1e — required in deploy posture)_ |

Take the app's **UUID** from the Coolify URL; the deploy script reads it from
`FITNESS_APP_UUID`.

### 1b. The single-email allowlist file

Copy `authenticated-emails.txt.example` to `authenticated-emails.txt` and put a
single line in it — the one allowed account:

```
you@example.com
```

The real file is git-ignored. Mount it into the oauth2-proxy container as a
**file mount** in Coolify:

- Mount path: `/etc/oauth2-proxy/authenticated-emails.txt`
- Contents: the one line above.

> **Caveat (why 1e is preferred in practice):** the oauth2-proxy image runs as a
> non-root user, but Coolify mounts this file root-owned and **rewrites it on
> every redeploy** — so the proxy gets "permission denied" reading it and
> crash-loops. To use this approach you'd have to keep the file world-readable
> across redeploys. The app-level gate (1e) sidesteps this entirely.

### 1c. Generate a fresh cookie secret

Use a **unique** cookie secret for this instance (so its sessions can't be
decoded by any other oauth2-proxy you run). Generate one and paste it into the
Coolify UI — never commit it:

```bash
python3 -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
# or:
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

### 1d. The oauth2-proxy instance — env-var set

New Docker-image service (`quay.io/oauth2-proxy/oauth2-proxy`) on the proxy
network, host port `<oauth2-port>` → container `4180`.

| Variable | Value |
|----------|-------|
| `OAUTH2_PROXY_PROVIDER` | `google` |
| `OAUTH2_PROXY_CLIENT_ID` | _(from Google Cloud Console)_ |
| `OAUTH2_PROXY_CLIENT_SECRET` | _(from Google Cloud Console)_ |
| `OAUTH2_PROXY_COOKIE_SECRET` | a fresh 32-byte base64url value from 1c |
| `OAUTH2_PROXY_EMAIL_DOMAINS` | `gmail.com` _(authenticates your account(s); single-account narrowing is the app gate in 1e)_ |
| `OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE` | _(optional alternative to the app gate — see the caveat in 1b)_ |
| `OAUTH2_PROXY_UPSTREAMS` | `http://fitness-visualiser:3001` _(alias + the app's port)_ |
| `OAUTH2_PROXY_HTTP_ADDRESS` | `0.0.0.0:4180` |
| `OAUTH2_PROXY_COOKIE_SECURE` | `true` |
| `OAUTH2_PROXY_COOKIE_NAME` | `_fitness_oauth2` _(distinct from any other instance)_ |
| `OAUTH2_PROXY_COOKIE_DOMAIN` | `fitness.example.com` _(host-scoped, not a wildcard)_ |
| `OAUTH2_PROXY_REDIRECT_URL` | `https://fitness.example.com/oauth2/callback` |
| `OAUTH2_PROXY_SKIP_PROVIDER_BUTTON` | `true` |
| `OAUTH2_PROXY_REVERSE_PROXY` | `true` |
| `OAUTH2_PROXY_SET_XAUTHREQUEST` | `true` |
| `OAUTH2_PROXY_PASS_USER_HEADERS` | `true` _(so the app can read `X-Forwarded-Email` for 1e)_ |

> **Gotcha:** `UPSTREAMS` is plural — singular `UPSTREAM` is silently ignored by
> oauth2-proxy v7.

> **Account lock (what we actually run):** `EMAIL_DOMAINS=gmail.com` only restricts
> to gmail accounts that clear Google consent — in *Testing* status that means your
> listed **test users** *and any account with an IAM role on the GCP project*, which
> is more than one account. The narrowing to your specific account(s) is enforced by
> the app-level `ALLOWED_EMAILS` gate (1e). Belt-and-braces: also lock it at the edge
> with `OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE` and/or by trimming the test-user list
> and project IAM principals, so a foreign account can't even get a session.

### 1e. Account gate — the app-level check (recommended)

This is what actually enforces "only you" in practice. The app refuses any request
whose proxy-injected email isn't in `ALLOWED_EMAILS` (comma-separated; `ALLOWED_EMAIL`
is a legacy single-value alias). oauth2-proxy injects the authenticated email as a
header (`X-Forwarded-Email`); the app sits behind the proxy on an internal network
and is never directly reachable, so the header can't be spoofed. The check covers
the whole app (shell and PWA assets included) so a wrong-account session sees nothing
at all, and it **fails closed** — in deploy posture (`WEB_DIST_PATH` set, or
`REQUIRE_AUTH=1`) a missing allowlist makes the server refuse to start.

Add this hook in `server/src/app.ts`. It stays a no-op when no allowlist is set and
auth isn't required, so local dev on 127.0.0.1 stays open:

```ts
// Account gate. Whole-app, fails closed in deploy posture (see app.ts for the
// REQUIRE_AUTH / WEB_DIST_PATH logic); unset locally so dev on 127.0.0.1 stays open.
const allowedEmails = parseAllowlist(process.env.ALLOWED_EMAILS ?? process.env.ALLOWED_EMAIL);
if (allowedEmails.length > 0) {
  app.addHook('onRequest', async (req, reply) => {
    const raw = req.headers['x-forwarded-email'] ?? req.headers['x-auth-request-email'];
    const email = Array.isArray(raw) ? raw[0] : raw;
    if (typeof email !== 'string' || !allowedEmails.includes(email.toLowerCase())) {
      return reply.code(403).send({ error: 'forbidden' });
    }
  });
}
```

This keeps the "no auth on 127.0.0.1" design intact — it's authorization (who),
not authentication, and it's a no-op unless the env var is set.

### 1f. Reverse-proxy vhost (Caddy example)

```caddyfile
fitness.example.com {
    reverse_proxy <coolify-host>:<oauth2-port>
    encode gzip
}
```

Point DNS for `fitness.example.com` at the host; Caddy provisions TLS
automatically via Let's Encrypt. HTTPS is required — a service worker won't
register over plain HTTP.

### 1g. Add the redirect URI to Google

On the OAuth client, add the authorized redirect URI:

```
https://fitness.example.com/oauth2/callback
```

The single-email file — not Google's test-user list — is what keeps this app to
one account.

---

## Phase 2 — SPA auth-expiry handling (already in the code)

When the proxy session expires, `/api/*` calls return `401` instead of JSON. The
`web/src/api.ts` `apiFetch` wrapper detects that and does a full-page reload to
re-authenticate through Google. (`403` is left alone — wrong-account, reloading
would loop.) Nothing to do here; it's wired in.

## Phase 3 — PWA shell (already in the code)

`vite-plugin-pwa` in `web/vite.config.ts`: manifest + Workbox service worker,
app-shell precache, `NetworkFirst` for `/api` (200s only). Icons in
`web/public/icons/`. **Caches the shell, not the data** — the app still needs the
server to render. Regenerate icons with `make-icons.py` if the brand colours
change.

## Phase 4 — Mobile layout (already in the code)

Collapsible hamburger nav, single-column chart grid, scrollable tables, stacked
chat, larger tap targets. Charts reflow via their existing `ResizeObserver`.

## Phase 5 — Deploy + device check

Deploy however you drive Coolify — the **Deploy** button in the Coolify UI, or an
API script. (Keep any deploy script with real hostnames/tokens in your private
infra repo, not here.) Then on the phone: load the URL, sign in with Google,
"Add to Home Screen", confirm the service worker registers and a non-allowed
account is cleanly denied.

---

## Getting garmin_sync.db onto the host

Independent of the PWA, but needed before the phone shows anything — the app reads
`garmin_sync.db`, produced by fitness-data-sync. Either `rsync`/`scp` it into the
`/data` volume periodically (a snapshot until the next push), or run
fitness-data-sync on the host (fresher; more setup). Choose by how current the
data needs to be.

---

## File rundown

| File | Purpose |
|------|---------|
| `PWA-DEPLOY.md` | This runbook |
| `authenticated-emails.txt.example` | Template for the one-line single-account allowlist (copy to `authenticated-emails.txt`, which is git-ignored) |
| `make-icons.py` | Regenerates the PWA icon set into `web/public/icons/` |

> The actual deploy script (with real hostnames/UUID/token) lives in the
> operator's **private** infra repo, not in this public one.
