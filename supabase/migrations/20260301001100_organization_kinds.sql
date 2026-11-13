-- Migration 12/13: two more organization categories (own file: new enum values cannot be used in the transaction that adds them).
-- Existing kinds already cover government bodies, universities (Azerbaijani and international: the COUNTRY tells them apart),
-- banks and financial institutions, IT companies, other private companies, NGOs and international organizations.
alter type public.organization_kind add value if not exists 'scholarship_org';
alter type public.organization_kind add value if not exists 'development_org';
