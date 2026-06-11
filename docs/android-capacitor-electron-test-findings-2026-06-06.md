# Android Capacitor and Electron Test Findings - 2026-06-06

Scope: investigation, implemented fixes, and remaining runtime verification for Android Capacitor, iOS Web App, desktop web, and Electron.

Updated 2026-06-11: verified desktop web dialog layering/landscape center motion, added Google OAuth pending UI follow-up, and refreshed the implementation checklist.

## Executive Summary

The highest-risk Android issue is not a quota or rendering bug; it is the pad edit drag path. Edit-mode pad arrangement and transfer still depend on native HTML5 drag/drop events. That path works with mouse input in desktop web and Electron, and the latest manual test confirms iOS drag/drop still works. The failing runtime is Android Capacitor WebView. The pad becomes dim because the drag-start visual state is entered, then Android often does not deliver the matching drag/drop/end flow needed to finish the operation.

The stutter-scroll issue is separate but related at the interaction-design level. Stutter pads use a delayed touch trigger that commits after 45 ms unless movement exceeds 10 px first. On a phone scroll, that timer can fire before the browser delivers enough pointer movement to classify the gesture as scroll.

Android Google sign-in had a separate native callback problem. The app was starting a web-style Supabase Google OAuth redirect, Android was not registered to receive a VDJV deep link, and the React app had no `appUrlOpen` session handler. The native callback path is now implemented in code, but Android APK verification and the hosted Supabase redirect allow-list update are still required before treating it as production-verified.

Offline readiness is also a release risk. iOS Add to Home Screen, Android Capacitor, and Electron can keep the last trusted account/session and local sampler data, but offline UI reliability depends on whether the required app code chunks and local bank/audio data were already loaded. A user who only installs, logs in once, and immediately goes offline can reach the main app, but unopened lazy dialogs or network-only features may fail, delay, or appear unavailable.

## Findings

### 1. Android Edit Mode Pad Long-Press Drag/Drop Fails

**Implementation status**

Implemented 2026-06-07 in code. Android device verification is still required because this bug depends on Android Capacitor WebView pointer delivery.

**User finding**

In Android Capacitor, `EDIT MODE > PAD LONGPRESS > DRAG and DROP` for arrangement or transfer no longer works. After long press, the pad becomes dim and the app feels laggy/buggy. Desktop web and Electron still work. iOS drag/drop also still works based on manual testing, so this should be treated as Android Capacitor-specific.

**Root cause**

The implementation uses native HTML5 drag/drop for edit-mode pad movement:

- `SamplerPad` disables custom pointer handlers during edit mode and makes the pad `draggable` instead.
- `SamplerPad` sets `isDragging` on native `dragstart`.
- `PadGrid` completes reorder/transfer only through native `dragover`, `drop`, and `dragend`.
- Android WebView touch-driven HTML5 drag/drop is unreliable, so the pad can enter the drag visual state but never complete the grid drop flow. iOS working does not remove the risk because Android WebView has different touch drag/drop behavior.

**Evidence**

- `client/src/components/sampler/SamplerPad.tsx:989-996` attaches pointer handlers only when not in edit mode and uses `draggable={editMode && !adminColorPaintActive}`.
- `client/src/components/sampler/SamplerPad.tsx:549-573` sets drag payload and `isDragging`.
- `client/src/components/sampler/SamplerPad.tsx:657-663` maps `isDragging` to `opacity-50`, explaining the dim pad.
- `client/src/components/sampler/PadGrid.tsx:252-299` uses native drag state, drag-over index, drop, and drag-end for reordering.
- `client/src/components/sampler/PadGrid.tsx:244-247` detects mobile/Capacitor only for external file drop hints, not for pad reorder behavior.

**Recommended fix**

Keep native HTML5 drag/drop for desktop and Electron, but add a dedicated mobile/Capacitor edit drag manager using pointer events:

- Long-press threshold around 250-350 ms in edit mode.
- After long-press activation, call `setPointerCapture`, show a lightweight drag ghost, and track target pad/bank using pointer coordinates.
- Use `document.elementFromPoint()` or registered pad/bank rectangles to resolve the drop target.
- On pointer up, call existing `onReorderPads` or `onTransferPad`.
- On pointer cancel, visibility change, scroll start, or route/bank change, clear drag state.
- Do not use this mobile drag manager outside edit mode.

This avoids Android WebView HTML5 drag/drop and should fix the dim/stuck state without changing desktop, Electron, or currently-working iOS behavior.

