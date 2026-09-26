# Uptime

A streak you keep by existing.

Uptime takes the "I started a stopwatch and never stopped it" trend and gives
it stakes: the time on your clock is a currency. Send some to a friend and it
comes straight off your timer and lands on theirs; spend some to bring a
friend's broken streak back.

The clock is never a running process. Every number in the app is
`now - streak_start`, computed at the moment it is read — the same trick that
lets a phone's stopwatch survive a restart.

---

## Running it

```bash
npm install
npm run dev          # browser, http://localhost:1420
npm run desktop:dev  # the same app in a Tauri window
npm test             # 162 tests over the domain rules, the store, the updater and the Stripe webhook
```

With no Supabase project configured the app runs against browser storage with
a seeded cast of friends in deliberately varied states — one long-running, one
inside the nudge window, two lapsed and revivable. A `LOCAL` badge in the
header tells you which adapter is live.

This is not a mock. The local adapter runs the same `src/core` rules the server
does, so the gift caps, the lapse sweep and the revive price all behave
identically before any backend exists.

To point at a real project, copy `.env.example` to `.env` and fill it in;
`src/data/index.ts` switches adapters on those variables alone.

---

## How it fits together

```
src/core/         Pure rules. No I/O, no React. Every number the app shows is
                  derived here from two timestamps and a ledger.
src/data/         One store interface, two adapters (local, Supabase).
src/components/   
src/screens/      
supabase/         Schema, rules, and the two scheduled jobs.
src-tauri/        The native shell: Windows, Android, iOS from one codebase.
```

The seam that matters is `src/data/store.ts`. Screens receive a `Snapshot` of
answers and never compute a balance themselves, because the same derivation has
to hold across both adapters — and because a client that can compute its own
balance is a client that can lie about it.

### The stop problem

A server clock never dies on its own, so nothing would ever naturally stop. The
mechanic that restores real risk of failure is a **60-day check-in window**: any
sign of life — opening the app, tapping a push, sending or receiving a gift —
moves `last_seen`. If `last_seen` falls further behind than the window, the
streak lapses.

Two details that are easy to get wrong and are tested for:

- A lapse is dated to **the deadline**, not to whenever the sweeper noticed. A
  sweep running a week late does not hand out free days.
- A lapsed run is credited **up to `last_seen`**, not through the grace window.
  Vanishing should not earn the same as showing up.

Deliberately not daily. Snapchat's 24-hour cycle produces the documented
pathologies — proxy snapping, paid restoration, streaks their owners describe
as anxiety-inducing. A 60-day window is invisible to an active user and only
ever fires on someone who has genuinely gone.

**One consequence worth knowing about.** Because opening the app is itself a
sign of life, the window bar as originally specified could only ever read
full — the act of looking at it refills it. So the bar is measured from
`windowAnchor`: where the window stood *before this visit*. It now says
something true ("you last showed up 58 days ago, 2 days left") and the offer to
turn on reminders fires at the one moment a user has a reason to accept it.
An explicit check-in is what refills it.

For the same reason the `lapsed` *status* is nearly unobservable — every open
sweeps it — so the reset message is driven by the last closed run instead.
Without that, a returning user would find a zeroed counter and no explanation.

### The economy

**The time you send is your clock.** There is no separate bank. Sending an
hour takes that hour straight off your own running timer and adds it to the
recipient's; time sent to you is added to yours. Because nothing ticks, a
clock is `now - streak_start`, so a transfer moves two timestamps: the
sender's start later, the recipient's earlier. Both happen in one transaction,
with both rows locked in id order so two people sending to each other at the
same moment cannot deadlock.

The rules around it are unchanged: time only moves between mutual follows,
anonymous accounts cannot send, and at most 7 days can leave a free account per
rolling 24 hours. Two follow from the new model: you can send at most what your
clock reads, and the recipient's clock has to be running - a stopped one has
nowhere for the time to land, and a lapsed one is what reviving is for.

**A free account sends a tenth; the upgrade sends it all.** Without the
upgrade you can send 6 minutes for every hour on your clock - the ratio the
old bank accrued at. The **whole-clock upgrade** is a one-off $5 purchase that
lifts both limits: everything on the clock can be sent, with no daily cap, so a
60-day clock can go to a friend in one gift. It belongs to the account, not the
device or the run. Everyone keeps the 120-sends-an-hour limit, which protects
the ledger rather than the economy.

