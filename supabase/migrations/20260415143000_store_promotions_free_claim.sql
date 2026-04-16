alter table public.store_promotions
  drop constraint if exists store_promotions_discount_type_ck;
alter table public.store_promotions
  add constraint store_promotions_discount_type_ck
  check (discount_type in ('percent', 'fixed', 'free'));

alter table public.store_promotions
  drop constraint if exists store_promotions_discount_value_ck;
alter table public.store_promotions
  add constraint store_promotions_discount_value_ck
  check (
    (discount_type = 'percent' and discount_value > 0 and discount_value < 100)
    or (discount_type = 'fixed' and discount_value > 0)
    or (discount_type = 'free' and discount_value = 0)
  );

notify pgrst, 'reload schema';
