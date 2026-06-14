# APP_DEFAULT_SETTINGS

Generated: 2026-06-14  
Scope: static source scan of the VDJV app, landing/pricing pages, Electron, Android Capacitor, Express legacy server, Supabase Edge Functions, and Supabase migrations.  
Runtime/live database values were not queried. Any deployed secret or live dashboard value is intentionally redacted or marked `Needs verification`.

## Theme, Colors, Fonts, Layout, Spacing

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Theme storage key | `vdjv-theme` | `client/src/components/sampler/hooks/useTheme.ts` -> `localStorage.getItem('vdjv-theme')`; `client/src/main.tsx` -> `applyPersistedThemeClass` | Defaults to OS preference when no saved value exists; SSR fallback in hook is `dark`. |
| Theme options | `light`, `dark` | `client/src/components/sampler/hooks/useTheme.ts` -> `type Theme` | Invalid stored values are ignored. |
| Light background/foreground | `--background: 18 36% 97%`; `--foreground: 222 42% 9%` | `client/src/index.css` -> `:root` | Global theme token. Risky to change without full light-mode contrast pass. |
| Dark background/foreground | `--background: 222 42% 5%`; `--foreground: 220 18% 96%` | `client/src/index.css` -> `.dark` | Global dark token. |
| Primary brand color | light `352 86% 54%`; dark `352 92% 58%` | `client/src/index.css` -> `--primary`, `--vdjv-brand` | Duplicated into tier defaults as `#f21984` for PRO UI. |
| Success/neon green | `--vdjv-good: 77 100% 54%` | `client/src/index.css` -> `:root`, `.dark` | Used as standard success/save/accent color. |
| Warning/info colors | `--vdjv-warn: 38 95% 55/58%`; `--vdjv-info: 196 100% 46/50%` | `client/src/index.css` -> `:root`, `.dark` | Theme token only; some components still hardcode amber/blue classes. |
| Border radius token | `--radius: 0.75rem` | `client/src/index.css`; `tailwind.config.js` -> `borderRadius` | Tailwind `lg/md/sm` derive from this token. |
| Global font stack | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif` | `client/src/index.css` -> `html, body, #root` | Android WebView uses available system fonts. |
| Landing fallback font | `"Avenir Next", "SF Pro Display", "Segoe UI", sans-serif` | `client/src/index.css` -> `.lp-app-fallback` | Only the suspense/loading fallback. |
| Body transition | `background-color 160ms ease-out`, `color 160ms ease-out` | `client/src/index.css` -> `body` | Low-risk visual timing. |
| App background | Radial brand/info gradients over `hsl(var(--background))` | `client/src/index.css` -> `body`, `.vdjv-app-bg` | Performance variants override the background. |
| Safe area variables | `env(safe-area-inset-*, 0px)` | `client/src/index.css` -> `--vdjv-safe-*` | Critical for iOS PWA/Capacitor layout. |
| Bottom nav clearance | `calc(var(--vdjv-safe-bottom) + 7rem)` | `client/src/index.css` -> `--vdjv-bottom-nav-clearance` | Risky to reduce; SideMenu/Mixer depend on clearance. |
| Mobile dialog animation | Center scale/fade, `180ms cubic-bezier(0.16,1,0.3,1)` | `client/src/index.css` -> dialog keyframes/classes | Keep in sync with dialog portal behavior. |
| Tailwind dark mode | `class` strategy | `tailwind.config.js` -> `darkMode: ['class']` | Controlled by `document.documentElement.classList.toggle('dark')`. |
| Tailwind content scan | `client/index.html`, `client/src/**/*.{js,jsx,ts,tsx}` | `tailwind.config.js` -> `content` | Add new UI paths here if they move outside `client/src`. |
| Performance CSS classes | `perf-high`, `perf-medium`, `perf-low`, `perf-lowest` | `tailwind.config.js` plugin variants; `client/src/App.tsx` -> `root.classList.add` | Controlled by performance tier. |
| Admin tab page size | `10` | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `PAGE_SIZE` | Reused by multiple admin tables. |
| Admin home window options | `[1, 7, 14, 30, 90, 180, 365]` days | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `HOME_WINDOW_OPTIONS` | Dashboard date presets. |
| Mobile gesture guard edge zone | `28px` | `client/src/main.tsx` -> `setupGlobalGestureGuards` / `EDGE_ZONE_PX` | Prevents browser back-swipe conflicts. Risky to reduce on iOS. |
| Mobile swipe trigger | `14px`, horizontal must exceed vertical by `1.15x` | `client/src/main.tsx` -> `SWIPE_TRIGGER_PX` | Affects touch/drag behavior. |
| Double-tap zoom guard | `320ms` | `client/src/main.tsx` -> `DOUBLE_TAP_ZOOM_WINDOW_MS` | Allows double tap only on editable or explicit allowed targets. |
| Main app fallback text | `Loading VDJV` | `client/src/App.tsx` -> `AppFallback` | Placeholder/fallback text. |

## Build, Routing, Env, API

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Package name | `vdjv-sampler-pad` | `package.json` -> `name` | Build/package identity. |
| Package version | `0.1.6` | `package.json` -> `version` | Also used as fallback app version. |
| Vite app version fallback | `process.env.VITE_APP_VERSION || package.json.version` | `vite.config.js` -> `getAppVersion` | Build-time injected as `import.meta.env.VITE_APP_VERSION`. |
| Service worker cache name | `vdjv-shell-cache-${sanitizedAppVersion}` | `vite.config.js` -> `injectServiceWorkerVersion`; `client/public/sw.js` -> `CACHE_NAME` | Public source placeholder is `__VDJV_SHELL_CACHE__`; replaced during build. |
| Landing included by default | `true` for web; `false` for Electron/Capacitor unless overridden | `vite.config.js` -> `includeLanding` | `VITE_INCLUDE_LANDING=false` disables landing explicitly. |
| Required frontend env | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `vite.config.js` -> `requiredClientEnv`; `client/src/lib/supabase.ts` | Missing values throw at startup/build. |
| Local Supabase default URL | `http://127.0.0.1:54321` | `.env.example` -> `VITE_SUPABASE_URL` | Live `.env` values are intentionally not documented here. |
| Frontend Supabase anon key | Placeholder `your_local_anon_key_here` | `.env.example` -> `VITE_SUPABASE_ANON_KEY` | Secret/public anon value is environment-specific. |
| Remote Supabase in dev | `false` | `.env.example`; `client/src/lib/supabase.ts` -> `VITE_ALLOW_REMOTE_SUPABASE_IN_DEV` | Dev runtime blocks remote Supabase unless explicitly true. |
| Edge Functions base URL | `VITE_EDGE_FUNCTIONS_URL` or `${supabaseUrl}/functions/v1` | `client/src/lib/edge-api.ts` -> `edgeFunctionsBaseUrl` | Dev runtime also blocks remote Edge Functions unless explicitly allowed. |
| Client compatibility headers | `X-VDJV-Tier-Client: 1`, `X-VDJV-Promo-Client: 1`, `X-VDJV-App-Version` | `client/src/lib/supabase.ts`, `client/src/lib/edge-api.ts` | Important for old-build compatibility gates. |
| Router mode | `HashRouter` for `file:`; `BrowserRouter` otherwise | `client/src/App.tsx` -> `RouteContainer` | Electron packaged file URLs use hash routing. |
| Fallback route | Packaged/no landing -> sampler path; web landing -> landing path | `client/src/App.tsx` -> `fallbackPath` | Avoids dead routes in packaged app. |
| Web sampler path | `/vdjv` | `client/src/lib/runtime-routes.ts` -> `WEB_SAMPLER_APP_PATH` | Exact file not opened in this pass; value inferred from imports and route usage. Needs verification if changed. |
| Pricing route auth wrapper | `AuthProvider` wraps `/pricing` and `/pricing/checkout` | `client/src/App.tsx` -> `PricingRouteElement` | Prevents pricing/vdjv session conflict. |
| Product analytics host | `https://us.i.posthog.com` in example | `.env.example` -> `VITE_POSTHOG_HOST`; `client/src/lib/productAnalytics.ts` | Disabled unless key and host exist and runtime is not local/dev. |
| Product analytics defaults | `defaults: '2026-01-30'`, `autocapture: false`, `capture_pageview: false`, `disable_session_recording: true` | `client/src/lib/productAnalytics.ts` -> `initProductAnalytics` | Good privacy/performance defaults. |
| Legacy Express API | `ENABLE_LEGACY_EXPRESS_API=false` in example; runtime false unless env true | `.env.example`; `server/index.ts` -> `ENABLE_LEGACY_EXPRESS_API` | Keep disabled unless intentionally testing old routes. |
| Express port fallback | `3001` | `server/index.ts` -> `startServer(process.env.PORT || 3001)` | Used by dev/start scripts. |
| Chrome CDP helper port | `9223` | `scripts/start-chrome-cdp.cjs` -> `CDP_PORT` fallback | Testing helper only. |
| Chrome CDP helper URL | `http://127.0.0.1:4173/vdjv` | `scripts/start-chrome-cdp.cjs` -> `CDP_URL` fallback | Testing helper only. |
| Cleanup retry count | `3` retries, `100ms` delay | `scripts/cleanup-web-build-output.cjs` | Build cleanup only. |

