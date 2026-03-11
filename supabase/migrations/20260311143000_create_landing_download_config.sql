create table if not exists public.landing_download_config (
  id text primary key,
  is_active boolean not null default true,
  download_links jsonb not null default '{}'::jsonb,
  platform_descriptions jsonb not null default '{}'::jsonb,
  version_descriptions jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.landing_download_config enable row level security;

insert into public.landing_download_config (
  id,
  is_active,
  download_links,
  platform_descriptions,
  version_descriptions
) values (
  'default',
  true,
  '{
    "V1": {
      "android": "https://vdjvsamplerpad.online/Android/",
      "ios": "https://vdjvsamplerpad.online/iOS/",
      "windows": "https://vdjvsamplerpad.online",
      "macos": ""
    },
    "V2": {
      "android": "https://www.mediafire.com/file/lxd0x4365yrhgzf/",
      "ios": "https://apps.apple.com/us/app/virtualdj-remote/id407160120",
      "windows": "https://www.mediafire.com/file/0h40ivp0y63su8b/",
      "macos": ""
    },
    "V3": {
      "android": "https://www.mediafire.com/file/lxd0x4365yrhgzf/",
      "ios": "https://apps.apple.com/us/app/virtualdj-remote/id407160120",
      "windows": "https://www.mediafire.com/file/0h40ivp0y63su8b/",
      "macos": ""
    }
  }'::jsonb,
  '{
    "V1": {
      "android": "VDJV App, no laptop needed",
      "ios": "Web App, no laptop needed",
      "windows": "Standalone software, no remote app",
      "macos": "Web app sa browser, no remote app"
    },
    "V2": {
      "android": "VDJV Remote App V2 connect sa laptop/PC",
      "ios": "VirtualDJ Remote App",
      "windows": "VDJV V2 (up to V2.5)",
      "macos": "Message muna for compatibility"
    },
    "V3": {
      "android": "VDJV Remote App V3 connect sa laptop/PC",
      "ios": "VirtualDJ Remote App",
      "windows": "VDJV V3 (2026 latest)",
      "macos": "Message muna for compatibility"
    }
  }'::jsonb,
  '{
    "V1": {
      "title": "V1 – Standalone Version",
      "desc": "Pinakasimple na version ng VDJV. Hindi kailangan ng laptop o PC dahil diretso na itong gagana sa device mo. Best ito para sa mga gusto lang ng basic sampler pad para sa events gamit ang phone, tablet, o computer nang walang setup o remote connection. May unique features kumpara sa V2 at V3 pero mabilis at madaling gamitin."
    },
    "V2": {
      "title": "V2 – Laptop/PC Based Version",
      "desc": "Ito ang 2023 version na gumagamit ng laptop o PC bilang main system. Ang phone o tablet ay gagamitin bilang wireless touchscreen controller gamit ang remote app. Mas stable ito para sa events at mas flexible kumpara sa V1 dahil naka-run ang audio sa laptop. Recommended ito kung gusto mo ng mas professional setup pero hindi pa kailangan ang full features ng V3."
    },
    "V3": {
      "title": "V3 – Full Features Version",
      "desc": "Ito ang pinaka-complete at latest version ng VDJV. May kasama na itong installer, bagong features, effects, at lahat ng banks. Designed ito para sa professional events at mas advanced na paggamit. Laptop o PC pa rin ang main system habang ang phone o tablet ay gagamitin bilang wireless controller. Ito ang recommended version kung gusto mo ng full VDJV experience."
    }
  }'::jsonb
)
on conflict (id) do nothing;
