# APP_DEFAULT_SETTINGS

Generated: 2026-06-14  
Scope: static source scan of the VDJV app, landing/pricing pages, Electron, Android Capacitor, Express legacy server, Supabase Edge Functions, and Supabase migrations.  
Runtime/live database values were not queried. Any deployed secret or live dashboard value is intentionally redacted or marked `Needs verification`.

## Theme, Colors, Fonts, Layout, Spacing

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Theme storage key | `vdjv-theme` | = | `client/src/components/sampler/hooks/useTheme.ts` -> `localStorage.getItem('vdjv-theme')`; `client/src/main.tsx` -> `applyPersistedThemeClass` | Defaults to OS preference when no saved value exists; SSR fallback in hook is `dark`. |
| Theme options | `light`, `dark` | = | `client/src/components/sampler/hooks/useTheme.ts` -> `type Theme` | Invalid stored values are ignored. |
| Light background/foreground | `--background: 18 36% 97%`; `--foreground: 222 42% 9%` | = | `client/src/index.css` -> `:root` | Global theme token. Risky to change without full light-mode contrast pass. |
| Dark background/foreground | `--background: 222 42% 5%`; `--foreground: 220 18% 96%` | = | `client/src/index.css` -> `.dark` | Global dark token. |
| Primary brand color | light `352 86% 54%`; dark `352 92% 58%` | = | `client/src/index.css` -> `--primary`, `--vdjv-brand` | Duplicated into tier defaults as `#f21984` for PRO UI. |
| Success/neon green | `--vdjv-good: 77 100% 54%` | = | `client/src/index.css` -> `:root`, `.dark` | Used as standard success/save/accent color. |
| Warning/info colors | `--vdjv-warn: 38 95% 55/58%`; `--vdjv-info: 196 100% 46/50%` | = | `client/src/index.css` -> `:root`, `.dark` | Theme token only; some components still hardcode amber/blue classes. |
| Border radius token | `--radius: 0.75rem` | = | `client/src/index.css`; `tailwind.config.js` -> `borderRadius` | Tailwind `lg/md/sm` derive from this token. |
| Global font stack | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif` | = | `client/src/index.css` -> `html, body, #root` | Android WebView uses available system fonts. |
| Landing fallback font | `"Avenir Next", "SF Pro Display", "Segoe UI", sans-serif` | = | `client/src/index.css` -> `.lp-app-fallback` | Only the suspense/loading fallback. |
| Body transition | `background-color 160ms ease-out`, `color 160ms ease-out` | = | `client/src/index.css` -> `body` | Low-risk visual timing. |
| App background | Radial brand/info gradients over `hsl(var(--background))` | = | `client/src/index.css` -> `body`, `.vdjv-app-bg` | Performance variants override the background. |
| Safe area variables | `env(safe-area-inset-*, 0px)` | = | `client/src/index.css` -> `--vdjv-safe-*` | Critical for iOS PWA/Capacitor layout. |
| Bottom nav clearance | `calc(var(--vdjv-safe-bottom) + 7rem)` | = | `client/src/index.css` -> `--vdjv-bottom-nav-clearance` | Risky to reduce; SideMenu/Mixer depend on clearance. |
| Mobile dialog animation | Center scale/fade, `180ms cubic-bezier(0.16,1,0.3,1)` | = | `client/src/index.css` -> dialog keyframes/classes | Keep in sync with dialog portal behavior. |
| Tailwind dark mode | `class` strategy | = | `tailwind.config.js` -> `darkMode: ['class']` | Controlled by `document.documentElement.classList.toggle('dark')`. |
| Tailwind content scan | `client/index.html`, `client/src/**/*.{js,jsx,ts,tsx}` | = | `tailwind.config.js` -> `content` | Add new UI paths here if they move outside `client/src`. |
| Performance CSS classes | `perf-high`, `perf-medium`, `perf-low`, `perf-lowest` | = | `tailwind.config.js` plugin variants; `client/src/App.tsx` -> `root.classList.add` | Controlled by performance tier. |
| Admin tab page size | `10` | = | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `PAGE_SIZE` | Reused by multiple admin tables. |
| Admin home window options | `[1, 7, 14, 30, 90, 180, 365]` days | = | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `HOME_WINDOW_OPTIONS` | Dashboard date presets. |
| Mobile gesture guard edge zone | `28px` | = | `client/src/main.tsx` -> `setupGlobalGestureGuards` / `EDGE_ZONE_PX` | Prevents browser back-swipe conflicts. Risky to reduce on iOS. |
| Mobile swipe trigger | `14px`, horizontal must exceed vertical by `1.15x` | = | `client/src/main.tsx` -> `SWIPE_TRIGGER_PX` | Affects touch/drag behavior. |
| Double-tap zoom guard | `320ms` | = | `client/src/main.tsx` -> `DOUBLE_TAP_ZOOM_WINDOW_MS` | Allows double tap only on editable or explicit allowed targets. |
| Main app fallback text | `Loading VDJV` | = | `client/src/App.tsx` -> `AppFallback` | Placeholder/fallback text. |

## Build, Routing, Env, API

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Package name | `vdjv-sampler-pad` | = | `package.json` -> `name` | Build/package identity. |
| Package version | `0.1.6` | = | `package.json` -> `version` | Also used as fallback app version. |
| Vite app version fallback | `process.env.VITE_APP_VERSION \|\| package.json.version` | = | `vite.config.js` -> `getAppVersion` | Build-time injected as `import.meta.env.VITE_APP_VERSION`. |
| Service worker cache name | `vdjv-shell-cache-${sanitizedAppVersion}` | = | `vite.config.js` -> `injectServiceWorkerVersion`; `client/public/sw.js` -> `CACHE_NAME` | Public source placeholder is `__VDJV_SHELL_CACHE__`; replaced during build. |
| Landing included by default | `true` for web; `false` for Electron/Capacitor unless overridden | = | `vite.config.js` -> `includeLanding` | `VITE_INCLUDE_LANDING=false` disables landing explicitly. |
| Required frontend env | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | = | `vite.config.js` -> `requiredClientEnv`; `client/src/lib/supabase.ts` | Missing values throw at startup/build. |
| Local Supabase default URL | `http://127.0.0.1:54321` | = | `.env.example` -> `VITE_SUPABASE_URL` | Live `.env` values are intentionally not documented here. |
| Frontend Supabase anon key | Placeholder `your_local_anon_key_here` | = | `.env.example` -> `VITE_SUPABASE_ANON_KEY` | Secret/public anon value is environment-specific. |
| Remote Supabase in dev | `false` | = | `.env.example`; `client/src/lib/supabase.ts` -> `VITE_ALLOW_REMOTE_SUPABASE_IN_DEV` | Dev runtime blocks remote Supabase unless explicitly true. |
| Edge Functions base URL | `VITE_EDGE_FUNCTIONS_URL` or `${supabaseUrl}/functions/v1` | = | `client/src/lib/edge-api.ts` -> `edgeFunctionsBaseUrl` | Dev runtime also blocks remote Edge Functions unless explicitly allowed. |
| Client compatibility headers | `X-VDJV-Tier-Client: 1`, `X-VDJV-Promo-Client: 1`, `X-VDJV-App-Version` | = | `client/src/lib/supabase.ts`, `client/src/lib/edge-api.ts` | Important for old-build compatibility gates. |
| Router mode | `HashRouter` for `file:`; `BrowserRouter` otherwise | = | `client/src/App.tsx` -> `RouteContainer` | Electron packaged file URLs use hash routing. |
| Fallback route | Packaged/no landing -> sampler path; web landing -> landing path | = | `client/src/App.tsx` -> `fallbackPath` | Avoids dead routes in packaged app. |
| Web sampler path | `/vdjv` | = | `client/src/lib/runtime-routes.ts` -> `WEB_SAMPLER_APP_PATH` | Exact file not opened in this pass; value inferred from imports and route usage. Needs verification if changed. |
| Pricing route auth wrapper | `AuthProvider` wraps `/pricing` and `/pricing/checkout` | = | `client/src/App.tsx` -> `PricingRouteElement` | Prevents pricing/vdjv session conflict. |
| Product analytics host | `https://us.i.posthog.com` in example | = | `.env.example` -> `VITE_POSTHOG_HOST`; `client/src/lib/productAnalytics.ts` | Disabled unless key and host exist and runtime is not local/dev. |
| Product analytics defaults | `defaults: '2026-01-30'`, `autocapture: false`, `capture_pageview: false`, `disable_session_recording: true` | = | `client/src/lib/productAnalytics.ts` -> `initProductAnalytics` | Good privacy/performance defaults. |
| Legacy Express API | `ENABLE_LEGACY_EXPRESS_API=false` in example; runtime false unless env true | = | `.env.example`; `server/index.ts` -> `ENABLE_LEGACY_EXPRESS_API` | Keep disabled unless intentionally testing old routes. |
| Express port fallback | `3001` | = | `server/index.ts` -> `startServer(process.env.PORT \|\| 3001)` | Used by dev/start scripts. |
| Chrome CDP helper port | `9223` | = | `scripts/start-chrome-cdp.cjs` -> `CDP_PORT` fallback | Testing helper only. |
| Chrome CDP helper URL | `http://127.0.0.1:4173/vdjv` | = | `scripts/start-chrome-cdp.cjs` -> `CDP_URL` fallback | Testing helper only. |
| Cleanup retry count | `3` retries, `100ms` delay | = | `scripts/cleanup-web-build-output.cjs` | Build cleanup only. |