## Sampler App User Defaults

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Settings storage key | `vdjv-sampler-settings` | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `SETTINGS_STORAGE_KEY` | Main persisted settings key. |
| Portrait pad size | `5` | `client/src/components/sampler/samplerAppConfig.ts` -> `DEFAULT_SAMPLER_APP_CONFIG.uiDefaults.defaultPadSizePortrait` | Clamp range `2..8`. |
| Landscape/desktop pad size | `10` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultPadSizeLandscape` | Clamp range `2..16`. Electron expects landscape behavior. |
| Mobile channel count | `2` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultChannelCountMobile` | Legacy/admin sampler default; tier deck limits now also control allowed values. |
| Desktop channel count | `4` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultChannelCountDesktop` | Legacy/admin sampler default; tier deck limits now also control allowed values. |
| Master volume | `1` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultMasterVolume` | Clamp range `0..1`; shortcuts change in `0.05` steps in `SamplerPadApp.tsx`. |
| Stop mode | `instant` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultStopMode` | Configurable stop timing excludes instant. |
| Stop timing overrides | `{}` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultStopTimingOverrides` | Actual timings come from platform-specific audio profile. |
| Side panel mode | `overlay` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultSidePanelMode` | Other allowed value is `reflow`. |
| Keyboard mapping enabled | `false` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultKeyboardMappingEnabled` | Feature may also be tier-gated. |
| Hide shortcut labels | `true` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultHideShortcutLabels` | Also initializes `keyboardMappingVisibilityInitialized`. |
| Auto pad/bank mapping | `true` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultAutoPadBankMapping` | First-run mapping behavior. |
| Graphics profile | `auto` | `client/src/components/sampler/samplerAppConfig.ts` -> `defaultGraphicsProfile` | Allowed values: `auto`, `lowest`, `low`, `medium`, `high`. |
| Default bank name/color | `Default Bank`, `#3b82f6` | `client/src/components/sampler/samplerAppConfig.ts` -> `bankDefaults` | Also seeded in `supabase/migrations/20260312150000_create_sampler_app_config.sql`. |
| Default pad trigger mode | `toggle` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultTriggerMode` | Other values include `hold`, `stutter`, `unmute`. |
| Default pad playback mode | `once` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultPlaybackMode` | Other values include `loop`, `stopper`, `bank_stopper`. |
| Default pad volume/gain | `volume: 1`, `gainDb: 0` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Gain clamp `-24..24`. |
| Default pad fades | `fadeInMs: 0`, `fadeOutMs: 0` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Clamp `0..60000ms`. |
| Default pitch/tempo | `pitch: 0`, `tempoPercent: 0` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults` | Pitch clamp `-12..12`; tempo normalization is in `audioPadNormalization`. |
| Default key lock | `true` | `client/src/components/sampler/samplerAppConfig.ts` -> `padDefaults.defaultKeyLock` | Affects pitch/tempo behavior. |
| Audio file size limit | `52,428,800 bytes` | `client/src/components/sampler/samplerAppConfig.ts`; `client/src/lib/audio-engine/types.ts` -> `DEFAULT_MAX_PAD_AUDIO_BYTES` | Comment says 50 MB. DB seed uses `52,428,800`. |
| Audio duration limit | `1,200,000ms` / 20 minutes | `client/src/components/sampler/samplerAppConfig.ts`; `client/src/lib/audio-engine/types.ts` -> `DEFAULT_MAX_PAD_AUDIO_DURATION_MS` | Clamp max `7,200,000ms`. |
| Default shortcuts | Space stop, M mixer, Z edit, X mute, B banks, `[` prev, `]` next, N upload, ArrowUp/Down volume, `=` pad size up, `-` pad size down, V import, C secondary, empty midiShift | `client/src/components/sampler/samplerAppConfig.ts` -> `DEFAULT_SHORTCUTS` | Shortcut strings are sliced to 40 chars when normalized. |
| Default settings booleans | `sideMenuOpen:false`, `mixerOpen:false`, `editMode:false`, `midiEnabled:false` | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `createDefaultSettings` | First-run settings state. |
| Deck layout default | `[]`, version from caller | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `createDefaultSettings` | `DECK_LAYOUT_SCHEMA_VERSION` referenced by app. |
| Mapping export version | `1` | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `MAPPING_EXPORT_VERSION` | Export/import compatibility. |
| Mapping export folder | `VDJV-Export` | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `EXPORT_FOLDER_NAME` | Android mapping fallback path. |
| Android download root | `/storage/emulated/0/Download` | `client/src/components/sampler/SamplerPadApp.shared.ts` -> `ANDROID_DOWNLOAD_ROOT` | Android-specific filesystem target. |
| Pad size min/max | min `2`, portrait max `8`, landscape max `16` | `client/src/components/sampler/SamplerPadApp.tsx` -> `PAD_SIZE_MIN`, `PAD_SIZE_MAX_*` | UI/layout sensitive. |
| Mixer overlay width | `384px`, max viewport ratio `0.95` | `client/src/components/sampler/SamplerPadApp.tsx` -> `MIXER_OVERLAY_WIDTH_PX`, `MIXER_OVERLAY_MAX_VIEWPORT_RATIO` | Affects SideMenu/Mixer overlay behavior. |
| Minimum visible pad columns during mixer | `2` | `client/src/components/sampler/SamplerPadApp.tsx` -> `MIN_VISIBLE_PAD_COLUMNS_FOR_MIXER_TAP` | Protects against accidental pad taps behind mixer. |
| Search result limit | `40` | `client/src/components/sampler/SamplerPadApp.tsx` -> `SEARCH_RESULT_LIMIT` | Local sampler search. |
| Search debounce/highlight clear | `120ms`, `1500ms` | `client/src/components/sampler/SamplerPadApp.tsx` -> `SEARCH_INPUT_DEBOUNCE_MS`, `SEARCH_HIGHLIGHT_CLEAR_MS` | UX timing. |
| Pad warmup defaults | max per bank `10`, total `20`, idle `120ms`, mobile max duration `120000ms`, unknown safe bytes `1500000`, unknown trim `12000ms` | `client/src/components/sampler/SamplerPadApp.tsx` -> `PAD_WARMUP_*` | Runtime profile may override/scales. Risky to increase on mobile. |
| Offline readiness storage version | `v1` | `client/src/components/sampler/SamplerPadApp.tsx` -> `OFFLINE_READINESS_STORAGE_VERSION` | Cached first-use offline preparation state. |
| Default bank source id | `vdjv-default-bank-source` | `client/src/components/sampler/SamplerPadApp.tsx`; `useSamplerStore.bankIdentity` imports | Important for protected/default bank identity. |

## Account Tiers, Feature Gates, Pricing UI

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Capability cache key | `vdjv-account-capabilities-v5` | `client/src/lib/account-capabilities.ts` -> `ACCOUNT_CAPABILITIES_CACHE_KEY` | Per-user local capability cache. |
| Capability version | `1` | `client/src/lib/account-capabilities.ts`; `supabase/functions/_shared/account-capabilities.ts` | Duplicated client/server. |
| Unknown tier fallback | `free` | `client/src/lib/account-capabilities.ts` -> `normalizeAccountTier` | Unknown DB value becomes FREE. |
| Admin capability fallback | PRO MAX capabilities | `client/src/lib/account-capabilities.ts` -> `fallbackCapabilitiesForProfile` | Admin role treated as full access. |
| Guest limits | owned banks `0`, pad cap `0`, device cap `1`, daily plays `10`, decks `1/1/1` | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.guest` | Guest can browse Store but cannot checkout/download/free claim by default. |
| FREE limits | owned banks `2`, pad cap `25`, device cap `4`, daily plays `50`, decks `1/1/1` | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.free` | Current code default. Legacy DB seed differs. |
| PRO limits | owned banks `6`, pad cap `64`, device cap `120`, daily plays `null`, decks min/default/max `1/2/4` | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.pro` | Current code default. |
| PRO MAX limits | owned banks `12`, pad cap `128`, device cap `150`, daily plays `null`, decks min/default/max `1/4/8` | `client/src/lib/account-capabilities.ts` -> `DEFAULT_ACCOUNT_CAPABILITIES.pro_max` | `bankStoreAllAccess` true. |
| Account limit clamps | owned `0..500`, pad cap `0..256`, device cap `1..1000`, daily plays `0..100000`, decks `1..8` | `client/src/lib/account-capabilities.ts` -> `normalizeAccountLimits` | Keep client/server in sync. |
| PRO feature set | Store browse/checkout/download/free claim, search, mappings, shortcuts, backup, advanced stop modes, hotcue, pad/bank edits, demo banks, unlimited own bank play | `client/src/lib/account-capabilities.ts` -> `proFeatures` | PRO MAX adds `bankStoreAllAccess`. |
| Guest/FREE disabled features | Checkout, downloads, free claim, all-access, search, mappings, shortcuts, backup, advanced stop modes, mixer hotcue, most edit gates | `client/src/lib/account-capabilities.ts` -> guest/free features override | Store browse and demo banks remain true. |
| Tier video fallback | `/assets/v1-preview.mp4` | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_VIDEO_SRC` | Used by V1 and installer tier UI unless admin uploads R2 video. |
| Tier color text contrast | luminance threshold `0.52`; dark text `#0f172a`; light text `#ffffff` | `client/src/lib/account-tier-content.ts` -> `getReadableTextColor` | Important for admin-set light tier colors. |
| Tier accent fallback | `rgba(242,25,132,0.35)` | `client/src/lib/account-tier-content.ts` -> `accentRgb` fallback | Hardcoded PRO pink fallback. |
| FREE tier UI | color `#64748b`, no header/badge, meter `33`, Locked Features | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.free` | Checklist includes 50 plays/day and 2 own banks. |
| PRO tier UI | color `#f21984`, header `Most popular`, badge `VDJV 2.0`, meter `66` | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.pro` | Duplicates brand pink. |
| PRO MAX tier UI | color `#2155ff`, header `Best value`, badge `VDJV 2.0`, meter `100` | `client/src/lib/account-tier-content.ts` -> `DEFAULT_TIER_UI_CONTENT.pro_max` | Inclusion badge values include `12` and `150`. |
| Installer STANDARD UI | color `#f59e0b`, badge `VDJV`, meter `48` | `client/src/lib/account-tier-content.ts` -> `DEFAULT_INSTALLER_TIER_UI_CONTENT.standard` | V2/V3 pricing default. |
| Installer PRO UI | color `#f21984`, header `Flexible`, badge `VDJV`, meter `66` | `client/src/lib/account-tier-content.ts` -> `DEFAULT_INSTALLER_TIER_UI_CONTENT.pro` | Includes Standard + Update / Update Only copy. |
| Tier UI row normalization | text rows, details, inclusions sliced to 12 rows | `client/src/lib/account-tier-content.ts` -> `normalizeTextRows`, `normalizeDetailRows`, `normalizeInclusionRows` | Prevents runaway admin content. |
| Upgrade promo discount default | `30` percent | `supabase/functions/store-api/index.ts` -> `normalizePromoDiscountPercent`; `AccountUpgradeDialog.tsx` constant observed by scan | Clamp `0..90`. |
| Upgrade receipt prefix | `VDJV-UPGRADE-YYYYMMDD-XXXXXXXXXX` | `supabase/functions/store-api/index.ts` -> `buildUpgradeReceiptReference` | Receipt format default. |
| Profile tier default | `account_tier: free`, `tier_source: signup` | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Legacy migration promoted old signups to PRO/PRO MAX. |
| Account upgrade request status | `pending` | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_upgrade_requests.status` | Current pending-review flow depends on this. |
| Voucher campaign max codes | default `1`, max `10000` | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_voucher_campaigns.max_codes` | Admin voucher guardrail. |
| Voucher status default | `reserved` | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` -> `account_vouchers.status` | Other states: redeemed, disabled, expired. |

## Audio, Playback, Performance

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Audio engine v3 enabled | `false` | `client/src/lib/audio-engine/types.ts` -> `DEFAULT_ENGINE_CONFIG.audioEngineV3Enabled` | Needs verification if runtime toggles elsewhere. |
| Stop modes | `instant`, `fadeout`, `brake`, `backspin`, `filter` | `client/src/lib/audio-engine/types.ts` -> `STOP_TIMING_MODES` | Instant is not configurable in settings. |
| Configurable stop modes | `fadeout`, `brake`, `backspin`, `filter` | `client/src/lib/audio-engine/types.ts` -> `CONFIGURABLE_STOP_TIMING_MODES` | Instant excluded by design. |
| Stop timing ranges | instant `10..40ms`, fadeout `250..3000ms`, brake `450..3000ms`, backspin `350..2200ms`, filter `400..3000ms` | `client/src/lib/audio-engine/types.ts` -> `STOP_TIMING_RANGES`; duplicated in `supabase/functions/_shared/sampler-app-config.ts` | Keep client/server ranges synced. |
| iOS stop profile | instant fade `0.014s`, finalize `18ms`, fadeout `900ms`, brake `1350ms`, backspin total `900ms`, filter `1.2s` | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` iOS branch | Audio-artifact sensitive. |
| Android stop profile | instant fade `0.02s`, finalize `24ms`, fadeout `800ms`, brake `1200ms`, backspin total `780ms`, filter `1.1s` | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` Android branch | Audio-artifact sensitive. |
| Desktop stop profile | instant fade `0.012s`, finalize `14ms`, fadeout `900ms`, brake `1400ms`, backspin total `950ms`, filter `1.35s` | `client/src/lib/audio-engine/types.ts` -> `getStopTimingProfile` default branch | Audio-artifact sensitive. |
| iOS media backend thresholds | duration `240000ms`, size `15728640 bytes` | `client/src/lib/audio-engine/types.ts` -> `IOS_MEDIA_*` | Routes long/large audio away from buffers. |
| Audio buffer memory caps | iOS `50MB`, Android `64MB`, native Capacitor `72MB`, low-memory web `96MB`, desktop `160MB` | `client/src/lib/audio-engine/types.ts` -> `*_MAX_BUFFER_MEMORY` | Risky to increase on iOS/Android. |
| Max audio elements | `800` | `client/src/lib/audio-engine/types.ts` -> `MAX_AUDIO_ELEMENTS` | Chrome safety margin. |
| Max iOS buffer sources | `32` | `client/src/lib/audio-engine/types.ts` -> `MAX_IOS_BUFFER_SOURCES` | iOS stability limit. |
| Max playback channels | `8` | `client/src/lib/audio-engine/types.ts` -> `MAX_PLAYBACK_CHANNELS` | Tier dropdown should not exceed this. |
| Playback notification throttle | iOS `100ms`, Android `50ms`, desktop `16ms` | `client/src/lib/audio-engine/types.ts` -> `NOTIFICATION_THROTTLE_MS` | Runtime-sensitive. |
| Import concurrency | native `1`, native Android `2`, web `4`, iOS web `1` | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `*_IMPORT_CONCURRENCY` | iOS low-memory safety. |
| Import batch flush | default `12` files or `48MB`; iOS `1` file or `8MB` | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `IMPORT_BATCH_FLUSH_*` | Large-bank import stability. |
| iOS conservative import size | `250MB` | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `IOS_CONSERVATIVE_IMPORT_BYTES` | Matches Store large-download threshold. |
| Prepared audio policy | version `1` | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_AUDIO_POLICY_VERSION` | Prepared playback compatibility. |
| Prepared short hot pad | max `12000ms` or `1500000 bytes` | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_SHORT_HOT_*` | Runtime prewarm classification. |
| Prepared long heavy pad | min `90000ms` or `12MB` | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_LONG_HEAVY_*` | Runtime prewarm/dehydrate classification. |
| Prepared heavy resume idle | `5000ms` | `client/src/components/sampler/hooks/preparedAudio.ts` -> `PREPARED_HEAVY_RESUME_IDLE_MS` | Audio resume timing. |
| Performance tier fallback hardware | mobile cores/memory `2/2GB`; desktop `4/4GB` | `client/src/lib/performance-monitor.ts` -> `detectCapabilities` | Used when browser APIs are missing. |
| Performance tier default floor | Auto never below `low` | `client/src/lib/performance-monitor.ts` -> `evaluateInitialTier` | Manual override can be `lowest`. |
| Native mobile high guard | Native/mobile returns `medium` unless strong specs | `client/src/lib/performance-monitor.ts` -> `evaluateInitialTier` | Protects Android/iOS performance. |
| Runtime desktop warmup | max per bank `14`, total `36`, idle `60ms`, no max duration | `client/src/lib/sampler-runtime-profile.ts` -> `DEFAULT_DESKTOP_WARMUP` | Electron may override from memory profile. |
| Runtime mobile low/medium/high | Android/mobile web max total `5/6/8`; iOS web max total `2/3/4`; iOS Capacitor `4/5/6` | `client/src/lib/sampler-runtime-profile.ts` -> `MOBILE_RUNTIME_PROFILES` | Summarized because each profile also defines restore/hydration/retention limits. |
| Runtime desktop web restore/hydration | startup restore `1200`, background hydration `480` | `client/src/lib/sampler-runtime-profile.ts` -> `getSamplerRuntimeTuningProfile` desktop_web | Large values are desktop-only. |
| Runtime Electron fallback restore/hydration | startup restore `900`, background hydration `320` | `client/src/lib/sampler-runtime-profile.ts` -> Electron fallback profile | Used when preload memory info unavailable. |

