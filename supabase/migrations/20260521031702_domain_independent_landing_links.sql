update public.landing_download_config
set
  download_links = jsonb_set(
    jsonb_set(
      jsonb_set(
        download_links,
        '{V1,android}',
        '"/android/"'::jsonb,
        true
      ),
      '{V1,ios}',
      '"/ios/"'::jsonb,
      true
    ),
    '{V1,windows}',
    '"/"'::jsonb,
    true
  ),
  updated_at = now()
where id = 'default';;