## Sampler App User Defaults

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Settings storage key | `vdjv-sampler-settings` | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `SETTINGS_STORAGE_KEY` | Main persisted settings key. |
| Portrait pad size | `5` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultPadSizePortrait` | Clamp range `2..8`. |
| Landscape/desktop pad size | `10` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultPadSizeLandscape` | Clamp range `2..16`. Electron expects landscape behavior. |
| Mobile channel count | `2` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultChannelCountMobile` | Legacy/admin sampler default; tier deck limits now also control allowed values. |
| Desktop channel count | `4` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultChannelCountDesktop` | Legacy/admin sampler default; tier deck limits now also control allowed values. |
| Master volume | `1` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultMasterVolume` | Clamp range `0..1`; shortcuts change in `0.05` steps in `SamplerPadApp.tsx`. |
| Stop mode | `instant` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultStopMode` | Configurable stop timing excludes instant. |
| Stop timing overrides | `{}` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultStopTimingOverrides` | Actual timings come from platform-specific audio profile. |
| Side panel mode | `overlay` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultSidePanelMode` | Other allowed value is `reflow`. |
| Keyboard mapping enabled | `false` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultKeyboardMappingEnabled` | Feature may also be tier-gated. |
| Hide shortcut labels | `true` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultHideShortcutLabels` | Also initializes `keyboardMappingVisibilityInitialized`. |
| Auto pad/bank mapping | `true` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultAutoPadBankMapping` | First-run mapping behavior. |
| Graphics profile | `auto` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultGraphicsProfile` | Allowed values: `auto`, `lowest`, `low`, `medium`, `high`. |
| Default bank name/color | `Default Bank`, `#3b82f6` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `bankDefaults` | Also seeded in `supabase/migrations/20260312150000_create_sampler_app_config.sql`. |
| Default pad trigger mode | `toggle` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultTriggerMode` | Other values include `hold`, `stutter`, `unmute`. |
| Default pad playback mode | `once` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultPlaybackMode` | Other values include `loop`, `stopper`, `bank_stopper`. |
| Default pad volume/gain | `volume: 1`, `gainDb: 0` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Gain clamp `-24..24`. |
| Default pad fades | `fadeInMs: 0`, `fadeOutMs: 0` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Clamp `0..60000ms`. |
| Default pitch/tempo | `pitch: 0`, `tempoPercent: 0` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Pitch clamp `-12..12`; tempo normalization is in `audioPadNormalization`. |
| Default key lock | `true` | = | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultKeyLock` | Affects pitch/tempo behavior. |
| Audio file size limit | `52,428,800 bytes` | = | `client/src/components/sampler/samplerAppConfig.ts`; `client/src/lib/audio-engine/types.ts` -> `DEFAULT_MAX_PAD_AUDIO_BYTES` | Comment says 50 MB. DB seed uses `52,428,800`. |
| Audio duration limit | `1,200,000ms` / 20 minutes | = | `client/src/components/sampler/samplerAppConfig.ts`; `client/src/lib/audio-engine/types.ts` -> `DEFAULT_MAX_PAD_AUDIO_DURATION_MS` | Clamp max `7,200,000ms`. |
| Default shortcuts | Space stop, M mixer, Z edit, X mute, B banks, `[` prev, `]` next, N upload, ArrowUp/Down volume, `=` pad size up, `-` pad size down, V import, C secondary, empty midiShift | = | `client/src/components/sampler/samplerAppConfig.ts` -> `DEFAULT_SHORTCUTS` | Shortcut strings are sliced to 40 chars when normalized. |
| Default settings booleans | `sideMenuOpen:false`, `mixerOpen:false`, `editMode:false`, `midiEnabled:false` | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `createDefaultSettings` | First-run settings state. |
| Deck layout default | `[]`, version from caller | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `createDefaultSettings` | `DECK_LAYOUT_SCHEMA_VERSION` referenced by app. |
| Mapping export version | `1` | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `MAPPING_EXPORT_VERSION` | Export/import compatibility. |
| Mapping export folder | `VDJV-Export` | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `EXPORT_FOLDER_NAME` | Android mapping fallback path. |
| Android download root | `/storage/emulated/0/Download` | = | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `ANDROID_DOWNLOAD_ROOT` | Android-specific filesystem target. |
| Pad size min/max | min `2`, portrait max `8`, landscape max `16` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `PAD_SIZE_MIN`, `PAD_SIZE_MAX_*` | UI/layout sensitive. |
| Mixer overlay width | `384px`, max viewport ratio `0.95` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `MIXER_OVERLAY_WIDTH_PX`, `MIXER_OVERLAY_MAX_VIEWPORT_RATIO` | Affects SideMenu/Mixer overlay behavior. |
| Minimum visible pad columns during mixer | `2` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `MIN_VISIBLE_PAD_COLUMNS_FOR_MIXER_TAP` | Protects against accidental pad taps behind mixer. |
| Search result limit | `40` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `SEARCH_RESULT_LIMIT` | Local sampler search. |
| Search debounce/highlight clear | `120ms`, `1500ms` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `SEARCH_INPUT_DEBOUNCE_MS`, `SEARCH_HIGHLIGHT_CLEAR_MS` | UX timing. |
| Pad warmup defaults | max per bank `10`, total `20`, idle `120ms`, mobile max duration `120000ms`, unknown safe bytes `1500000`, unknown trim `12000ms` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `PAD_WARMUP_*` | Runtime profile may override/scales. Risky to increase on mobile. |
| Offline readiness storage version | `v1` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> `OFFLINE_READINESS_STORAGE_VERSION` | Cached first-use offline preparation state. |
| Default bank source id | `vdjv-default-bank-source` | = | `client/src/components/sampler/SamplerPadApp.tsx`; `useSamplerStore.bankIdentity` imports | Important for protected/default bank identity. |

## Account Tiers, Feature Gates, Pricing UI

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Capability cache key | `vdjv-account-capabilities-v5` | = | `client/src/lib/account-capabilities.ts` -> `ACCOUNT_CAPABILITIES_CACHE_KEY` | Per-user local capability cache. |
| Capability version | `1` | = | `client/src/lib/account-capabilities.ts`; `supabase/functions/_shared/account-capabilities.ts` | Duplicated client/server. |
| Unknown tier fallback | `free` | = | `client/src/lib/account-capabilities.ts` -> `normalizeAccountTier` | Unknown DB value becomes FREE. |
| Admin capability fallback | PRO MAX capabilities | = | `client/src/lib/account-capabilities.ts` -> `fallbackCapabilitiesForProfile` | Admin role treated as full access. |
| Guest limits | owned banks `0`, pad cap `0`, device cap `1`, daily plays `10`, decks `1/1/1` | = | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.guest` | Guest can browse Store but cannot checkout/download/free claim by default. |
| FREE limits | owned banks `2`, pad cap `25`, device cap `4`, daily plays `50`, decks `1/1/1` | = | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.free` | Current code default. Legacy DB seed differs. |
| PRO limits | owned banks `6`, pad cap `64`, device cap `120`, daily plays `null`, decks min/default/max `1/2/4` | = | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.pro` | Current code default. |
| PRO MAX limits | owned banks `12`, pad cap `128`, device cap `150`, daily plays `null`, decks min/default/max `1/4/8` | = | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.pro_max` | `bankStoreAllAccess` true. |
| Account limit clamps | owned `0..500`, pad cap `0..256`, device cap `1..1000`, daily plays `0..100000`, decks `1..8` | = | `client/src/lib/account-capabilities.ts` -> `normalizeAccountLimits` | Keep client/server in sync. |
| PRO feature set | Store browse/checkout/download/free claim, search, mappings, shortcuts, backup, advanced stop modes, hotcue, pad/bank edits, demo banks, unlimited own bank play | = | `client/src/lib/account-capabilities.ts` -> `proFeatures` | PRO MAX adds `bankStoreAllAccess`. |
| Guest/FREE disabled features | Checkout, downloads, free claim, all-access, search, mappings, shortcuts, backup, advanced stop modes, mixer hotcue, most edit gates | = | `client/src/lib/account-capabilities.ts` -> guest/free features override | Store browse and demo banks remain true. |
| Tier video fallback | `/assets/v1-preview.mp4` | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_VIDEO_SRC` | Used by V1 and installer tier UI unless admin uploads R2 video. |
| Tier color text contrast | luminance threshold `0.52`; dark text `#0f172a`; light text `#ffffff` | = | `client/src/lib/account-tier-content.ts` -> `getReadableTextColor` | Important for admin-set light tier colors. |
| Tier accent fallback | `rgba(242,25,132,0.35)` | = | `client/src/lib/account-tier-content.ts` -> `accentRgb` fallback | Hardcoded PRO pink fallback. |
| FREE tier UI | color `#64748b`, no header/badge, meter `33`, Locked Features | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.free` | Checklist includes 50 plays/day and 2 own banks. |
| PRO tier UI | color `#f21984`, header `Most popular`, badge `VDJV 2.0`, meter `66` | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.pro` | Duplicates brand pink. |
| PRO MAX tier UI | color `#2155ff`, header `Best value`, badge `VDJV 2.0`, meter `100` | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.pro_max` | Inclusion badge values include `12` and `150`. |
| Installer STANDARD UI | color `#f59e0b`, badge `VDJV`, meter `48` | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_INSTALLER_TIER_UI_CONTENT.standard` | V2/V3 pricing default. |
| Installer PRO UI | color `#f21984`, header `Flexible`, badge `VDJV`, meter `66` | = | `client/src/lib/account-tier-content.ts` -> `DEFAULT_INSTALLER_TIER_UI_CONTENT.pro` | Includes Standard + Update / Update Only copy. |
| Tier UI row normalization | text rows, details, inclusions sliced to 12 rows | = | `client/src/lib/account-tier-content.ts` -> `normalizeTextRows`, `normalizeDetailRows`, `normalizeInclusionRows` | Prevents runaway admin content. |
| Upgrade promo discount default | `30` percent | = | `supabase/functions/store-api/index.ts` -> `normalizePromoDiscountPercent`; `AccountUpgradeDialog.tsx` constant observed by scan | Clamp `0..90`. |
| Upgrade receipt prefix | `VDJV-UPGRADE-YYYYMMDD-XXXXXXXXXX` | = | `supabase/functions/store-api/index.ts` -> `buildUpgradeReceiptReference` | Receipt format default. |
| Profile tier default | `account_tier: free`, `tier_source: signup` | = | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Legacy migration promoted old signups to PRO/PRO MAX. |
| Account upgrade request status | `pending` | = | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_upgrade_requests.status` | Current pending-review flow depends on this. |
| Voucher campaign max codes | default `1`, max `10000` | = | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_voucher_campaigns.max_codes` | Admin voucher guardrail. |
| Voucher status default | `reserved` | = | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_vouchers.status` | Other states: redeemed, disabled, expired. |

## Audio, Playback, Performance

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Audio engine v3 enabled | `false` | = | `client/src/lib/audio-engine/types.ts` -> `DEFAULT_ENGINE_CONFIG.audioEngineV3Enabled` | Needs verification if runtime toggles elsewhere. |
| Stop modes | `instant`, `fadeout`, `brake`, `backspin`, `filter` | = | `client/src/lib/audio-engine/types.ts` -> `STOP_TIMING_MODES` | Instant is not configurable in settings. |
| Configurable stop modes | `fadeout`, `brake`, `backspin`, `filter` | = | `client/src/lib/audio-engine/types.ts` -> `CONFIGURABLE_STOP_TIMING_MODES` | Instant excluded by design. |
| Stop timing ranges | instant `10..40ms`, fadeout `250..3000ms`, brake `450..3000ms`, backspin `350..2200ms`, filter `400..3000ms` | = | `client/src/lib/audio-engine/types.ts` -> `STOP_TIMING_RANGES`; duplicated in `supabase/functions/_shared/sampler-app-config.ts` | Keep client/server ranges synced. |
| iOS stop profile | instant fade `0.014s`, finalize `18ms`, fadeout `900ms`, brake `1350ms`, backspin total `900ms`, filter `1.2s` | = | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` iOS branch | Audio-artifact sensitive. |
| Android stop profile | instant fade `0.02s`, finalize `24ms`, fadeout `800ms`, brake `1200ms`, backspin total `780ms`, filter `1.1s` | = | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` Android branch | Audio-artifact sensitive. |
| Desktop stop profile | instant fade `0.012s`, finalize `14ms`, fadeout `900ms`, brake `1400ms`, backspin total `950ms`, filter `1.35s` | = | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` default branch | Audio-artifact sensitive. |
| iOS media backend thresholds | duration `240000ms`, size `15728640 bytes` | = | `client/src/lib/audio-engine/types.ts` -> `IOS_MEDIA_*` | Routes long/large audio away from buffers. |
| Audio buffer memory caps | iOS `50MB`, Android `64MB`, native Capacitor `72MB`, low-memory web `96MB`, desktop `160MB` | = | `client/src/lib/audio-engine/types.ts` -> `*_MAX_BUFFER_MEMORY` | Risky to increase on iOS/Android. |
| Max audio elements | `800` | = | `client/src/lib/audio-engine/types.ts` -> `MAX_AUDIO_ELEMENTS` | Chrome safety margin. |
| Max iOS buffer sources | `32` | = | `client/src/lib/audio-engine/types.ts` -> `MAX_IOS_BUFFER_SOURCES` | iOS stability limit. |
| Max playback channels | `8` | = | `client/src/lib/audio-engine/types.ts` -> `MAX_PLAYBACK_CHANNELS` | Tier dropdown should not exceed this. |
| Playback notification throttle | iOS `100ms`, Android `50ms`, desktop `16ms` | = | `client/src/lib/audio-engine/types.ts` -> `NOTIFICATION_THROTTLE_MS` | Runtime-sensitive. |
| Import concurrency | native `1`, native Android `2`, web `4`, iOS web `1` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `*_IMPORT_CONCURRENCY` | iOS low-memory safety. |
| Import batch flush | default `12` files or `48MB`; iOS `1` file or `8MB` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `IMPORT_BATCH_FLUSH_*` | Large-bank import stability. |
| iOS conservative import size | `250MB` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `IOS_CONSERVATIVE_IMPORT_BYTES` | Matches Store large-download threshold. |
| Prepared audio policy | version `1` | = | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_AUDIO_POLICY_VERSION` | Prepared playback compatibility. |
| Prepared short hot pad | max `12000ms` or `1500000 bytes` | = | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_SHORT_HOT_*` | Runtime prewarm classification. |
| Prepared long heavy pad | min `90000ms` or `12MB` | = | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_LONG_HEAVY_*` | Runtime prewarm/dehydrate classification. |
| Prepared heavy resume idle | `5000ms` | = | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_HEAVY_RESUME_IDLE_MS` | Audio resume timing. |
| Performance tier fallback hardware | mobile cores/memory `2/2GB`; desktop `4/4GB` | = | `client/src/lib/performance-monitor.ts` -> `detectCapabilities` | Used when browser APIs are missing. |
| Performance tier default floor | Auto never below `low` | = | `client/src/lib/performance-monitor.ts` -> `evaluateInitialTier` | Manual override can be `lowest`. |
| Native mobile high guard | Native/mobile returns `medium` unless strong specs | = | `client/src/lib/performance-monitor.ts` -> `evaluateInitialTier` | Protects Android/iOS performance. |
| Runtime desktop warmup | max per bank `14`, total `36`, idle `60ms`, no max duration | = | `client/src/lib/sampler-runtime-profile.ts` -> `DEFAULT_DESKTOP_WARMUP` | Electron may override from memory profile. |
| Runtime mobile low/medium/high | Android/mobile web max total `5/6/8`; iOS web max total `2/3/4`; iOS Capacitor `4/5/6` | = | `client/src/lib/sampler-runtime-profile.ts` -> `MOBILE_RUNTIME_PROFILES` | Summarized because each profile also defines restore/hydration/retention limits. |
| Runtime desktop web restore/hydration | startup restore `1200`, background hydration `480` | = | `client/src/lib/sampler-runtime-profile.ts` -> `getSamplerRuntimeTuningProfile` desktop_web | Large values are desktop-only. |
| Runtime Electron fallback restore/hydration | startup restore `900`, background hydration `320` | = | `client/src/lib/sampler-runtime-profile.ts` -> Electron fallback profile | Used when preload memory info unavailable. |

## Store, Download, Import, Cache, Offline

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Bank Store page size | `12` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `STORE_PAGE_SIZE` | User-facing pagination. |
| Download proof max size | `10MB` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `ACCOUNT_PROOF_MAX_BYTES` | Same order as server account proof max. |
| Proof image extensions | `png`, `jpg`, `jpeg`, `webp`, `gif`, `heic`, `heif` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `ACCOUNT_PROOF_ALLOWED_EXTENSIONS` | Client validation. |
| Banner rotation clamp | `3000..15000ms` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `normalizeBannerRotationMs`; `supabase/functions/store-api/index.ts` -> `STORE_BANNER_ROTATION_*` | Default is `5000ms`. |
| Store snapshot version | `8` | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_SNAPSHOT_VERSION` | Local offline Store snapshot schema. |
| Store snapshot freshness | `30 minutes` | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_SNAPSHOT_FRESH_TTL_MS` | Offline fallback can still display stale data. |
| Store view memory cache cooldown | `2 minutes` | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_VIEW_FETCH_COOLDOWN_MS` | Reduces repeated catalog fetches. |
| Store payment config cache cooldown | `15 minutes` | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_PAYMENT_CONFIG_FETCH_COOLDOWN_MS` | Admin payment changes may take up to this unless refreshed. |
| Downloaded Store sort page size | `200` | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `requestPerPage` for `storeSort === 'downloaded'` | One-page downloaded view. |
| Store next-page thumbnail preload | `3` thumbnails | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `preloadStoreThumbnails` default | Text/items are cached before thumbnails. |
| Large Store download warning | `250MB` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `LARGE_WEB_STORE_DOWNLOAD_WARNING_BYTES` | iOS requires low-memory variant at/above this when missing. |
| iOS Store download concurrency | `1` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `IOS_WEB_STORE_DOWNLOAD_CONCURRENCY_LIMIT` | Prevents iOS PWA memory crashes. |
| Default Store download concurrency | `3` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `DEFAULT_STORE_DOWNLOAD_CONCURRENCY_LIMIT` | Desktop/Android/web cap. |
| iOS low-memory block | iOS web + large download + no low-memory variant -> block | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `requiresIOSLowMemoryVariant` | Public-release safety rule. |
| Store debug max entries | `250` | = | `client/src/components/sampler/onlineStore.types.ts` -> `STORE_DOWNLOAD_DEBUG_MAX_ENTRIES` | Needs verification from file if changed after scan. |
| Store live/recovered debug keys | `vdjv-store-download-live-v1`, `vdjv-store-download-recovered-v1` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Recovered report max age is `24h` from prior scan; Needs verification. |
| Guest Store preview cache | `vdjv-guest-store-preview-banks-v2`, limit `10` | = | `client/src/components/sampler/hooks/useGuestStorePreviewBanks.ts` | Needs verification from file if changed after scan. |
| Store recovery catalog TTL | `5 minutes` | = | `client/src/components/sampler/hooks/useSamplerStore.storeRecovery.ts` -> `STORE_RECOVERY_CATALOG_TTL_MS` | Recovery fallback cache. |
| Store recovery scan | `perPage 200`, `maxPages 25` | = | `client/src/components/sampler/hooks/useSamplerStore.storeRecovery.ts` | Upper scan of 5000 catalog rows. |
| Storage headroom | min free `200MB`, unknown operation `450MB`, unknown import `3GB` | = | `client/src/components/sampler/hooks/useSamplerStore.storageHeadroom.ts` | Needs verification from file if changed after scan. |
| Low-memory variant split | threshold `250MB`, target part `120MB` | = | `client/src/components/sampler/hooks/useSamplerStore.updateStoreBank.ts` | Admin export/update behavior. Needs verification from file if changed after scan. |
| Native export folder | `VDJV-Export`; media root `VDJV-Export/_media`; logs `VDJV-Export/logs` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Export/import filesystem conventions. |
| Capacitor export write chunks | single write `24MB`, chunk `2MB` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Bridge stability. Needs verification from file if changed after scan. |
| Backup format | version `3`, extension `.vdjvbackup`, part `.vdjvpart`, manifest schema `vdjv-backup-manifest-v1`, manifest version `1` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Backup compatibility. |
| Native bank export cap | `700MB` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` -> `MAX_NATIVE_BANK_EXPORT_BYTES` | Needs verification from line if changed after scan. |
| Native app backup cap | `1700MB` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` -> `MAX_NATIVE_APP_BACKUP_BYTES` | Needs verification from line if changed after scan. |
| Backup part sizes | mobile `64MB`, desktop `256MB`, max parts `200` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Backup restore compatibility. |
| Native audio/image bridge write caps | audio `8MB`, image `4MB`, bridge read `6MB` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Native bridge stability. |
| Selected bank hydration retries | `3` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constant | Startup recovery. |
| Sampler local storage keys | `vdjv-sampler-banks`, `vdjv-sampler-state`, `vdjv-default-bank-by-owner`, `vdjv-last-open-bank`, `vdjv-default-bank-image-prefs` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants and imported helpers | Main offline/local data keys. |
| IndexedDB JSON fallback paths | `state/sampler-banks-fallback.json`, `state/sampler-ui-fallback.json` | = | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Fallback when localStorage is too small. |
| Offline module warmup batch | `3` modules per batch, idle timeout `180ms` | = | `client/src/lib/offline-readiness.ts` -> `OFFLINE_READINESS_*` | Loads essential dialogs/features after first offline use. |
| Offline warmup modules | settings, login, upgrade, pad edit/transfer, bank edit, side menu, mixer, app dialogs, bank store, duplication, export/import, backup | = | `client/src/lib/offline-readiness.ts` -> `entries` | App shell still requires modules to be warmed for offline dialogs. |
| Service worker app shell | `/`, `/index.html`, `/ios/`, `/android/`, `/site.webmanifest`, logo/icons | = | `client/public/sw.js` -> `APP_SHELL_URLS` | API/auth requests stay network-only. |
| Service worker API offline response | `Offline`, HTTP `503` | = | `client/public/sw.js` -> fetch handler | Prevents fake success for network-required actions. |
| Service worker strategy | navigation network-first; static assets stale-while-revalidate | = | `client/public/sw.js` -> `networkFirstNavigation`, `staleWhileRevalidate` | Existing cache is deleted when cache name changes. |
| Chunk recovery key | `vdjv-chunk-recovery-attempted` | = | `client/src/lib/chunk-load-recovery.ts` -> `CHUNK_RECOVERY_STORAGE_KEY` | One recovery attempt per session. |
| Chunk reload query | `_vdjv_chunk_reload=${Date.now()}` | = | `client/src/lib/chunk-load-recovery.ts` -> `getReloadUrl` | Used after stale chunk failure. |
| Guest default bank trial | `10` plays | = | `client/src/lib/guest-default-bank-trial.ts` -> `GUEST_DEFAULT_BANK_TRIAL_LIMIT` | Stored in local/shadow keys and Electron file. |
| Guest trial storage keys | `vdjv-guest-default-bank-trial-v1`, `vdjv-guest-default-bank-trial-shadow-v1` | = | `client/src/lib/guest-default-bank-trial.ts` | Shadow key prevents simple accidental loss. |
| Default bank daily allowance key | `vdjv-default-bank-play-allowance-v1:${tier}:${userId}` | = | `client/src/lib/account-default-bank-play-allowance.ts` | Resets at local midnight. |
| Default bank allowance max | `100000` plays/day | = | `client/src/lib/account-default-bank-play-allowance.ts` -> `normalizeLimit` | Also matches capability clamp. |
| Clock rollback guard | `5 minutes` | = | `client/src/lib/account-default-bank-play-allowance.ts` -> `clockMovedBack` | Prevents reset if clock moved backward. |