## Store, Download, Import, Cache, Offline

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Bank Store page size | `12` | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `STORE_PAGE_SIZE` | User-facing pagination. |
| Download proof max size | `10MB` | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `ACCOUNT_PROOF_MAX_BYTES` | Same order as server account proof max. |
| Proof image extensions | `png`, `jpg`, `jpeg`, `webp`, `gif`, `heic`, `heif` | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `ACCOUNT_PROOF_ALLOWED_EXTENSIONS` | Client validation. |
| Banner rotation clamp | `3000..15000ms` | `client/src/components/sampler/OnlineBankStoreDialog.tsx` -> `normalizeBannerRotationMs`; `supabase/functions/store-api/index.ts` -> `STORE_BANNER_ROTATION_*` | Default is `5000ms`. |
| Store snapshot version | `8` | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_SNAPSHOT_VERSION` | Local offline Store snapshot schema. |
| Store snapshot freshness | `30 minutes` | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_SNAPSHOT_FRESH_TTL_MS` | Offline fallback can still display stale data. |
| Store view memory cache cooldown | `2 minutes` | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_VIEW_FETCH_COOLDOWN_MS` | Reduces repeated catalog fetches. |
| Store payment config cache cooldown | `15 minutes` | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `STORE_PAYMENT_CONFIG_FETCH_COOLDOWN_MS` | Admin payment changes may take up to this unless refreshed. |
| Downloaded Store sort page size | `200` | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `requestPerPage` for `storeSort === 'downloaded'` | One-page downloaded view. |
| Store next-page thumbnail preload | `3` thumbnails | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts` -> `preloadStoreThumbnails` default | Text/items are cached before thumbnails. |
| Large Store download warning | `250MB` | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `LARGE_WEB_STORE_DOWNLOAD_WARNING_BYTES` | iOS requires low-memory variant at/above this when missing. |
| iOS Store download concurrency | `1` | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `IOS_WEB_STORE_DOWNLOAD_CONCURRENCY_LIMIT` | Prevents iOS PWA memory crashes. |
| Default Store download concurrency | `3` | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `DEFAULT_STORE_DOWNLOAD_CONCURRENCY_LIMIT` | Desktop/Android/web cap. |
| iOS low-memory block | iOS web + large download + no low-memory variant -> block | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` -> `requiresIOSLowMemoryVariant` | Public-release safety rule. |
| Store debug max entries | `250` | `client/src/components/sampler/onlineStore.types.ts` -> `STORE_DOWNLOAD_DEBUG_MAX_ENTRIES` | Needs verification from file if changed after scan. |
| Store live/recovered debug keys | `vdjv-store-download-live-v1`, `vdjv-store-download-recovered-v1` | `client/src/components/sampler/hooks/useOnlineStoreDebugLog.ts` | Recovered report max age is `24h` from prior scan; Needs verification. |
| Guest Store preview cache | `vdjv-guest-store-preview-banks-v2`, limit `10` | `client/src/components/sampler/hooks/useGuestStorePreviewBanks.ts` | Needs verification from file if changed after scan. |
| Store recovery catalog TTL | `5 minutes` | `client/src/components/sampler/hooks/useSamplerStore.storeRecovery.ts` -> `STORE_RECOVERY_CATALOG_TTL_MS` | Recovery fallback cache. |
| Store recovery scan | `perPage 200`, `maxPages 25` | `client/src/components/sampler/hooks/useSamplerStore.storeRecovery.ts` | Upper scan of 5000 catalog rows. |
| Storage headroom | min free `200MB`, unknown operation `450MB`, unknown import `3GB` | `client/src/components/sampler/hooks/useSamplerStore.storageHeadroom.ts` | Needs verification from file if changed after scan. |
| Low-memory variant split | threshold `250MB`, target part `120MB` | `client/src/components/sampler/hooks/useSamplerStore.updateStoreBank.ts` | Admin export/update behavior. Needs verification from file if changed after scan. |
| Native export folder | `VDJV-Export`; media root `VDJV-Export/_media`; logs `VDJV-Export/logs` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Export/import filesystem conventions. |
| Capacitor export write chunks | single write `24MB`, chunk `2MB` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Bridge stability. Needs verification from file if changed after scan. |
| Backup format | version `3`, extension `.vdjvbackup`, part `.vdjvpart`, manifest schema `vdjv-backup-manifest-v1`, manifest version `1` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Backup compatibility. |
| Native bank export cap | `700MB` | `client/src/components/sampler/hooks/useSamplerStore.ts` -> `MAX_NATIVE_BANK_EXPORT_BYTES` | Needs verification from line if changed after scan. |
| Native app backup cap | `1700MB` | `client/src/components/sampler/hooks/useSamplerStore.ts` -> `MAX_NATIVE_APP_BACKUP_BYTES` | Needs verification from line if changed after scan. |
| Backup part sizes | mobile `64MB`, desktop `256MB`, max parts `200` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Backup restore compatibility. |
| Native audio/image bridge write caps | audio `8MB`, image `4MB`, bridge read `6MB` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Native bridge stability. |
| Selected bank hydration retries | `3` | `client/src/components/sampler/hooks/useSamplerStore.ts` constant | Startup recovery. |
| Sampler local storage keys | `vdjv-sampler-banks`, `vdjv-sampler-state`, `vdjv-default-bank-by-owner`, `vdjv-last-open-bank`, `vdjv-default-bank-image-prefs` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants and imported helpers | Main offline/local data keys. |
| IndexedDB JSON fallback paths | `state/sampler-banks-fallback.json`, `state/sampler-ui-fallback.json` | `client/src/components/sampler/hooks/useSamplerStore.ts` constants | Fallback when localStorage is too small. |
| Offline module warmup batch | `3` modules per batch, idle timeout `180ms` | `client/src/lib/offline-readiness.ts` -> `OFFLINE_READINESS_*` | Loads essential dialogs/features after first offline use. |
| Offline warmup modules | settings, login, upgrade, pad edit/transfer, bank edit, side menu, mixer, app dialogs, bank store, duplication, export/import, backup | `client/src/lib/offline-readiness.ts` -> `entries` | App shell still requires modules to be warmed for offline dialogs. |
| Service worker app shell | `/`, `/index.html`, `/ios/`, `/android/`, `/site.webmanifest`, logo/icons | `client/public/sw.js` -> `APP_SHELL_URLS` | API/auth requests stay network-only. |
| Service worker API offline response | `Offline`, HTTP `503` | `client/public/sw.js` -> fetch handler | Prevents fake success for network-required actions. |
| Service worker strategy | navigation network-first; static assets stale-while-revalidate | `client/public/sw.js` -> `networkFirstNavigation`, `staleWhileRevalidate` | Existing cache is deleted when cache name changes. |
| Chunk recovery key | `vdjv-chunk-recovery-attempted` | `client/src/lib/chunk-load-recovery.ts` -> `CHUNK_RECOVERY_STORAGE_KEY` | One recovery attempt per session. |
| Chunk reload query | `_vdjv_chunk_reload=${Date.now()}` | `client/src/lib/chunk-load-recovery.ts` -> `getReloadUrl` | Used after stale chunk failure. |
| Guest default bank trial | `10` plays | `client/src/lib/guest-default-bank-trial.ts` -> `GUEST_DEFAULT_BANK_TRIAL_LIMIT` | Stored in local/shadow keys and Electron file. |
| Guest trial storage keys | `vdjv-guest-default-bank-trial-v1`, `vdjv-guest-default-bank-trial-shadow-v1` | `client/src/lib/guest-default-bank-trial.ts` | Shadow key prevents simple accidental loss. |
| Default bank daily allowance key | `vdjv-default-bank-play-allowance-v1:${tier}:${userId}` | `client/src/lib/account-default-bank-play-allowance.ts` | Resets at local midnight. |
| Default bank allowance max | `100000` plays/day | `client/src/lib/account-default-bank-play-allowance.ts` -> `normalizeLimit` | Also matches capability clamp. |
| Clock rollback guard | `5 minutes` | `client/src/lib/account-default-bank-play-allowance.ts` -> `clockMovedBack` | Prevents reset if clock moved backward. |

## Auth, Session, Security, Notifications

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Cached user key | `vdjv-cached-user` | `client/src/hooks/useAuth.ts` -> `USER_CACHE_KEY` | Enables trusted offline access. |
| Cached profile key | `vdjv-cached-profile` | `client/src/hooks/useAuth.ts` -> `PROFILE_CACHE_KEY` | Used by sampler session fallback. |
| Cached ban key | `vdjv-cached-ban` | `client/src/hooks/useAuth.ts` -> `BAN_CACHE_KEY` | `1` or `true` means banned. |
| Offline signout pending key | `vdjv-offline-signout-pending` | `client/src/hooks/useAuth.ts` -> `OFFLINE_SIGNOUT_PENDING_KEY` | Offline signout sync. |
| Session conflict keys | `vdjv-session-conflict-reason`, `vdjv-session-conflict-details`, `vdjv-session-enforcement-event` | `client/src/hooks/useAuth.ts` | Cross-tab/session conflict handling. |
| Protected banks hide key | `vdjv-hide-protected-banks` | `client/src/hooks/useAuth.ts`; `useSamplerStore.ts` | Session conflict/security behavior. |
| Password recovery mode key | `vdjv-password-recovery-mode` | `client/src/hooks/useAuth.ts` -> `PASSWORD_RECOVERY_MODE_KEY` | sessionStorage only. |
| Google OAuth pending key | `vdjv-google-oauth-login-pending` | `client/src/hooks/useAuth.ts` -> `GOOGLE_OAUTH_LOGIN_PENDING_KEY` | sessionStorage only. |
| Google OAuth pending max age | `10 minutes` | `client/src/hooks/useAuth.ts` -> `GOOGLE_OAUTH_LOGIN_PENDING_MAX_AGE_MS` | Loading overlay should clear after this window. |
| Auth heartbeat interval | `5 minutes` | `client/src/hooks/useAuth.ts` -> `AUTH_HEARTBEAT_INTERVAL_MS` | Used for activity/session validity. |
| Capacitor auth redirect | `com.powerworkout.vdjv://auth/callback` | `client/src/hooks/useAuth.ts` -> `DEFAULT_CAPACITOR_AUTH_REDIRECT_URL`; `capacitor.config.ts` -> `appId` | Can be overridden by `VITE_CAPACITOR_AUTH_REDIRECT_URL`. |
| Profile select fields | id, role, display_name, tier fields, quota caps, welcome email sent | `client/src/hooks/useAuth.ts` -> `PROFILE_SELECT` | Add fields here if profile-dependent UI needs them. |
| Offline session modes | `guest_locked`, `trusted_offline`, `authenticated` | `client/src/components/sampler/hooks/useSamplerStore.session.ts` -> `SamplerAuthSessionMode` | Trusted offline requires cached user and offlineTrustedSession true. |
| Sampler quota legacy fallback | owned `6`, pad cap `64`, device cap `120` | `client/src/components/sampler/hooks/useSamplerStore.session.ts` -> `DEFAULT_*` | Used if capability/profile value missing. |
| Auth client compatibility marker | POST `store-api/account/auth-compatibility/start` | `client/src/lib/edge-api.ts` -> `markAuthClientCompatibility` | Fails with update message for incompatible old client. |
| Activity event rate limit | `120/600s` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_EVENT_RATE_LIMIT` | Edge Function default. |
| Activity heartbeat rate limit | `40/600s` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_HEARTBEAT_RATE_LIMIT` | Edge Function default. |
| Session check rate limit | `30/600s` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CHECK_RATE_LIMIT` | Edge Function default. |
| Session claim rate limit | `24/600s` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CLAIM_RATE_LIMIT` | Edge Function default. |
| Session claim stale window | `6 minutes` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SESSION_CLAIM_STALE_MS` | Allows claiming stale sessions. |
| Signout rate limit | `15/600s` | `supabase/functions/activity-api/index.ts` -> `ACTIVITY_SIGNOUT_RATE_LIMIT` | Edge Function default. |
| Attendance date timezone | `Asia/Manila` | `supabase/migrations/20260527094833_user_daily_attendance.sql` -> `record_user_daily_attendance` | Daily attendance count is Manila-date based. |
| Attendance heartbeat default | `p_increment_heartbeat: true` | `supabase/migrations/20260527094833_user_daily_attendance.sql` | Heartbeats increment daily count. |
| App notice event | `vdjv-app-notice` | `client/src/lib/app-notices.ts` -> `APP_NOTICE_EVENT` | Shared in-app notification event. |
| App notice dedupe | `2500ms` | `client/src/lib/app-notices.ts` -> `DEFAULT_DEDUPE_MS` | Prevents repeated duplicate notices. |
| Discord webhook HTTP timeout | min `1000ms`, default `5000ms` | `supabase/functions/_shared/discord.ts` -> `WEBHOOK_HTTP_TIMEOUT_MS` | Monitoring only. |
| Discord geo lookup timeout | min `500ms`, default `2500ms` | `supabase/functions/_shared/discord.ts` -> `GEO_LOOKUP_TIMEOUT_MS` | Monitoring only. |
| Rate-limit fallback max keys | `5000` | `supabase/functions/_shared/rate-limit.ts` -> `FALLBACK_BUCKET_MAX_KEYS` | In-memory fallback when RPC unavailable. |
| CORS allow headers/methods | `authorization, x-client-info, apikey, content-type`; `GET,POST,PATCH,DELETE,OPTIONS` | `supabase/functions/_shared/http.ts` | Origins from `APP_ALLOWED_ORIGINS` or `ALLOWED_ORIGINS`; if unset, production fallback is limited to VDJV domains plus native localhost origins. |

## Admin, Payments, Banners, Promotions

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Admin active sort key | `vdjv-admin-active-sort` | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `ACTIVE_SORT_STORAGE_KEY` | Persists Active tab sorting. |
| Assisted user min password | `8` | `client/src/components/sampler/AdminAccessDialog.shared.ts` -> `ACCOUNT_ASSISTED_MIN_PASSWORD` | Generated password format `Assist!${seed}9`. |
| Store config empty defaults | blank instructions/payment fields, banner rotation `5000`, maintenance false, all auto-approve false | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_CONFIG` | Admin form fallback. |
| Auto-approval mode defaults | mode `schedule`, start `0`, end `0`, duration `24`, expires `null` | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_CONFIG` | Account, Store, Installer V2, Installer V3. |
| Store maintenance message | `Bank Store is under maintenance. Downloads and browsing are temporarily unavailable.` | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `DEFAULT_STORE_MAINTENANCE_MESSAGE` | Used if enabling maintenance with blank message. |
| Store promotion form defaults | type `flash_sale`, discount `percent`, value `10`, timezone `Asia/Manila`, priority `100`, active true, audience `all`, new-user window `168h` | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `EMPTY_STORE_PROMOTION_FORM` | UI create form. |
| Banner create defaults | sort order `0`, schedule `always`, timezone `Asia/Manila`, inactive view false | `client/src/components/sampler/AdminAccessDialog.store.ts` -> state defaults | Admin Banners tab. |
| Banner schedule mode | `always` fallback, otherwise `scheduled` | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `normalizeBannerScheduleMode`; `supabase/migrations/20260604145000_store_banner_schedule_and_updates.sql` | `always` means permanent banner. |
| Banner status fallback | inactive if disabled; permanent for always; scheduled/expired/active by time window | `client/src/components/sampler/AdminAccessDialog.store.ts` -> `normalizeBannerStatus` | Time-window status derived client-side. |
| Store promotion DB defaults | `promotion_type: standard`, timezone `Asia/Manila`, priority `100`, active true, audience `all` | `supabase/migrations/20260311193000_store_promotions.sql`; `20260328160000_store_promotion_audiences.sql` | UI defaults differ: create form uses `flash_sale`. |
| Promotion discount types | `percent`, `fixed`, `free` | `supabase/migrations/20260415143000_store_promotions_free_claim.sql` | Free requires `discount_value = 0`. |
| New user window range | `1..8760` hours or null | `supabase/migrations/20260328160000_store_promotion_audiences.sql` | UI default is `168`. |
| Store payment email subject approved | `Payment Approved - {{receipt_reference}}` | `supabase/migrations/20260227143000_store_email_template_defaults.sql` | Template default only fills blank DB values. |
| Store payment email subject rejected | `Payment Update - {{receipt_reference}}` | `supabase/migrations/20260227143000_store_email_template_defaults.sql` | Template default only fills blank DB values. |
| Payment channels | `image_proof`, `gcash_manual`, `maya_manual` | `server/index.ts` -> `PAYMENT_CHANNEL_VALUES`; `supabase/functions/store-api/index.ts` -> `PAYMENT_CHANNEL_VALUES` | Upgrade requests also allow `voucher` in migration. |
| Store purchase pending limit | `5` pending requests | `supabase/functions/store-api/index.ts` -> `STORE_PENDING_PURCHASE_REQUEST_LIMIT`; `server/index.ts` legacy same env name | Spam protection. |
| Store max purchase items | `20` | `supabase/functions/store-api/index.ts` -> `STORE_MAX_PURCHASE_ITEMS`; `server/index.ts` legacy same env name | Cart/purchase limit. |
| Store purchase rate limit | `12/3600s` | `supabase/functions/store-api/index.ts` -> `STORE_PURCHASE_RATE_LIMIT`; `server/index.ts` legacy same default | Public endpoint. |
| Store download rate limit | `20/3600s` | `supabase/functions/store-api/index.ts` -> `STORE_DOWNLOAD_RATE_LIMIT`; `server/index.ts` legacy same default | Public endpoint. |
| Store max web download bytes | `478150656` bytes / 456 MB | `supabase/functions/store-api/index.ts` -> `STORE_MAX_DOWNLOAD_BYTES` | Legacy Express default is `268435456`; duplicated mismatch. |
| Store max native download bytes | `2GB - 1` | `supabase/functions/store-api/index.ts` -> `STORE_MAX_NATIVE_DOWNLOAD_BYTES` | Native-capable archive handling. |
| Store managed asset max | `25MB` | `supabase/functions/store-api/index.ts` -> `STORE_MANAGED_ASSET_MAX_BYTES` | QR/banner/thumbnail assets. |
| Store marketing banner max active | `12` | `supabase/functions/store-api/index.ts` -> `STORE_MARKETING_BANNER_MAX_ACTIVE` | Admin guardrail. |
| R2 signed download TTL | default `300s`, clamped `60..3600s` | `supabase/functions/store-api/index.ts`; `supabase/functions/_shared/r2-storage.ts` -> `createPresignedGetUrl` | Used for Store/default bank downloads. |
| R2 upload URL TTL | default `900s`, clamped `60..3600s` | `supabase/functions/admin-api/index.ts`; `supabase/functions/_shared/r2-storage.ts` -> `createPresignedPutUrl` | Direct uploads. |
| Store release cache | TTL `300s`, max entries `200` | `supabase/functions/store-api/index.ts` -> `STORE_RELEASE_CACHE_*` | Android/GitHub release cache. |
| Store receipt link TTL | default `3600s`, clamped `300..604800s` | `supabase/functions/store-api/index.ts` -> `STORE_EMAIL_RECEIPT_LINK_TTL_SECONDS` | Email receipt links. |
| Account registration rate limit | submit `8/3600s`, upload `12/3600s`, login hint `30/3600s` | `supabase/functions/store-api/index.ts` -> `ACCOUNT_REG_*` | Registration/checkout protection. |
| Account proof max | `10MB` | `supabase/functions/store-api/index.ts` -> `ACCOUNT_REG_MAX_PROOF_BYTES` | Server validation. |
| OCR endpoint/timeout | `https://api.ocr.space/parse/image`, timeout `12000ms` | `supabase/functions/store-api/index.ts` -> `OCR_SPACE_API_URL`, `RECEIPT_OCR_TIMEOUT_MS` | OCR should be disabled by config when not desired. |
| OCR rate limit | `40/3600s` | `supabase/functions/store-api/index.ts` -> `RECEIPT_OCR_RATE_LIMIT` | API-cost sensitive. |
| Crash report rate/max | `12/86400s`, max support log `256KB` | `supabase/functions/store-api/index.ts` -> `CLIENT_CRASH_REPORT_*` | Public report endpoint. |
| Admin publish rate limit | `30/3600s` | `supabase/functions/admin-api/index.ts` -> `ADMIN_STORE_PUBLISH_RATE_LIMIT` | Store/default-bank publish actions. |
| Admin export token rate limit | `120/3600s` | `supabase/functions/admin-api/index.ts` -> `ADMIN_EXPORT_SIGN_TOKEN_RATE_LIMIT` | Admin export signing. |
| Admin dashboard caps | series `5000`, active session scan `2000`, max window days `730` | `supabase/functions/admin-api/index.ts` -> `DASHBOARD_*` | Dashboard performance guardrails. |
| Admin asset max size | `2GB - 1` | `supabase/functions/admin-api/index.ts` -> `R2_MAX_ASSET_BYTES` | R2 asset upload guardrail. |
| Tier video max size | `512MB` | `supabase/functions/admin-api/index.ts` -> `ACCOUNT_TIER_VIDEO_MAX_BYTES` | Admin tier video upload. |

