update public.landing_download_config
set buy_sections = jsonb_set(
  coalesce(buy_sections, '{}'::jsonb),
  '{V1,description}',
  to_jsonb('Register your VDJV V1 account, submit payment proof, and wait for approval before logging in.'::text),
  true
)
where id = 'default'
  and is_active = true
  and (
    buy_sections is null
    or buy_sections -> 'V1' is null
    or buy_sections -> 'V1' ->> 'description' is null
    or buy_sections -> 'V1' ->> 'description' = 'Register your VDJV V1 account, submit your payment proof, and wait for approval before downloading and logging in.'
    or buy_sections -> 'V1' ->> 'description' = 'Register your VDJV V1 account, send payment proof, and wait for approval. Once approved, you can log in and use the V1 app on your preferred platform.'
  );
