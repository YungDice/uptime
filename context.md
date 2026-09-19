# context.md

Orientation for an agent picking this repo up cold. `README.md` explains *why*
the product works the way it does and is worth reading once. This file is the
map, the invariants you can break without noticing, and the true state of each
platform.

---

## One paragraph

Uptime is a React + TypeScript single-page app wrapped in Tauri v2, backed by
Supabase (PostgreSQL + Edge Functions). It is a social streak game: a stopwatch
you never stop, whose time becomes a currency you can bank, gift, and spend
reviving a friend's broken streak. The entire app is four tabs and roughly 4.5k
lines of TypeScript.

**The load-bearing idea:** nothing ticks. There is no running process and no
`elapsed` column anywhere. Every number on screen is `now - streak_start`,
computed at read time. That is why a streak survives a restart, a reinstall and
a year of the server being asleep.

---

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Pure rules. No I/O, no React, no imports outside `core`. |
| `src/data/` | One store interface, two adapters that must behave identically. |
| `src/components/` | Presentational. `Shell`, `TabBar`, `List`, `StopwatchFace`, `FriendList`, `Sheet`, `SendSheet`, `ConfirmSheet`, `LiveTime`, `Medal`, `Podium`, `Avatar`, `ReminderOffer`. |
| `src/screens/` | The four tabs: `Home`, `People`, `Boards`, `Account` — plus `Profile`, which is somebody else's page and opens as a sheet over any of them. |
| `src/hooks/` | `useSession` (owns store + clock + notices), `useNow` / `useFractionalNow`. |
| `src/notifications/` | Client half of the check-in prompt. |
| `src/platform.ts` | Which platform the bundle is running on. |
| `src/components/ErrorBoundary.tsx` | The only thing standing between a render error and a black window. |
| `supabase/migrations/` | `0001`–`0011`. The rules again, in SQL. |
| `supabase/functions/` | `sweep-lapsed`, `nudge-check-in`. |
| `src-tauri/` | The native shell. One Rust crate for all platforms. |

Import alias: `@/` → `src/`. Set in both `vite.config.ts` and `tsconfig.json` —
change one and you must change the other.

### The two seams that matter

**`src/data/store.ts`** — `UptimeStore` is the only thing the UI talks to.
Screens receive a `Snapshot` of *answers* and never compute a balance. Both
adapters behind it enforce the same rules; `LocalStore` is not a mock with the
checks stubbed out, it runs the real `src/core` logic. If you add a rule, it
goes in three places or it is not really a rule: `src/core`, the SQL, and the
tests.

**`src/core/`** — every derivation. If you find yourself computing a duration,
a balance or a rank inside a component, it belongs here instead.

---

## Invariants you can break without noticing

These are the things that are easy to get subtly wrong, each of which has a
test standing behind it. Read this list before changing streak or ledger logic.

1. **A lapse is dated to the deadline, not to the sweep.** `endRun(..., "lapsed")`
   uses `windowEndsAt(record)`, not `now`. A sweeper running a week late must
   not hand out free days.

2. **A lapsed run is credited to `lastSeen`, not through the grace window.**
   `runLength(startedAt, lastSeen)`. Vanishing must not earn the same as
   showing up.

3. **The window bar is measured from `Snapshot.windowAnchor`, not from
   `me.streak.lastSeen`.** Opening the app is itself a sign of life, so by the
   time the bar renders, `lastSeen` is already now and the bar would
   tautologically read 100%. `windowAnchor` is the value from *before* this
   visit. `windowFraction()` in `core/streak.ts` is the honest primitive — use
   it only when you genuinely have the record you mean.

4. **The `lapsed` status is nearly unobservable**, because every open sweeps it.
   The reset message is therefore driven by `Snapshot.lastRun` (the last closed
   run), not by the status. Without that, a returning user gets a zeroed
   counter and no explanation.

5. **Balances are sums over the gift ledger, never a stored column.** This gives
   a free audit trail and makes the donation boards a `GROUP BY`.

6. **Anonymous accounts play but do not rank and cannot send.** Enforced in SQL
   (`0009_accounts.sql`) *and* mirrored in `LocalStore`. The client mirror
   exists so the UI can explain a refusal before the round trip — it is not the
   thing enforcing it.

7. **Sign-up is an upgrade, not a new account.** Supabase keeps the same user id
   when an anonymous user attaches an email, so streak, history and balance all
   carry over. Never create a fresh row on sign-up.

