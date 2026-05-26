update public.account_tier_configs
set ui_content = jsonb_set(
  coalesce(ui_content, '{}'::jsonb),
  '{inclusionTitle}',
  to_jsonb(case tier
    when 'free' then 'Locked Features'
    when 'pro' then 'Included Tools'
    else 'Store Access'
  end),
  true
)
where tier in ('free', 'pro', 'pro_max')
  and not (coalesce(ui_content, '{}'::jsonb) ? 'inclusionTitle');