The share is counted across the run, not per gift. Measured against the clock
as it reads *now*, a free account could send a tenth, then a tenth of what was
left, and so on until it was empty, so the run remembers what has gone out of
it (`sent_this_run`) and the share is a tenth of *clock + sent this run*. A
send leaves that sum unchanged, so the share drops by exactly what was sent.
Time you receive is on your clock like any other and adds a tenth of itself.
A new run starts from nothing sent. Revives are not limited by the share: they
are paid off the whole clock, as before.

Reviving a broken streak restores **half** its lost length and costs the
reviver a tenth of that restored stretch, **paid off their own clock**. A
400-day streak comes back at 200 days and costs its rescuer 20 days of their
own run. That is intentional: a headline rescue takes more than one friend.

The gift ledger is still the audit trail and what the given/received/rescues
boards count. Reads no longer sum it: each profile carries running totals,
kept in step with the ledger by a trigger in the same transaction.

An open app polls a one-row `uptime_pulse` every 30 seconds, so time a friend
sends you appears on your clock within half a minute - the full snapshot is
only re-read when the pulse says something moved.

### Scale

Every read now costs what it returns rather than what the table holds.
Measured on PostgreSQL 16 with 300,000 accounts (`0013_clock_transfers_and_scale.sql`):

| Read | Before | After |
|---|---|---|
| A leaderboard (each of six) | 254 ms - 5.9 s | 0.3 - 4.8 ms |
| Your rank on a board | 0.5 - 1.8 s | ~5 ms (board size cached 10 min) |
| Snapshot, account at the 2,000-follow cap | 46 ms | 16 ms |

Boards read partial indexes and stop after the rows they return; the two whose
value is partly still running ("Hall of fame", "Career total") merge the top N
of each part. The new boards and ranks were checked against a brute-force
evaluation of the old definitions: identical top-100 on all six boards and
identical placings for all 120,000 account/board pairs of a 20,000-account set.

On the client, the per-frame clock used to live at the top of the tree, so the
whole app - every friend row, every board row - re-rendered about 60 times a
second to move the timer's last digits. Only the stopwatch face subscribes to
it now; the People tab went from ~61 renders a second to 1.

---

## Status

| Milestone | State |
|---|---|
| 1. Accounts and the bare timer | Done. Timer, pulse hero, derived elapsed. |
| 2. Cross-platform shell | Desktop done and building, with a self-updating installer. Android/iOS configured, not built here — see below. |
| 3. The heartbeat | Done. Window, per-user and batch sweep, reset flow. |
| 4. Push notifications | Code complete, unverified — needs credentials. |
| 5. The time economy | Done. Ledger, sending, revive, follow/unfollow. |
| 6. Leaderboards | Done. All six boards. |
| 7. Abuse hardening | Done: friend gate, rolling cap, account-age gate, RLS. |

### What was verified, and how

- **100 automated tests** over the domain rules and the store, including lapse
  timing, cap enforcement, revive pricing, clock-to-clock transfers, the
  one-way-follow gate, window anchoring, reload-from-storage, and every
  account rule (anonymous accounts
  refused from sending and reviving, excluded from every board, and the streak
  surviving an upgrade).
- **The SQL was applied to a real PostgreSQL 17** and exercised end to end:
  derivation, the mutual-follow gate (a one-way follow is still refused), the
  rolling cap, overdrafts, revive pricing, double-revive prevention, the
  leaderboards, and the account rules including an anonymous account being
  refused a donation, excluded from the boards, and ranked the moment it is
  upgraded. The RLS was tested under Supabase's default grant posture, and the
  write-guard trigger was tested with a grant deliberately restored.
- **Every screen was rendered in a headless browser** at phone width with no
  console errors, including the states that are awkward to reach by hand:
  a window about to close, a streak just swept, and a one-way follow.
- **A release desktop build**, producing a working `.exe` plus MSI and NSIS
  installers under `src-tauri/target/release/bundle/`.

### What was not verified, and why

- **Android and iOS builds.** No Android SDK or NDK is installed here and the
  JDK is 8 (Android needs 17+); iOS needs macOS. The Tauri project is
  configured for both and `npm run android:init` / `ios:init` are wired, but
  neither has been run. Expect the usual first-run friction.
- **Push delivery.** `supabase/functions/nudge-check-in` implements FCM, APNs
  and WNS including the JWT signing each requires, but none of it has been run
  against a real provider — there are no credentials here. Budget real time for
  this; it is the one piece with no precedent in Nexo or Rater. The function
  skips any provider whose secrets are unset, so deploying it before you have
  credentials is harmless.