## Landing, Pricing, Downloads, Legal

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Landing versions | `V1`, `V2`, `V3` | `client/src/components/landing/download-config.ts` -> `VERSION_OPTIONS` | Pricing/version selector depends on this. |
| Landing platforms | `android`, `ios`, `windows`, `macos` | `client/src/components/landing/download-config.ts` -> `PLATFORM_OPTIONS` | Download target options. |
| Landing social options | `facebook`, `instagram`, `youtube` | `client/src/components/landing/download-config.ts` -> `SOCIAL_OPTIONS` | Footer/admin social links. |
| V1 Android download | GitHub latest release URL | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.android` | Current source default points to GitHub latest release. |
| V1 iOS download | `/ios/` | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.ios` | Add-to-home-screen guide route. |
| V1 Windows/macOS download | Messenger link | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V1.windows/macos` | Needs verification if public release should offer EXE directly. |
| V2/V3 iOS download | VirtualDJ Remote App Store URL | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS.V2/V3.ios` | External app dependency. |
| V2/V3 other download links | Messenger link for Android/Windows/macOS | `client/src/components/landing/download-config.ts` -> `DEFAULT_DOWNLOAD_LINKS` | Admin can override via landing config. |
| Landing version descriptions | Filipino V1/V2/V3 descriptions | `client/src/components/landing/download-config.ts` -> `DEFAULT_VERSION_DESCRIPTIONS` | Copy defaults; not repeated here in full to keep this reference compact. |
| Landing buy sections | V1 image `/assets/logo.png`, V2/V3 Messenger installer link | `client/src/components/landing/download-config.ts` -> `DEFAULT_BUY_SECTIONS` | DB seed may differ from current source. |
| Landing socials | Facebook, Instagram, YouTube VDJV links | `client/src/components/landing/download-config.ts` -> `DEFAULT_SOCIAL_LINKS` | Admin editable. |
| Install guide canonical paths | `/ios/`, `/android/` | `client/src/components/landing/download-config.ts` -> `canonicalizeInstallGuideLink` | Normalizes `/ios` and `/android`. |
| Landing DB default row id | `default` | `supabase/migrations/20260311143000_create_landing_download_config.sql` | Seed values are legacy domain/mediafire defaults and may not match current source defaults. |
| Landing DB JSON defaults | `{}` for links/descriptions/socials when columns empty | `supabase/migrations/20260311143000_create_landing_download_config.sql`; `20260423133000_landing_page_social_links.sql` | Runtime normalizer falls back to client defaults. |
| Legal document sections | `[]` | `supabase/migrations/20260423120000_legal_documents.sql` -> `sections default '[]'` | Draft/published docs stored in DB; fallback legal content lives in `_shared/legal-content.ts`. |

