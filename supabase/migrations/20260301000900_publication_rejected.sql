-- Migration 10/11: a review can REJECT a submitted opportunity.
-- (Own file: a new enum value cannot be used in the transaction that adds it.)
alter type public.publication_status add value if not exists 'rejected';