**Implemented approach**

- `PadGrid` now owns a mobile/Capacitor edit drag manager.
- Long-press activates drag after a short hold; movement before activation cancels the drag intent so normal scrolling is preserved.
- Active drag uses pointer tracking and DOM hit testing instead of Android WebView HTML5 drag/drop.
- Same-bank drops call the existing `onReorderPads` handler.
- Cross-bank drops call the existing `onTransferPad` handler when the target bank is resolved.
- `SamplerPad` disables native `draggable` only for the mobile edit-drag path; desktop/Electron native drag/drop remains unchanged.
- Drag state is cleared on pointer cancel, scroll, visibility loss, blur, edit-mode changes, and bank changes to avoid a stuck dim pad.

### 2. Stutter Pads Can Still Trigger During Scroll

**Implementation status**

Implemented 2026-06-07 in code. Android/iOS device verification is still required because the original issue depends on touch scroll timing.

**User finding**

When scrolling on device, if the finger lands on a pad with trigger mode `stutter`, the pad can still play accidentally.

**Root cause**

The current stutter touch gate is timer-based:

- Touch stutter queues an intent.
- It commits after `TOUCH_TRIGGER_COMMIT_MS = 45`.
- It cancels only if movement exceeds `TOUCH_TRIGGER_SCROLL_CANCEL_PX = 10` before the timer fires.
- Pointer release also commits pending stutter.

On Android, a real scroll gesture can start slowly or deliver pointer movement after the 45 ms timer, so playback can commit before the code knows the user intended to scroll.

**Evidence**

- `client/src/components/sampler/SamplerPad.tsx:64-66` defines the 700 ms click suppress, 10 px cancel threshold, and 45 ms commit delay.
- `client/src/components/sampler/SamplerPad.tsx:361-370` schedules the touch trigger timer.
- `client/src/components/sampler/SamplerPad.tsx:482-483` queues stutter intent for touch.
- `client/src/components/sampler/SamplerPad.tsx:499-505` cancels only after movement reaches 10 px.
- `client/src/components/sampler/SamplerPad.tsx:511-512` commits pending touch trigger on pointer up.

**Recommended fix**

Treat stutter-on-touch as a tap gesture, not a timer gesture:

- Do not fire stutter from the 45 ms timer on touch.
- Fire on release only if movement stayed below a smaller threshold and no scroll was detected.
- Track scroll container movement between pointer down and pointer up; cancel if scrollTop changes.
- Consider a longer touch intent window for hold/stutter only if needed, but avoid delaying normal toggle playback.

This is independent from edit-mode drag/drop, but both should be handled in the same mobile touch cleanup pass.

**Implemented approach**

- Touch stutter no longer starts from the 45 ms touch timer.
- Touch stutter now starts only on pointer release after movement stays below the tap threshold.
- The nearest scroll container and window scroll position are captured on pointer down.
- Pending stutter is canceled if the finger moves or the scroll container/window position changes before release.
- Hold-trigger touch behavior keeps the existing short hold timer to avoid changing hold-pad responsiveness.

### 3. Pad Edit Dialog Reappears After Save/Close

**Implementation status**

Implemented 2026-06-07 in code. Device verification is recommended for the original bank-switch/edit-mode reproduction.

**User finding**

After editing and saving/closing a pad edit dialog, the same edit dialog can reappear after edit mode is activated again or after returning to the original bank while edit mode is active.

**Root cause**

The edit request is stored in the parent as a persistent command object and is not cleared after the dialog opens/closes. The child pad only dedupes the request with a local ref. If the pad component remounts after bank navigation or edit mode changes, the local ref resets and the old parent request token is consumed again.

**Evidence**

- `client/src/components/sampler/SamplerPadApp.tsx:627-629` stores `editRequest`, `closeEditRequest`, and `activePadEditId`.
- `client/src/components/sampler/SamplerPadApp.tsx:1009-1019` sets `editRequest` but does not define a consumed/cleared state for the token.
- `client/src/components/sampler/SamplerPadApp.tsx:1021-1029` clears active dialog tracking on close but does not clear `editRequest`.
- `client/src/components/sampler/SamplerPad.tsx:199-203` opens the dialog whenever `editMode` and `editRequestToken` are present unless a local ref has already seen that token.
- `client/src/components/sampler/PadEditDialog.tsx:786-790` handles close request tokens, but that does not consume the original open request.

**Recommended fix**