## Electron, Android Capacitor, Platform Update Defaults

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Capacitor app id/name | `com.powerworkout.vdjv`, `VDJV Sampler Pad` | `capacitor.config.ts` | Must match OAuth redirect scheme expectations. |
| Capacitor web dir | `dist/public` | `capacitor.config.ts` | Build output copied into native app. |
| Android namespace/applicationId | `com.powerworkout.vdjv` | `android/app/build.gradle` | Native app identity. |
| Android SDKs | min `22`, compile `35`, target `35` | `android/variables.gradle` | Release compatibility. |
| Android release version fallback | `versionCode 1`, `versionName 1.0` | `android/app/build.gradle` -> `releaseVersionCode`, `releaseVersionName` | Build script normally injects package version/code. |
| Android build script version fallback | `ANDROID_RELEASE_VERSION_NAME` and `VITE_APP_VERSION` default to `package.json.version` | `scripts/build-android-release.cjs` | Actual computed versionCode needs verification from script function. |
| Android release signing | unsigned unless keystore env/properties exist | `android/app/build.gradle` -> `hasReleaseSigning` | Public release requires signed outputs. |
| Android sideload update API | `https://api.github.com` | `.env.example`; `client/src/lib/android-sideload-update.ts` -> `DEFAULT_GITHUB_API_BASE_URL` | Native Android release checker. |
| Android release owner/repo | `vdjvsamplerpad` / `vdjvsamplerpad.github.io` | `.env.example`; `client/src/lib/android-sideload-update.ts` | GitHub Releases source. |
| Android APK prefix | `VDJV-Sampler-Pad-` | `.env.example`; `client/src/lib/android-sideload-update.ts` -> `preferredPrefix` | First matching APK asset is preferred. |
| Electron auth scheme | `com.powerworkout.vdjv://auth/callback` | `electron/main.cjs` -> `AUTH_CALLBACK_*` | Same scheme as Capacitor redirect. |
| Electron portable marker files | `vdjv-portable-data.flag`, `.vdjv-portable-data`, `portable-data.flag` | `electron/main.cjs` -> `PORTABLE_DATA_MARKER_FILES` | Enables portable data root. |
| Electron portable data folder | `VDJV Data/userData`, `sessionData`, `crashDumps`, `logs` beside executable | `electron/main.cjs` -> `configurePortableDataPaths` | Portable mode only. |
| Electron encryption parameters | magic `VDJVENC2`, version `1`, salt `16`, IV `12`, verifier `16`, PBKDF2 `120000` | `electron/main.cjs` constants | Backup/archive compatibility. Risky to change. |
| Electron media root | `media` | `electron/main.cjs` -> `ELECTRON_MEDIA_ROOT_FOLDER` | Local media storage. |
| Electron import archive caps | entries `2000`, total uncompressed `2GB`, entry `512MB` | `electron/main.cjs` -> `MAX_IMPORT_ARCHIVE_*` | Zip bomb protection. |
| Electron window min/default/max | min `1100x700`, default `1200x800`, max `5000x4000` | `electron/main.cjs` -> `MIN_WINDOW_STATE`, `DEFAULT_WINDOW_STATE`, `MAX_WINDOW_STATE` | Window state persisted in `window-state.json`. |
| Electron save dialog fallback | filename `download.bin`, default directory Downloads | `electron/main.cjs` -> `sanitizeSuggestedFileName`, `saveFileElectron` | File exports. |
| Electron update channel | `latest` | `electron/auto-updater.cjs` -> `DEFAULT_UPDATE_CHANNEL` | Can be overridden by env or `auto-update.json`. |
| Electron update check interval | `6 hours` | `electron/auto-updater.cjs` -> `CHECK_INTERVAL_MS` | Plus startup check after `15000ms`. |
| Electron update install close timeout | destroy window after `1800ms`, then `quitAndInstall` after `250ms` | `electron/auto-updater.cjs` -> `installDownloadedUpdate` | Installer close behavior. |
| Electron build artifact names | `VDJV-Sampler-Pad-Setup-${version}-${arch}.${ext}`, `VDJV-Sampler-Pad-Portable-${version}-${arch}.${ext}` | `package.json` -> `build.nsis.artifactName`, `build.portable.artifactName` | Release artifact naming. |
| Electron installer mode | NSIS `oneClick: false`, `perMachine: false`, allow changing installation directory true | `package.json` -> `build.nsis` | User installation defaults. |

