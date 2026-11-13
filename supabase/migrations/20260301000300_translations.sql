-- Migration 4/7: localized content.
--
-- One row per (opportunity, language). A translation can only exist for an existing canonical
-- opportunity (FK), at most once per language (PK), and may be INCOMPLETE: only `title` is
-- mandatory; every other field is NULL when no text exists and is never filled in for the reader.

create table public.opportunity_translations (
  opportunity_id    uuid not null references public.opportunities (id) on delete cascade,
  language          text not null,
  title             text not null,
  short_description text,
  description       text,
  requirements      text,
  benefits          text,
  eligibility       text,
  status            public.translation_status not null,
  translated_from   text,
  source_version    integer not null default 1,
  translated_by     uuid,   -- will reference profiles(id) in the authentication phase
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- No duplicate translation for the same language of the same opportunity.
  primary key (opportunity_id, language),

  constraint translations_language_format check (language ~ '^[a-z]{2}$'),
  -- Supported locales for TRANSLATIONS are az, ru and en. Only the ORIGINAL row may be in any
  -- other language (a German page keeps its German original; we never invent a German UI).
  constraint translations_supported_locale check (status = 'original' or language in ('az', 'ru', 'en')),
  constraint translations_source_language check ((status = 'original') = (translated_from is null)),
  constraint translations_source_format check (translated_from is null or translated_from ~ '^[a-z]{2}$'),
  constraint translations_not_from_itself check (translated_from is distinct from language),
  constraint translations_source_version check (source_version >= 1),

  constraint translations_title check (btrim(title) <> '' and length(title) <= 200),
  constraint translations_short_length check (length(short_description) <= 400),
  constraint translations_text_length check (
    length(description) <= 20000 and length(requirements) <= 10000 and length(benefits) <= 10000 and length(eligibility) <= 10000
  ),
  -- Raw HTML is rejected everywhere (restricted Markdown only).
  constraint translations_no_html check (not (
    public.has_raw_html(title) or public.has_raw_html(short_description) or public.has_raw_html(description)
    or public.has_raw_html(requirements) or public.has_raw_html(benefits) or public.has_raw_html(eligibility)
  ))
);

comment on table public.opportunity_translations is 'Localized text, one row per language; may be incomplete. The row with status = original preserves the source text in its own language.';
comment on column public.opportunity_translations.status is 'machine_draft rows are never readable by anon/authenticated (RLS).';

-- Exactly one ORIGINAL row per opportunity.
create unique index opportunity_translations_one_original on public.opportunity_translations (opportunity_id) where status = 'original';
create index opportunity_translations_language_idx on public.opportunity_translations (language);
create index opportunity_translations_status_idx on public.opportunity_translations (opportunity_id, status);
-- Typo-tolerant title lookups (admin search); the folded form is shared with the public search.
create index opportunity_translations_title_trgm on public.opportunity_translations using gin (public.fold_text(title) extensions.gin_trgm_ops);

create trigger opportunity_translations_set_updated_at before update on public.opportunity_translations
  for each row execute function public.set_updated_at();

-- ── Row-level language rules (need the parent's original_language) ─────────────────────────
create function public.check_translation_language() returns trigger
language plpgsql
as $$
declare
  v_original text;
begin
  select original_language into v_original from public.opportunities where id = new.opportunity_id;
  if not found then
    return new; -- the foreign key reports the missing parent
  end if;
  if new.status = 'original' and new.language <> v_original then
    raise exception 'the original translation must be in the opportunity''s original_language (%), not %', v_original, new.language
      using errcode = 'check_violation';
  end if;
  if new.status <> 'original' and new.translated_from is distinct from v_original then
    raise exception 'translations must be translated from the original language (%)', v_original
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger opportunity_translations_check_language before insert or update on public.opportunity_translations
  for each row execute function public.check_translation_language();

-- ── Transaction-level invariant: the original-language content is always preserved ─────────
-- Deferred to COMMIT so an opportunity and its translations can be written in one transaction.
create function public.assert_original_translation() returns trigger
language plpgsql
as $$
declare
  v_id uuid;
  v_language text;
  v_status public.publication_status;
  v_originals integer;
  v_in_language integer;
  v_short text;
begin
  -- Explicit branches: PL/pgSQL resolves record fields per executed statement, and NEW is
  -- unassigned in DELETE triggers.
  if tg_table_name = 'opportunities' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.opportunity_id;
  else
    v_id := new.opportunity_id;
  end if;
  select original_language, publication_status into v_language, v_status from public.opportunities where id = v_id;
  if not found then
    return null; -- the opportunity was deleted (cascade)
  end if;

  select count(*) filter (where status = 'original'),
         count(*) filter (where status = 'original' and language = v_language),
         max(short_description) filter (where status = 'original')
    into v_originals, v_in_language, v_short
    from public.opportunity_translations where opportunity_id = v_id;

  if v_originals <> 1 or v_in_language <> 1 then
    raise exception 'opportunity % needs exactly one original translation, written in its original_language (%)', v_id, v_language
      using errcode = 'check_violation';
  end if;
  if v_status = 'published' and (v_short is null or btrim(v_short) = '') then
    raise exception 'published opportunity % needs a short_description in its original translation', v_id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create constraint trigger opportunities_require_original after insert or update on public.opportunities
  deferrable initially deferred for each row execute function public.assert_original_translation();
create constraint trigger translations_require_original after insert or update or delete on public.opportunity_translations
  deferrable initially deferred for each row execute function public.assert_original_translation();

-- ── Editing the ORIGINAL text outdates the reviewed translations ────────────────────────────
-- (SQL twin of applyOriginalEdit in src/lib/opportunities/translations.ts.)
create function public.on_original_text_changed() returns trigger
language plpgsql
as $$
declare
  v_version integer;
begin
  update public.opportunities set content_version = content_version + 1
   where id = new.opportunity_id returning content_version into v_version;
  update public.opportunity_translations set status = 'outdated'
   where opportunity_id = new.opportunity_id and status in ('human', 'machine_approved');
  update public.opportunity_translations set source_version = v_version
   where opportunity_id = new.opportunity_id and status = 'original';
  return null;
end;
$$;
create trigger opportunity_translations_original_changed after update on public.opportunity_translations
  for each row
  when (old.status = 'original' and new.status = 'original' and (
    old.title, old.short_description, old.description, old.requirements, old.benefits, old.eligibility
  ) is distinct from (
    new.title, new.short_description, new.description, new.requirements, new.benefits, new.eligibility
  ))
  execute function public.on_original_text_changed();