Make pad edit requests one-shot:

- Clear the parent `editRequest` when the target pad reports `open=true`, or when the dialog closes for that same pad/token.
- Add an explicit `onEditRequestConsumed(padId, token)` callback if needed.
- Clear stale edit requests on edit mode off and on bank switch.
- Keep `closeEditRequest` only for closing an already-open dialog.

This prevents remounts from replaying the last open command.

**Implemented approach**

- `SamplerPadApp` now clears the parent `editRequest` when the target pad edit dialog reports `open=true`.
- The parent also clears matching pending edit and close requests on dialog close.
- Stale edit requests are cleared when edit mode is turned off.
- Stale edit state is cleared on current/visible bank changes so a remounted pad cannot replay an old request token.

### 4. Search Go Does Not Hide SideMenu or VolumeMixer on Small Screens

**Implementation status**

Implemented 2026-06-07 in code. Browser smoke verification passed for page rendering; phone-size/manual verification is still recommended.

**User finding**

On small/phone screens, when `SEARCH > GO` runs, SideMenu and VolumeMixer can block the result highlight.

**Root cause**

`handleSearchGo` selects the result bank and queues scroll/highlight, but it does not close side panels. Current responsive behavior only prevents SideMenu and Mixer from being open at the same time. It does not hide an already-open panel before launching the result locator.

**Evidence**

- `client/src/components/sampler/SamplerPadApp.tsx:2489-2501` handles Search Go and does not update `sideMenuOpen` or `mixerOpen`.
- `client/src/components/sampler/SamplerPadApp.tsx:1928-1931` only closes Mixer if both SideMenu and Mixer are open on small screens.
- `client/src/components/sampler/SamplerPadApp.tsx:2682-2748` scrolls and launches the locator after bank visibility is ready.
- `client/src/components/sampler/SamplerPadApp.tsx:4688-4705` renders the spotlight independently from panel state.

**Recommended fix**

Add a shared `closeTransientPanelsForFocus()` helper and call it from search result actions on small screens:

- If `isPortraitOrSmallScreen` or `windowWidth < 900`, set `sideMenuOpen=false` and `mixerOpen=false`.
- Call it before queuing the scroll/highlight so the measured target position is not panel-covered.
- Apply to Go, Edit result, Open Bank, and load result flows.

**Implemented approach**

- Added shared `closeTransientPanelsForFocus()` in `SamplerPadApp`.
- The helper closes SideMenu and VolumeMixer when `isPortraitOrSmallScreen` or `windowWidth < 900`.
- Applied to Search Go, Open Bank, Edit Bank, Edit Pad, Navigate to Playing Pad, and Search Load flows before highlight/load focus work starts.

### 5. Floating Status/Bank UI Layers Over SideMenu and VolumeMixer

**Implementation status**

Implemented 2026-06-07 in code as part of item #4's z-index layer cleanup. Visual verification on mobile/desktop panels is still recommended.

**User finding**

The floating top bank name, blinking edit icon, `Master output muted`, `Edit Mode`, `Load Mode`, and portrait bottom-right edit icon should sit behind SideMenu and VolumeMixer. `Exit Dual` and the bottom Nav Tool should stay in front.

**Root cause**

There is no shared z-index layer contract. SideMenu and VolumeMixer use `z-[35]`, while passive floating status elements use `z-40` or `z-50`, so those passive elements can render above the panels.

**Evidence**

- `client/src/components/sampler/SideMenu.tsx:452` uses `z-[35]`.
- `client/src/components/sampler/VolumeMixer.tsx:1167` uses `z-[35]`.
- `client/src/components/sampler/HeaderControls.tsx:1283` top bank header uses `z-40`.
- `client/src/components/sampler/HeaderControls.tsx:1706-1766` portrait/admin floating action buttons use `z-40`.
- `client/src/components/sampler/HeaderControls.tsx:1794-1845` Exit Dual, mute status, edit/load status use `z-50`.
- `client/src/components/sampler/HeaderControls.tsx:1528-1537` bottom nav uses `z-40`.

**Recommended fix**

Introduce a single overlay layer policy:

- Passive bank/status labels: below panels, for example `z-30`.
- SideMenu/VolumeMixer: panel layer, for example `z-45` or `z-50`.
- Bottom Nav Tool and Exit Dual: active control layer above panels, for example `z-60`.
- Search locator/spotlight and modals: remain above all app chrome.