8. **`splitStopwatch` scales to integer milliseconds before splitting.** At ~95
   days the elapsed float is large enough that `x - Math.floor(x)` returns
   `0.4199…` for `0.42`, so flooring would render 41 instead of 42. Do not
   "simplify" that back to a fractional subtraction.

9. **Hundredths are cosmetic and local.** The server stores whole seconds.
   `useFractionalNow` animates from the anchored local clock and resyncs against
   `SyncedClock` every 5s.

10. **Every snapshot must carry an `account`, and the SQL cannot supply one.**
    `account` comes from a separate RPC (`uptime_account`, which reads
    `auth.users`), so no SQL action returns it. `SupabaseStore.action()` has to
    reattach it from `lastAccount`. This shipped as a black screen: the UI reads
    `snapshot.account.isAnonymous` on every render, so every successful action
    threw, and with no error boundary React unmounted the whole tree
    permanently. If you add a field the UI always reads, check *both* paths -
    `refresh()` and `action()` - return it.

11. **There is an `ErrorBoundary` now. Keep it.** Without one, any render throw
    blanks the app forever on a true-black design, with no message and no way
    back but a restart.

12. **The giveable figure is derived on the client, not read off the snapshot.**
    `liveGiveable(snapshot, now)` in `src/data/store.ts`, and every surface that
    offers to spend time takes it from the single call in `App`. `Snapshot.balance`
    is the server's reading at the instant the snapshot was taken, and snapshots
    are only taken when something is pressed — so on a running clock the figure
    stood still for an hour and then leapt by the hour's accrual on the next
    action. It shipped as a bug report reading "banking went from 5 to 13
    minutes". If you add a place that shows or spends it, take the live value.

13. **A theme token nothing uses as a utility class is deleted.** Tailwind v4
    tree-shakes `@theme`, and `var(--color-gold)` read from an inline `style` is
    invisible to it. The metals therefore live in `:root`, not `@theme`. This
    fails silently and spectacularly: three `color-mix()` calls and a
    `box-shadow` all became invalid at once and the podium rendered as white
    numerals floating over nothing, with no console error anywhere.

14. **The Tauri CSP has to name every host an image can come from.** Avatars are
    public Supabase Storage URLs, `img-src` was `'self' data: blob:`, and so
    every profile picture was blocked in the desktop and Android builds while
    working perfectly in `npm run dev` — the browser has no CSP. If a remote
    asset appears, `src-tauri/tauri.conf.json` needs it in the matching
    directive.

15. **`Capsule` defaults to `type="button"`, so it cannot submit a form unless
    you pass `type="submit"`.** This already shipped one dead screen: the
    "Create account" button was a `Capsule` with no `onClick` inside a `<form>`,
    which made it inert. Worse, a form whose only control is a plain button has
    *no* way to be submitted — with more than one text field the browser
    suppresses implicit Enter-to-submit too, so the keyboard did not save it.
    A `Capsule` in a form needs either `onClick` or `type="submit"`.

### The tunable numbers

`src/core/constants.ts`, mirrored by SQL functions in `0001_schema.sql`.
Changing one is a one-line edit in each place:

- `CHECK_IN_WINDOW` = 60 days — how long you may go unseen before lapsing.
- `ACCRUAL_RATE` = 0.1 — banked time as a fraction of time kept.
- `REVIVE_RESTORE_FRACTION` = 0.5 and `REVIVE_COST_PER_RESTORED_SECOND` = 0.1.
- `MAX_SENT_PER_DAY` = 7 days (rolling 24h cap).
- `MIN_ACCOUNT_AGE_FOR_LEADERBOARD_CREDIT` = 14 days.

These three decide how the game feels and the README is explicit that they are
guesses.

---

### Newer surfaces

