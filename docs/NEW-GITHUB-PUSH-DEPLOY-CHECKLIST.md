# Project Finalization + Push/Deploy Checklist

Last updated: 2026-03-11

Use this as the final ship checklist for this repo.

Archived planning/migration docs were removed from the fresh local project so this can remain the single active checklist.

Current local note:
- Fresh repo is active on `main`, connected to `https://github.com/vdjvsamplerpad/vdjvsamplerpad.github.io.git`, and GitHub Pages is live.

Current intended architecture:
1. Frontend: GitHub Pages static build
2. App APIs: Supabase Edge Functions
3. Store asset storage: Cloudflare R2
4. Mobile priority: Android via Capacitor

## 0) Ship Decision Gate
- [x] Decide what this release is:
  - [ ] final MVP
  - [x] release candidate
  - [ ] internal beta
- [x] Freeze scope for this release
  - In scope for this release: fresh repo setup, GitHub Pages deploy readiness, Supabase production verification, Android release/update readiness, final cleanup, and blocker fixes only.
  - Out of scope for this release: new sampler features, new store/admin features, extra UI experiments, and non-blocking refactors.
- [x] Move non-blocking ideas into a post-launch list instead of continuing feature creep
  - Deferred to post-launch: extra bundle optimization, additional runtime instrumentation, extra admin UX polish, and Electron update work unless desktop shipping becomes part of this release.

## 1) Release Blockers You Should Fix First
- [x] Review the current dirty worktree carefully with `git status`
- [x] Classify every untracked file:
  - [x] real source file
  - [x] docs
  - [x] generated artifact
  - [x] temporary/debug file
- [x] Remove or ignore accidental local artifacts before push:
  - [x] `.VSCodeCounter/`
  - [x] `testsprite-preview*.log`
  - [x] `testsprite_tests/` if not intentionally committed
  - [x] `reports/` if generated only
  - [x] `release-snapshots/` if generated only
  - [x] `desktop.ini`
- [x] Confirm large refactors are complete and not half-migrated:
  - [x] split sampler/admin files are all imported from the live app paths
  - [x] no dead legacy code path is still wired by mistake
  - [x] no duplicate dialog/store implementation exists with diverging behavior
- [x] Run and pass:
  - [x] `npm run type-check`
  - [x] `npm run build`
- [ ] Run at least targeted tests for the areas you changed most
  - Current blocker: test files were archived out of the active project tree, so this gate cannot be honestly checked until the needed tests are restored or replaced.
- [x] Verify there are no top-level runtime crashes in local browser startup
  - Verified by successful production build, successful headless `App` render smoke in JSDOM, and successful local static-shell responses for `/`, `/sw.js`, `/site.webmanifest`, `/ios/`, and `/android/`.
- [x] Verify service worker changes do not break first load or update flow
  - Manual browser verification completed locally and reported working.

## 2) Security / Secret Hygiene
- [x] Confirm no secrets are committed anywhere in repo history for this release branch
  - Current fresh repo has no commits yet, so this branch currently has no commit history.
- [x] Double-check `.env`, local notes, docs, screenshots, and copied logs for leaked values
  - Active docs now contain only this checklist, local `.env` files remain ignored, and no active repo-local notes/screenshots/logs with secret material were found outside ignored build/release output.
- [x] Run a final grep for obvious secrets:
  - [x] `git grep -n "SUPABASE_SERVICE_ROLE_KEY\\|ghp_\\|github_pat_\\|WEBHOOK_SIGNING_SECRET\\|R2_SECRET_ACCESS_KEY\\|DISCORD_WEBHOOK_"`
  - Result: equivalent repo-wide scan matched env variable names, runtime secret lookups, and checklist text, not hard-coded secret values.
- [x] Confirm release-signing material is not committed or exposed in repo/docs:
  - [x] Android keystore file path is outside repo
  - [x] keystore password / alias password is not stored in committed notes
  - [x] Electron signing secrets/cert notes are not in repo if signing is used
  - Note: `scripts/sign-android-release.ps1` was updated to use environment variables or an explicitly provided external info file, not a repo-local keystore note.
- [x] Make sure only public keys remain in client env usage:
  - [x] `VITE_SUPABASE_URL`
  - [x] `VITE_SUPABASE_ANON_KEY`
  - [x] public verification keys only