Then update the floating bank name, mute/edit/load badges, blinking edit button, and portrait edit toggle to the passive layer. Keep Exit Dual and bottom nav above panels.

**Implemented approach**

- SideMenu and VolumeMixer now use the panel layer (`z-50`).
- Passive bank/status/edit/load/color-paint badges and portrait floating edit/admin controls now use the passive layer (`z-30`).
- Bottom Nav Tool and Exit Dual now use the active control layer (`z-[60]`).
- Shared base dialogs now use a modal layer above the active nav (`overlay z-[180]`, content `z-[190]`), so the bottom Nav Tool stays in front of SideMenu/VolumeMixer but behind popups, dialogs, and confirmations.
- Search locator/spotlight and modal layers were not lowered.

### 6. Edit Pad Preview Play Row Wraps Poorly in Portrait

**User finding**

In Edit Pad Setting, the preview Play button is no longer one row in portrait mode after adding the audio in/out time controls.

**Root cause**

`WaveformTrim` uses a wrapping top row. On mobile the preview button is explicitly `w-full`, while the trim control group has a `min-w-[220px]`. This forces the row to wrap and makes the preview action feel disconnected from the trim controls.

**Evidence**

- `client/src/components/sampler/WaveformTrim.tsx:1331-1345` renders a `flex flex-wrap` top row with the Play button set to `w-full sm:w-auto`.
- `client/src/components/sampler/WaveformTrim.tsx:1347-1398` renders the IN/OUT control group with `min-w-[220px]`.
- `client/src/components/sampler/WaveformTrim.tsx:1409-1413` renders the auto-silence message as an extra row below the controls.

**Recommended fix**

Use a compact portrait-specific layout:

- Make the top row a two-column grid on small screens: fixed-width Play button plus flexible trim controls.
- Consider icon-only Play on very narrow screens.
- Keep the auto-silence status message below as a full-width helper line.
- Preserve current desktop layout.

**Implemented approach**

- Changed the top trim row to a compact mobile grid with a fixed-width preview button, flexible IN/OUT control group, and Reset action.
- Removed the mobile `w-full` preview button behavior and the forced mobile `min-w-[220px]` trim-control width that caused wrapping.
- Kept the audio preview and silence-detection logic unchanged.

### 7. SideMenu "Need More Bank Room?" Shows Too Early

**User finding**

For a PRO user, `NEED MORE BANK ROOM?` appears after only 2 own banks even though current config has owned limit 4. It should appear only after the user reaches the owned-bank limit.

**Root cause**

The CTA checks total loaded banks, not quota-counted owned banks. Total loaded banks can include the default bank, Store banks, trusted admin banks, previews, or restored official banks. The actual create/import quota path already uses a stricter helper that excludes default/trusted official banks.

**Evidence**

- `client/src/components/sampler/SideMenu.tsx:405-409` uses `banks.length >= ownedBankQuotaLimit`.
- `client/src/components/sampler/hooks/useSamplerStore.bankIdentity.ts:41-47` already defines `isOwnedCountedBankForQuota` and `countOwnedCountedBanks`.
- `client/src/components/sampler/hooks/useSamplerStore.bankCrud.ts:506-513` uses `countOwnedCountedBanks` before blocking create-bank operations.

**Recommended fix**

Use the same quota-counting helper for the SideMenu CTA:

- Import/use `countOwnedCountedBanks(banks)` or pass a quota summary from `useSamplerStore`.
- Show `NEED MORE BANK ROOM?` only when `ownedCountedBankCount >= ownedBankQuotaLimit`.
- Optionally show progress copy such as `2 / 4 owned banks used` only near the create-bank flow, not as an upgrade CTA.

**Implemented approach**

- SideMenu now uses `countOwnedCountedBanks(banks)` from the same bank-identity helper used by quota enforcement.
- `NEED MORE BANK ROOM?` now ignores default banks, Store banks, trusted admin banks, and other non-owned quota-exempt banks.

### 8. Electron Can Enter Phone/Portrait Layout When Resized Narrow

**User finding**

Electron Windows build should stay in landscape/desktop design. Resizing the window should not switch to portrait/device UI.

**Root cause**

Electron currently restores and accepts narrow window sizes. The frontend responsive logic uses real viewport width/height, so a narrow Electron window triggers the same compact/mobile layout as web/mobile.

**Evidence**