## Auth, Session, Security, Notifications

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Cached user key | `vdjv-cached-user` | = | `client/src/hooks/useAuth.ts` -> `USER_CACHE_KEY` | Enables trusted offline access. |
| Cached profile key | `vdjv-cached-profile` | = | `client/src/hooks/useAuth.ts` -> `PROFILE_CACHE_KEY` | Used by sampler session fallback. |
| Cached ban key | `vdjv-cached-ban` | = | `client/src/hooks/useAuth.ts` -> `BAN_CACHE_KEY` | `1` or `true` means banned. |
| Offline signout pending key | `vdjv-offline-signout-pending` | = | `client/src/hooks/useAuth.ts` -> `OFFLINE_SIGNOUT_PENDING_KEY` | Offline signout sync. |
| Session conflict keys | `vdjv-session-conflict-reason`, `vdjv-session-conflict-details`, `vdjv-session-enforcement-event` | = | `client/src/hooks/useAuth.ts` | Cross-tab/session conflict handling. |
| Protected banks hide key | `vdjv-hide-protected-banks` | = | `client/src/hooks/useAuth.ts`; `useSamplerStore.ts` | Session conflict/security behavior. |
| Password recovery mode key | `vdjv-password-recovery-mode` | = | `client/src/hooks/useAuth.ts` -> `PASSWORD_RECOVERY_MODE_KEY` | sessionStorage only. |
| Google OAuth pending key | `vdjv-google-oauth-login-pending` | = | `client/src/hooks/useAuth.ts` -> `GOOGLE_OAUTH_LOGIN_PENDING_KEY` | sessionStorage only. |
| Google OAuth pending max age | `10 minutes` | = | `client/src/hooks/useAuth.ts` -> `GOOGLE_OAUTH_LOGIN_PENDING_MAX_AGE_MS` | Loading overlay should clear after this window. |
| Auth heartbeat interval | `5 minutes` | = | `client/src/hooks/useAuth.ts` -> `AUTH_HEARTBEAT_INTERVAL_MS` | Used for activity/session validity. |
| Capacitor auth redirect | `com.powerworkout.vdjv://auth/callback` | = | `client/src/hooks/useAuth.ts` -> `DEFAULT_CAPACITOR_AUTH_REDIRECT_URL`; `capacitor.config.ts` -> `appId` | Can be overridden by `VITE_CAPACITOR_AUTH_REDIRECT_URL`. |
| Profile select fields | id, role, display_name, tier fields, quota caps, welcome email sent | = | `client/src/hooks/useAuth.ts` -> `PROFILE_SELECT` | Add fields here if profile-dependent UI needs them. |
| Offline session modes | `guest_locked`, `trusted_offline`, `authenticated` | = | `client/src/components/sampler/hooks/useSamplerStore.session.ts` -> `SamplerAuthSessionMode` | Trusted offline requires cached user and offlineTrustedSession true. |
| Sampler quota legacy fallback | owned `6`, pad cap `64`, device cap `120` | = | `client/src/components/sampler/hooks/useSamplerStore.session.ts` -> `DEFAULT_*` | Used if capability/profile value missing. |
| Auth client compatibility marker | POST `store-api/account/auth-compatibility/start` | = | `client/src/lib/edge-api.ts` -> `markAuthClientCompatibility` | Fails with update message for incompatible old client. |
| Activity event rate limit | `120/600s` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_EVENT_RATE_LIMIT` | Edge Function default. |
| Activity heartbeat rate limit | `40/600s` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_HEARTBEAT_RATE_LIMIT` | Edge Function default. |
| Session check rate limit | `30/600s` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CHECK_RATE_LIMIT` | Edge Function default. |
| Session claim rate limit | `24/600s` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CLAIM_RATE_LIMIT` | Edge Function default. |
| Session claim stale window | `6 minutes` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CLAIM_STALE_MS` | Allows claiming stale sessions. |
| Signout rate limit | `15/600s` | = | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SIGNOUT_RATE_LIMIT` | Edge Function default. |
| Attendance date timezone | `Asia/Manila` | = | `supabase/migrations/20260527094833_user_daily_attendance.sql` -> `record_user_daily_attendance` | Daily attendance count is Manila-date based. |
| Attendance heartbeat default | `p_increment_heartbeat: true` | = | `supabase/migrations/20260527094833_user_daily_attendance.sql` | Heartbeats increment daily count. |
| App notice event | `vdjv-app-notice` | = | `client/src/lib/app-notices.ts` -> `APP_NOTICE_EVENT` | Shared in-app notification event. |
| App notice dedupe | `2500ms` | = | `client/src/lib/app-notices.ts` -> `DEFAULT_DEDUPE_MS` | Prevents repeated duplicate notices. |
| Discord webhook HTTP timeout | min `1000ms`, default `5000ms` | = | `supabase/functions/_shared/discord.ts` -> `WEBHOOK_HTTP_TIMEOUT_MS` | Monitoring only. |
| Discord geo lookup timeout | min `500ms`, default `2500ms` | = | `supabase/functions/_shared/discord.ts` -> `GEO_LOOKUP_TIMEOUT_MS` | Monitoring only. |
| Rate-limit fallback max keys | `5000` | = | `supabase/functions/_shared/rate-limit.ts` -> `FALLBACK_BUCKET_MAX_KEYS` | In-memory fallback when RPC unavailable. |
| CORS allow headers/methods | `authorization, x-client-info, apikey, content-type`; `GET,POST,PATCH,DELETE,OPTIONS` | = | `supabase/functions/_shared/http.ts` | Origins from `APP_ALLOWED_ORIGINS` or `ALLOWED_ORIGINS`; if unset, production fallback is limited to VDJV domains plus native localhost origins. |

## Notification, Error, Success Messages