- [x] Ensure server/edge secrets exist only in runtime secrets, not in client code
- [x] Re-check `.env.example` and `supabase/functions/.env.example` are safe and current
- [x] If local dev is still using hosted Supabase, make sure that is intentional:
  - [x] local-only override documented
  - [x] `VITE_ALLOW_REMOTE_SUPABASE_IN_DEV` not accidentally carried into production CI
  - Current note: `.env.example` keeps `VITE_ALLOW_REMOTE_SUPABASE_IN_DEV=false`, and this fresh repo currently has no CI workflow configured.

## 3) Repo Hygiene Before Push
- [x] Confirm new repo URL / org / username references are correct
  - Current remote: `https://github.com/vdjvsamplerpad/vdjvsamplerpad.github.io.git`
- [x] Search for stale old repo, domain, or username references:
  - [x] `rg -n "<old-username>|<old-repo>|<old-domain>|<old-username>\\.github\\.io" .`
  - Result: no stale old repo/domain references were found in active project files; only this checklist contains the placeholder command text.
- [x] Confirm `.gitignore` covers generated media, logs, and local tooling output
- [x] Check if large media files in `docs/` are intentional to keep in git
- [x] Confirm deleted files are intentional, especially docs and data exports
  - Current active docs intentionally contain only this checklist, and prior local-only cleanup removed archived docs/data artifacts from the fresh repo.
- [x] Stage only the release-intended set of files
  - Current index excludes ignored local/build output and excludes removed junk such as `android/.idea/`, `client/typecheck.log`, and `client/public/assets/DEFAULT_BANK - Copy/`.

## 4) Deploy / Hosting Checklist
- [x] GitHub repo settings recreated if moving repo
- [x] Actions enabled and deployment workflow present
  - [x] deployment workflow present at `.github/workflows/deploy.yml`
- [x] Pages target confirmed:
  - [x] root site `/`
  - [ ] project path `/<repo>/`
- [x] Frontend base path is correct for GitHub Pages deployment mode
- [x] `404.html`, manifest, icons, and service worker are all valid for static hosting
- [ ] GitHub Pages update path tested:
  - [ ] open old deployed app in one browser tab
  - [ ] deploy new build
  - [ ] verify refresh / revisit gets new hashed assets and working routes
  - [ ] verify existing installed PWA or shortcut is not trapped on stale shell assets
- [ ] Public site URL is consistent across:
  - [x] GitHub Pages
  - [ ] Supabase Auth Site URL
  - [ ] Supabase redirect URLs
  - [x] docs

## 5) Supabase / Edge / Storage Production Checks
- [ ] Confirm production project is the intended Supabase project
- [ ] All required functions are deployed:
  - [ ] `activity-api`
  - [ ] `admin-api`
  - [ ] `store-api`
  - [ ] `user-export-api`
  - [ ] `webhook-api`
- [ ] Function secrets reviewed:
  - [ ] Supabase keys
  - [ ] `PUBLIC_SITE_URL`
  - [ ] `STORE_PROVIDER`
  - [ ] R2 credentials
  - [ ] webhook secrets
  - [ ] export/entitlement signing keys
- [ ] Required buckets and policies still exist
- [ ] Existing `bank_catalog_items` rows still resolve to valid R2 assets
- [ ] Existing default-bank release rows still resolve to valid R2 assets
- [ ] Payment proof paths still generate working signed URLs
- [ ] No old GitHub-release-based catalog assumptions remain in live production code paths

## 6) Product / Flow Smoke Tests
- [ ] Landing page loads correctly on desktop and mobile widths
- [ ] App boot path works from a clean session
- [ ] Login works
- [ ] Logout works
- [ ] Password reset and redirect flows work
- [ ] Session conflict handling works and does not soft-lock the user
- [ ] Store catalog loads with banners and thumbnails
- [ ] Store purchase flow works:
  - [ ] free download
  - [ ] paid request submit
  - [ ] rejected request resubmit/retry behavior
  - [ ] approved request download/import
- [ ] Downloaded bank imports correctly and metadata is preserved
- [ ] Admin flows work:
  - [ ] catalog edit
  - [ ] publish
  - [ ] banner create/edit/delete
  - [ ] payment config save
  - [ ] request approve/reject
  - [ ] default bank release publish
- [ ] User export flow works on the supported runtime