## Supabase Local Config, Database Defaults, Edge Function Defaults

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Supabase local project id | `VDJV_SAMPLER_PAD_WEB` | `supabase/config.toml` -> `project_id` | Local CLI only. |
| Supabase local API port | `54321` | `supabase/config.toml` -> `[api].port` | Matches `.env.example`. |
| Supabase local DB ports | DB `54322`, shadow `54320`, pooler `54329` | `supabase/config.toml` -> `[db]`, `[db.pooler]` | Local dev only. |
| Supabase API max rows | `1000` | `supabase/config.toml` -> `[api].max_rows` | Local config. |
| Supabase storage file limit | `50MiB` | `supabase/config.toml` -> `[storage].file_size_limit` | Local Supabase storage; R2 handles large Store assets. |
| Supabase auth site URL | `https://vdjvsamplerpad.online` | `supabase/config.toml` -> `[auth].site_url` | Local config and hosted reference; live hosted value needs verification. |
| Supabase auth redirect URLs | localhost/127.0.0.1 ports `3000`, `4173`, `5173`; `vdjvsamplerpad.online`; `vdjvsamplerpad.github.io`; `com.powerworkout.vdjv://auth/callback` | `supabase/config.toml` -> `additional_redirect_urls` | Important for Google/OAuth. |
| Supabase JWT expiry | `3600s` | `supabase/config.toml` -> `[auth].jwt_expiry` | Local config; hosted needs verification. |
| Refresh token rotation | enabled, reuse interval `10s` | `supabase/config.toml` -> `[auth]` | Auth/session behavior. |
| Signup/anonymous sign-in | signup true, anonymous false | `supabase/config.toml` -> `[auth]` | Hosted needs verification. |
| Email password policy | min length `6`, no requirement string | `supabase/config.toml` -> `[auth]` | App-level assisted password uses 8 chars. |
| Auth email rate/OTP | email sent `2/h`, OTP length `6`, expiry `3600s`, max frequency `1s` | `supabase/config.toml` -> `[auth.rate_limit]`, `[auth.email]` | Local config; hosted needs verification. |
| Supabase edge runtime | enabled, policy `per_worker`, inspector port `8083`, Deno `2` | `supabase/config.toml` -> `[edge_runtime]` | Local dev. |
| API rate limit counter hits default | `0` | `supabase/migrations/20260225124000_api_rate_limits.sql` | DB limiter table. |
| Profile role default | `user` | `supabase/migrations/20260225110000_db_hardening_comprehensive.sql` | Role constraint allows user/admin. |
| Legacy profile quotas | owned `6`, pad cap `64`, device cap `120` | `supabase/migrations/20260305170000_profile_bank_quota_defaults.sql` | Legacy profile columns still exist for compatibility. |
| Sampler app config row | id `default`, active true | `supabase/migrations/20260312150000_create_sampler_app_config.sql` | Server/admin reads this row. |
| Sampler app config DB quota seed | owned `6`, pad cap `64`, device cap `120` | `supabase/migrations/20260312150000_create_sampler_app_config.sql` | Duplicates client config. |
| Default bank release defaults | source pad count `0`, storage provider `r2`, active false, published now | `supabase/migrations/20260306110000_default_bank_releases.sql` | Default bank publishing. |
| Catalog asset protection | `encrypted` | `supabase/migrations/20260227190000_bank_catalog_asset_protection.sql` | Store catalog security default. |
| Catalog pinned flag | `false` | `supabase/migrations/20260227223000_store_catalog_pinned_flag.sql` | Store sorting/default display. |
| Catalog item type | `single_bank` | `supabase/migrations/20260329110000_store_catalog_bundles.sql` | Bundles opt in. |
| Catalog coming soon | `false` | `supabase/migrations/20260323143000_add_coming_soon_to_bank_catalog_items.sql` | Store visibility state. |
| Low-memory catalog variant status | `uploading`, part count `0` | `supabase/migrations/20260421103000_store_catalog_low_memory_variants.sql` | Low-memory segmented assets. |
| User bank access source | `purchase` | `supabase/migrations/20260601093000_time_limited_free_store_promos.sql` | Free promo downloads should not create permanent access unless specific path does. |
| Account registration request status | `pending`, password key version `1`, decision email `pending` | `supabase/migrations/20260226054318_account_registration_requests.sql` | Legacy registration and pricing checkout. |
| Installer buy product defaults | description empty, price `0`, enabled true, sort `0`, allow auto-approve true, entitlements `{}` | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Installer catalog. |
| Installer request status/email | status `pending`, decision email `pending` | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Installer purchase review. |
| Installer auto-approve defaults | V2/V3 enabled false, mode `schedule`, start `0`, end `0`, duration `24` | `supabase/migrations/20260325120000_installer_buy_flow.sql` | Mirrors admin UI defaults. |
| Installer tier config defaults | display/description empty, UI `{}`, active true | `supabase/migrations/20260522124500_installer_tier_ui_content.sql` | Seeded rows provide actual version/tier copy. |
| Crash report DB defaults | status `new`, title `Crash Report`, repeat `1`, fingerprint version `1`, latest summary `{}` | `supabase/migrations/20260324093000_create_client_crash_reports.sql` | Admin Crash Reports. |
| R2 region/content type | region `auto`, content type `application/octet-stream` | `supabase/functions/_shared/r2-storage.ts` -> `DEFAULT_REGION`, `DEFAULT_UPLOAD_CONTENT_TYPE` | Cloudflare R2 signing. |
| Admin export token defaults | key id `admin-export-v1`, token version `1`, issuer `vdjv.admin-export`, bank name fallback `Untitled Bank` | `supabase/functions/_shared/admin-export-token.ts` | TTL from env; exact default TTL needs verification from file line if required. |