This table tracks static user-facing notice, error, success, loading, confirmation, receipt, and status messages found in the current source. Dynamic backend/exception pass-through messages are documented by their fallback or template.

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| App notice event name | `vdjv-app-notice` | = | `client/src/lib/app-notices.ts` -> `APP_NOTICE_EVENT` | Shared global notification event. |
| App notice default dedupe | `2500ms` | = | `client/src/lib/app-notices.ts` -> `DEFAULT_DEDUPE_MS` | Applies when a caller does not set `dedupeMs`. |
| Offline mode active notice | `Offline mode active. Local sampler features stay available; Store, upgrades, payment, admin sync, and new downloads need internet.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> online/offline effects | Info notice, deduped `10000ms`. |
| Back online notice | `Back online. Store, upgrades, payment, and account sync are available again.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> online/offline effects | Success notice, deduped `10000ms`. |
| Offline preparation notice | `Preparing offline mode. Keep this app online for a moment before going offline.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> offline readiness effect | Info notice, first run per user/offline readiness version. |
| Offline ready notice | `Offline mode is ready on this device. Local dialogs and saved banks can open without internet.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> offline readiness effect | Success notice. |
| Offline partial notice | `Offline mode is partially ready. Reconnect if an unopened feature does not load offline.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> offline readiness effect | Info fallback if module warmup has failures. |
| Offline preparation failed notice | `Offline preparation did not finish. Reconnect once before relying on offline dialogs.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> offline readiness catch | Info fallback. |
| Login busy overlay title | `Signing you in...` | = | `client/src/components/auth/LoginModal.tsx` -> `authBusyOverlay` | Modal loading title for Google/session sync. |
| Google login busy overlay description | `Please wait while Google returns your account session.` | = | `client/src/components/auth/LoginModal.tsx` -> `authBusyOverlay` | Modal loading description. |
| Session sync busy overlay description | `Please wait while your account session finishes syncing.` | = | `client/src/components/auth/LoginModal.tsx` -> `authBusyOverlay` | Modal loading fallback. |
| Login success notice | `Logged in successfully.` | = | `client/src/components/auth/LoginModal.tsx` -> sign-in effects | Success notice. |
| Login sync timeout notice | `Sign-in sync did not finish. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> `awaitingSignInSync` effect; `client/src/routes/PricingPage.tsx` V1 checkout | Error notice/fallback. |
| Google login incomplete notice | `Google sign-in did not complete. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> Google loading effect | Error notice. |
| Google open failed notice | `We could not open Google sign-in. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleGoogleSignIn`; `client/src/routes/PricingPage.tsx` -> `handlePricingGoogleAuth` | Error notice. |
| Auth open failed fallback | `Google sign-in could not open. Please try again.` | = | `client/src/hooks/useAuth.ts` -> `signInWithGoogle` | Auth action error fallback. |
| Free registration auth success notice | `Account ready. Choose your V1 download.` | = | `client/src/components/auth/LoginModal.tsx` -> signup-only success effects | Success notice. |
| Free account created notice | `Free account created.` | = | `client/src/components/auth/LoginModal.tsx` -> signup flow | Success notice. |
| Signup verification sent notice | `Verification code sent. Enter the OTP from your email.` | = | `client/src/components/auth/LoginModal.tsx` -> signup flow | Success notice. |
| Signup create failed notice | `We could not create your account. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> signup flow catch | Error fallback. |
| Signup OTP required notice | `Enter the OTP code from your email.` | = | `client/src/components/auth/LoginModal.tsx` -> verification flow | Error notice. |
| Signup OTP failed notice | `We could not verify that code. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> verification catch | Error fallback. |
| Signup OTP resend success | `A new verification code was sent.` | = | `client/src/components/auth/LoginModal.tsx` -> resend flow | Success notice. |
| Signup OTP resend failed | `We could not resend the verification code. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> resend catch | Error fallback. |
| Login missing credentials notice | `Email and password are required.` | = | `client/src/components/auth/LoginModal.tsx` -> sign-in submit | Error notice. |
| Invalid credential normalized message | `Incorrect email or password. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> `normalizeAuthErrorMessage`; `client/src/routes/PricingPage.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Invalid credential cooldown message | `Incorrect email or password. Too many failed attempts. Try again in ${nextCooldown}s.` | = | `client/src/components/auth/LoginModal.tsx` -> sign-in attempt guard | Error template. |
| Banned account message | `Your account is banned. Please contact support.` | = | `client/src/components/auth/LoginModal.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Email invalid message | `Email address is invalid.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/routes/PricingPage.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Email already registered message | `This email is already registered.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/routes/PricingPage.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Rate limit auth message | `Too many attempts. Please try again later.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/routes/PricingPage.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Reset code invalid message | `Reset code is invalid or expired. Request a new code and try again.` | = | `client/src/components/auth/LoginModal.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Password reuse message | `New password must be different from your old password.` | = | `client/src/components/auth/LoginModal.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Verify email failed message | `Unable to verify email. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> `normalizeAuthErrorMessage` | Error fallback. |
| Email required notice | `Please enter your email.` | = | `client/src/components/auth/LoginModal.tsx` -> forgot password flow | Error notice. |
| Reset code sent notice | `If the email is registered, a reset code was sent. Check your email and enter the code here.` | = | `client/src/components/auth/LoginModal.tsx` -> forgot password flow | Success notice. |
| Generic auth action failed notice | `We could not complete that right now. Please try again.` | = | `client/src/components/auth/LoginModal.tsx` -> forgot/reset catch | Error fallback. |
| Reset email validation message | `Enter a valid email address.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/routes/PricingPage.tsx` | Error notice. |
| Reset code required message | `Enter the reset code from your email or spam folder.` | = | `client/src/components/auth/LoginModal.tsx` -> reset flow | Error notice. |
| Password minimum message | `Password must be at least 8 characters.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/components/ui/AppSettingsDialog.tsx`; `client/src/routes/PricingPage.tsx` | Error notice. |
| Password mismatch message | `Passwords do not match.` | = | `client/src/components/auth/LoginModal.tsx`; `client/src/components/ui/AppSettingsDialog.tsx`; `client/src/routes/PricingPage.tsx` | Error notice. |
| Password updated notice | `Password updated. Please sign in with your new password.` | = | `client/src/components/auth/LoginModal.tsx` -> reset flow | Success notice. |
| Reset code resent notice | `If the email is registered, a new reset code was sent.` | = | `client/src/components/auth/LoginModal.tsx` -> resend reset code | Success notice. |
| Reset resend cooldown message | `Please wait ${resetCooldown} minute(s) before requesting another reset.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleResendResetCode` | Error template. |
| Pending session claim success | `Previous device was logged out. Continuing here.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleConfirmPendingSessionClaim` | Success notice. |
| Pending session claim failed | `Could not continue this login.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleConfirmPendingSessionClaim` | Error fallback. |
| Pending session claim cancelled | `Login cancelled. Your other device remains signed in.` | = | `client/src/components/auth/LoginModal.tsx` -> cancel pending claim | Info notice. |
| Session conflict dialog message | `Your account was logged out on this device because it continued on another device.` | = | `client/src/components/auth/LoginModal.tsx` -> session conflict view | Dialog description. |
| Session conflict fallback reason | `You were logged out because this account was continued on another device.` | = | `client/src/components/auth/LoginModal.tsx` -> session conflict view | Dialog fallback. |
| Auth already in progress message | `Authentication is already in progress. Please wait.` | = | `client/src/hooks/useAuth.ts` -> auth action guards | Auth action error fallback. |
| Offline access not offline message | `Offline access is only available when this device has no internet connection.` | = | `client/src/hooks/useAuth.ts` -> `continueOffline` | Auth action error fallback. |
| No trusted offline user message | `No trusted offline account is saved on this device. Connect to the internet and sign in once.` | = | `client/src/hooks/useAuth.ts` -> `continueOffline` | Auth action error fallback. |
| Continue offline success notice | `Offline mode active. Local and prepared banks are available.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleContinueOffline` | Success notice. |
| Continue offline unavailable fallback | `Offline access is not available on this device.` | = | `client/src/components/auth/LoginModal.tsx` -> `handleContinueOffline` | Error fallback. |
| Upgrade token loading message | `Account session is still loading. Please wait a moment and try again.` | = | `client/src/hooks/useAuth.ts` -> `getAuthenticatedAccessToken` | Auth token fallback. |
| Upgrade claim required message | `Confirm this login before submitting an upgrade request.` | = | `client/src/hooks/useAuth.ts` -> `getAuthenticatedAccessToken` | Auth token fallback. |
| Upgrade offline token message | `Reconnect before submitting an upgrade request.` | = | `client/src/hooks/useAuth.ts` -> `getAuthenticatedAccessToken` | Auth token fallback. |
| Upgrade sync token message | `Account session is still syncing. Please reopen upgrade pricing or refresh the app, then submit again.` | = | `client/src/hooks/useAuth.ts` -> `getAuthenticatedAccessToken` | Auth token fallback. |
| Upgrade unauthenticated token message | `Please sign in before submitting an upgrade request.` | = | `client/src/hooks/useAuth.ts` -> `getAuthenticatedAccessToken` | Auth token fallback. |
| Account deletion sign-in message | `Sign in again before deleting this account.` | = | `client/src/hooks/useAuth.ts` -> `deleteAccount` | Error fallback. |
| Account deletion incomplete message | `Deletion confirmation is incomplete.` | = | `client/src/hooks/useAuth.ts` -> `deleteAccount` | Error fallback. |
| Account deletion email required | `Email is required to verify your password.` | = | `client/src/hooks/useAuth.ts` -> `deleteAccount` | Error fallback. |
| Account deletion wrong password | `Current password is incorrect.` | = | `client/src/hooks/useAuth.ts` -> `deleteAccount` | Error fallback. |
| Account deletion mismatch | `Password verification did not match the signed-in account.` | = | `client/src/hooks/useAuth.ts` -> `deleteAccount` | Error fallback. |
| Settings update check failed | `Update check failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `handleCheckForAppUpdates` | Settings error fallback. |
| Settings update install failed | `Update install failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `handleInstallAppUpdate` | Settings error fallback. |
| Settings GitHub release missing | `No published release was found for this build yet.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `normalizeAppUpdateActionError` | Error fallback. |
| Settings update source bad | `Update source is not configured correctly for this build.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `normalizeAppUpdateActionError` | Error fallback. |
| Settings update network failed | `Could not reach the update server. Check your internet connection and try again.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `normalizeAppUpdateActionError` | Error fallback. |
| Settings Play update unavailable | `Play in-app update is unavailable on this install.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `normalizeAppUpdateActionError` | Error fallback. |
| Settings generic update check failed | `Could not check for updates right now.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `normalizeAppUpdateActionError` | Error fallback. |
| Settings admin password block | `Admin password changes are managed manually.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password handlers | Error notice. |
| Settings missing account email | `No email is attached to this account.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password handlers | Error notice. |
| Settings security code cooldown | `Please wait ${activeCooldown} minute(s) before requesting another security code.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password setup email | Error template. |
| Settings security code sent | `Security code sent to ${email}. Enter it below to continue.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password setup email | Success notice. |
| Settings password email failed | `Password email failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password setup email catch | Error fallback. |
| Settings security code required | `Enter the security code from your email.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Error notice. |
| Settings security code lockout | `Too many invalid security code attempts. Please wait ${waitMinutes} minute(s) before trying again.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Error template. |
| Settings security code verify failed | `Security code verification failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Error fallback. |
| Settings password update failed | `Password update failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Error fallback. |
| Settings password changed | `Password changed.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Success notice. |
| Settings Google password set | `VDJV password set. You can now sign in with Google or email and password.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> password change | Success notice. |
| Settings admin deletion block | `Admin account deletion is managed manually.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> deletion handlers | Info notice. |
| Settings deletion code sign-in message | `Sign in again before requesting a deletion code.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `requestDeleteAccountOtp` | Error fallback. |
| Settings deletion code failed | `Could not send deletion code.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `requestDeleteAccountOtp` | Error fallback. |
| Settings deletion code sent | `Deletion code sent to ${user.email}. It expires in about 10 minutes.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `requestDeleteAccountOtp` | Success template. |
| Settings deletion requirements | `Enter your current password, type DELETE, and confirm the warning first.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `confirmDeleteAccount` | Error notice for password accounts. |
| Settings OAuth deletion requirements | `Enter the email deletion code, type DELETE, and confirm the warning first.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `confirmDeleteAccount` | Error notice for OAuth accounts. |
| Settings account deletion failed | `Account deletion failed.` | = | `client/src/components/ui/AppSettingsDialog.tsx`; `client/src/hooks/useAuth.ts` | Error fallback. |
| Settings display name minimum | `Display name must be at least 2 characters.` | = | `client/src/components/ui/AppSettingsDialog.tsx`; `client/src/components/sampler/HeaderControls.tsx`; `client/src/hooks/useAuth.ts` | Error notice. |
| Settings display name maximum | `Display name must be 50 characters or less.` | = | `client/src/components/sampler/HeaderControls.tsx`; `client/src/hooks/useAuth.ts` | Error notice. |
| Settings display name saved | `Display name updated.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> account panel | Success notice. |
| Header display name saved | `Saved. We will call you ${normalized}.` | = | `client/src/components/sampler/HeaderControls.tsx` -> display name prompt | Success template. |
| Settings voucher unavailable | `Voucher is not available. Check the code or ask admin for a new one.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher expired | `Voucher expired. Ask admin for a new code.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher already used | `Voucher was already used.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher target mismatch | `Voucher is locked to another email or user.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher rate limited | `Too many voucher attempts. Please try again later.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher sign-in message | `Sign in before redeeming a voucher.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> voucher redeem | Error fallback. |
| Settings voucher failed | `Voucher redeem failed. Please try again.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> `mapVoucherRedeemError` | Error fallback. |
| Settings voucher applied | `Voucher applied. Account tier is now ${targetTier}.` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> voucher redeem | Success template. |
| Settings sign-out button busy | `Signing out...` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> sign-out controls | Loading label. |
| Settings delete account busy | `Deleting...` | = | `client/src/components/ui/AppSettingsDialog.tsx` -> delete account dialog | Loading label. |
| App update browser default | `Automatic app updates are unavailable in the browser build.` | = | `client/src/hooks/useAppUpdate.ts` -> `BROWSER_UPDATE_STATE` | Web update state fallback. |
| App update web ready default | `Web app is ready. Check here when you want to refresh to the latest deployed version.` | = | `client/src/hooks/useAppUpdate.ts` -> `WEB_REFRESH_READY_STATUS` | Web update status. |
| App update no status | `No update status available.` | = | `client/src/hooks/useAppUpdate.ts` -> `appUpdateState` fallback | Update status fallback. |
| App update unavailable | `Auto-update is unavailable.` | = | `client/src/hooks/useAppUpdate.ts`; `electron/auto-updater.cjs` -> initial state | Update status fallback. |
| Desktop update state failed | `Could not load the desktop update state.` | = | `client/src/hooks/useAppUpdate.ts` -> Electron state catch | Error status. |
| Android latest APK notice | `You already have the latest APK release.` | = | `client/src/hooks/useAppUpdate.ts` -> Android update state | Success/status message. |
| Android update state failed | `Could not load the Android update state.` | = | `client/src/hooks/useAppUpdate.ts` -> Android state catch | Error status. |
| Android update check failed | `Android update check failed.` | = | `client/src/hooks/useAppUpdate.ts` -> Android check catch | Error status. |
| Web SW unavailable message | `Web update check is unavailable until the service worker is ready.` | = | `client/src/hooks/useAppUpdate.ts` -> web update check | Error status. |
| Web update invalid message | `Web update became invalid before it finished.` | = | `client/src/hooks/useAppUpdate.ts` -> service worker watcher | Error status. |
| Web update downloading message | `Downloading the latest web app files...` | = | `client/src/hooks/useAppUpdate.ts` -> service worker watcher | Loading status. |
| Web update checking message | `Checking for the latest web app files...` | = | `client/src/hooks/useAppUpdate.ts` -> web update check | Loading status. |
| Web already up-to-date message | `Web app is already up to date.` | = | `client/src/hooks/useAppUpdate.ts` -> web update check | Status message. |
| Web update deployed message | `Web app ${latestVersion} is deployed. Reload from Settings to update this installed copy.` | = | `client/src/hooks/useAppUpdate.ts` -> version manifest handling | Info template. |
| Web update check failed | `Could not check for the latest web app version.` | = | `client/src/hooks/useAppUpdate.ts` -> web update check catch | Error status. |
| Header new version notice | `There is a new version ${nextVersion}. Check Settings > App Update.` | = | `client/src/components/sampler/HeaderControls.tsx` -> app update notice effect | Info template, shown once per platform/version. |
| Electron update unavailable feed | `Auto-update is unavailable because no update feed is configured.` | = | `electron/auto-updater.cjs` -> `checkForUpdates` guards | Electron status message. |
| Electron Windows-only update message | `Auto-update is only configured for Windows packages.` | = | `electron/auto-updater.cjs` -> `checkForUpdates` guard | Electron status message. |
| Electron dev update disabled | `Auto-update is disabled in development builds.` | = | `electron/auto-updater.cjs` -> `checkForUpdates` guard | Electron status message. |
| Electron update feed missing package | `Auto-update is ready in code, but no update feed is configured for this package yet.` | = | `electron/auto-updater.cjs` -> `checkForUpdates` guard | Electron status message. |
| Electron checking update | `Checking for updates...` | = | `electron/auto-updater.cjs` -> `checkForUpdates` | Loading status. |
| Electron latest update | `You already have the latest version.` | = | `electron/auto-updater.cjs` -> `update-not-available` | Status message. |
| Electron downloaded update dialog | `A new version of VDJV Sampler Pad has been downloaded.` | = | `electron/auto-updater.cjs` -> `showUpdateDownloadedDialog` | Native dialog message. |
| Electron downloaded update detail | `Restart now to install the update, or close the app later to install on exit.` | = | `electron/auto-updater.cjs` -> `showUpdateDownloadedDialog` | Native dialog detail. |
| Electron ready install message | `Version ${nextVersion} is ready to install.` | = | `electron/auto-updater.cjs` -> `update-downloaded` | Status template. |
| Electron ready install fallback | `Update downloaded and ready to install.` | = | `electron/auto-updater.cjs` -> `update-downloaded` | Status fallback. |
| Electron installing update | `Closing VDJV Sampler Pad to install the update...` | = | `electron/auto-updater.cjs` -> `installDownloadedUpdate` | Loading status. |
| Electron installer failed | `Could not start the update installer.` | = | `electron/auto-updater.cjs` -> `installDownloadedUpdate` catch | Error status. |
| Electron update check failed | `Update check failed.` | = | `electron/auto-updater.cjs` -> initial/check catch | Error status. |
| Electron update error | `Auto-update encountered an error.` | = | `electron/auto-updater.cjs` -> updater error handler | Error status. |
| Electron import downloading | `Downloading bank archive...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Electron import checking | `Checking bank file...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Electron import metadata | `Reading bank metadata...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Electron import decrypting | `Decrypting bank archive...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Electron import extracting | `Extracting bank media...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Electron import finalizing | `Finalizing import payload...` | = | `electron/main.cjs` -> `importArchiveJobElectron` | Electron import progress. |
| Pricing config load failed | `Pricing config could not be loaded. Please refresh.` | = | `client/src/routes/PricingPage.tsx` -> config loader | Error message. |
| Pricing signout free success | `Signed out. You can register free again.` | = | `client/src/routes/PricingPage.tsx` -> free signout | Success notice. |
| Pricing signout checkout success | `Signed out. Enter the account you want to use for checkout.` | = | `client/src/routes/PricingPage.tsx` -> checkout signout | Success notice. |
| Pricing unavailable standard | `${version} Standard is not available yet.` | = | `client/src/routes/PricingPage.tsx` -> `startInstallerCheckout` | Error template. |
| Pricing unavailable PRO MAX | `${version} PRO MAX is not available yet.` | = | `client/src/routes/PricingPage.tsx` -> `startInstallerCheckout` | Error template. |
| Pricing PRO mode required | `Choose Standard + Update or Update Only before getting PRO.` | = | `client/src/routes/PricingPage.tsx` -> `startInstallerCheckout` | Error notice. |
| Pricing update SKU required | `Select at least one update for PRO.` | = | `client/src/routes/PricingPage.tsx` -> `startInstallerCheckout` | Error notice. |
| Pricing standard bundle unavailable | `${version} Standard is not available for this bundle.` | = | `client/src/routes/PricingPage.tsx` -> `startInstallerCheckout` | Error template. |
| Pricing choose card notice | `Choose a pricing card first.` | = | `client/src/routes/PricingPage.tsx` -> checkout submit | Error notice. |
| Pricing payer name required | `Please enter the account name used for payment.` | = | `client/src/routes/PricingPage.tsx`; `client/src/components/auth/LoginModal.tsx` | Error notice. |
| Pricing payment reference required | `Please enter your payment reference or transaction number.` | = | `client/src/routes/PricingPage.tsx` | Error notice. |
| Login payment reference required | `Please enter your payment reference/transaction number.` | = | `client/src/components/auth/LoginModal.tsx` -> buy flow | Error notice. |
| Pricing proof required | `Please upload proof of payment.` | = | `client/src/routes/PricingPage.tsx`; `client/src/components/auth/LoginModal.tsx` | Error notice. |
| Pricing use register free message | `Use Register Free to create a free account.` | = | `client/src/routes/PricingPage.tsx` -> checkout submit | Error notice. |
| Pricing buy selection required | `Select what you want to buy first.` | = | `client/src/routes/PricingPage.tsx` -> checkout submit | Error notice. |
| Pricing Google/session failed | `Google/session sign-in did not finish. Please continue with Google again.` | = | `client/src/routes/PricingPage.tsx` -> V1 checkout | Error fallback. |
| Pricing wrong existing password | `This email is already registered but the password does not match. Use the correct password, reset it, or continue with Google.` | = | `client/src/routes/PricingPage.tsx`; `client/src/components/auth/LoginModal.tsx` | Error notice. |
| Pricing pending registration | `This email already has a pending registration. Please wait for review or check your email.` | = | `client/src/routes/PricingPage.tsx`; `client/src/components/auth/LoginModal.tsx` | Error notice. |
| Pricing rejected registration | `This email has a rejected registration. Please message support before submitting again.` | = | `client/src/routes/PricingPage.tsx` -> login hint | Error fallback. |
| Pricing submit failed | `Your purchase was not submitted. Please try again.` | = | `client/src/routes/PricingPage.tsx` -> checkout catch | Error fallback. |
| Pricing pending review card | `Already submitted: ${receiptReference}. Wait for admin review for 24 hours, or message us on Facebook to follow up your request.` | = | `client/src/routes/PricingPage.tsx` -> plan card pending state | Pending status template. |
| Pricing approved V1 result | `Your V1 account tier is ready. Choose a platform link below.` | = | `client/src/routes/PricingPage.tsx` -> V1 upgrade result | Receipt success message. |
| Pricing pending V1 upgrade result | `Your upgrade request is waiting for admin review for 24 hours. Message us on Facebook to follow up your request.` | = | `client/src/routes/PricingPage.tsx` -> V1 upgrade result | Receipt pending message. |
| Pricing approved registration result | `Your payment passed verification and your V1 account is ready. Choose a platform link below.` | = | `client/src/routes/PricingPage.tsx` -> V1 registration result | Receipt success message. |
| Pricing pending registration result | `Your account request is waiting for admin review for 24 hours. Message us on Facebook to follow up your request.` | = | `client/src/routes/PricingPage.tsx` -> V1 registration result | Receipt pending fallback. |
| Pricing approved installer result | `Your payment passed verification and your license is ready below. A copy was also sent to your email.` | = | `client/src/routes/PricingPage.tsx` -> installer checkout result | Receipt success message. |
| Pricing pending installer result | `Your purchase request is waiting for admin review for 24 hours. Message us on Facebook to follow up your request.` | = | `client/src/routes/PricingPage.tsx` -> installer checkout result | Receipt pending fallback. |
| Pricing pending button | `Pending Review` | = | `client/src/routes/PricingPage.tsx` -> `PaymentReceiptCard` action | Disabled loading CTA for pending review. |
| Pricing signout free confirmation | `Sign out from this pricing session? You will need to sign in again before choosing a download target.` | = | `client/src/routes/PricingPage.tsx` -> signout confirmation | Confirmation message. |
| Pricing signout checkout confirmation | `Sign out from this pricing checkout? The payment form will switch back to email and password entry.` | = | `client/src/routes/PricingPage.tsx` -> signout confirmation | Confirmation message. |
| Upgrade not authenticated mapped message | `Account session is still syncing. Please reopen upgrade pricing and submit again.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError`; submit token fallback | Error fallback. |
| Upgrade already on tier | `Your account is already on this tier.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade already above tier | `Your account already has a higher tier.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade proof too large | `Payment proof is too large. Use a smaller image.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade attempts rate limited | `Too many attempts. Please try again later.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade pending duplicate | `You already have a pending upgrade request. Wait for admin review before submitting another one.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade generic failure | `Upgrade request failed. Please try again.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `mapUpgradeError` | Error fallback. |
| Upgrade proof required | `Upload your receipt or payment proof.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `validateProofFile` | Error notice. |
| Upgrade proof empty | `Selected proof file is empty.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx`; `client/src/routes/PricingPage.tsx`; `client/src/components/sampler/OnlineBankStoreDialog.tsx` | Error notice. |
| Upgrade proof max size | `Proof file is too large. Max is 10MB.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `validateProofFile` | Error notice. |
| Upgrade proof unsupported | `Unsupported proof image. Use PNG, JPG, WEBP, GIF, or HEIC.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> `validateProofFile` | Error notice. |
| Upgrade pricing offline | `Reconnect to load upgrade pricing.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> options loader | Error/empty-state message. |
| Upgrade payer reference required | `Enter payer name and payment reference.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit validation | Error notice. |
| Upgrade proof upload prepare failed | `Could not prepare proof upload.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit proof upload | Error fallback. |
| Upgrade proof upload failed | `Payment proof upload failed. Please try again.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit proof upload | Error fallback. |
| Upgrade request applied notice | `Upgrade applied.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit success | Success notice. |
| Upgrade request submitted notice | `Upgrade request submitted.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit success | Success notice. |
| Upgrade request failed notice | `Upgrade request failed.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> submit catch | Error fallback. |
| Upgrade approved receipt | `Your account tier is active.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> receipt result | Receipt success message. |
| Upgrade pending receipt | `Your upgrade request is waiting for admin review for 24 hours. Message us on Facebook to follow up your request.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> receipt result | Receipt pending message. |
| Upgrade pending card | `Already submitted: ${receiptReference}. Wait for admin review for 24 hours, or message us on Facebook to follow up your request.` | = | `client/src/components/sampler/AccountUpgradeDialog.tsx` -> tier card pending notice | Pending status template. |
| Store proof required | `Please upload your proof of payment.` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx`; `client/src/routes/PricingPage.tsx`; `client/src/components/auth/LoginModal.tsx` | Error notice. |
| Store proof max size | `Proof file is too large. Max is ${maxMb}MB.` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx`; `client/src/routes/PricingPage.tsx` | Error template. |
| Store proof unsupported | `Unsupported image format. Please upload PNG, JPG, WEBP, GIF, or HEIC/HEIF.` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx`; `client/src/routes/PricingPage.tsx` | Error notice. |
| Store checkout proof required | `Please upload proof of payment to continue.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts` -> purchase submit | Error notice. |
| Store checkout sign-in required | `Please sign in to continue.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts`; `useOnlineStoreDownloadTransfer.ts` | Error fallback. |
| Store free claim approved receipt | `Your free promotion was claimed and your bank access is now active.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts` -> `setPurchaseReceipt` | Receipt success message. |
| Store free claim pending receipt | `Your free promotion claim was received and is being verified.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts` -> `setPurchaseReceipt` | Receipt pending fallback. |
| Store payment approved receipt | `Your payment passed verification and your bank access is now approved.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts` -> `setPurchaseReceipt` | Receipt success message. |
| Store payment pending receipt | `Your payment was received and is now waiting for admin review. We will email you after the approval check.` | = | `client/src/components/sampler/hooks/useOnlineStorePurchaseFlow.ts` -> `setPurchaseReceipt` | Receipt pending message. |
| Store device unavailable toast | `This bank is not currently available on this device.` | = | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> download button guard | Error toast. |
| Store iOS low-memory block | `This bank needs a low-memory variant before it can be imported safely on iPhone or iPad.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `requiresIOSLowMemoryVariant` | Error toast and card state. |
| Store iOS concurrent download block | `Finish the current Bank Store download before starting another on iPhone or iPad.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> active transfer limit | Error toast. |
| Store concurrent download block | `Bank Store can download up to ${activeTransferLimit} banks at a time.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> active transfer limit | Error toast template. |
| Store download plan missing | `Download plan missing` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> download ticket handling | Error fallback. |
| Store signed URL missing | `Signed download URL missing` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> download ticket handling | Error fallback. |
| Store download failed raw | `Download failed` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> fetch handling | Error fallback. |
| Store stream unsupported | `ReadableStream not supported` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> fetch handling | Error fallback. |
| Store integrity failed raw | `Integrity check failed` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts`; `electron/main.cjs` | Error fallback. |
| Store empty download | `Downloaded file is empty` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> blob handling | Error fallback. |
| Store download cancelled | `Download cancelled.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> abort handling | Success toast. |
| Store checksum failed toast | `Downloaded file failed integrity check. Re-download required.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> checksum failure toast | Error toast. |
| Store download failed toast | `Download failed. Please try again.` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> generic failure toast | Error toast. |
| Store low-memory importing | `Importing in low-memory mode...` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> import stage | Progress message. |
| Store low-memory manifest loading | `Loading low-memory manifest...` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Import progress message. |
| Store low-memory prepare | `Preparing low-memory bank import...` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Import progress message. |
| Store low-memory part download | `Downloading low-memory part ${partIndex}/${totalParts}...` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Import progress template. |
| Store low-memory part import | `Importing low-memory part ${partIndex}/${totalParts}...` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Import progress template. |
| Store low-memory invalid manifest | `Invalid low-memory manifest.` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Error fallback. |
| Store low-memory invalid structure | `Invalid low-memory manifest structure.` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Error fallback. |
| Store low-memory missing part | `Missing low-memory part ${partIndex}.` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Error template. |
| Store low-memory no valid pads | `No valid pads found in low-memory import.` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> segmented import | Error fallback. |
| Store import timeout | `Import timed out. The file may be too large or corrupted. Please try again.` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> standard import | Error fallback. |
| Store import failed template | `Import failed: ${errorMessage}` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts`; `useSamplerStore.importBank.android.ts` | Error/progress template. |
| Store debug copied | `Store debug log copied.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Success toast. |
| Store debug copy failed | `Failed to copy store debug log.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store support copied | `Support log copied.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Success toast. |
| Store support copy failed | `Failed to copy support log.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store debug export failed | `Failed to export store debug log.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store support export failed | `Failed to export support log.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store recovered crash copied | `Recovered crash report copied.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Success toast. |
| Store recovered crash copy failed | `Failed to copy recovered crash report.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store recovered crash export failed | `Failed to export recovered crash report.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Error toast. |
| Store crash report sent | `Crash report sent.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` -> recovered crash sender | Success toast. |
| Store crash repeat report sent | `Crash report sent. Repeat count: ${repeatCount}.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` -> recovered crash sender | Success template. |
| Store crash report failed | `Failed to send crash report.` | = | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` -> recovered crash sender | Error fallback. |
| Sampler direct import failed | `Failed to import bank directly: ${message}` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> direct import handler | Error dialog template. |
| Sampler metadata sync failed | `Failed to sync sampler metadata.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> metadata sync catch | Error dialog fallback. |
| Sampler invalid audio file | `Invalid file type. Please select an audio file.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> file upload | Error dialog. |
| Sampler audio too large | `Audio file is too large (${sizeMb}MB). Maximum size allowed is ${maxAudioSizeMB}MB. Please use a smaller audio file.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> file upload | Error dialog template. |
| Sampler upload failed | `Failed to upload file. Please try again.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> file upload catch | Error dialog fallback. |
| Sampler pad syncing | `"${padName}" is still syncing. Try again in a moment or keep the bank selected until sync completes.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> pad load flow | Error dialog template. |
| Sampler channel load failed | `Failed to load "${padName}" into Channel ${channelId}.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> channel load flow | Error dialog template. |
| Sampler channel load fallback | `Failed to load pad into channel.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> channel load catch | Error dialog fallback. |
| Sampler pad not found | `Pad not found` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> pad update flow | Error fallback. |
| Sampler pad update failed | `Failed to update pad. Please try again.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> pad update catch | Error dialog fallback. |
| Sampler transfer failed | `Failed to transfer pad. Please try again.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> pad transfer catch | Error dialog. |
| Sampler backup restore failed | `Backup restore failed.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> backup restore catch | Error dialog fallback. |
| Sampler recovery import failed | `Recovery import failed.` | = | `client/src/components/sampler/SamplerPadApp.tsx` -> recovery catch | Error dialog fallback. |
| SideMenu keyboard shortcuts cleared | `Cleared keyboard shortcuts from ${cleared} pad(s).` | = | `client/src/components/sampler/SideMenu.tsx` -> clear shortcuts | Success template. |
| SideMenu no keyboard shortcuts | `No pad keyboard shortcuts to clear.` | = | `client/src/components/sampler/SideMenu.tsx` -> clear shortcuts | Info notice. |
| SideMenu MIDI mappings cleared | `Cleared MIDI mappings from ${cleared} pad(s).` | = | `client/src/components/sampler/SideMenu.tsx` -> clear MIDI | Success template. |
| SideMenu no MIDI mappings | `No pad MIDI mappings to clear.` | = | `client/src/components/sampler/SideMenu.tsx` -> clear MIDI | Info notice. |
| SideMenu official assets refreshed | `Refreshed official assets for ${bankCount} bank(s) and ${padCount} pad(s).` | = | `client/src/components/sampler/SideMenu.tsx` -> Store asset refresh | Success template. |
| SideMenu latest assets refreshed | `The latest bank assets were refreshed on this device.` | = | `client/src/components/sampler/SideMenu.tsx` -> Store asset refresh | Info notice. |
| SideMenu restored missing assets | `Restored ${restored} missing pad asset(s).` | = | `client/src/components/sampler/SideMenu.tsx` -> snapshot recovery | Success template. |
| SideMenu no official assets restored | `No official assets could be restored automatically. Use .bank recovery or full backup for custom media.` | = | `client/src/components/sampler/SideMenu.tsx` -> snapshot recovery | Info notice. |
| SideMenu bank recovery failed | `Bank media recovery failed.` | = | `client/src/components/sampler/SideMenu.tsx` -> snapshot recovery catch | Error fallback. |
| SideMenu already offline | `This bank is already available offline on this device.` | = | `client/src/components/sampler/SideMenu.tsx` -> offline prefetch | Info notice. |
| SideMenu offline cached | `Offline-ready: cached ${prefetched} pad(s) for this bank.` | = | `client/src/components/sampler/SideMenu.tsx` -> offline prefetch | Success template. |
| SideMenu offline partial cached | `Cached ${prefetched} pad(s) offline. ${failed} pad(s) still need network.` | = | `client/src/components/sampler/SideMenu.tsx` -> offline prefetch | Info template. |
| SideMenu offline cache failed | `Could not cache this bank for offline use.` | = | `client/src/components/sampler/SideMenu.tsx` -> offline prefetch | Error notice. |
| SideMenu missing Store metadata | `This restored bank is missing Store download metadata on this device. Restore your account backup or open Store once to refresh the bank record.` | = | `client/src/components/sampler/SideMenu.tsx` -> Store recovery dialog | Error notice. |
| SideMenu bank duplicated | `Bank duplicated as "${duplicatedBank.name}".` | = | `client/src/components/sampler/SideMenu.tsx` -> duplicate callback | Success template. |
| SideMenu duplicate failed | `Failed to duplicate bank.` | = | `client/src/components/sampler/SideMenu.tsx` -> duplicate callback catch | Error fallback. |
| Header fullscreen enabled | `Fullscreen enabled. Press Esc to exit or use the Fullscreen button.` | = | `client/src/components/sampler/HeaderControls.tsx` -> fullscreen listener | Info notice. |
| Header color paint cancelled | `Color Paint Mode cancelled.` | = | `client/src/components/sampler/HeaderControls.tsx` -> color paint handlers | Info notice. |
| Header color paint active | `Color Paint Mode active: ${colorLabel}. Click pads to recolor them.` | = | `client/src/components/sampler/HeaderControls.tsx` -> color paint confirmation | Success template. |
| Header color paint undo | `Undid the last painted pad color.` | = | `client/src/components/sampler/HeaderControls.tsx` -> color paint undo | Info notice. |
| Header color paint edit required | `Enter Edit Mode before using Color Paint Mode.` | = | `client/src/components/sampler/HeaderControls.tsx` -> `padColorPaintBlockedReason` | Info notice. |
| Header color paint channel block | `Cancel channel load mode before using Color Paint Mode.` | = | `client/src/components/sampler/HeaderControls.tsx` -> `padColorPaintBlockedReason` | Info notice. |
| Header color paint search block | `Close search before using Color Paint Mode.` | = | `client/src/components/sampler/HeaderControls.tsx` -> `padColorPaintBlockedReason` | Info notice. |
| Header signed out | `Signed out.` | = | `client/src/components/sampler/HeaderControls.tsx` -> auth transition effect | Success notice. |
| Header signout failed | `Sign out failed.` | = | `client/src/components/sampler/HeaderControls.tsx` -> `handleSignOut` | Error fallback. |
| Header signing in wait | `Signing you in. Please wait a moment.` | = | `client/src/components/sampler/HeaderControls.tsx` -> search click while auth resolving | Info notice. |
| Header greeting | `${Good morning / Good afternoon / Good evening}, ${displayName}! Welcome back.` | = | `client/src/components/sampler/HeaderControls.tsx` -> login greeting effect | Success template. |
| Header upgrade fallback | `Choose a PRO or PRO MAX plan to unlock this feature.` | = | `client/src/components/sampler/HeaderControls.tsx` -> `openUpgradeDialog` | Info notice. |
| Header guest trial remaining | `Guest trial: ${remainingCount} plays left on Default Bank.` | = | `client/src/components/sampler/HeaderControls.tsx` -> search gate | Info template. |
| Header guest trial exhausted | `Guest trial finished. Sign in or upgrade to keep playing.` | = | `client/src/components/sampler/HeaderControls.tsx` -> search gate | Info template. |
| Header free plays exhausted | `Free plays are finished. They reset ${resetLabel}. Upgrade to keep playing now.` | = | `client/src/components/sampler/HeaderControls.tsx` -> search gate | Info template. |
| Header free upgrade prompt | `Upgrade to PRO for unlimited Default Bank plays and Store access.` | = | `client/src/components/sampler/HeaderControls.tsx` -> search gate | Info notice. |
| Admin load account requests failed | `Could not load account registration requests. Please try again.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> request loader | Error notice. |
| Admin load crash reports failed | `Could not load crash reports.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> crash report loader | Error notice. |
| Admin crash report status updated | `Crash report marked ${status}.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> crash report action | Success template. |
| Admin crash report update failed | `Could not update crash report.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> crash report action catch | Error fallback. |
| Admin account request approved | `Account request approved.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> request action | Success notice. |
| Admin account request rejected | `Account request rejected.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> request action | Success notice. |
| Admin account refund | `Account request refunded from revenue. User account stays active.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> refund action | Success notice. |
| Admin account approved email skipped | `Account approved without sending email. The request is approved, but you can retry the email from History.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> request action | Info notice. |
| Admin decision email sent | `Decision email sent.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> email retry | Success notice. |
| Admin email retry skipped | `Email retry skipped.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> email retry | Info notice. |
| Admin account update network error | `Network error updating account request` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> request action catch | Error fallback. |
| Admin decision email retry network error | `Network error retrying decision email` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> email retry catch | Error fallback. |
| Admin assisted email required | `Email is required.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> assisted user validation | Error notice. |
| Admin assisted password minimum | `Password must be at least 6 characters.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> assisted user validation | Error notice. |
| Admin assisted display name required | `Display name is required.` | = | `client/src/components/sampler/AdminAccessDialog.tsx`; `AdminAccessInstallerTab.tsx` | Error notice. |
| Admin user bank quota range | `Bank quota must be between 1 and 500.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> user edit validation | Error notice. |
| Admin user pad cap range | `Pad cap must be between 1 and 256.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> user edit validation | Error notice. |
| Admin user bank cap range | `Bank cap must be between 10 and 1000.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> user edit validation | Error notice. |
| Admin limit override JSON message | `Limit overrides must be a JSON object.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> user edit validation | Error notice. |
| Admin feature override JSON message | `Feature overrides must be a JSON object.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> user edit validation | Error notice. |
| Admin default bank publish source missing | `Select a loaded source bank first.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> default bank publish | Error notice. |
| Admin default bank publish unavailable | `Default bank publish is not available in this build.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> default bank publish | Error notice. |
| Admin bank title required | `Bank title is required.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> bank edit validation | Error notice. |
| Admin decline reason required | `Please enter a reason before declining.` | = | `client/src/components/sampler/AdminAccessDialog.tsx` -> decline dialog | Error notice. |
| Admin store requests load failed | `Could not load requests. Check your connection and try again.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request loader | Error notice. |
| Admin catalog load failed | `Could not load catalog data. Please try again.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> catalog loader | Error notice. |
| Admin promotions load failed | `Could not load store promotions.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotions loader | Error fallback. |
| Admin promotion users load failed | `Could not load user list for promotion targeting.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> user loader | Error notice. |
| Admin payment config load failed | `Could not load payment configuration. Please try again.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> payment config loader | Error notice. |
| Admin store refund | `Request refunded from revenue. User access stays active.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request action | Success notice. |
| Admin store request email success | `Request updated and decision email sent.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request action | Success notice. |
| Admin store request update success | `Request updated successfully.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request action | Success notice. |
| Admin store request update failed | `Request update failed. Please try again. (${text})` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request action catch | Error template. |
| Admin store request network error | `Network error updating request` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> store request action catch | Error fallback. |
| Admin store decision email sent | `Store decision email sent.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> email retry | Success notice. |
| Admin store retry email skipped | `Store retry email skipped.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> email retry | Info notice. |
| Admin store retry email network error | `Network error retrying store decision email` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> email retry catch | Error fallback. |
| Admin catalog update saved | `Catalog item updated!` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> catalog update fallback success | Success notice. |
| Admin catalog update failed | `Update could not be saved. Please try again. (${text})` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> catalog update catch | Error template. |
| Admin catalog network error | `Network error updating catalog` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> catalog update catch | Error fallback. |
| Admin catalog publish success | `Catalog item published!` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> publish action | Success notice. |
| Admin catalog publish failed | `Could not publish this item. (${errMsg})` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> publish action | Error template. |
| Admin catalog publish unexpected | `Could not publish due to an unexpected issue.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> publish catch | Error fallback. |
| Admin bundle draft created | `Bundle draft created.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> bundle create | Success notice. |
| Admin bundle title required | `Bundle title is required.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts`; `AdminAccessDialog.tabs.tsx`; `AdminAccessDialog.widgets.tsx` | Error notice. |
| Admin bundle minimum banks | `Select at least two banks for the bundle.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> bundle validation | Error notice. |
| Admin bundle minimum widgets | `Bundle must include at least two banks.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> bundle validation | Error notice. |
| Admin bundle price required | `Set a valid bundle price before creating a live bundle draft.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> bundle validation | Error notice. |
| Admin promotion name required | `Promotion name is required.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion dates required | `Start and end dates are required.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion discount required | `Discount value must be greater than zero.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion priority invalid | `Priority must be zero or greater.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion target required | `Select at least one target bank or bundle.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion user target required | `Select at least one user for a specific-user promotion.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion new-user window invalid | `Set a valid new-user window in hours.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion validation | Error notice. |
| Admin promotion saved | `Promotion updated.` / `Promotion created.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion save | Success notice variants. |
| Admin promotion save failed | `Promotion could not be saved.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion save catch | Error fallback. |
| Admin promotion deleted | `Promotion deleted.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion delete | Success notice. |
| Admin promotion delete failed | `Promotion could not be deleted.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> promotion delete catch | Error fallback. |
| Admin banner schedule date required | `Scheduled banners require start and end date/time.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `validateBannerScheduleDraft` | Error validation. |
| Admin banner schedule order invalid | `Scheduled banner start must be before the end date/time.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `validateBannerScheduleDraft` | Error validation. |
| Admin banner upload success | `Banner image uploaded. Click Save to apply changes.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner upload | Success notice. |
| Admin banner upload failed | `Could not upload banner image.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner upload catch | Error fallback. |
| Admin banner sort invalid | `Sort order must be a non-negative number.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner validation | Error notice. |
| Admin banner link invalid | `Banner link must be a valid http(s) URL.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner validation | Error notice. |
| Admin banner image invalid | `Provide a valid banner image URL or upload an image file.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner validation | Error notice. |
| Admin banner created | `Marketing banner created.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner create | Success notice. |
| Admin banner create failed | `Could not create marketing banner.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner create catch | Error fallback. |
| Admin banner image URL invalid | `Banner image URL must be a valid http(s) URL.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner update validation | Error notice. |
| Admin banner updated | `Marketing banner updated.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner update | Success notice. |
| Admin banner cleanup failed | `Banner updated, but old image cleanup failed: ${cleanupWarning}` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner update | Info template. |
| Admin banner inactive delete only | `Only inactive banners can be deleted.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner delete guard | Error notice. |
| Admin banner deleted | `Inactive banner deleted.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner delete | Success notice. |
| Admin banner delete cleanup failed | `Banner deleted, but image cleanup failed: ${cleanupWarning}` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner delete | Info template. |
| Admin banner delete failed | `Could not delete banner.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> banner delete catch | Error fallback. |
| Admin banner rotation invalid | `Banner Rotation must be between 3000 and 60000 ms.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> config validation | Error notice. |
| Admin config invalid | `Configuration is invalid.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> config save catch | Error fallback. |
| Admin config save success | `Configuration saved successfully.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> config save fallback success | Success notice. |
| Admin config save failed | `Configuration could not be saved.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> config save | Error fallback. |
| Admin config network error | `Network error saving config` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> config save catch | Error fallback. |
| Admin automation save failed | `Automation settings could not be saved.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> automation save | Error fallback. |
| Admin automation network error | `Network error saving automation settings` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> automation save catch | Error fallback. |
| Admin OCR auto disabled reason | `Skipped because auto-approval is disabled` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR decision labels | Admin status label. |
| Admin OCR not configured reason | `OCR provider is not configured` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status label. |
| Admin OCR proof load failed reason | `Proof image could not be loaded from storage` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status label. |
| Admin OCR file unsupported reason | `Proof image file extension is not supported` / `Proof image mime type is not supported` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status labels. |
| Admin OCR size invalid reason | `Proof image file size is invalid` / `Proof image is too large for OCR` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status labels. |
| Admin OCR timeout reason | `OCR request timed out` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status label. |
| Admin OCR provider failure reason | `OCR provider request failed` / `OCR provider could not process the proof image` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status labels. |
| Admin OCR no text reason | `OCR found no readable text in the proof image` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status label. |
| Admin OCR unknown failure reason | `OCR failed for an unknown reason` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> OCR error labels | Admin status label. |
| Admin upgrade requests load failed | `Could not load upgrade requests.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> upgrade requests loader | Error notice. |
| Admin upgrade approved | `Upgrade request approved.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> upgrade action | Success notice. |
| Admin upgrade rejected | `Upgrade request rejected.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> upgrade action | Success notice. |
| Admin upgrade update failed | `Upgrade request update failed.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> upgrade action catch | Error fallback. |
| Admin upgrade refund | `Upgrade request refunded from revenue. Account tier stays active.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> refund action | Success notice. |
| Admin upgrade refund failed | `Upgrade refund failed.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> refund catch | Error fallback. |
| Admin installer requests load failed | `Failed to load installer requests.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer request loader | Error fallback. |
| Admin installer approved | `${receiptReferenceOrEmail} approved.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer approve | Success template. |
| Admin installer approve failed | `Failed to approve installer request.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer approve catch | Error fallback. |
| Admin installer rejected | `${receiptReferenceOrEmail} rejected.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer reject | Success template. |
| Admin installer reject failed | `Failed to reject installer request.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer reject catch | Error fallback. |
| Admin installer refunded | `${receiptReferenceOrEmail} refunded from revenue.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer refund | Success template. |
| Admin installer refund failed | `Failed to refund installer request.` | = | `client/src/components/sampler/AdminAccessDialog.tabs.tsx` -> installer refund catch | Error fallback. |
| Admin staged assets load failed | `Could not load staged upload assets.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> staged assets loader | Error fallback. |
| Admin low-memory variants load failed | `Could not load low-memory asset variants.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> low-memory loader | Error fallback. |
| Admin paid price required | `Enter a valid price before publishing or saving a paid catalog item.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> catalog item validation | Error notice. |
| Admin staged asset promoted | `Staged asset promoted to this catalog item.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> staged asset action | Success notice. |
| Admin staged asset promote failed | `Could not promote staged asset.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> staged asset action catch | Error fallback. |
| Admin staged asset deleted | `Staged asset deleted.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> staged asset action | Success notice. |
| Admin staged asset delete failed | `Could not delete staged asset.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> staged asset action catch | Error fallback. |
| Admin low-memory variant deleted | `Low-memory variant deleted.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> low-memory action | Success notice. |
| Admin low-memory variant delete failed | `Could not delete low-memory variant.` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> low-memory action catch | Error fallback. |
| Admin thumbnail updated | `Thumbnail updated!` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> thumbnail upload | Success notice. |
| Admin thumbnail upload failed | `Thumbnail upload failed: ${error.message}` | = | `client/src/components/sampler/AdminAccessDialog.widgets.tsx` -> thumbnail upload catch | Error template. |
| Admin tier video type invalid | `Tier video must be MP4, WEBM, MOV, or M4V.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> tier video upload validation | Error notice. |
| Admin tier video uploaded | `Tier video uploaded. Save the tier to publish it.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> tier video upload | Success notice. |
| Admin tier video upload failed | `Tier video upload failed.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> tier video upload catch | Error fallback. |
| Admin voucher campaign name required | `Voucher campaign name is required.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> voucher create | Error notice. |
| Admin voucher campaign created | `Voucher campaign created.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> voucher create | Success notice. |
| Admin voucher campaign create failed | `Voucher campaign create failed.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> voucher create catch | Error fallback. |
| Admin voucher copied | `Voucher copied: ${code}` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> copy next voucher | Success template. |
| Admin voucher created | `Voucher created.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> copy next voucher fallback | Success notice. |
| Admin voucher copy failed | `Copy next voucher failed.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> copy next voucher catch | Error fallback. |
| Admin voucher revoked | `Latest unused voucher revoked. You can copy a replacement code.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> revoke latest voucher | Success notice. |
| Admin voucher revoke failed | `Voucher revoke failed.` | = | `client/src/components/sampler/AdminTierConfigTab.tsx` -> revoke latest voucher catch | Error fallback. |
| Admin installer product code required | `Product code is required.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error notice. |
| Admin installer product prefix | `Product code must start with ${version}_.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer install order invalid | `Install order must be zero or greater.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error notice. |
| Admin installer package parts required | `At least one package part is required.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error notice. |
| Admin installer archive name required | `Archive name is required for part ${partIndex}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer zip password required | `Zip password is required for part ${partIndex}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer part URL invalid | `Download URL must be valid for part ${partIndex}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer part size invalid | `Download size must be zero or greater for part ${partIndex}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer duplicate part | `Duplicate part index: ${partIndex}` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer duplicate product | `Duplicate product code: ${productCode}` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer duplicate order | `Install order ${installOrder} is already used.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer one standard | `Only one standard package is allowed for ${version}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package validation | Error template. |
| Admin installer package saved | `${productCode} saved.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package save | Success template. |
| Admin installer package save failed | `Failed to save package.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package save catch | Error fallback. |
| Admin installer package deleted | `${productCode} deleted.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package delete | Success template. |
| Admin installer package delete failed | `Failed to delete package.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> package delete catch | Error fallback. |
| Admin installer license entitlement required | `Select at least one entitlement.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license validation | Error notice. |
| Admin installer license created | `Installer license created.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license create | Success notice. |
| Admin installer license saved | `License #${licenseId} saved.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license update | Success template. |
| Admin installer license save failed | `Failed to save installer license.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license save catch | Error fallback. |
| Admin installer license reset | `License #${licenseId} reset.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license reset | Success template. |
| Admin installer license reset failed | `Failed to reset installer license.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license reset catch | Error fallback. |
| Admin installer license deleted | `License #${licenseId} deleted.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license delete | Success template. |
| Admin installer license delete failed | `Failed to delete installer license.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> license delete catch | Error fallback. |
| Admin installer SKU required | `SKU code is required.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Admin installer SKU prefix | `SKU code must start with ${version}.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error template. |
| Admin installer price invalid | `Price must be zero or greater.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Admin installer sort invalid | `Sort order must be zero or greater.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Admin installer catalog entitlement required | `Select at least one granted entitlement.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Admin installer download override invalid | `Download override must be a valid http or https URL.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Admin installer hero image invalid | `Hero image must be a valid http or https URL.` | = | `client/src/components/sampler/AdminAccessInstallerTab.tsx` -> catalog product validation | Error notice. |
| Image upload no file | `No file selected.` | = | `client/src/lib/image-upload.ts` -> `validateImageFile` | Error fallback. |
| Image upload unsupported banner | `Uploaded banner files must be JPG, PNG, or WEBP. Use an external banner URL for SVG or GIF.` | = | `client/src/lib/image-upload.ts` -> `validateImageFile` | Error notice. |
| Image upload process failed | `This browser could not process the selected image.` | = | `client/src/lib/image-upload.ts` -> compression path | Error fallback. |
| Image upload encode failed | `This browser could not encode the selected image.` | = | `client/src/lib/image-upload.ts` -> compression path | Error fallback. |
| Support log native shared | `Support log opened in your device share sheet.` | = | `client/src/lib/supportDiagnostics.ts` -> export helpers | Success message. |
| Support log copied fallback | `File export is not supported on this device. Support log copied instead.` | = | `client/src/lib/supportDiagnostics.ts` -> export helpers | Success fallback. |

## Admin, Payments, Banners, Promotions

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Admin active sort key | `vdjv-admin-active-sort` | = | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `ACTIVE_SORT_STORAGE_KEY` | Persists Active tab sorting. |
| Assisted user min password | `8` | = | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `ACCOUNT_ASSISTED_MIN_PASSWORD` | Generated password format `Assist!${seed}9`. |
| Store config empty defaults | blank instructions/payment fields, banner rotation `5000`, maintenance false, all auto-approve false | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_CONFIG` | Admin form fallback. |
| Auto-approval mode defaults | mode `schedule`, start `0`, end `0`, duration `24`, expires `null` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_CONFIG` | Account, Store, Installer V2, Installer V3. |
| Store maintenance message | `Bank Store is under maintenance. Downloads and browsing are temporarily unavailable.` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `DEFAULT_STORE_MAINTENANCE_MESSAGE` | Used if enabling maintenance with blank message. |
| Store promotion form defaults | type `flash_sale`, discount `percent`, value `10`, timezone `Asia/Manila`, priority `100`, active true, audience `all`, new-user window `168h` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_PROMOTION_FORM` | UI create form. |
| Banner create defaults | sort order `0`, schedule `always`, timezone `Asia/Manila`, inactive view false | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> state defaults | Admin Banners tab. |
| Banner schedule mode | `always` fallback, otherwise `scheduled` | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `normalizeBannerScheduleMode`; `supabase/migrations/20260604145000_store_banner_schedule_and_updates.sql` | `always` means permanent banner. |
| Banner status fallback | inactive if disabled; permanent for always; scheduled/expired/active by time window | = | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `normalizeBannerStatus` | Time-window status derived client-side. |
| Store promotion DB defaults | `promotion_type: standard`, timezone `Asia/Manila`, priority `100`, active true, audience `all` | = | `supabase/migrations/20260311193000_store_promotions.sql`; `20260328160000_store_promotion_audiences.sql` | UI defaults differ: create form uses `flash_sale`. |
| Promotion discount types | `percent`, `fixed`, `free` | = | `supabase/migrations/20260415143000_store_promotions_free_claim.sql` | Free requires `discount_value = 0`. |
| New user window range | `1..8760` hours or null | = | `supabase/migrations/20260328160000_store_promotion_audiences.sql` | UI default is `168`. |
| Store payment email subject approved | `Payment Approved - {{receipt_reference}}` | = | `supabase/migrations/20260227143000_store_email_template_defaults.sql` | Template default only fills blank DB values. |
| Store payment email subject rejected | `Payment Update - {{receipt_reference}}` | = | `supabase/migrations/20260227143000_store_email_template_defaults.sql` | Template default only fills blank DB values. |
| Payment channels | `image_proof`, `gcash_manual`, `maya_manual` | = | `server/index.ts` -> `PAYMENT_CHANNEL_VALUES`; `supabase/functions/store-api/index.ts` -> `PAYMENT_CHANNEL_VALUES` | Upgrade requests also allow `voucher` in migration. |
| Store purchase pending limit | `5` pending requests | = | `supabase/functions/store-api/index.ts` -> `STORE_PENDING_PURCHASE_REQUEST_LIMIT`; `server/index.ts` legacy same env name | Spam protection. |
| Store max purchase items | `20` | = | `supabase/functions/store-api/index.ts` -> `STORE_MAX_PURCHASE_ITEMS`; `server/index.ts` legacy same env name | Cart/purchase limit. |
| Store purchase rate limit | `12/3600s` | = | `supabase/functions/store-api/index.ts` -> `STORE_PURCHASE_RATE_LIMIT`; `server/index.ts` legacy same default | Public endpoint. |
| Store download rate limit | `20/3600s` | = | `supabase/functions/store-api/index.ts` -> `STORE_DOWNLOAD_RATE_LIMIT`; `server/index.ts` legacy same default | Public endpoint. |
| Store max web download bytes | `478150656` bytes / 456 MB | = | `supabase/functions/store-api/index.ts` -> `STORE_MAX_DOWNLOAD_BYTES` | Legacy Express default is `268435456`; duplicated mismatch. |
| Store max native download bytes | `2GB - 1` | = | `supabase/functions/store-api/index.ts` -> `STORE_MAX_NATIVE_DOWNLOAD_BYTES` | Native-capable archive handling. |
| Store managed asset max | `25MB` | = | `supabase/functions/store-api/index.ts` -> `STORE_MANAGED_ASSET_MAX_BYTES` | QR/banner/thumbnail assets. |
| Store marketing banner max active | `12` | = | `supabase/functions/store-api/index.ts` -> `STORE_MARKETING_BANNER_MAX_ACTIVE` | Admin guardrail. |
| R2 signed download TTL | default `300s`, clamped `60..3600s` | = | `supabase/functions/store-api/index.ts`; `supabase/functions/_shared/r2-storage.ts` -> `createPresignedGetUrl` | Used for Store/default bank downloads. |
| R2 upload URL TTL | default `900s`, clamped `60..3600s` | = | `supabase/functions/admin-api/index.ts`; `supabase/functions/_shared/r2-storage.ts` -> `createPresignedPutUrl` | Direct uploads. |
| Store release cache | TTL `300s`, max entries `200` | = | `supabase/functions/store-api/index.ts` -> `STORE_RELEASE_CACHE_*` | Android/GitHub release cache. |
| Store receipt link TTL | default `3600s`, clamped `300..604800s` | = | `supabase/functions/store-api/index.ts` -> `STORE_EMAIL_RECEIPT_LINK_TTL_SECONDS` | Email receipt links. |
| Account registration rate limit | submit `8/3600s`, upload `12/3600s`, login hint `30/3600s` | = | `supabase/functions/store-api/index.ts` -> `ACCOUNT_REG_*` | Registration/checkout protection. |
| Account proof max | `10MB` | = | `supabase/functions/store-api/index.ts` -> `ACCOUNT_REG_MAX_PROOF_BYTES` | Server validation. |
| OCR endpoint/timeout | `https://api.ocr.space/parse/image`, timeout `12000ms` | = | `supabase/functions/store-api/index.ts` -> `OCR_SPACE_API_URL`, `RECEIPT_OCR_TIMEOUT_MS` | OCR should be disabled by config when not desired. |
| OCR rate limit | `40/3600s` | = | `supabase/functions/store-api/index.ts` -> `RECEIPT_OCR_RATE_LIMIT` | API-cost sensitive. |
| Crash report rate/max | `12/86400s`, max support log `256KB` | = | `supabase/functions/store-api/index.ts` -> `CLIENT_CRASH_REPORT_*` | Public report endpoint. |
| Admin publish rate limit | `30/3600s` | = | `supabase/functions/admin-api/index.ts` -> `ADMIN_STORE_PUBLISH_RATE_LIMIT` | Store/default-bank publish actions. |
| Admin export token rate limit | `120/3600s` | = | `supabase/functions/admin-api/index.ts` -> `ADMIN_EXPORT_SIGN_TOKEN_RATE_LIMIT` | Admin export signing. |
| Admin dashboard caps | series `5000`, active session scan `2000`, max window days `730` | = | `supabase/functions/admin-api/index.ts` -> `DASHBOARD_*` | Dashboard performance guardrails. |
| Admin asset max size | `2GB - 1` | = | `supabase/functions/admin-api/index.ts` -> `R2_MAX_ASSET_BYTES` | R2 asset upload guardrail. |
| Tier video max size | `512MB` | = | `supabase/functions/admin-api/index.ts` -> `ACCOUNT_TIER_VIDEO_MAX_BYTES` | Admin tier video upload. |

