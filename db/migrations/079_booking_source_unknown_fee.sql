-- Pencilled-offer fulfilment deliberately preserves unavailable Stripe fee
-- evidence as NULL. The original BCS NOT NULL constraint rolled back the paid
-- booking until a later webhook retry could retrieve the fee. Match the
-- existing nullable credit transaction/booking evidence contract without
-- rewriting historical fees or interpreting unknown fees as zero.
ALTER TABLE booking_credit_sources
  ALTER COLUMN stripe_fee_pence DROP NOT NULL;