- `electron/main.cjs:31-36` default window is 1200x800.
- `electron/main.cjs:95-104` accepts persisted width down to 640 and height down to 480.
- `electron/main.cjs:1306-1318` creates `BrowserWindow` without `minWidth`, `minHeight`, or aspect ratio.
- `client/src/components/sampler/hooks/useWindowSize.ts:23-28` reports real viewport size.
- `client/src/components/sampler/HeaderControls.tsx:1050-1051` switches bottom navigation to compact mode at width < 768 or portrait viewport.
- `client/src/components/sampler/SamplerPadApp.tsx:1916-1921` treats narrow/portrait windows as small-screen layout.

**Recommended fix**

Best practical Electron fix:

- Add `minWidth` around `1024` or `1100` and `minHeight` around `640` or `700` in `BrowserWindow`.
- Update persisted window-state sanitization so old saved sizes below the minimum are clamped or ignored.
- Do not force a frontend-only desktop breakpoint if the physical window can still be too narrow; that would risk overflow.

Optional stricter fix:

- If the app must never be resized into portrait proportions, use `setAspectRatio()` or handle resize bounds in Electron. This is less flexible and should be tested with different Windows display scaling settings.

**Implemented approach**

- Added Electron minimum window size of `1100x700` directly to `BrowserWindow`.
- Persisted window-state sanitization now clamps old saved sizes below `1100x700` instead of restoring narrow phone-like layouts.
- Did not add a frontend-only desktop override, so the renderer still reflects the real Electron window size while the native shell prevents unsupported narrow sizes.

### 9. Android Google Sign-In Returns to Web URL Instead of Capacitor App

**Implementation status**

Implemented 2026-06-07 in code. Android APK verification is still required, and the hosted Supabase Auth URL configuration must allow `com.powerworkout.vdjv://auth/callback` before production Google sign-in can complete through this native callback.

**User finding**

In Android Capacitor, tapping Google sign-in opens Google account selection/sign-in externally. After selecting or signing in, it goes to a web URL such as `vdjvsamplerpad.com/#` instead of returning to the VDJV Capacitor app. When manually returning to the app, the UI is stuck on the `Signing in...` popup/loading state.

**Root cause**

The current Google flow is a web OAuth redirect flow, not a native Capacitor OAuth flow:

- `LoginModal` resolves the Google OAuth `redirectTo` from `VITE_GOOGLE_OAUTH_REDIRECT_URL` or the current web URL.
- The fallback redirect normalizes known web hosts to `/vdjv/`, so the callback is a website URL, not a native app callback.
- `useAuth.signInWithGoogle` calls `supabase.auth.signInWithOAuth` directly and lets Supabase/browser handle navigation.
- The Android manifest only has the launcher intent filter. It does not register a `VIEW` / `BROWSABLE` intent filter for `com.powerworkout.vdjv://...`.
- The codebase has a helper for the Capacitor App plugin, but no current app-wide `appUrlOpen` listener that parses OAuth callback URLs and calls `supabase.auth.setSession(...)` or `supabase.auth.exchangeCodeForSession(...)`.
- The Supabase client is created without native OAuth-specific options or callback handling.

Because no callback reaches the app, `useAuth.signInWithGoogle` sets `authTransition` to `signing_in` and `vdjv-google-oauth-login-pending`, but no auth state change/session arrives to clear the loading state.

**Evidence**

- `client/src/components/auth/LoginModal.tsx:203-230` builds Google redirect URLs from env/current web location and maps known web hosts to `/vdjv/`.
- `client/src/hooks/useAuth.ts:1226-1242` sets `signing_in`, marks Google OAuth pending, and calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
- `client/src/lib/supabase.ts:37` creates the Supabase client with only global headers; there is no native callback/session handling configured there.
- `android/app/src/main/AndroidManifest.xml:17-20` only registers the launcher intent filter. There is no `android.intent.action.VIEW`, `android.intent.category.BROWSABLE`, or custom scheme `<data>` filter.
- `client/src/lib/capacitor-app-plugin.ts:17-21` exposes access to `App.addListener`, but the app does not use it for OAuth URL handling.
- `package.json:45` includes `@capacitor/app`, but `@capacitor/browser` is not currently installed.
- `supabase/config.toml:154-164` allow-lists localhost and web URLs, but no native app redirect URL such as `com.powerworkout.vdjv://auth/callback`.
- Official Supabase Native Mobile Deep Linking guidance requires a mobile redirect URL, platform deep-link registration, and app-side callback/session handling for auth redirects.

**Recommended fix**

