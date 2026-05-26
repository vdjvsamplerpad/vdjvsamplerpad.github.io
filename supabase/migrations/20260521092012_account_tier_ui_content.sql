alter table public.account_tier_configs
  add column if not exists ui_content jsonb not null default '{}'::jsonb;

update public.account_tier_configs
set ui_content = jsonb_build_object(
  'version', 1,
  'color', case tier
    when 'free' then '#64748b'
    when 'pro' then '#f21984'
    else '#2155ff'
  end,
  'cardHeader', case tier
    when 'free' then jsonb_build_object('enabled', false, 'label', '')
    when 'pro' then jsonb_build_object('enabled', true, 'label', 'Most popular')
    else jsonb_build_object('enabled', true, 'label', 'Best value')
  end,
  'video', jsonb_build_object(
    'src', '/assets/v1-preview.mp4',
    'storageProvider', 'local'
  ),
  'shortDescriptions', case tier
    when 'free' then jsonb_build_array('For trying VDJV before upgrading')
    when 'pro' then jsonb_build_array('Full VDJV feature set.')
    else jsonb_build_array('All PRO features plus a snapshot grant of Store banks published at upgrade time.')
  end,
  'otherDescriptions', case tier
    when 'free' then jsonb_build_array(jsonb_build_object('title', 'Daily trial access', 'body', '100 Default Bank plays. Upgrade to remove daily play limits.'))
    when 'pro' then jsonb_build_array(jsonb_build_object('title', 'Full sampler tools', 'body', 'Unlock checkout, free promos, search, mapping, backup, and editing.'))
    else jsonb_build_array(jsonb_build_object('title', 'All current Store banks', 'body', 'PRO plus Store bank grant snapshot at approval time.'))
  end,
  'checklist', case tier
    when 'free' then jsonb_build_array('100 Default Bank plays/day', '2 own sampler banks', 'Store browsing only', 'Locked checkout and free promotions')
    when 'pro' then jsonb_build_array('Unlimited Default Bank plays', 'Bank Store checkout and free promotions', 'Search, MIDI/keyboard mapping, backup and repair', 'Full pad/bank edit controls and 4 deck channels')
    else jsonb_build_array('Everything in PRO', 'All Store banks published at upgrade time are granted', 'Higher own-bank and device bank caps', 'Best option for heavy offline/event use')
  end,
  'inclusions', case tier
    when 'free' then jsonb_build_array(
      jsonb_build_object('title', 'Bank Store downloads', 'badge', 'LOCKED', 'enabled', false),
      jsonb_build_object('title', 'Search / mappings', 'badge', 'LOCKED', 'enabled', false),
      jsonb_build_object('title', 'Backup / repair', 'badge', 'LOCKED', 'enabled', false)
    )
    when 'pro' then jsonb_build_array(
      jsonb_build_object('title', 'Bank Store downloads', 'badge', 'ENABLED', 'enabled', true),
      jsonb_build_object('title', 'Search / mappings', 'badge', 'ENABLED', 'enabled', true),
      jsonb_build_object('title', 'Backup / repair', 'badge', 'ENABLED', 'enabled', true)
    )
    else jsonb_build_array(
      jsonb_build_object('title', 'Published Store banks', 'badge', 'GRANTED', 'enabled', true),
      jsonb_build_object('title', 'Own bank quota', 'badge', '12', 'enabled', true),
      jsonb_build_object('title', 'Device bank cap', 'badge', '150', 'enabled', true)
    )
  end
)
where ui_content = '{}'::jsonb
  and tier in ('free', 'pro', 'pro_max');