## 7) Audio / Runtime Risk Review
- [ ] Validate the new audio runtime on the actual Android device(s) you care about most
- [ ] Test memory pressure with large banks and repeated import/export
- [ ] Test rapid pad triggering, stop modes, hotcues, and deck/channel interactions
- [ ] Test background/foreground transitions on Android
- [ ] Test app recovery after tab hide, refresh, reconnect, and offline/online transitions
- [ ] Confirm no major audio regressions were introduced by the rewrite split
- [ ] Keep a rollback note for audio runtime issues if this is the first wide release of the rewritten engine

## 8) Mobile / PWA / Installability
- [ ] Android Capacitor build completes
- [ ] `npm run cap:sync` succeeds
- [ ] Android release build installs and opens correctly
- [x] PWA install path still works in browser
- [x] Icons, splash-related assets, and manifest entries are correct
- [ ] Service worker update path does not trap users on stale builds
- [ ] If URL/domain changed, understand what happens to existing installed shortcuts

## 9) Performance / Cost Checklist
- [ ] Confirm there are no accidental polling loops
- [ ] Confirm admin/store lists use bounded queries and pagination
- [ ] Confirm hosted Supabase dev usage is intentional, not accidental
- [ ] Verify image optimization path is working for new uploads
- [ ] Keep watching image-heavy pages because public thumbnails/banners still create real egress
- [ ] Re-check slow-query list after final release candidate testing

## 10) Known Risks You Can Still Ship With If Checked
- [ ] Large ongoing refactor footprint means hidden integration regressions are still possible
- [ ] GitHub Pages + service worker caching can create stale-asset support issues after deploy
- [ ] Public image URLs still cost bandwidth even after compression
- [ ] Edge Function / local Express parity may still diverge in a few paths
- [ ] Mobile WebView behavior may differ from desktop browser behavior, especially for audio and file APIs
- [ ] Offline/local cache behavior may preserve stale state longer than expected in some auth/store cases

## 11) Known Loopholes / Tradeoffs To Accept Or Close
- [ ] External banner URLs bypass managed image compression because only uploaded images are transformed
- [ ] Existing previously uploaded images are not retro-compressed automatically
- [ ] Local `.env` can intentionally opt into hosted Supabase dev traffic
- [ ] Public image delivery still uses cacheable URLs, so cached egress is reduced but not eliminated
- [ ] If service worker cache invalidation misses a file, users may see mismatched frontend/runtime assets
- [ ] If a catalog/storage row points to the wrong R2 key, the publish flow may succeed earlier than the real user download smoke test reveals

## 12) Polish Pass
- [ ] Clean up copy/typos in dialogs, toasts, and empty states
- [ ] Review spacing/alignment in admin dialogs on small screens
- [ ] Make sure layered modals always stay centered and clickable
- [ ] Confirm loading states are visible for slow store/admin operations
- [ ] Confirm destructive actions have clear confirmation copy
- [ ] Review default screenshots/icons/branding assets one last time
- [ ] Remove leftover debug UI, debug logs, and temporary notices if not intentionally kept

## 13) Recommended Post-Launch Follow-Up
- [ ] Monitor Supabase function logs for 24-72 hours
- [ ] Monitor auth redirect failures
- [ ] Monitor store publish and download failures
- [ ] Monitor Android-specific crashes or audio complaints first
- [ ] Re-check cached egress, storage growth, and function invocation patterns after real usage
- [ ] Create a short post-launch backlog:
  - [ ] image migration / old image recompression
  - [ ] additional runtime tests
  - [ ] admin UX polish
  - [ ] hardening of service worker update flow

## 14) Android / Play Store Release + Update Continuity
- [ ] Final Android package identity is locked:
  - [ ] `applicationId` / Capacitor `appId` will never change after first public release
  - [ ] app name / branding is final enough for store listing and upgrade continuity
- [ ] Android release signing is ready for long-term updates:
  - [ ] upload key / keystore is backed up outside this machine
  - [ ] password recovery / storage plan exists
  - [ ] if any keystore password or key path was exposed in repo/docs, rotate before public release
  - [ ] Play App Signing is enabled or intentionally planned
- [ ] Android build targets satisfy current Play requirements:
  - [ ] `compileSdkVersion` is current enough
  - [ ] `targetSdkVersion` is current enough for Play submission/update policy
  - [ ] dangerous/legacy permissions are still necessary and policy-safe
  - Current note: repo config has been bumped to API 35 in `android/variables.gradle`, but a full Android release build and manifest/policy review are still pending.