- **The release workflow on a GitHub runner.** Everything it runs has been
  run on Windows: the exact build command (both installers, signed with the
  current key) and the staging script. A real update was installed end to end
  with a separately named test build - an installed 0.0.1 found 0.0.2 in a
  feed, downloaded it, verified its signature, installed it from Account ->
  App -> Updates and came back up as 0.0.2, reading "Up to date". What has not
  run is `release.yml` itself on GitHub, and an update of an MSI install (a
  per-machine MSI needs an administrator, and nobody was there to click the
  prompt).
- **Supabase itself.** The migrations were validated against stock PostgreSQL
  with a small `auth` schema shim, not against a live Supabase project. The
  `auth.uid()` and `auth.users` integration points are the parts to watch.

---

## Deploying the backend

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy sweep-lapsed
supabase functions deploy nudge-check-in
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

`npm run fn:deploy` runs all four.

No direct Postgres access? Paste `supabase/deploy.sql` into the SQL editor
instead. It is generated from the migrations - run `npm run db:bundle` after
changing one, rather than editing it by hand.

Then schedule both — see the header comment in each function for the
`cron.schedule` call. `sweep-lapsed` is idempotent and drains any backlog in
5,000-row batches, so running it hourly costs nothing. Both call functions
that only the service role may execute.

Note that every action already sweeps the specific rows it touches, so the
scheduled job is a backstop for accounts nobody is interacting with rather than
the only thing standing between a dead streak and the leaderboards.

### Taking payments

The whole-clock upgrade is sold through **Stripe Checkout**. The app asks
`create-checkout` for a payment page and opens it in the browser - the system
browser on desktop, a new tab on the web. Nothing is unlocked by the app or by
that function: only `stripe-webhook`, on a Stripe-signed event, writes the
purchase (`0014_whole_clock_upgrade.sql`), and an open app notices on its next
30-second pulse. The price is set server-side in
`supabase/functions/_shared/stripe.ts` (`UPGRADE_PRICE`, 500 cents USD); the
`$5` the app shows is `WHOLE_CLOCK_PRICE_LABEL` in `src/core/constants.ts`.
Change them together.

Setup, once per Stripe mode (do it in test mode first, with `sk_test_` keys):

1. **The secret key.** `supabase secrets set STRIPE_SECRET_KEY=sk_...`
2. **Where the browser lands afterwards.** `supabase secrets set
   CHECKOUT_RETURN_URL=https://...` - any page of yours. Stripe adds
   `?checkout=done` or `?checkout=cancelled`. If it is the web build of this
   app, the app says what happened; otherwise make it a page that says "you can
   go back to Uptime now". It is fixed server-side so nobody can mint a genuine
   Stripe page that forwards its payer somewhere else.
3. **The webhook.** In the Stripe dashboard, Developers -> Webhooks, add an
   endpoint at `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   for `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   and `charge.refunded`, then `supabase secrets set
   STRIPE_WEBHOOK_SECRET=whsec_...` with its signing secret.
4. **Deploy** the migration and both functions (above).

To try it end to end in test mode: buy with card `4242 4242 4242 4242`, any
future expiry, any CVC. The account unlocks within half a minute. Refunding
the payment in full from the dashboard locks it again; time already sent
stays where it landed.

Things to know:

- **Anonymous accounts cannot buy it**, for the same reason they cannot send:
  a purchase has to belong to an account that can be signed back into.
- **The phone apps do not sell it.** Apple and Google require their own billing
  for a digital upgrade sold inside an app, so the Android and iOS builds hide
  the offer (`canBuyHere` in `src/payments/checkout.ts`). One bought on the
  desktop or the web still applies there. A phone's web browser does sell it.
- **Chargebacks are not handled.** A refund locks the account; a dispute does
  not. Add `charge.dispute.created` to the webhook if that turns out to matter.
- **The desktop app may open `https://checkout.stripe.com/*` and nothing else**
  (`src-tauri/capabilities/desktop.json`). A custom Stripe checkout domain
  needs adding there.

### CAPTCHA page

`captcha/` is a one-file page that produces a Cloudflare Turnstile token for
the app. It lives on its own host because Turnstile only runs on a public
hostname and the app's page is `http://tauri.localhost`. It is deployed at
`https://uptime-5jf.pages.dev/`; `src/data/captcha.ts` loads it in a hidden
iframe before each sign-in, and `frame-src` in `src-tauri/tauri.conf.json`
allows that. Change all three together.

The app sends a token whenever `VITE_TURNSTILE_SITE_KEY` is set - in `.env`
locally, and as a repository variable for the release build - and signs in
without one otherwise. That is what makes the rollout safe, in this order:

