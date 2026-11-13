import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CITIES } from "@/lib/opportunities/cities";
import { OPPORTUNITY_TYPES } from "@/types/opportunity";
import { databaseAvailable, first, insertOpportunity, insertOrganization, TestDb } from "./helpers";

const available = await databaseAvailable();

describe.skipIf(!available)("schema, constraints and triggers", () => {
  let db: TestDb;
  beforeAll(async () => { db = await TestDb.create(); });
  afterAll(async () => { await db?.drop(); });

  /** Asserts that `sql` fails with an error whose message matches. */
  const fails = async (q: Parameters<Parameters<TestDb["tx"]>[1]>[0], sql: string, pattern: RegExp) =>
    expect((await q.expectError(sql)).message).toMatch(pattern);
  /** Forces the deferred (commit-time) invariants to run now. */
  const checkDeferred = (q: Parameters<Parameters<TestDb["tx"]>[1]>[0]) => q.expectError("set constraints all immediate");

  describe("structure", () => {
    it("creates the requested tables (plus cities and the private user tables)", async () => {
      const rows = await db.sql<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1");
      expect(rows.map((r) => r.table_name)).toEqual(["admin_audit_log", "applications", "categories", "cities", "opportunities", "opportunity_categories", "opportunity_sources", "opportunity_translations", "organizations", "profiles", "saved_opportunities", "user_roles"]);
    });

    it("every foreign key column is indexed (no slow joins / cascades)", async () => {
      const rows = await db.sql<{ conrelid: string; cols: string[]; indexed: boolean }>(`
        select c.conrelid::regclass::text as conrelid,
               array(select attname from pg_attribute where attrelid = c.conrelid and attnum = any (c.conkey)) as cols,
               exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey)-1] @> c.conkey and cardinality(c.conkey) <= i.indnatts) as indexed
        from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`);
      expect(rows.length).toBe(14); // organization, type, city, 2 × category links, translations → opportunity, profile → auth user, 2 × (saved, application) → user and opportunity, user_roles → user
      const unindexed = rows.filter((r) => !r.indexed).map((r) => `${r.conrelid}(${r.cols.join(",")})`);
      expect(unindexed).toEqual([]);
    });

    it("seeds exactly the application's opportunity types and cities (no drift from TypeScript)", async () => {
      const categories = await db.sql<{ code: string }>("select code from public.categories order by sort_order");
      expect(categories.map((c) => c.code)).toEqual([...OPPORTUNITY_TYPES]);
      const cities = await db.sql<{ id: string; country: string; name_az: string; name_ru: string; name_en: string }>("select * from public.cities order by sort_order");
      expect(cities.map((c) => [c.id, c.country, c.name_az, c.name_ru, c.name_en])).toEqual(CITIES.map((c) => [c.id, c.country, c.names.az, c.names.ru, c.names.en]));
    });

    it("fold_text is the SQL twin of foldText", async () => {
      const { f } = first(await db.sql<{ f: string }>("select public.fold_text('Təqaüd İSTANBUL Ёлка Şəki Çay ğ ı') as f"));
      expect(f).toBe("teqaud istanbul елка seki cay g i");
    });
  });

  describe("translations: one canonical opportunity, separate localized rows", () => {
    it("a translation must reference an existing canonical opportunity", async () => {
      await db.tx(null, async (q) => {
        await fails(q, "insert into public.opportunity_translations (opportunity_id, language, title, status) values ('00000000-0000-4000-8000-0000000000ff', 'az', 'X', 'original')", /foreign key|violates/i);
      });
    });

    it("prevents a duplicate translation for the same locale", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await q(`insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'en', 'One', 'human', 'az')`);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'en', 'Two', 'human', 'az')`, /duplicate key|already exists/i);
      });
    });

    it("supports the locales az, ru and en for translations; other languages only as the ORIGINAL", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        for (const language of ["ru", "en"]) {
          await q(`insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', '${language}', 'T', 'human', 'az')`);
        }
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'de', 'T', 'human', 'az')`, /translations_supported_locale/);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'xx1', 'T', 'human', 'az')`, /translations_language_format/);
        // a German ORIGINAL is fine, with az/en translations
        const de = await insertOpportunity(q, { original_language: "de", country: "DE", city_id: "berlin" }, { translations: [{ language: "de", status: "original", title: "Titel", short_description: "Kurz" }] });
        await q(`insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${de}', 'az', 'Başlıq', 'human', 'de')`);
        await checkDeferred(q).then(() => undefined, () => undefined);
      });
    });

    it("preserves the original language: exactly one original row, in original_language", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        // a second original is rejected (unique index)
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status) values ('${id}', 'en', 'Dup original', 'original')`, /one_original|duplicate key|original_language/);
        // an original in the wrong language is rejected (trigger)
        const other = await insertOpportunity(q, {}, { translations: false });
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status) values ('${other}', 'en', 'Wrong lang', 'original')`, /must be in the opportunity's original_language/);
      });
    });

    it("an opportunity without its original translation cannot be committed", async () => {
      await db.tx(null, async (q) => {
        await insertOpportunity(q, {}, { translations: false });
        await fails(q, "set constraints all immediate", /needs exactly one original translation/);
      });
      await expect(db.commit((q) => insertOpportunity(q, {}, { translations: false }))).rejects.toThrow(/needs exactly one original translation/);
    });

    it("deleting the original of an existing opportunity is rejected, but deleting the opportunity cascades", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await q("set constraints all immediate"); // from here on the invariant is checked per statement
        await fails(q, `delete from public.opportunity_translations where opportunity_id = '${id}' and status = 'original'`, /needs exactly one original translation/);
      });
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await q(`delete from public.opportunities where id = '${id}'`);
        await q("set constraints all immediate");
        expect(await q(`select 1 from public.opportunity_translations where opportunity_id = '${id}'`)).toHaveLength(0);
        expect(await q(`select 1 from public.opportunity_categories where opportunity_id = '${id}'`)).toHaveLength(0);
      });
    });

    it("supports INCOMPLETE translations: only the title is mandatory; nothing is auto-filled", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await q(`insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'ru', 'Только заголовок', 'human', 'az')`);
        const [row] = await q<Record<string, unknown>>(`select short_description, description, requirements, benefits, eligibility from public.opportunity_translations where opportunity_id = '${id}' and language = 'ru'`);
        expect(Object.values(row!)).toEqual([null, null, null, null, null]);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'en', '   ', 'human', 'az')`, /translations_title/);
      });
    });

    it("translation provenance: translations come from the original language; originals have no source", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'en', 'T', 'human', 'ru')`, /translated from the original language/);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status) values ('${id}', 'en', 'T', 'human')`, /translations_source_language|translated from the original/);
        // an original must not name a source language (checked on an opportunity that has no original yet)
        const bare = await insertOpportunity(q, {}, { translations: false });
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${bare}', 'az', 'T', 'original', 'ru')`, /translations_source_language/);
      });
    });

    it("rejects raw HTML and over-long text", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        for (const bad of ["<script>alert(1)</script>", "x <b>bold</b>", "<!-- c -->", "<img src=x onerror=1>"]) {
          await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from, description) values ('${id}', 'en', 'T', 'human', 'az', '${bad}')`, /translations_no_html/);
        }
        await q(`insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from, description) values ('${id}', 'en', 'T', 'human', 'az', 'Compare 3 < 5 and 7 > 2.')`);
        await fails(q, `insert into public.opportunity_translations (opportunity_id, language, title, status, translated_from) values ('${id}', 'ru', '${"x".repeat(201)}', 'human', 'az')`, /translations_title/);
      });
    });

    it("a published opportunity needs a short description in its original translation", async () => {
      await db.tx(null, async (q) => {
        await insertOpportunity(q, {}, { translations: [{ language: "az", status: "original", title: "Only title" }] });
        await fails(q, "set constraints all immediate", /needs a short_description/);
      });
      await db.tx(null, async (q) => {
        await insertOpportunity(q, { publication_status: "draft" }, { translations: [{ language: "az", status: "original", title: "Draft needs none" }] });
        await q("set constraints all immediate");
      });
    });

    it("editing the ORIGINAL text bumps content_version and outdates reviewed translations (drafts untouched)", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q, {}, { translations: [
          { language: "az", status: "original", title: "Orijinal", short_description: "Qısa" },
          { language: "en", status: "human", title: "EN", translated_from: "az" },
          { language: "ru", status: "machine_draft", title: "RU", translated_from: "az" },
        ] });
        await q(`update public.opportunity_translations set title = 'Yeni başlıq' where opportunity_id = '${id}' and language = 'az'`);
        const rows = await q<{ language: string; status: string; source_version: number }>(`select language, status, source_version from public.opportunity_translations where opportunity_id = '${id}' order by language`);
        expect(rows).toEqual([
          { language: "az", status: "original", source_version: 2 },
          { language: "en", status: "outdated", source_version: 1 },
          { language: "ru", status: "machine_draft", source_version: 1 },
        ]);
        expect((await q<{ content_version: number }>(`select content_version from public.opportunities where id = '${id}'`))[0]!.content_version).toBe(2);
        // an edit that changes nothing in the text does not bump the version
        await q(`update public.opportunity_translations set updated_at = now() where opportunity_id = '${id}' and language = 'az'`);
        expect((await q<{ content_version: number }>(`select content_version from public.opportunities where id = '${id}'`))[0]!.content_version).toBe(2);
      });
    });
  });

  describe("categories and opportunity_categories", () => {
    it("creates the primary category link automatically and keeps it in sync with opportunity_type", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q, { opportunity_type: "scholarship" });
        const links = () => q<{ category_code: string; is_primary: boolean }>(`select category_code, is_primary from public.opportunity_categories where opportunity_id = '${id}' order by category_code`);
        expect(await links()).toEqual([{ category_code: "scholarship", is_primary: true }]);
        await q(`insert into public.opportunity_categories (opportunity_id, category_code) values ('${id}', 'research')`);
        await q(`update public.opportunities set opportunity_type = 'grant' where id = '${id}'`);
        expect(await links()).toEqual([
          { category_code: "grant", is_primary: true },
          { category_code: "research", is_primary: false },
          { category_code: "scholarship", is_primary: false },
        ]);
      });
    });

    it("rejects unknown categories, duplicates, a second primary, hand-edited primary flags and removing the primary", async () => {
      await db.tx(null, async (q) => {
        const id = await insertOpportunity(q);
        await fails(q, `insert into public.opportunity_categories (opportunity_id, category_code) values ('${id}', 'nonsense')`, /foreign key|violates/i);
        await fails(q, `insert into public.opportunity_categories (opportunity_id, category_code) values ('${id}', 'scholarship')`, /duplicate key/);
        await fails(q, `insert into public.opportunity_categories (opportunity_id, category_code, is_primary) values ('${id}', 'research', true)`, /one_primary|duplicate key/);
        await fails(q, `update public.opportunity_categories set is_primary = false where opportunity_id = '${id}'`, /managed by the opportunity_type/);
        await fails(q, `delete from public.opportunity_categories where opportunity_id = '${id}' and category_code = 'scholarship'`, /primary category .* cannot be removed/);
      });
    });

    it("opportunity_type must be a known category (foreign key)", async () => {
      await db.tx(null, async (q) => {
        const org = await insertOrganization(q);
        await fails(q, `insert into public.opportunities (slug, organization_id, opportunity_type, location_type, country) values ('x1', '${org}', 'course', 'onsite', 'AZ')`, /foreign key|violates/i);
      });
    });
  });

  describe("opportunity constraints", () => {
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ["bad slug", { slug: "Not A Slug" }, /opportunities_slug_format/],
      ["'other' without a label", { opportunity_type: "other" }, /opportunities_other_label/],
      ["label on a non-'other' type", { other_type_label: "x" }, /opportunities_other_label/],
      ["onsite without a country", { country: null, city_id: null }, /opportunities_location/],
      ["lower-case country", { country: "az", city_id: null }, /opportunities_country_format/],
      ["unknown city", { city_id: "atlantis" }, /foreign key|violates/i],
      ["city in the wrong country", { country: "DE", city_id: "baku" }, /city baku belongs to AZ, not DE/],
      ["city without a host country", { location_type: "remote", country: null, city_id: "baku" }, /city baku requires a host country/],
      ["city id and city text together", { city_text: "Baku" }, /opportunities_city/],
      ["fixed deadline without a date", { application_deadline: null }, /opportunities_deadline_fixed/],
      ["a date on a rolling deadline", { deadline_type: "rolling" }, /opportunities_deadline_fixed/],
      ["start after deadline", { application_start_date: "2099-01-01T00:00:00Z" }, /opportunities_dates_order/],
      ["invalid time zone", { deadline_timezone: "Mars/Olympus" }, /opportunities_timezone/],
      ["funding amount without currency", { funding_amount: 100 }, /funding_amount_currency/],
      ["amount on an unpaid opportunity", { funding_type: "unpaid", funding_amount: 100, funding_currency: "AZN" }, /funding_amount_type/],
      ["negative amount", { funding_type: "paid", funding_amount: -1, funding_currency: "AZN" }, /funding_amount_positive/],
      ["period without amount", { funding_period: "monthly" }, /funding_period/],
      ["percent on a non-discount", { funding_percent: 30 }, /funding_percent/],
      ["percent out of range", { funding_type: "tuition_discount", funding_percent: 101 }, /funding_percent/],
      ["bad currency", { funding_type: "paid", funding_amount: 1, funding_currency: "azn" }, /currency_format/],
      ["fee without currency", { participation_fee_amount: 10 }, /opportunities_fee/],
      ["http source url", { official_source_url: "http://org.example.com/x" }, /urls_https/],
      ["javascript: application url", { application_url: "javascript:alert(1)" }, /urls_https/],
      ["bad original language", { original_language: "deu" }, /language_format/],
      ["empty eligible countries", { eligible_countries: "{}" }, /eligible_countries/],
      ["duplicate eligible countries", { eligible_countries: "{AZ,AZ}" }, /eligible_countries/],
      ["lower-case eligible country", { eligible_countries: "{az}" }, /eligible_countries/],
      ["duplicate education levels", { education_levels: "{bachelor,bachelor}" }, /levels_unique/],
    ];
    it.each(bad)("rejects: %s", async (_name, overrides, pattern) => {
      await db.tx(null, async (q) => {
        const message = await insertOpportunity(q, overrides).then(() => "ACCEPTED", (e: Error) => e.message);
        expect(message).toMatch(pattern);
      });
    });

    it("accepts a fully specified valid record (and a remote one without a host country)", async () => {
      await db.tx(null, async (q) => {
        await insertOpportunity(q, {
          funding_type: "paid", funding_amount: 800, funding_currency: "AZN", funding_period: "monthly", participation_fee_amount: 10, participation_fee_currency: "USD",
          education_levels: "{bachelor,master}", eligible_fields: "{ict,engineering}", eligible_countries: "{AZ,GE}", deadline_timezone: "America/New_York",
        });
        await insertOpportunity(q, { location_type: "remote", country: null, city_id: null });
        await q("set constraints all immediate");
      });
    });
  });

  describe("trust rules: unverified records can never pass as verified", () => {
    const outcome = (overrides: Record<string, unknown>) =>
      db.tx(null, (q) => insertOpportunity(q, overrides).then(() => "ACCEPTED", (e: Error) => e.message));
    const unverified = { verification_status: "unverified", verified_by: null, last_verified_at: null };

    it("'verified' must say who verified it and when", async () => {
      // draft, so only the verification rule (not the publication rule) can fire
      expect(await outcome({ publication_status: "draft", verified_by: null })).toMatch(/verified_has_verifier/);
      expect(await outcome({ publication_status: "draft", last_verified_at: null })).toMatch(/verified_has_verifier/);
      expect(await outcome({ publication_status: "draft" })).toBe("ACCEPTED");
    });
    it("demo records can never be verified", async () => {
      expect(await outcome({ is_demo: true, publication_status: "draft" })).toMatch(/demo_never_verified/);
    });
    it("publishing needs an official source", async () => {
      expect(await outcome({ official_source_url: null })).toMatch(/published_requirements/);
    });
    it("publishing needs verification: unverified or rejected records cannot be published", async () => {
      expect(await outcome({ ...unverified })).toMatch(/published_requirements/);
      expect(await outcome({ ...unverified, verification_status: "rejected" })).toMatch(/published_requirements/);
    });
    it("…but unpublished unverified records are fine, and a demo record may be published unverified", async () => {
      expect(await outcome({ ...unverified, publication_status: "draft" })).toBe("ACCEPTED");
      expect(await outcome({ ...unverified, is_demo: true })).toBe("ACCEPTED");
    });
  });

  describe("housekeeping triggers and referential integrity", () => {
    it("maintains updated_at and sets published_at on first publication", async () => {
      // now() is constant inside a transaction, so use separate committed transactions.
      const draft = { publication_status: "draft", verification_status: "unverified", verified_by: null, last_verified_at: null };
      const id = await db.commit((q) => insertOpportunity(q, { ...draft, slug: "housekeeping-1" }));
      const read = () => db.sql<{ published_at: string | null; updated_at: string }>(`select published_at, updated_at from public.opportunities where id = '${id}'`).then((r) => r[0]!);
      const first = await read();
      expect(first.published_at).toBeNull();
      await db.sql("select pg_sleep(0.05)");
      await db.sql(`update public.opportunities set publication_status = 'in_review' where id = '${id}'`);
      const second = await read();
      expect(new Date(second.updated_at).getTime()).toBeGreaterThan(new Date(first.updated_at).getTime());
      await db.sql(`update public.opportunities set publication_status = 'published', verification_status = 'verified', verified_by = '00000000-0000-4000-8000-000000000001', last_verified_at = now() where id = '${id}'`);
      expect((await read()).published_at).not.toBeNull();
      await db.sql(`delete from public.opportunities where id = '${id}'`);
    });
    it("cannot delete an organization that still has opportunities (restrict)", async () => {
      await db.tx(null, async (q) => {
        const org = await insertOrganization(q);
        await insertOpportunity(q, {}, { organizationId: org });
        await fails(q, `delete from public.organizations where id = '${org}'`, /foreign key|violates/i);
      });
    });
    it("organization checks: slug, https website, HTML-free name", async () => {
      await db.tx(null, async (q) => {
        await fails(q, "insert into public.organizations (slug, kind, name) values ('Bad Slug', 'ngo', 'X')", /slug/);
        await fails(q, "insert into public.organizations (slug, kind, name, website_url) values ('o1', 'ngo', 'X', 'http://x.example.com')", /website_url/);
        await fails(q, "insert into public.organizations (slug, kind, name) values ('o2', 'ngo', '<b>X</b>')", /name/);
        await fails(q, "insert into public.organizations (slug, kind, name) values ('o3', 'bogus', 'X')", /invalid input value for enum/);
      });
    });
  });
});