Implement a real Capacitor OAuth path for Android:

- Choose a native callback URL, for example `com.powerworkout.vdjv://auth/callback`.
- Add it to Supabase Auth `Additional Redirect URLs` for the live project.
- Add Android manifest deep-link intent filter under `MainActivity`:
  - `android.intent.action.VIEW`
  - `android.intent.category.DEFAULT`
  - `android.intent.category.BROWSABLE`
  - `<data android:scheme="com.powerworkout.vdjv" android:host="auth" android:path="/callback" />`
- Add an app-wide `App.addListener('appUrlOpen', ...)` handler on startup.
- In the handler, parse both possible callback formats:
  - hash/query `access_token` + `refresh_token`: call `supabase.auth.setSession({ access_token, refresh_token })`
  - query `code`: call `supabase.auth.exchangeCodeForSession(code)`
- Clear `vdjv-google-oauth-login-pending` and reset `authTransition` on success, failure, or timeout.
- Prefer opening OAuth through Capacitor Browser with `skipBrowserRedirect: true` so the app controls the external browser session and can close it after callback. This requires adding `@capacitor/browser`.

**Compatibility notes**

- Keep the current web redirect behavior for desktop web, iOS web app, Electron, and `/pricing`.
- Apply the native redirect only when `Capacitor.isNativePlatform()` is true.
- The symptom URL may appear as `.com`, `.online`, or the configured Supabase site URL depending on the live Auth configuration. The root problem is the same: it is a web callback instead of an app callback.
- If using a custom scheme, Android should return to the app without relying on the expired/custom web domain. Universal/App Links are nicer but require domain ownership and assetlinks/AASA hosting; the custom scheme is the fastest practical fix for APK testing.

**Implemented approach**

- Added `@capacitor/browser` and synced Android so the APK registers the Browser plugin.
- Added the Android `VIEW` / `BROWSABLE` intent filter for `com.powerworkout.vdjv://auth/callback` under `MainActivity`.
- Added the native callback URL to local `supabase/config.toml` for local Supabase auth parity.
- Updated `useAuth.signInWithGoogle` to keep web redirect behavior for web/Electron while using `skipBrowserRedirect: true`, the native callback URL, and Capacitor Browser on native Capacitor.
- Added an app-wide `App.addListener('appUrlOpen', ...)` handler that parses token-hash or code callbacks and calls `supabase.auth.setSession(...)` or `supabase.auth.exchangeCodeForSession(...)`.
- Added failure handling so OAuth callback errors or missing session data clear the Google pending/loading state instead of leaving the app stuck.
- Follow-up adjustment: OAuth-pending startup now restores `authTransition: signing_in` from the pending marker and keeps the bottom auth action disabled as `Signing in` instead of briefly showing `GUEST` / `LOGIN` while Supabase session/profile sync completes.
- Follow-up adjustment: if a Google OAuth return never completes, the pending loading state times out and clears after 30 seconds instead of staying in a misleading loading state.

### 10. Offline Readiness Needs Automatic Warm-Up and Clear Fallbacks

**Implementation status**

Implemented 2026-06-07 in code. Type-check, production build, Capacitor web build, Android sync, and clean Playwright smoke verification passed in this pass. Offline behavior still needs iOS Add to Home Screen, Android Capacitor, and Electron manual checks because storage/cache eviction and packaged chunk behavior differ by runtime.

**User finding**

On iOS Web App / Add to Home Screen, the user can add the app, open it online, log in, then go offline and still reach the main sampler. However, some essential offline popups such as edit pad, settings, edit bank, or other dialogs may not show, may fail, or may open only after a delay. The same class of risk should be considered for Android Capacitor and Electron offline usage, even though their storage/runtime behavior differs from iOS Safari.

**Root cause**

Offline account/session cache is not the same as offline UI code cache:

- The service worker caches a small app shell and then caches static assets after they are requested.
- Many important dialogs and feature modules are lazy-loaded JavaScript chunks.
- If the user never opened a lazy dialog while online, its chunk may not exist in cache when offline.
- Network-required features can never complete offline even if the UI shell is cached.
- iOS Web App storage can also be evicted by the OS under storage pressure, so offline readiness should be treated as verified/prepared state, not a permanent guarantee.

**Evidence**