1. Ship a release built with the site key (Settings -> Secrets and variables
   -> Actions -> Variables -> `VITE_TURNSTILE_SITE_KEY`).
2. Wait until installed copies have updated to it.
3. Only then switch CAPTCHA on: Supabase dashboard -> Authentication ->
   Attack Protection -> Enable CAPTCHA protection -> Turnstile, with the
   widget's secret key. Switching it on first stops every older copy signing
   in, since the app signs in anonymously on first launch and after sign-out.
4. Turn the release workflow's missing-key warning into an error.

Automated browsers get error `600010` from the real widget - Turnstile
detecting a bot, as designed - so check the real key from a browser you drive
yourself: `npm run dev`, open `http://localhost:1420`, and in the console run
`(await import("/src/data/captcha.ts")).captchaToken()`.

Deploy the page by hand, once:

1. Cloudflare dashboard -> **Workers & Pages** -> **Create application** ->
   **Get started** -> **Drag and drop your files**. Name the project (the
   name becomes `<name>.pages.dev`), drop the `captcha` folder, **Deploy site**.
   Or: `npx wrangler pages deploy captcha --project-name <name>`.
2. Cloudflare dashboard -> **Turnstile** -> **Add widget**: hostname
   `<name>.pages.dev`, mode **Invisible**. Keep the site key and secret key.

The page takes the site key from its URL (`?sitekey=...`), so it never needs
redeploying for a new key. `captcha/_headers` lists which app origins may
frame it; add the web build's origin there if it signs people in too. To test
without real keys, use Turnstile's dummy site key `1x00000000000000000000BB`
(always passes, invisible), which works on any host including localhost.

## Releasing the desktop app

Windows users get two links that never change:

```
https://github.com/YungDice/uptime/releases/latest/download/Uptime_Installer.exe
https://github.com/YungDice/uptime/releases/latest/download/Uptime_Installer.msi
```

The `.exe` is the one to hand out; the `.msi` is the same app as a Windows
Installer package, for people and IT departments that want one. The file names
carry no version, so the links always serve the current build. Once
installed, the app keeps itself current: it checks on launch and every six
hours, downloads a newer build in the background, and offers a restart
(Account -> App -> Updates does the same by hand, and says why if it cannot).
An app installed from the `.exe` updates from the `.exe` and one installed from
the `.msi` from the `.msi`. Restarting costs nothing, because the clock was
never kept by the app. The phone apps are updated by Google Play and the App
Store instead; there the Updates row just says which.

Releases are published in this repo, which is public, so the downloads and the
update feed (`latest.json`) are too. If the repo is ever made private, see
`RELEASES_REPO` below.

### Shipping a version

```bash
npm run release -- --check   # is everything ready? changes nothing
npm run release              # 0.1.2 -> 0.1.3
npm run release -- minor     # 0.1.2 -> 0.2.0 (also: major, or an exact 1.2.3)
```

From a clean `main` that is level with origin, it checks the one-time setup
below is done, runs the tests, bumps `package.json`, commits, tags `vX.Y.Z` and
pushes both. The tag starts `.github/workflows/release.yml`, which builds both
installers on a Windows runner, signs them, and publishes them with
`latest.json` as the new latest release. The command follows that build to the
end (about 15 minutes; Ctrl+C stops watching, not the build) and prints the
download links. Nothing is built on your machine.

`package.json` is the only place the version is written - `tauri.conf.json`
and the Account screen both read it. The workflow refuses a tag that disagrees
with `package.json` and a version that is already out. If a build fails after
the tag is pushed, fix the cause on `main` and start **Actions -> Release ->
Run workflow**: it ships whatever `package.json` says, so the same version
goes out without spending a new number.

### One-time setup

`npm run release -- --check` says which of these are missing.

1. **The updater's signing key**, as two Actions secrets. The key pair lives in
   `~/.tauri/` on the machine that made it: `uptime-updater.key`, its `.pub`,
   and `uptime-updater.password`.

   ```bash
   gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/uptime-updater.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD < ~/.tauri/uptime-updater.password
   ```

   The matching public key is `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json`; an installed app refuses any update that was
   not signed with it. The key has a password because a Windows runner drops
   an empty environment variable, and Tauri then asks for a password with
   nobody there to type it.
2. **The backend the release talks to**, as two Actions variables - the same
   values as `.env`. The anon key is public by design, so a variable is fine.

   ```bash
   gh variable set VITE_SUPABASE_URL --body "https://<ref>.supabase.co"
   gh variable set VITE_SUPABASE_ANON_KEY --body "<anon key>"
   ```

   Without them the release runs on browser storage, with the demo cast, as a
   fresh checkout does - so `npm run release` refuses to ship one.