## Landing, Pricing, Downloads, Legal

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Landing versions | `V1`, `V2`, `V3` | = | `client/src/components/landing/download-config.ts` -> `VERSION_OPTIONS` | Pricing/version selector depends on this. |
| Landing platforms | `android`, `ios`, `windows`, `macos` | = | `client/src/components/landing/download-config.ts` -> `PLATFORM_OPTIONS` | Download target options. |
| Landing social options | `facebook`, `instagram`, `youtube` | = | `client/src/components/landing/download-config.ts` -> `SOCIAL_OPTIONS` | Footer/admin social links. |
| V1 Android download | GitHub latest release URL | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.android` | Current source default points to GitHub latest release. |
| V1 iOS download | `/ios/` | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.ios` | Add-to-home-screen guide route. |
| V1 Windows/macOS download | Messenger link | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.windows/macos` | Needs verification if public release should offer EXE directly. |
| V2/V3 iOS download | VirtualDJ Remote App Store URL | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V2/V3.ios` | External app dependency. |
| V2/V3 other download links | Messenger link for Android/Windows/macOS | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS` | Admin can override via landing config. |
| Landing version descriptions | Filipino V1/V2/V3 descriptions | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_VERSION_DESCRIPTIONS` | Copy defaults; not repeated here in full to keep this reference compact. |
| Landing buy sections | V1 image `/assets/logo.png`, V2/V3 Messenger installer link | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_BUY_SECTIONS` | DB seed may differ from current source. |
| Landing socials | Facebook, Instagram, YouTube VDJV links | = | `client/src/components/landing/download-config.ts` -> `DEFAULT_SOCIAL_LINKS` | Admin editable. |
| Install guide canonical paths | `/ios/`, `/android/` | = | `client/src/components/landing/download-config.ts` -> `canonicalizeInstallGuideLink` | Normalizes `/ios` and `/android`. |
| Landing DB default row id | `default` | = | `supabase/migrations/20260311143000_create_landing_download_config.sql` | Seed values are legacy domain/mediafire defaults and may not match current source defaults. |
| Landing DB JSON defaults | `{}` for links/descriptions/socials when columns empty | = | `supabase/migrations/20260311143000_create_landing_download_config.sql`; `20260423133000_landing_page_social_links.sql` | Runtime normalizer falls back to client defaults. |
| Legal document sections | `[]` | = | `supabase/migrations/20260423120000_legal_documents.sql` -> `sections default '[]'` | Draft/published docs stored in DB; fallback legal content lives in `_shared/legal-content.ts`. |

## Electron, Android Capacitor, Platform Update Defaults

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Capacitor app id/name | `com.powerworkout.vdjv`, `VDJV Sampler Pad` | = | `capacitor.config.ts` | Must match OAuth redirect scheme expectations. |
| Capacitor web dir | `dist/public` | = | `capacitor.config.ts` | Build output copied into native app. |
| Android namespace/applicationId | `com.powerworkout.vdjv` | = | `android/app/build.gradle` | Native app identity. |
| Android SDKs | min `22`, compile `35`, target `35` | = | `android/variables.gradle` | Release compatibility. |
| Android release version fallback | `versionCode 1`, `versionName 1.0` | = | `android/app/build.gradle` -> `releaseVersionCode`, `releaseVersionName` | Build script normally injects package version/code. |
| Android build script version fallback | `ANDROID_RELEASE_VERSION_NAME` and `VITE_APP_VERSION` default to `package.json.version` | = | `scripts/build-android-release.cjs` | Actual computed versionCode needs verification from script function. |
| Android release signing | unsigned unless keystore env/properties exist | = | `android/app/build.gradle` -> `hasReleaseSigning` | Public release requires signed outputs. |
| Android sideload update API | `https://api.github.com` | = | `.env.example`; `client/src/lib/android-sideload-update.ts` -> `DEFAULT_GITHUB_API_BASE_URL` | Native Android release checker. |
| Android release owner/repo | `vdjvsamplerpad` / `vdjvsamplerpad.github.io` | = | `.env.example`; `client/src/lib/android-sideload-update.ts` | GitHub Releases source. |
| Android APK prefix | `VDJV-Sampler-Pad-` | = | `.env.example`; `client/src/lib/android-sideload-update.ts` -> `preferredPrefix` | First matching APK asset is preferred. |
| Electron auth scheme | `com.powerworkout.vdjv://auth/callback` | = | `electron/main.cjs` -> `AUTH_CALLBACK_*` | Same scheme as Capacitor redirect. |
| Electron portable marker files | `vdjv-portable-data.flag`, `.vdjv-portable-data`, `portable-data.flag` | = | `electron/main.cjs` -> `PORTABLE_DATA_MARKER_FILES` | Enables portable data root. |
| Electron portable data folder | `VDJV Data/userData`, `sessionData`, `crashDumps`, `logs` beside executable | = | `electron/main.cjs` -> `configurePortableDataPaths` | Portable mode only. |
| Electron encryption parameters | magic `VDJVENC2`, version `1`, salt `16`, IV `12`, verifier `16`, PBKDF2 `120000` | = | `electron/main.cjs` constants | Backup/archive compatibility. Risky to change. |
| Electron media root | `media` | = | `electron/main.cjs` -> `ELECTRON_MEDIA_ROOT_FOLDER` | Local media storage. |
| Electron import archive caps | entries `2000`, total uncompressed `2GB`, entry `512MB` | = | `electron/main.cjs` -> `MAX_IMPORT_ARCHIVE_*` | Zip bomb protection. |
| Electron window min/default/max | min `1100x700`, default `1200x800`, max `5000x4000` | = | `electron/main.cjs` -> `MIN_WINDOW_STATE`, `DEFAULT_WINDOW_STATE`, `MAX_WINDOW_STATE` | Window state persisted in `window-state.json`. |
| Electron save dialog fallback | filename `download.bin`, default directory Downloads | = | `electron/main.cjs` -> `sanitizeSuggestedFileName`, `saveFileElectron` | File exports. |
| Electron update channel | `latest` | = | `electron/auto-updater.cjs` -> `DEFAULT_UPDATE_CHANNEL` | Can be overridden by env or `auto-update.json`. |
| Electron update check interval | `6 hours` | = | `electron/auto-updater.cjs` -> `CHECK_INTERVAL_MS` | Plus startup check after `15000ms`. |
| Electron update install close timeout | destroy window after `1800ms`, then `quitAndInstall` after `250ms` | = | `electron/auto-updater.cjs` -> `installDownloadedUpdate` | Installer close behavior. |
| Electron build artifact names | `VDJV-Sampler-Pad-Setup-${version}-${arch}.${ext}`, `VDJV-Sampler-Pad-Portable-${version}-${arch}.${ext}` | = | `package.json` -> `build.nsis.artifactName`, `build.portable.artifactName` | Release artifact naming. |
| Electron installer mode | NSIS `oneClick: false`, `perMachine: false`, allow changing installation directory true | = | `package.json` -> `build.nsis` | User installation defaults. |

