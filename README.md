# Assignment Tracker

A personal assignment-tracking app: tiered priority scoring, automatic
Google Calendar time-blocking, and a daily 1pm digest notification.

## Tech stack (and why)

| Layer | Choice | Why |
|---|---|---|
| App framework | **React Native + Expo (TypeScript)** | One codebase runs on your iPhone via Expo Go during development, and can be built to a real `.ipa` later via EAS. Expo bundles first-class modules for everything this app needs (auth, notifications, SQLite, background tasks) without hand-rolling native code — a good fit for Copilot-assisted iteration, since almost everything stays in plain TypeScript. |
| Local data | **expo-sqlite** | This is a single-user, on-device app — no need for a hosted database or backend server. SQLite gives you real queries/indexes as the assignment list grows, with an easy upgrade path if you ever want sync (see `src/storage/database.ts`). |
| Calendar integration | **Google Calendar REST API v3 + expo-auth-session (OAuth 2.0)** | Talks directly to Google's API, so events land in the same Google Calendar you already check — visible from the Google Calendar iOS app, or the built-in iOS Calendar app if that Google account is also added there. |
| Notifications | **expo-notifications (local) + expo-task-manager/expo-background-fetch** | No backend required for the MVP. See the reliability caveat in `src/services/notificationService.ts` — this is a deliberate simplicity/reliability tradeoff, explained below. |

No custom backend server was introduced. Everything runs client-side on
your phone. The one thing a backend *would* buy you is a guaranteed-on-time
push notification regardless of whether the app was opened that day —
see the caveat below.

## Project structure

```
assignment-tracker/
├── App.tsx                                # entry point
├── app.json                                # Expo config (bundle id, URL scheme, OAuth client id)
├── src/
│   ├── models/Assignment.ts                # core data model + validation
│   ├── services/
│   │   ├── priorityScoring.ts              # ⭐ the tiered priority algorithm
│   │   ├── priorityScoring.test.ts         # unit tests locking in tiering behavior
│   │   ├── googleCalendarSync.ts           # OAuth + freebusy + event scheduling
│   │   └── notificationService.ts          # 1pm digest, scoped to "today"
│   ├── storage/database.ts                 # SQLite CRUD
│   └── screens/AssignmentListScreen.tsx     # minimal UI wiring it all together
```

## Priority scoring — summary

Full rationale and tuning knobs are documented in the header comment of
`src/services/priorityScoring.ts`. Short version: it's a **tiered
(lexicographic) sort**, not a blended weighted average — assignments
are bucketed by due-date urgency first (Tier 1, dominant), and only
assignments in the *same* bucket get reordered by a difficulty/time
"how taxing is this" score (Tier 2). Subject/notes never affect order
(Tier 3). The bucket width (`urgencyBucketDays`) is the main tuning
knob: `1` (the default) means due date is nearly absolute; widening it
to 2–4 days lets harder/longer tasks jump ahead of easier ones due a
couple of days sooner, which is useful for batching effort during a
high-load week but weakens due-date dominance somewhat. Try both and
see what feels right — see the file for the full discussion.

## Setup

```bash
npm install
npx expo start
```

Scan the QR code with your iPhone camera (opens in Expo Go), or press
`i` for the iOS simulator if you have one set up on a Mac.

## ⚠️ Manual steps required (can't be done by AI/code)

These are things only you can do, outside this repo:

1. **Google Cloud project & OAuth client**
   - Create a project at [console.cloud.google.com](https://console.cloud.google.com).
   - Enable the **Google Calendar API** for that project.
   - Configure the **OAuth consent screen** (External, Testing mode is
     fine for personal use — add your own Google account as a test
     user so Google doesn't block sign-in).
   - Create an **OAuth 2.0 Client ID** of type **iOS**. You'll need to
     give it the app's bundle identifier (see `app.json`,
     `ios.bundleIdentifier`) and, if prompted, the custom URL scheme
     (`assignmenttracker`, also in `app.json`).
   - Paste the resulting client id into `app.json` →
     `expo.extra.googleClientIdIOS`.

2. **iOS OAuth caveat with Expo Go**
   Google restricts sign-in inside some embedded/WebView browsers,
   which can occasionally affect Expo Go during development. If Google
   sign-in misbehaves in Expo Go, the fix is to build a
   [development build](https://docs.expo.dev/develop/development-builds/introduction/)
   (`npx expo prebuild` + `eas build --profile development --platform ios`)
   instead — this runs your own app shell rather than Expo Go's, and
   sign-in works exactly like a normal app. Requires a free Expo
   account either way; a development build additionally needs an Apple
   ID registered as an Apple Developer (free tier is enough for
   installing on your own device — no $99/year paid membership needed
   unless you want TestFlight/App Store distribution later).

3. **Notification permission**
   The app will prompt you on first launch — just tap Allow. Nothing
   to configure in Apple/Google consoles for *local* notifications
   (they don't need APNs certificates, since they never leave the
   device).

4. **iOS Calendar app visibility (optional)**
   If you want the auto-scheduled blocks to show up in the stock iOS
   Calendar app (not just the Google Calendar app), add your Google
   account under iPhone **Settings → Calendar → Accounts → Add
   Account → Google**, and make sure that calendar is toggled on.

5. **Daily digest reliability tradeoff — read this**
   The 1pm notification is scheduled *locally* on your phone and its
   content is only as fresh as the last time it was refreshed (on app
   open, or via opportunistic background refresh — see the comment in
   `notificationService.ts`). In practice this means: as long as you
   open the app at some point most days, you'll get an accurate 1pm
   digest. If you go a long stretch without opening the app, iOS may
   or may not have run the background refresh, and the digest could be
   stale or silently skipped. If rock-solid daily delivery ends up
   mattering more than the "no backend" simplicity, the fix is a small
   server (e.g. a free-tier cron job) that calls the
   [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/)
   at 1pm — flagged here rather than built, since it's a meaningfully
   bigger lift (server hosting + push token registration) than the
   rest of this MVP.

6. **App Store / TestFlight** — not needed for personal use. Running
   via Expo Go or a development build installed directly on your own
   phone (via `eas build` + AltStore/Xcode install, or TestFlight with
   a paid Apple Developer account) is sufficient. Only pursue
   TestFlight/App Store if you want to share this with other people.

## Suggested build order (matches how this repo is laid out)

1. ✅ Data model + priority scoring (`models/`, `services/priorityScoring.ts`) — done, with tests.
2. ✅ Google Calendar sync (`services/googleCalendarSync.ts`) — done; needs your OAuth client id (manual step 1) to actually run.
3. ✅ 1pm daily digest (`services/notificationService.ts`) — done.
4. Next, likely with Copilot: a real add/edit assignment form (currently just a "+ Add sample" button), swipe-to-complete, and settings UI for the `PriorityConfig` tuning knobs.
