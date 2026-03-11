create table if not exists public.sampler_app_config (
  id text primary key,
  is_active boolean not null default true,
  ui_defaults jsonb not null default '{}'::jsonb,
  bank_defaults jsonb not null default '{}'::jsonb,
  pad_defaults jsonb not null default '{}'::jsonb,
  quota_defaults jsonb not null default '{}'::jsonb,
  audio_limits jsonb not null default '{}'::jsonb,
  shortcut_defaults jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sampler_app_config enable row level security;

insert into public.sampler_app_config (
  id,
  is_active,
  ui_defaults,
  bank_defaults,
  pad_defaults,
  quota_defaults,
  audio_limits,
  shortcut_defaults
) values (
  'default',
  true,
  '{
    "defaultPadSizePortrait": 5,
    "defaultPadSizeLandscape": 10,
    "defaultChannelCountMobile": 2,
    "defaultChannelCountDesktop": 4,
    "defaultMasterVolume": 1,
    "defaultStopMode": "instant",
    "defaultSidePanelMode": "overlay",
    "defaultHideShortcutLabels": true,
    "defaultAutoPadBankMapping": true,
    "defaultGraphicsProfile": "auto"
  }'::jsonb,
  '{
    "defaultBankName": "Default Bank",
    "defaultBankColor": "#3b82f6"
  }'::jsonb,
  '{
    "defaultTriggerMode": "toggle",
    "defaultPlaybackMode": "once",
    "defaultVolume": 1,
    "defaultGainDb": 0,
    "defaultFadeInMs": 0,
    "defaultFadeOutMs": 0,
    "defaultPitch": 0,
    "defaultTempoPercent": 0,
    "defaultKeyLock": true
  }'::jsonb,
  '{
    "ownedBankQuota": 6,
    "ownedBankPadCap": 64,
    "deviceTotalBankCap": 120
  }'::jsonb,
  '{
    "maxPadAudioBytes": 52428800,
    "maxPadAudioDurationMs": 1200000
  }'::jsonb,
  '{
    "stopAll": "Space",
    "mixer": "M",
    "editMode": "Z",
    "mute": "X",
    "banksMenu": "B",
    "nextBank": "[",
    "prevBank": "]",
    "upload": "N",
    "volumeUp": "ArrowUp",
    "volumeDown": "ArrowDown",
    "padSizeUp": "=",
    "padSizeDown": "-",
    "importBank": "V",
    "activateSecondary": "C",
    "midiShift": ""
  }'::jsonb
)
on conflict (id) do nothing;

drop policy if exists sampler_app_config_deny_all on public.sampler_app_config;
create policy sampler_app_config_deny_all
on public.sampler_app_config
for all
to authenticated
using (false)
with check (false);

create index if not exists idx_sampler_app_config_updated_by
  on public.sampler_app_config (updated_by);