- **Avatars** are Supabase Storage (`avatars` bucket, public read, writes
  confined to a folder named for the owner's uid). `profiles.avatar_url` holds
  the full public URL and `uptime_set_avatar` checks its shape, so the column
  cannot be pointed at an arbitrary host. The local adapter inlines a data URL
  instead. `Avatar` falls back to a grey monogram, Contacts-style.
- **Achievements** (`src/core/achievements.ts`) are derived at read time from
  numbers the snapshot already carries, plus a placing from `uptime_my_rank`.
  There is no achievements table and there should not be one. Each one names
  its own `glyph` and `metal`; `Medal` strikes it. Art belongs to the rule that
  grants the award, not to the renderer.
- **Profiles** (`uptime_profile` in `0011`, `LocalStore.profile`) are the public
  read of *any* account, connected or not. Not to be confused with the `friends`
  array inside `uptime_snapshot`, which exists to draw rows in a list you are
  part of and stops at the edge of your own follow graph.
- **Nickname is the word; `handle` is the column.** The rename in `0011` touches
  message strings only. Renaming the column, the unique index and every function
  signature to match a caption is how a rename becomes an outage.
- **Follow requests** are not a new schema. `friends` always contained people
  who follow you and are not followed back; the snapshot now says which way
  each follow points (`iFollow` / `followsMe`) and People splits them out.

## Running it

```bash
npm install
npm run dev            # browser, http://localhost:1420
npm test               # 78 tests, ~0.4s
npm run typecheck      # tsc --noEmit
npm run desktop:dev    # same app in a Tauri window
npm run desktop:build  # .exe + MSI + NSIS
```

With no Supabase env configured the app runs `LocalStore` against
`localStorage`, seeded with a cast of friends in deliberately varied states
(one long-running, one inside the nudge window, two lapsed and revivable). A
`Local` badge in the header tells you which adapter is live.
`VITE_UPTIME_ADAPTER=local` (see `.env.demo`) forces it even when Supabase
*is* configured.

Adapter selection is `src/data/index.ts` and depends on env vars alone.

**tsconfig is strict in ways that bite:** `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noUnusedLocals`. An `arr[0]` is `T | undefined`,
and `{ foo: undefined }` is not assignable to `{ foo?: T }`.

---

## Platform state

One Rust crate (`uptime_lib`) serves all targets. `main.rs` is the desktop
binary; mobile links the library through `#[cfg_attr(mobile, tauri::mobile_entry_point)]`.
`src-tauri/gen/` is generated and gitignored.

| Target | State |
|---|---|
| Windows desktop | **Builds and ships.** `.exe`, MSI and NSIS rebuilt and verified 2026-09-19, after the mobile config was added. |
| macOS / Linux desktop | Config is platform-neutral; never built. Needs those hosts. |
| Android | Config written, Rust targets installed, back button and touch behaviour done and verified in a browser. **`tauri android init` not yet run** — needs Android SDK + NDK and JDK 17+. |
| iOS | Config written. **Cannot be touched from Windows** — see below. |

`bundle.android` and `bundle.iOS` in `tauri.conf.json` are set explicitly
(`minSdkVersion` 24, `debugApplicationIdSuffix` `.debug`,
`minimumSystemVersion` 16.2). The iOS floor is not arbitrary — see the webview
note below.

### What blocks Android here

`npx tauri android init` fails with:

```
Error Android SDK not found at C:\Users\strat\AppData\Local\Android/Sdk
```

This machine has **JDK 1.8** (Android needs 17+), no `ANDROID_HOME`, no
`NDK_HOME`, no SDK. The four Android Rust targets *are* installed
(`aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`,
`x86_64-linux-android`).

Once the SDK, NDK and a JDK 17+ are installed and `ANDROID_HOME` / `NDK_HOME`
are set, `npm run android:init` generates `src-tauri/gen/android/` and
`npm run android:dev` should work with no further code changes.

### What blocks iOS here

Harder than "no credentials": **the `ios` subcommand does not exist in the
Windows Tauri CLI binary.**

```
$ npx tauri ios init
error: unrecognized subcommand 'ios'
```

It is compiled out on non-macOS hosts. The `ios:init` / `ios:dev` scripts in
`package.json` are correct but can only ever run on macOS with Xcode. Nothing
in the repo can change this; it needs a Mac.

### Mobile facts worth knowing before you touch the shell

- **The Android hardware back button is already wired to webview history.**
  `wry-0.55.1/src/android/kotlin/WryActivity.kt` installs an
  `OnBackPressedCallback` (default `handleBackNavigation = true`) that calls
  `webView.goBack()` when `canGoBack()`, and otherwise exits the activity. So
  pushing history entries in the frontend is what makes back behave — see
  `useBackStack` in `src/hooks/useBackStack.ts`.
- **Android IPC is a `@JavascriptInterface` postMessage bridge**, not a network
  request (`wry`'s `Ipc.kt`). So the CSP in `tauri.conf.json` does *not* need an
  `ipc:` entry in `connect-src` for mobile. Do not add one speculatively.
- **The capability in `src-tauri/capabilities/default.json` already applies on
  mobile.** Its `platforms` field is absent, which the schema defines as "all
  targets", and the mobile webview label is `main` just like the desktop
  window. It needs no split.
- The frontend was already written safe-area aware: `viewport-fit=cover` in
  `index.html`, `env(safe-area-inset-*)` in `Shell` and `TabBar`.
- **`color-mix()` is load-bearing and sets the real OS floor.** It is used
  throughout `styles.css` and in inline styles for the notice backgrounds, the
  collapsed title bar, selection and every button tint. It needs **Safari 16.2**
  (iOS 16.2, Dec 2022) and **Chrome 111** (Android WebView 111, Mar 2023).
  Below those, the declarations are simply dropped and the tinted surfaces go
  transparent — on a true-black ground that reads as broken, not as degraded.
  `minimumSystemVersion: "16.2"` encodes this for iOS. Android cannot: WebView
  updates through the Play Store independently of the OS, so `minSdkVersion`
  guarantees nothing. Either accept the risk on very old WebViews or add
  fallback declarations before the `color-mix()` ones.

---

### Finishing the Android port

Everything in the repo is done. What remains is machine setup, none of which
this repo can carry:

1. **JDK 17+.** This machine has 1.8. `winget install Microsoft.OpenJDK.17`,
   then set `JAVA_HOME`.
2. **Android SDK + NDK.** Android Studio, or the command-line tools plus
   `sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;27.0.12077973"`.
3. **Set `ANDROID_HOME` and `NDK_HOME`.** The Tauri CLI reads both; `NDK_HOME`
   must point at the versioned NDK directory, not at the SDK root.
4. `npm run android:init` → generates `src-tauri/gen/android/` (gitignored).
5. `npm run android:dev` with a device or emulator attached.

`npm run doctor` (`tauri info`) prints what it can and cannot find, and is the
fastest way to see which of the four steps above is still missing.

### Finishing the iOS port

Needs a Mac; nothing else unblocks it. On macOS with Xcode and its command-line
tools installed:

1. `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`
2. `brew install cocoapods` — Tauri's iOS template uses it.
3. Set `bundle.iOS.developmentTeam` in `tauri.conf.json`, or export
   `APPLE_DEVELOPMENT_TEAM`, which overrides it. Code signing is enforced even
   for a simulator run.
4. `npm run ios:init` → generates `src-tauri/gen/apple/`.
5. `npm run ios:dev`.

## Known gaps

- **Push delivery is code-complete and entirely unverified.**
  `supabase/functions/nudge-check-in` implements FCM, APNs and WNS including
  the JWT signing each needs, but has never run against a real provider. It
  skips any provider whose secrets are unset, so deploying it early is
  harmless.
- **Nothing supplies a push token.** `registerDevice()` in
  `src/notifications/checkIn.ts` takes a platform and a token and has no
  caller. `src/platform.ts` now answers the platform half;
  `@tauri-apps/plugin-notification` is **local notifications only** and does
  not expose FCM/APNs tokens, so the token half needs a push plugin that is
  not yet a dependency. `uptime_register_device(platform, token)` is waiting
  in `0007_push.sql`.
- **Supabase was validated against stock PostgreSQL 17 with an `auth` schema
  shim**, not a live project. `auth.uid()` and `auth.users.is_anonymous` are
  the integration points to watch.
- **Discovery is one handle field on the People tab.** No search, no
  suggestions, no invite links. Gifts are gated on a *mutual* follow, so a
  fresh account can do nothing until it follows someone and is followed back.
  The README flags this as the next thing worth designing.
- **The name `Uptime`** is a working title, baked into the bundle identifier
  `com.yungdice.uptime`.
- **No component tests.** The 78 tests cover `src/core` and the store only;
  there is no DOM test environment installed (no jsdom, no Testing Library), so
  `useBackStack` and the screens are verified by driving a browser rather than
  by a test in the repo. Adding a DOM stack is a real decision, not an
  oversight — make it deliberately.
- **`/favicon.ico` 404s in the browser build.** There is no `public/` directory
  and no favicon link in `index.html`. Invisible inside a Tauri shell, which has
  no favicon concept, and it is the only console error the app produces.

---

## House style

The existing code is heavily commented, and the comments explain *why*, never
what. Several of them argue against the obvious implementation and say what
goes wrong if you take it (see `windowAnchor`, `splitStopwatch`, the solid
tab bar). Match that density and that register — a terse patch dropped into
this codebase reads as foreign.

Design language is documented in `DESIGN.md`: the iPhone Clock app's grammar,
true black, tabular figures, hairlines, and colour used only to name a system
(orange = live run, green = banked, red = lapse). Nothing else gets colour.

**Git:** the repo owner makes all commits. Stage freely; never commit, push,
tag or open a PR.