- [ ] Release versioning is correct:
  - [ ] `versionCode` increments for every Play upload
  - [ ] `versionName` matches the release you want users to see
  - [ ] release tag/changelog maps cleanly to the uploaded bundle
  - Current blocker: `android/app/build.gradle` is still `versionCode 1` and `versionName "1.0"`.
- [ ] Release artifact is the right one:
  - [ ] signed `.aab` generated from the final commit/tag
  - [ ] final release build is not just a debug APK snapshot
  - [ ] archive the exact uploaded artifact checksum and source commit
  - Current note: `npm run cap:build:android` now targets `bundleRelease`, and Gradle release signing can read `ANDROID_RELEASE_KEYSTORE_PATH`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, and optional `ANDROID_RELEASE_KEY_PASSWORD` from env or Gradle properties.
- [ ] Upgrade behavior is tested on a real Android device:
  - [ ] install previous build
  - [ ] install update over it
  - [ ] confirm app opens cleanly after upgrade
  - [ ] confirm local banks/media/cache survive as intended
  - [ ] confirm auth/session state after upgrade is acceptable
  - [ ] confirm import/export/audio playback still work after upgrade
- [ ] Web asset update behavior inside Capacitor is verified:
  - [ ] `npm run cap:sync` was run from the exact release build
  - [ ] native package contains the intended `dist/public` output
  - [ ] if service worker remains enabled in native WebView, app update does not pin stale web assets
- [ ] Play Console release prep is complete:
  - [ ] app access / tester access requirements understood
  - [ ] Data safety form prepared
  - [ ] privacy policy URL exists and is public
  - [ ] screenshots, icon, feature graphic, and listing copy are ready
  - [ ] content rating and app category are ready
  - [ ] if this is a new personal developer account, closed-test requirement is planned before production

## 15) GitHub Pages Update / Cache Safety
- [ ] GitHub Pages deploy points to the exact release commit/tag
- [ ] Hashed asset filenames are changing as expected between releases
- [ ] Service worker cache strategy was reviewed for this release:
  - [ ] cache name/version updated when shell behavior changed
  - [ ] API/auth requests are never incorrectly cached
  - [ ] navigation fallback still serves the correct shell after deploy
- [ ] SPA hosting behavior still works after deploy:
  - [ ] `404.html` redirect still restores route correctly
  - [ ] deep links work on refresh
  - [ ] manifest/icons still resolve from the live Pages URL
- [ ] GitHub Pages update smoke test is done in at least 3 states:
  - [ ] clean incognito session
  - [ ] normal browser with previous cache
  - [ ] installed PWA/shortcut if supported
- [ ] Supabase/Auth config still matches the live Pages domain:
  - [ ] site URL
  - [ ] redirect URLs
  - [ ] magic link / reset password flows
- [ ] Rollback plan exists for a bad Pages deploy:
  - [ ] previous good build/tag identified
  - [ ] stale-cache support response is prepared
  - [ ] manual cache-clear guidance is ready if needed

## 16) Electron Release / Update Strategy
- [ ] Decide the Electron release model:
  - [ ] manual installer-only releases
  - [ ] auto-update releases
  - [ ] update channel strategy documented (`stable` / `beta` / etc.)
- [ ] If using auto-update, the provider is chosen and tested:
  - [ ] GitHub Releases or generic update server selected
  - [ ] update metadata/artifacts are generated correctly
  - [ ] release publishing flow is reproducible
- [ ] Electron versioning is aligned with release flow:
  - [ ] app version bumped for each desktop release
  - [ ] release notes/changelog prepared
- [ ] Desktop upgrade path is tested:
  - [ ] install previous desktop build
  - [ ] install/update to new build
  - [ ] confirm user data/settings survive upgrade as intended
  - [ ] confirm packaged app loads current `dist/public` assets correctly
- [ ] Desktop trust/signing decision is explicit:
  - [ ] Windows code-signing plan decided
  - [ ] SmartScreen risk is accepted if shipping unsigned
  - [ ] signing credentials are stored outside repo if used

## Suggested Final Command Block
```bash
git status
rg -n "<old-username>|<old-repo>|<old-domain>|<old-username>\\.github\\.io" .
git grep -n "SUPABASE_SERVICE_ROLE_KEY\\|ghp_\\|github_pat_\\|WEBHOOK_SIGNING_SECRET\\|R2_SECRET_ACCESS_KEY\\|DISCORD_WEBHOOK_"
npm run type-check
npm run build
```
