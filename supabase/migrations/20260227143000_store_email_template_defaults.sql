begin;

insert into public.store_payment_settings (
  id,
  is_active,
  store_email_approve_subject,
  store_email_approve_body,
  store_email_reject_subject,
  store_email_reject_body
)
values (
  'default',
  true,
  'Payment Approved - {{receipt_reference}}',
  'Hi {{display_name}},\n\nYour payment request has been approved.\n\nBanks: {{bank_titles}}\nTotal Items: {{bank_count}}\nAmount: {{amount}}\nVDJV Receipt No: {{receipt_reference}}\nPayment Reference: {{payment_reference}}\nPayment Channel: {{payment_channel}}\nReviewed At: {{reviewed_at}}\n\nYou can now open the app and download your bank.',
  'Payment Update - {{receipt_reference}}',
  'Hi {{display_name}},\n\nYour payment request was rejected.\n\nBanks: {{bank_titles}}\nTotal Items: {{bank_count}}\nAmount: {{amount}}\nVDJV Receipt No: {{receipt_reference}}\nPayment Reference: {{payment_reference}}\nReviewed At: {{reviewed_at}}\nReason: {{rejection_message}}\n\nPlease submit a new payment request after correcting the issue.'
)
on conflict (id) do update
set
  store_email_approve_subject = case
    when coalesce(nullif(public.store_payment_settings.store_email_approve_subject, ''), '') = ''
      then excluded.store_email_approve_subject
    else public.store_payment_settings.store_email_approve_subject
  end,
  store_email_approve_body = case
    when coalesce(nullif(public.store_payment_settings.store_email_approve_body, ''), '') = ''
      then excluded.store_email_approve_body
    else public.store_payment_settings.store_email_approve_body
  end,
  store_email_reject_subject = case
    when coalesce(nullif(public.store_payment_settings.store_email_reject_subject, ''), '') = ''
      then excluded.store_email_reject_subject
    else public.store_payment_settings.store_email_reject_subject
  end,
  store_email_reject_body = case
    when coalesce(nullif(public.store_payment_settings.store_email_reject_body, ''), '') = ''
      then excluded.store_email_reject_body
    else public.store_payment_settings.store_email_reject_body
  end;

commit;