## Supabase Local Config, Database Defaults, Edge Function Defaults

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Supabase local project id | `VDJV_SAMPLER_PAD_WEB` | = | `supabase/config.toml` -> `project_id` | Local CLI only. |
| Supabase local API port | `54321` | = | `supabase/config.toml` -> `[api].port` | Matches `.env.example`. |
| Supabase local DB ports | DB `54322`, shadow `54320`, pooler `54329` | = | `supabase/config.toml` -> `[db]`, `[db.pooler]` | Local dev only. |
| Supabase API max rows | `1000` | = | `supabase/config.toml` -> `[api].max_rows` | Local config. |
| Supabase storage file limit | `50MiB` | = | `supabase/config.toml` -> `[storage].file_size_limit` | Local Supabase storage; R2 handles large Store assets. |
| Supabase auth site URL | `https://vdjvsamplerpad.online` | = | `supabase/config.toml` -> `[auth].site_url` | Local config and hosted reference; live hosted value needs verification. |
| Supabase auth redirect URLs | localhost/127.0.0.1 ports `3000`, `4173`, `5173`; `vdjvsamplerpad.online`; `vdjvsamplerpad.github.io`; `com.powerworkout.vdjv://auth/callback` | = | `supabase/config.toml` -> `additional_redirect_urls` | Important for Google/OAuth. |
| Supabase JWT expiry | `3600s` | = | `supabase/config.toml` -> `[auth].jwt_expiry` | Local config; hosted needs verification. |
| Refresh token rotation | enabled, reuse interval `10s` | = | `supabase/config.toml` -> `[auth]` | Auth/session behavior. |
| Signup/anonymous sign-in | signup true, anonymous false | = | `supabase/config.toml` -> `[auth]` | Hosted needs verification. |
| Email password policy | min length `6`, no requirement string | = | `supabase/config.toml` -> `[auth]` | App-level assisted password uses 8 chars. |
| Auth email rate/OTP | email sent `2/h`, OTP length `6`, expiry `3600s`, max frequency `1s` | = | `supabase/config.toml` -> `[auth.rate_limit]`, `[auth.email]` | Local config; hosted needs verification. |
| Supabase edge runtime | enabled, policy `per_worker`, inspector port `8083`, Deno `2` | = | `supabase/config.toml` -> `[edge_runtime]` | Local dev. |
| API rate limit counter hits default | `0` | = | `supabase/migrations/20260225124000_api_rate_limits.sql` | DB limiter table. |
| Profile role default | `user` | = | `supabase/migrations/20260225110000_db_hardening_comprehensive.sql` | Role constraint allows user/admin. |
| Legacy profile quotas | owned `6`, pad cap `64`, device cap `120` | = | `supabase/migrations/20260305170000_profile_bank_quota_defaults.sql` | Legacy profile columns still exist for compatibility. |
| Sampler app config row | id `default`, active true | = | `supabase/migrations/20260312150000_create_sampler_app_config.sql` | Server/admin reads this row. |
| Sampler app config DB quota seed | owned `6`, pad cap `64`, device cap `120` | = | `supabase/migrations/20260312150000_create_sampler_app_config.sql` | Duplicates client config. |
| Default bank release defaults | source pad count `0`, storage provider `r2`, active false, published now | = | `supabase/migrations/20260306110000_default_bank_releases.sql` | Default bank publishing. |
| Catalog asset protection | `encrypted` | = | `supabase/migrations/20260227190000_bank_catalog_asset_protection.sql` | Store catalog security default. |
| Catalog pinned flag | `false` | = | `supabase/migrations/20260227223000_store_catalog_pinned_flag.sql` | Store sorting/default display. |
| Catalog item type | `single_bank` | = | `supabase/migrations/20260329110000_store_catalog_bundles.sql` | Bundles opt in. |
| Catalog coming soon | `false` | = | `supabase/migrations/20260323143000_add_coming_soon_to_bank_catalog_items.sql` | Store visibility state. |
| Low-memory catalog variant status | `uploading`, part count `0` | = | `supabase/migrations/20260421103000_store_catalog_low_memory_variants.sql` | Low-memory segmented assets. |
| User bank access source | `purchase` | = | `supabase/migrations/20260601093000_time_limited_free_store_promos.sql` | Free promo downloads should not create permanent access unless specific path does. |
| Account registration request status | `pending`, password key version `1`, decision email `pending` | = | `supabase/migrations/20260226054318_account_registration_requests.sql` | Legacy registration and pricing checkout. |
| Installer buy product defaults | description empty, price `0`, enabled true, sort `0`, allow auto-approve true, entitlements `{}` | = | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Installer catalog. |
| Installer request status/email | status `pending`, decision email `pending` | = | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Installer purchase review. |
| Installer auto-approve defaults | V2/V3 enabled false, mode `schedule`, start `0`, end `0`, duration `24` | = | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Mirrors admin UI defaults. |
| Installer tier config defaults | display/description empty, UI `{}`, active true | = | `supabase/migrations/20260522124500_installer_tier_ui_content.sql` | Seeded rows provide actual version/tier copy. |
| Crash report DB defaults | status `new`, title `Crash Report`, repeat `1`, fingerprint version `1`, latest summary `{}` | = | `supabase/migrations/20260324093000_create_client_crash_reports.sql` | Admin Crash Reports. |
| R2 region/content type | region `auto`, content type `application/octet-stream` | = | `supabase/functions/_shared/r2-storage.ts` -> `DEFAULT_REGION`, `DEFAULT_UPLOAD_CONTENT_TYPE` | Cloudflare R2 signing. |
| Admin export token defaults | key id `admin-export-v1`, token version `1`, issuer `vdjv.admin-export`, bank name fallback `Untitled Bank` | = | `supabase/functions/_shared/admin-export-token.ts` | TTL from env; exact default TTL needs verification from file line if required. |