## Duplicated Or Hardcoded Defaults

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Sampler owned bank pad cap duplicate | Client/shared/server legacy `64` | `client/src/components/sampler/samplerAppConfig.ts`, `supabase/functions/_shared/sampler-app-config.ts`, `supabase/migrations/20260312150000_create_sampler_app_config.sql`, `useSamplerStore.session.ts` | Previously drifted at client `80`; now aligned. Safe improvement: centralize sampler defaults or make client read server config before first-run persistence. |
| FREE daily plays duplicate | Current client capability `50`; old tier seed `100` | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Admin Tier Config/live DB likely overrides. Mark live value Needs verification. |
| FREE deck count duplicate | Current client `1/1/1`; old tier seed only `deck_count:2` | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Public behavior depends on current account tier config row. |
| PRO MAX deck count duplicate | Current client max `8`; old tier seed `deck_count:4` | `client/src/lib/account-capabilities.ts` vs `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Tier config now supports min/default/max; live DB needs verification. |
| Store max download bytes duplicate | Edge Function `478150656`; legacy Express `268435456` | `supabase/functions/store-api/index.ts` vs `server/index.ts` | Legacy Express disabled by default; keep note for old local tests. |
| Landing download defaults duplicate | Client GitHub/Messenger defaults; old migration domain/MediaFire defaults | `client/src/components/landing/download-config.ts` vs `supabase/migrations/20260311143000_create_landing_download_config.sql` | Live DB/admin config may override. Needs verification before release link changes. |
| Payment channel values duplicate | `image_proof`, `gcash_manual`, `maya_manual` | `server/index.ts`, `supabase/functions/store-api/index.ts`, migrations | Keep in sync if adding a wallet/channel. |
| Stop timing ranges duplicate | Same ranges in client and Supabase shared sampler config | `client/src/lib/audio-engine/types.ts`; `supabase/functions/_shared/sampler-app-config.ts` | Audio setting validation must remain identical. |
| Theme brand pink duplicate | CSS HSL brand and tier `#f21984` | `client/src/index.css`; `client/src/lib/account-tier-content.ts` | Admin tier color may override but fallback remains hardcoded. |
| Legacy shared export password | `vdjv-export-disabled-2024-secure` | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` -> `SHARED_EXPORT_DISABLED_PASSWORD`; observed also in store code scan | Legacy compatibility/security-sensitive. Do not reuse for new encryption. |

## Fallback, Offline, First Installer, Legacy Defaults

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Offline login fallback | Cached user/profile and trusted offline session | `client/src/hooks/useAuth.ts`; `client/src/components/sampler/hooks/useSamplerStore.session.ts` | Works only after at least one successful online session/cache. |
| Offline Store fallback | Latest local snapshot if available; API offline returns 503 | `client/src/components/sampler/hooks/useOnlineStoreCatalogData.ts`; `client/public/sw.js` | Store browsing/payment/network actions should show offline unavailable messages. |
| First installer/user data mode | Electron standard uses app userData; portable uses `VDJV Data` beside executable | `electron/main.cjs` -> `configurePortableDataPaths` | First installer set value depends on packaged/portable marker. Needs verification in installer repo. |
| First Android version fallback | Gradle `versionName 1.0`, `versionCode 1` if build env missing | `android/app/build.gradle` | Build scripts should override; risky if bypassed. |
| Old public build auth compatibility | Tier/promo client versions default `1` | `supabase/functions/store-api/index.ts` -> `TIER_AWARE_CLIENT_VERSION`, `PROMO_AWARE_CLIENT_VERSION` | Old builds without headers may be blocked or handled by compatibility code. |
| Legacy registration default tier | New profiles default FREE; old approved registrations migrated to PRO | `supabase/migrations/20260422090000_account_tiers_upgrade_requests_vouchers.sql`; `20260501090000_promote_legacy_paid_registration_to_pro.sql` | Public release compatibility behavior. |
| Legacy sampler quota defaults | Profile columns still default 6/64/120 | `supabase/migrations/20260305170000_profile_bank_quota_defaults.sql` | User-level overrides and old builds may still read these columns. |
| Legacy Express API | Disabled unless env true | `server/index.ts` -> `ENABLE_LEGACY_EXPRESS_API` | Keep disabled for public unless needed. |
| App update unavailable fallback | `Auto-update is unavailable.` | `electron/auto-updater.cjs` -> initial `updateState.message` | Electron only. |
| Web update check fallback | `/version.json?_vdjv=${Date.now()}` | `client/src/hooks/useAppUpdate.ts` -> `fetchLatestWebBuildVersion` | If same version but waiting worker exists, UI may show refresh-ready. |

## Defaults Risky To Change In Public Release

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Auth redirect URLs/scheme | `com.powerworkout.vdjv://auth/callback` plus hosted/local URLs | `supabase/config.toml`; `client/src/hooks/useAuth.ts`; `electron/main.cjs`; `capacitor.config.ts` | Changing breaks Google/OAuth return paths across Electron/Capacitor/PWA. |
| Capability cache key | `vdjv-account-capabilities-v5` | `client/src/lib/account-capabilities.ts` | Changing invalidates cache; useful only when schema changes. |
| Audio stop timing profiles | Platform-specific timings | `client/src/lib/audio-engine/types.ts` | Sensitive to stutter/artifacts on Android/iOS. Test real devices before release. |
| Import concurrency and batch flush | iOS `1`, Android native `2`, web `4`; iOS flush `1/8MB` | `client/src/components/sampler/hooks/useSamplerStore.importBank.ts` | Increasing can reintroduce iOS/Android crashes. |
| Large download/iOS low-memory threshold | `250MB` | `client/src/components/sampler/hooks/useOnlineStoreDownloadTransfer.ts` | Changing affects bank-store crash prevention. |
| Backup/archive encryption constants | `VDJVENC2`, PBKDF2 `120000`, salt/IV/verifier sizes | `electron/main.cjs` | Changing breaks existing encrypted exports/backups. |
| Local storage keys | `vdjv-sampler-banks`, `vdjv-sampler-state`, etc. | `client/src/components/sampler/hooks/useSamplerStore.ts` | Changing loses offline/user data unless migration is added. |
| DB tier configs | Live `account_tier_configs` rows | Supabase DB, seeded by migrations | Live values should be exported/backed up before schema/default refactors. Needs verification. |
| Store request/payment status values | pending/approved/rejected/refunded etc. | Store/account migrations and admin UI | Changing enum-like text breaks filters and history. |
| Service worker cache naming | `vdjv-shell-cache-${version}` | `vite.config.js`, `client/public/sw.js` | Wrong name can strand stale public builds. |
| Android package id | `com.powerworkout.vdjv` | `capacitor.config.ts`, `android/app/build.gradle` | Changing creates a new Android app identity. |
| Electron app id/product | package build config | `package.json` -> `build.appId`, `build.productName` | Changing affects update/install identity. Needs verification from package fields before release. |

