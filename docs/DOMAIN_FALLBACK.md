# Domain Fallback Runbook

The public download targets should stay domain-independent so the same config works on both:

- `https://vdjvsamplerpad.online`
- `https://vdjvsamplerpad.github.io`

Keep landing download destinations as relative lowercase paths when the file lives in the GitHub Pages site:

- Android guide: `/android/`
- iOS guide: `/ios/`
- Home/pricing handoff: `/`
- Sampler app: `/vdjv/`
- Pricing: `/pricing`

Public CTAs and approval emails should point to resolver routes such as `/go/v1/android` instead of hardcoding the custom domain. The resolver reads the current Supabase landing config and then opens the configured target.

If `vdjvsamplerpad.online` expires later:

1. Open the GitHub Pages settings for the deployed `vdjvsamplerpad.github.io` repository.
2. Remove the custom domain value `vdjvsamplerpad.online`.
3. Remove the deployed `CNAME` file if GitHub does not remove it automatically.
4. Confirm `https://vdjvsamplerpad.github.io/`, `/android/`, `/ios/`, `/vdjv/`, `/pricing`, and `/go/v1/android` no longer redirect to the expired domain.

Do not put `https://vdjvsamplerpad.online/...` back into Supabase landing download links unless it is only a temporary marketing link and not part of a required redirect path.