## Duplicated Or Hardcoded Defaults

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Sampler owned bank pad cap duplicate | Client/shared/server legacy `64` | = | `client/src/components/sampler/samplerAppConfig.ts`, `supabase/functions/_shared/sampler-app-config.ts`, `supabase/migrations/20260312150000_create_sampler_app_config.sql`, `useSamplerStore.session.ts` | Previously drifted at client `80`; now aligned. Safe improvement: centralize sampler defaults or make client read server config before first-run persistence. |
| FREE daily plays duplicate | Current client capability `50`; old tier seed `100` | = | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Admin Tier Config/live DB likely overrides. Mark live value Needs verification. |
| FREE deck count duplicate | Current client `1/1/1`; old tier seed only `deck_count:2` | = | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Public behavior depends on current account tier config row. |
| PRO MAX deck count duplicate | Current client max `8`; old tier seed `deck_count:4` | = | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Tier config now supports min/default/max; live DB needs verification. |
| Store max download bytes duplicate | Edge Function `478150656`; legacy Express `268435456` | = | `supabase/functions/store-api/index.ts` vs `server/index.ts` | Legacy Express disabled by default; keep note for old local tests. |
| Landing download defaults duplicate | Client GitHub/Messenger defaults; old migration domain/MediaFire defaults | = | `client/src/components/landing/download-config.ts` vs `supabase/migrations/20260311143000_create_landing_download_config.sql` | Live DB/admin config may override. Needs verification before release link changes. |
| Payment channel values duplicate | `image_proof`, `gcash_manual`, `maya_manual` | = | `server/index.ts`, `supabase/functions/store-api/index.ts`, migrations | Keep in sync if adding a wallet/channel. |
| Stop timing ranges duplicate | Same ranges in client and Supabase shared sampler config | = | `client/src/lib/audio-engine/types.ts`; `supabase/functions/_shared/sampler-app-config.ts` | Audio setting validation must remain identical. |
| Theme brand pink duplicate | CSS HSL brand and tier `#f21984` | = | `client/src/index.css`; `client/src/lib/account-tier-content.ts` | Admin tier color may override but fallback remains hardcoded. |
| Legacy shared export password | `vdjv-export-disabled-2024-secure` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `SHARED_EXPORT_DISABLED_PASSWORD`; observed also in store code scan | Legacy compatibility/security-sensitive. Do not reuse for new encryption. |