## Recommended Safe Improvements

| Setting | Default Value | File/Location | Notes |
|---|---|---|---|
| Centralize sampler quota defaults | Current duplicate sources are aligned at pad cap `64` | `client/src/components/sampler/samplerAppConfig.ts`; `supabase/functions/_shared/sampler-app-config.ts`; migrations | Create a single generated/shared defaults source or make client default hydrate from `sampler_app_config` before persisting first-run settings. |
| Export live admin config snapshot | Needs verification | Supabase tables: `sampler_app_config`, `account_tier_configs`, `installer_tier_configs`, `landing_download_config`, `store_payment_settings` | Add an admin/export command so public-release docs include actual live values, not only source fallbacks. |
| Version default docs with app release | Current doc generated for `package.json` `0.1.6` | `package.json`; this file | Regenerate on release to catch default drift. |
| Add lint/check for duplicate constants | Needs verification | Source-wide | A lightweight script can compare client/server tier limits, stop timing ranges, Store limits, and landing defaults. |
| Redact `.env` values in docs | Done here | `.env.example`, runtime env | Avoid committing live Supabase keys/webhooks/signing data. |
| Mark legacy defaults in UI | Needs verification | Admin Sampler Defaults, Tier Config, Pay Config | Admin UI should label legacy quota/profile fields as compatibility-only when tier config owns behavior. |
| Add runtime config health panel | Needs verification | Admin Home or Tier Config | Show current live tier limits, sampler defaults, cache age, and client version header support. |
| Add migration comments for superseded seeds | Needs verification | Old migrations such as `20260422090000_account_tiers_upgrade_requests_vouchers.sql` | Prevent confusion when source fallbacks differ from old seed defaults. |
