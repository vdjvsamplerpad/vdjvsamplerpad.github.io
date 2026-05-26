update public.account_tier_configs
set ui_content = jsonb_set(
  jsonb_set(
    coalesce(ui_content, '{}'::jsonb),
    '{versionBadge}',
    case tier
      when 'free' then jsonb_build_object('enabled', false, 'label', '')
      else jsonb_build_object('enabled', true, 'label', 'VDJV 2.0')
    end,
    true
  ),
  '{meterPercent}',
  to_jsonb(case tier
    when 'free' then 33
    when 'pro' then 66
    else 100
  end),
  true
)
where tier in ('free', 'pro', 'pro_max')
  and (
    not (coalesce(ui_content, '{}'::jsonb) ? 'versionBadge')
    or not (coalesce(ui_content, '{}'::jsonb) ? 'meterPercent')
  );