- `client/public/sw.js` precaches only the app shell and selected icons/assets during install. Hashed build chunks are cached after request, not guaranteed up front.
- `client/src/main.tsx` registers the service worker for secure web/PWA contexts, not native Capacitor.
- `client/src/components/sampler/HeaderControls.tsx` lazy-loads Settings, Login, Account Upgrade, and admin/debug dialogs.
- `client/src/components/sampler/SamplerPad.tsx` lazy-loads the pad edit and transfer dialogs.
- `client/src/components/sampler/SideMenu.tsx` lazy-loads the bank edit and online bank store dialogs.
- `client/src/hooks/useAuth.ts` keeps trusted account/profile/capability state for offline use, but that does not preload every UI chunk.

**Recommended fix**

Do not require users to manually open every dialog before going offline. Add automatic offline warm-up after the first successful online login and after the main sampler becomes idle:

- Preload essential offline UI chunks: Settings, Edit Pad, Edit Bank, Pad Transfer, SideMenu/Mixer dialogs, search-related UI, and local sampler management dialogs.
- Preload essential offline action modules used by create/edit/import/export/backup flows if they are intended to work offline.
- Confirm that the current local bank list and local audio files are available before declaring offline readiness.
- Show a short in-app notification when offline preparation starts and another when it is ready, for example `Preparing offline mode...` then `Offline mode is ready on this device.`
- If a lazy feature is missing while offline, show a clear fallback message instead of a stuck spinner: `This feature was not prepared for offline use. Reconnect once to finish offline setup.`

**Offline fallback behavior to support**

For iOS Web App, Android Capacitor, and Electron, network-only features should show the same practical offline fallback:

- Bank Store browsing: show cached store snapshot if one exists, mark it as offline/cached, and disable purchase/download actions that require the server.
- Bank Store new downloads: block with a clear message, `Connect to the internet to browse or download Store banks. Already downloaded banks remain usable offline.`
- Upgrade/payment/account requests: block submission and proof upload while offline, with `Connect to the internet to submit upgrade/payment requests.`
- Admin, Supabase-backed sync, OCR, vouchers, promotions, revenue, and account management: show read-only cached data only if available, otherwise show an offline unavailable state.
- Login when offline: allow `Continue Offline` only for a trusted cached account on that device; otherwise require one online sign-in first.
- Dialogs/settings/editing local banks: should work offline after the automatic warm-up completes.

**Compatibility notes**

- iOS Add to Home Screen needs one online launch after install so the service worker, app shell, session, and local data can be prepared.
- Android Capacitor and Electron do not depend on the web service worker the same way, but they can still hit lazy chunk/local data readiness issues depending on packaged assets and runtime storage.
- Remote Store assets, Supabase data, payment proofs, OCR, and upgrade submissions are online-only by design.
- The app should never tell users that all features are offline-capable; it should distinguish local sampler use from server-backed features.

**Implemented approach**

- Added a shared in-app notice event bridge so app background systems can use the same HeaderControls toast UI.
- Added an offline readiness warm-up module that preloads essential local/offline UI chunks and local action modules after an online authenticated session is stable.
- The warm-up runs in small idle batches to avoid interfering with audio/playback work.
- The app shows one-time per-user preparation/ready notices and remembers successful warm-up in local storage.
- Offline/online transition notices now clarify that local sampler work remains available while Store, upgrades/payment, admin sync, and new downloads require internet.

### 11. Shared Dialog Layer And Landscape Entrance Motion Follow-Up

**Implementation status**

Implemented 2026-06-11 in code. Rendered desktop web smoke verification passed; manual landscape Electron confirmation is still recommended.

**User finding**

Dialog, popup, and confirmation entrance motion was fixed in portrait/device mode, but landscape web/Electron could still appear to animate from the bottom-right instead of opening from the center.

**Root cause**

The shared dialog component used Tailwind's generic zoom animation together with fixed `left: 50%`, `top: 50%`, and translate centering. On some desktop/landscape surfaces the animation transform can visually detach from the centering transform, making the popup appear to originate from an edge. The same shared base dialog layer also sat below the raised bottom nav layer.

**Recommended fix**

- Keep a single shared dialog implementation instead of patching individual dialogs.
- Raise shared base dialog overlay/content above active app chrome.
- Replace generic dialog zoom classes with a VDJV-specific center animation whose keyframes include `translate(-50%, -50%) scale(...)`.
- Preserve the mobile fullscreen path with a separate no-slide fade/scale animation.

**Implemented approach**

- `DialogContent` now uses custom `vdjv-dialog-center-motion` keyframes for centered dialogs.
- Mobile fullscreen dialogs keep a separate fullscreen-safe animation on small screens.
- Base dialog overlay/content z-index is now above bottom nav and SideMenu/VolumeMixer.