## Fallback, Offline, First Installer, Legacy Defaults

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Offline login fallback | Cached user/profile and trusted offline session | = | `client/src/hooks/useAuth.ts`; `client/src/components/sampler/hooks/useSamplerStore.session.ts` | Works only after at least one successful online session/cache. |
| Offline Store fallback | Latest local snapshot if available; API offline returns 503 | = | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts`; `client/public/sw.js` | Store browsing/payment/network actions should show offline unavailable messages. |
| First installer/user data mode | Electron standard uses app userData; portable uses `VDJV Data` beside executable | = | `electron/main.cjs` -> `configurePortableDataPaths` | First installer set value depends on packaged/portable marker. Needs verification in installer repo. |
| First Android version fallback | Gradle `versionName 1.0`, `versionCode 1` if build env missing | = | `android/app/build.gradle` | Build scripts should override; risky if bypassed. |
| Old public build auth compatibility | Tier/promo client versions default `1` | = | `supabase/functions/store-api/index.ts` -> `TIER_AWARE_CLIENT_VERSION`, `PROMO_AWARE_CLIENT_VERSION` | Old builds without headers may be blocked or handled by compatibility code. |
| Legacy registration default tier | New profiles default FREE; old approved registrations migrated to PRO | = | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql`; `20260501090000_promote_legacy_paid_registration_to_pro.sql` | Public release compatibility behavior. |
| Legacy sampler quota defaults | Profile columns still default 6/64/120 | = | `supabase/migrations/20260305170000_profile_bank_quota_defaults.sql` | User-level overrides and old builds may still read these columns. |
| Legacy Express API | Disabled unless env true | = | `server/index.ts` -> `ENABLE_LEGACY_EXPRESS_API` | Keep disabled for public unless needed. |
| App update unavailable fallback | `Auto-update is unavailable.` | = | `electron/auto-updater.cjs` -> initial `updateState.message` | Electron only. |
| Web update check fallback | `/version.json?_vdjv=${Date.now()}` | = | `client/src/hooks/useAppUpdate.ts` -> `fetchLatestWebBuildVersion` | If same version but waiting worker exists, UI may show refresh-ready. |

## Defaults Risky To Change In Public Release

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Auth redirect URLs/scheme | `com.powerworkout.vdjv://auth/callback` plus hosted/local URLs | = | `supabase/config.toml`; `client/src/hooks/useAuth.ts`; `electron/main.cjs`; `capacitor.config.ts` | Changing breaks Google/OAuth return paths across Electron/Capacitor/PWA. |
| Capability cache key | `vdjv-account-capabilities-v5` | = | `client/src/lib/account-capabilities.ts` | Changing invalidates cache; useful only when schema changes. |
| Audio stop timing profiles | Platform-specific timings | = | `client/src/lib/audio-engine/types.ts` | Sensitive to stutter/artifacts on Android/iOS. Test real devices before release. |
| Import concurrency and batch flush | iOS `1`, Android native `2`, web `4`; iOS flush `1/8MB` | = | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` | Increasing can reintroduce iOS/Android crashes. |
| Large download/iOS low-memory threshold | `250MB` | = | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` | Changing affects bank-store crash prevention. |
| Backup/archive encryption constants | `VDJVENC2`, PBKDF2 `120000`, salt/IV/verifier sizes | = | `electron/main.cjs` | Changing breaks existing encrypted exports/backups. |
| Local storage keys | `vdjv-sampler-banks`, `vdjv-sampler-state`, etc. | = | `client/src/components/sampler/hooks/useSamplerStore.ts` | Changing loses offline/user data unless migration is added. |
| DB tier configs | Live `account_tier_configs` rows | = | Supabase DB, seeded by migrations | Live values should be exported/backed up before schema/default refactors. Needs verification. |
| Store request/payment status values | pending/approved/rejected/refunded etc. | = | Store/account migrations and admin UI | Changing enum-like text breaks filters and history. |
| Service worker cache naming | `vdjv-shell-cache-${version}` | = | `vite.config.js`, `client/public/sw.js` | Wrong name can strand stale public builds. |
| Android package id | `com.powerworkout.vdjv` | = | `capacitor.config.ts`, `android/app/build.gradle` | Changing creates a new Android app identity. |
| Electron app id/product | package build config | = | `package.json` -> `build.appId`, `build.productName` | Changing affects update/install identity. Needs verification from package fields before release. |

## Recommended Safe Improvements

| Setting | Default Value | Current Value | File/Location | Notes |
|---|---|---|---|---|
| Centralize sampler quota defaults | Current duplicate sources are aligned at pad cap `64` | = | `client/src/components/sampler/samplerAppConfig.ts`; `supabase/functions/_shared/sampler-app-config.ts`; migrations | Create a single generated/shared defaults source or make client default hydrate from `sampler_app_config` before persisting first-run settings. |
| Export live admin config snapshot | Needs verification | = | Supabase tables: `sampler_app_config`, `account_tier_configs`, `installer_tier_configs`, `landing_download_config`, `store_payment_settings` | Add an admin/export command so public-release docs include actual live values, not only source fallbacks. |
| Version default docs with app release | Current doc generated for `package.json` `0.1.6` | = | `package.json`; this file | Regenerate on release to catch default drift. |
| Add lint/check for duplicate constants | Needs verification | = | Source-wide | A lightweight script can compare client/server tier limits, stop timing ranges, Store limits, and landing defaults. |
| Redact `.env` values in docs | Done here | = | `.env.example`, runtime env | Avoid committing live Supabase keys/webhooks/signing data. |
| Mark legacy defaults in UI | Needs verification | = | Admin Sampler Defaults, Tier Config, Pay Config | Admin UI should label legacy quota/profile fields as compatibility-only when tier config owns behavior. |
| Add runtime config health panel | Needs verification | = | Admin Home or Tier Config | Show current live tier limits, sampler defaults, cache age, and client version header support. |
| Add migration comments for superseded seeds | Needs verification | = | Old migrations such as `20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Prevent confusion when source fallbacks differ from old seed defaults. |