3. **Optionally**, `RELEASES_REPO`: an Actions variable naming a different repo
   to publish to, plus a `RELEASES_TOKEN` secret that can write to it. Only
   needed if this repo stops being public. Point `plugins.updater.endpoints`
   in `tauri.conf.json` at the same repo, or installed copies will never find
   an update - `npm run release` checks that the two agree.

**Keep a copy of the private key and its password somewhere other than GitHub
and this machine.** Secrets cannot be read back, and without the key no
installed copy can ever be updated again: everyone would have to reinstall
from a build signed with a new one. To replace it, run
`npx tauri signer generate -w ~/.tauri/uptime-updater.key -p <password>`, put
the `.pub` contents in `tauri.conf.json` and the key and password in the two
secrets, and ship one release by installer rather than by update.

The key in `tauri.conf.json` was replaced for exactly that reason on
2026-09-24: the original was made in a cloud session and never reached this
machine. No release had been published with it, but a copy built locally
before then (0.1.0) trusts the old key and polls a feed that never existed, so
it cannot update itself. Install once from the link above.

A local `npm run desktop:build` is unaffected: it builds unsigned installers
and never needs the key. The release build adds signing through
`src-tauri/tauri.release.conf.json`.

### `cargo` cannot reach crates.io on Windows

```
[60] SSL peer certificate or SSH remote key was not OK
(schannel: SEC_E_UNTRUSTED_ROOT ...)
```

Cargo on Windows trusts only the Windows certificate store, and that store is
missing the root that crates.io uses. Run `npm run fix:cargo-tls`. If
crates.io checks out against the root list that ships with Node, the script
points cargo at that list (`http.cainfo` in `%USERPROFILE%\.cargo\config.toml`).
If it does not, something like antivirus HTTPS scanning or a company proxy is
re-signing the traffic. The script then names who is re-signing it and changes
nothing.

### The icons

Every platform icon in `src-tauri/icons` is generated from `brand/`:

```bash
npm run icons
```

`brand/app-icon.svg` is the source for desktop and iOS; the Android adaptive
icon gets its own foreground, background and monochrome layers so the launcher's
mask never crops the mark. The installer's sidebar is
`src-tauri/windows/installer-sidebar.bmp`.

---

## Accounts

Playing without an account is a first-class state, not a trial. The clock starts
on the first tap, the streak is real, and nothing nags. Two things stay switched
off until there is an account:

- the account does not appear on any leaderboard
- it cannot send time or revive anyone

Both limits are the same defence. Anonymous accounts are free and unlimited, so
a board that counted them would rank whoever scripted the most signups, and a
ledger that accepted them would be a free supply of senders. Both are enforced
in SQL (`0009_accounts.sql`) and mirrored in the local adapter, so the client
can explain a refusal before the round trip without being the thing enforcing
it.

Signing up is an **upgrade, not a new account**: Supabase keeps the same user id
when an anonymous user attaches an email, so the running clock and the history
carry over. Losing a 95-day run to make an account would be the worst possible
moment to ask for one. `auth.users.is_anonymous` flips itself on that upgrade;
the boards read a mirror of it on `profiles`, refreshed by `uptime_open`, which
is the first thing the app calls after the upgrade - so the account is ranked on
its next read.

---

## Three things to decide

- **Following is the entry to everything social.** Gifts are gated on a mutual
  follow, so a fresh account can do nothing until it follows someone and is
  followed back. Names are tappable everywhere now and open a profile you can
  follow from, so the leaderboards are a discovery surface — but there is still
  no search, no suggestions and no invite links, and the only way to reach
  somebody who is not already on a board is to type their nickname exactly.
  That is probably the next thing worth designing.
- **The name.** `Uptime` is the working name and is used throughout, including
  the bundle identifier `com.yungdice.uptime`. It has not had the gut check
  against the Yung Dice brand that the build prompt asked for.
- **`CHECK_IN_WINDOW`, the revive price, the daily send cap and the free
  send share** are the numbers that decide how the game feels, and they are
  guesses. They are named
  constants in `src/core/constants.ts` with matching SQL functions
  (`0001_schema.sql`, `0013_clock_transfers_and_scale.sql`); changing one is a
  one-line edit in each. Now that gifts move real clock time, the cap is also
  what limits friends pooling time into one account to top "Running now" -
  and paid accounts have no cap, so $5 a friend now buys unlimited pooling.
  Worth watching once there are boards worth topping.