## Recommended Implementation Order

1. Android edit-mode touch drag manager and drag-state cleanup. Status: implemented in code, pending Android device verification.
2. Touch scroll/stutter gate cleanup. Status: implemented in code, pending Android/iOS device verification.
3. One-shot edit request consumption. Status: implemented in code, pending device/manual verification.
4. Search-result panel close helper and z-index layer contract. Status: implemented in code, pending phone-size/manual verification.
5. Android Capacitor Google OAuth native callback handling. Status: implemented in code, pending Android APK verification and hosted Supabase redirect allow-list update.
6. Offline readiness warm-up and network-only fallback messages. Status: implemented in code, pending offline runtime verification.
7. SideMenu quota CTA count fix and WaveformTrim portrait layout cleanup. Status: implemented in code, pending portrait/manual verification.
8. Electron window minimum size / persisted-state clamp. Status: implemented in code, pending Electron runtime verification.
9. Follow-up dialog layering, Google OAuth pending UI, and landscape dialog center motion. Status: implemented in code, pending Android/Electron device verification.

## Verification Checklist

- Android Capacitor: edit mode long-press reorder within the same bank. Status: pending device verification.
- Android Capacitor: edit mode long-press transfer to another bank. Status: pending device verification.
- Android Capacitor: drag cancel clears dim state after pointer cancel, scroll, app background, or bank switch. Status: pending device verification.
- Desktop web/Electron: native edit drag/drop remains available. Status: type-check passed; rendered/manual verification still recommended.
- Android Capacitor: scrolling over stutter pads does not play audio. Status: pending device verification.
- Android Capacitor: deliberate stutter tap still plays reliably. Status: pending device verification.
- Android Capacitor: Google sign-in returns to the app through the native callback and clears the signing-in popup.
- Android Capacitor: Google sign-in handles both success and cancel/error without leaving `vdjv-google-oauth-login-pending` stuck.
- iOS Add to Home Screen: fresh install, online login, automatic warm-up, then airplane-mode test for Settings/Edit Pad/Edit Bank/Transfer dialogs.
- Android Capacitor: online login, automatic warm-up, then offline test for local sampler dialogs and local banks.
- Electron Windows: offline launch with a previously trusted account still opens local sampler/editing flows.
- All platforms: Bank Store, upgrade/payment, admin, OCR, and other Supabase/network actions show clear offline unavailable or cached-read-only messages instead of hanging.
- Android/iOS small screen: Search Go closes SideMenu/Mixer before highlight. Status: pending phone-size/manual verification.
- Any platform: closing/saving a pad edit dialog does not reopen from stale state after edit mode toggle or bank return. Status: pending manual verification.
- Android Capacitor: Google sign-in returns to the installed app through `com.powerworkout.vdjv://auth/callback` and clears the signing-in loader. Status: pending APK verification and hosted Supabase redirect allow-list update.
- Android Capacitor: Google sign-in cancellation/error clears the loading state and shows an error. Status: pending APK verification.
- iOS Add to Home Screen: after one online login/warm-up, Settings, Edit Pad, Edit Bank, and local dialogs open while offline. Status: pending device verification.
- Android Capacitor/Electron: offline mode shows clear network-only fallback notices for Store, upgrades/payment, admin sync, and new downloads. Status: pending runtime verification.
- SideMenu PRO account: CTA appears at the actual owned-bank quota, not total bank count. Status: implemented in code, pending manual verification with a PRO quota account.
- Edit Pad portrait: Preview Play stays on one row with trim IN/OUT controls. Status: implemented in code, pending portrait/manual verification.
- Electron Windows: app cannot resize below the chosen desktop minimum and does not enter compact/mobile nav layout. Status: implemented in code, pending Electron runtime verification.
- Bottom Nav Tool: remains above SideMenu/VolumeMixer but behind shared dialogs, popups, and confirmations. Status: implemented in code; desktop web smoke passed, manual panel/dialog overlap verification recommended.
- Google sign-in return: app shows `Signing in` / loading state instead of briefly showing Guest/Login while account sync completes. Status: implemented in code, pending live Google callback verification.
- Landscape web/Electron dialogs: shared dialog motion opens from centered scale/fade instead of bottom-right/edge motion. Status: implemented in code; desktop web smoke passed, manual Electron landscape confirmation recommended.
