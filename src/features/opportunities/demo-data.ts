import type {
  Opportunity,
  OpportunityRecord,
  Organization,
} from "@/types/opportunity";
import type { LanguageCode, OpportunityTranslation, TranslationContent, TranslationStatus } from "@/types/translation";

/**
 * DEMO CONTENT — FOR VISUAL TESTING ONLY.
 * Every record is fictional: organizations are prefixed "Demo", links use the reserved
 * example.com domain, and every record has `isDemo: true` and verificationStatus "unverified"
 * (demo data never claims to be verified). The UI labels it everywhere and search engines never
 * index it. Deadlines are relative to "now" so the demo never shows stale dates.
 *
 * The set deliberately exercises the multilingual rules: originals in az/en and in non-interface
 * languages (de, tr), incomplete translations, a machine-approved translation, and a machine
 * DRAFT that must stay hidden. Replaced by Supabase data (flagged seed) in the database phase.
 */

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

// ── Organizations (all fictional) ───────────────────────────────────────────────────────────

const org = (id: string, name: string, kind: Organization["kind"], country: string): Organization => ({
  id: `demo-org-${id}`,
  slug: `demo-${id}`,
  name,
  kind,
  country,
  websiteUrl: `https://${id}.example.com`,
  isDemo: true,
});

const ORGS = {
  foundation: org("foundation", "Demo Foundation for Education", "ngo", "AZ"),
  digital: org("digital", "Demo Digital Solutions", "it_company", "AZ"),
  intlUniversity: org("intl-university", "Demo International University", "university", "DE"),
  science: org("science", "Demo Institute of Science", "university", "CH"),
  techCommunity: org("tech-community", "Demo Tech Community", "ngo", "AZ"),
  youthCouncil: org("youth-council", "Demo Youth Council", "government", "AZ"),
  academy: org("academy", "Demo Learning Academy", "company", "AZ"),
  professional: org("professional", "Demo Professional Institute", "international_org", "GB"),
  research: org("research", "Demo Research Council", "international_org", "GB"),
  cityUniversity: org("city-university", "Demo City University", "university", "TR"),
  consulting: org("consulting", "Demo Global Consulting", "company", "NL"),
  fellowship: org("fellowship", "Demo Global Fellowship Fund", "ngo", "US"),
  bank: org("bank", "Demo Bank", "bank", "AZ"),
  regional: org("regional", "Demo Regional Education Center", "government", "AZ"),
  civic: org("civic", "Demo Civic Initiative", "ngo", "AZ"),
  stateAgency: org("state-agency", "Demo State Education Agency", "government", "AZ"),
  startupFund: org("startup-fund", "Demo Startup Support Fund", "government", "AZ"),
  nakhchivanFund: org("nakhchivan-fund", "Demo Nakhchivan Education Fund", "ngo", "AZ"),
  energy: org("energy", "Demo Energy Group", "company", "AZ"),
  craftsCenter: org("crafts-center", "Demo Crafts and Skills Center", "government", "AZ"),
} satisfies Record<string, Organization>;

// ── Translation helpers ─────────────────────────────────────────────────────────────────────

type Extras = Partial<Pick<TranslationContent, "description" | "requirements" | "benefits" | "eligibility">>;
/** [language, status, title, shortDescription, extras?] */
type Row = [LanguageCode, TranslationStatus, string, string | null, Extras?];

function makeRows(opportunityId: string, original: LanguageCode, rows: Row[], now: string): OpportunityTranslation[] {
  return rows.map(([language, status, title, shortDescription, extras = {}]) => ({
    opportunityId,
    language,
    status,
    title,
    shortDescription,
    description: extras.description ?? null,
    requirements: extras.requirements ?? null,
    benefits: extras.benefits ?? null,
    eligibility: extras.eligibility ?? null,
    translatedFrom: status === "original" ? null : original,
    sourceVersion: 1,
    translatedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
}

/** Common case: a short card text in az/ru/en; the original language is "original", the rest "human". */
function trio(original: "az" | "en", az: [string, string], ru: [string, string], en: [string, string]): Row[] {
  const status = (l: string): TranslationStatus => (l === original ? "original" : "human");
  return [
    ["az", status("az"), az[0], az[1]],
    ["ru", status("ru"), ru[0], ru[1]],
    ["en", status("en"), en[0], en[1]],
  ];
}

// ── Seeds ───────────────────────────────────────────────────────────────────────────────────

type Seed = {
  id: string;
  slug: string;
  org: Organization;
  original: LanguageCode;
  rows: Row[];
  publishedDaysAgo: number;
  /** Days from now; null = rolling (no deadline). */
  deadline: number | null;
  /** Days from now when applications open; omit when already open. */
  start?: number;
  /** Days since the last edit; defaults to a deterministic spread so "recently updated" differs from "newest". */
  updatedDaysAgo?: number;
  fields?: Partial<Opportunity>;
};

const seeds: Seed[] = [
  {
    id: "demo-01", slug: "demo-merit-scholarship", org: ORGS.foundation, original: "az", publishedDaysAgo: 3, deadline: 21,
    rows: [
      ["az", "original", "Demo təqaüd proqramı: akademik nailiyyət", "Nümunə kart: tam təqaüd, yaşayış xərcləri və məsləhətçi dəstəyi daxil olan vizual test məzmunu.", {
        description: "Bu, vizual test üçün uydurulmuş nümunə təqaüd proqramıdır. Real proqram deyil və heç bir rəsmi mənbəyə əsaslanmır.",
        requirements: "Nümunə tələb: son akademik ilin nəticələri.\nNümunə tələb: motivasiya məktubu.",
        benefits: "Nümunə üstünlük: təhsil haqqının ödənilməsi.\nNümunə üstünlük: aylıq stipendiya.",
        eligibility: "Nümunə uyğunluq: Azərbaycan vətəndaşları, bakalavr və magistratura tələbələri.",
      }],
      ["ru", "human", "Демо-стипендия за академические достижения", "Пример карточки: визуальный тестовый контент с полной стипендией, расходами на проживание и поддержкой наставника.", {
        description: "Это вымышленный пример стипендиальной программы для визуального тестирования. Это не реальная программа, и она не основана на официальном источнике.",
        requirements: "Пример требования: результаты последнего учебного года.\nПример требования: мотивационное письмо.",
        benefits: "Пример преимущества: оплата обучения.\nПример преимущества: ежемесячная стипендия.",
        eligibility: "Пример условия: граждане Азербайджана, студенты бакалавриата и магистратуры.",
      }],
      ["en", "human", "Demo scholarship for academic achievement", "Sample card: visual test content with a full scholarship, living costs and mentor support.", {
        description: "This is a fictional sample scholarship program for visual testing. It is not a real program and is not based on any official source.",
        requirements: "Sample requirement: results of the last academic year.\nSample requirement: a motivation letter.",
        benefits: "Sample benefit: tuition covered.\nSample benefit: a monthly stipend.",
        eligibility: "Sample eligibility: citizens of Azerbaijan, bachelor's and master's students.",
      }],
    ],
    fields: { opportunityType: "scholarship", locationType: "onsite", country: "AZ", cityId: "baku", educationLevels: ["bachelor", "master"],
      eligibleCountries: ["AZ"], fundingType: "fully_funded", fundingAmount: 400, fundingCurrency: "AZN", fundingPeriod: "monthly", featured: true },
  },
  {
    id: "demo-02", slug: "demo-it-internship", org: ORGS.digital, original: "az", publishedDaysAgo: 5, deadline: 35, start: -10,
    rows: [
      ["az", "original", "Demo proqramçı təcrübə proqramı", "Nümunə kart: ödənişli, hibrid formatlı təcrübə proqramı üçün vizual test mətni.", {
        description: "Bu, vizual test üçün uydurulmuş nümunə təcrübə proqramıdır.",
        requirements: "Nümunə tələb: proqramlaşdırmanın əsasları.\nNümunə tələb: ingilis dili bacarığı.",
        benefits: "Nümunə üstünlük: aylıq ödəniş və mentor dəstəyi.",
      }],
      ["en", "human", "Demo developer internship", "Sample card: test text for a paid internship in a hybrid format.", {
        description: "This is a fictional sample internship for visual testing.",
        requirements: "Sample requirement: programming basics.\nSample requirement: English language skills.",
        benefits: "Sample benefit: a monthly payment and mentor support.",
      }],
      // Unreviewed machine output: must NEVER be shown. Russian visitors see the Azerbaijani original.
      ["ru", "machine_draft", "Демо-стажировка (черновик машинного перевода)", "Черновик, который не должен отображаться.", {}],
    ],
    fields: { opportunityType: "internship", locationType: "hybrid", country: "AZ", cityId: "baku", educationLevels: ["bachelor", "graduate"],
      eligibleFields: ["ict", "engineering"], fundingType: "paid", fundingAmount: 800, fundingCurrency: "AZN", fundingPeriod: "monthly", featured: true },
  },
  {
    id: "demo-03", slug: "demo-exchange-semester", org: ORGS.intlUniversity, original: "de", publishedDaysAgo: 8, deadline: 60, start: 14,
    rows: [
      // Original language is German: not an interface language, but it is preserved as the source of truth.
      ["de", "original", "Demo-Austauschsemester", "Beispielkarte: Testtext für ein einsemestriges Austauschprogramm mit Teilfinanzierung.", {
        description: "Dies ist ein erfundenes Beispiel für den visuellen Test. Es ist kein echtes Programm und beruht auf keiner offiziellen Quelle.",
        requirements: "Beispielanforderung: Nachweis über Studienleistungen.",
        benefits: "Beispielvorteil: Teilstipendium für Lebenshaltungskosten.",
        eligibility: "Beispiel: Studierende im Bachelor- oder Masterstudium.",
      }],
      ["en", "human", "Demo exchange semester", "Sample card: test text for a one-semester exchange program with partial funding.", {
        description: "This is a fictional example for visual testing. It is not a real program and is not based on any official source.",
        requirements: "Sample requirement: proof of academic results.",
        benefits: "Sample benefit: a partial stipend for living costs.",
        eligibility: "Sample: students in a bachelor's or master's program.",
      }],
      // Incomplete on purpose: Azerbaijani has no requirements/benefits/eligibility yet (shown in German, labelled).
      ["az", "human", "Demo mübadilə semestri", "Nümunə kart: qismən maliyyələşdirilən bir semestrlik mübadilə proqramı üçün test mətni.", {
        description: "Bu, vizual test üçün uydurulmuş nümunədir. Real proqram deyil.",
      }],
      // No Russian row at all: Russian visitors see the German original, labelled.
    ],
    fields: { opportunityType: "exchange", locationType: "onsite", country: "DE", cityId: "berlin", educationLevels: ["bachelor", "master"],
      eligibleFields: ["engineering", "natural_sciences"], fundingType: "partially_funded", featured: true },
  },
  {
    id: "demo-04", slug: "demo-summer-school-science", org: ORGS.science, original: "en", publishedDaysAgo: 12, deadline: 45,
    rows: trio("en",
      ["Demo elm üzrə yay məktəbi", "Nümunə kart: iştirakçının ödədiyi qısamüddətli yay məktəbi üçün test mətni."],
      ["Демо-летняя школа по естественным наукам", "Пример карточки: тестовый текст для краткосрочной летней школы с оплатой участником."],
      ["Demo science summer school", "Sample card: test text for a short summer school paid by the participant."]),
    fields: { opportunityType: "summer_school", locationType: "onsite", country: "CH", cityId: "zurich", educationLevels: ["bachelor"],
      eligibleFields: ["natural_sciences"], fundingType: "unpaid", participationFeeAmount: 1200, participationFeeCurrency: "CHF" },
  },
  {
    id: "demo-05", slug: "demo-hackathon-weekend", org: ORGS.techCommunity, original: "az", publishedDaysAgo: 2, deadline: 5,
    rows: trio("az",
      ["Demo həftəsonu hakatonu", "Nümunə kart: tezliklə bitən onlayn hakaton üçün vizual test mətni."],
      ["Демо-хакатон выходного дня", "Пример карточки: тестовый текст для онлайн-хакатона, срок подачи которого скоро истекает."],
      ["Demo weekend hackathon", "Sample card: test text for an online hackathon whose deadline is approaching."]),
    fields: { opportunityType: "hackathon", locationType: "remote", country: "AZ", educationLevels: ["high_school", "bachelor", "graduate"],
      eligibleFields: ["ict"], fundingType: "not_specified" },
  },
  {
    id: "demo-06", slug: "demo-essay-competition", org: ORGS.youthCouncil, original: "az", publishedDaysAgo: 6, deadline: 28,
    rows: trio("az",
      ["Demo esse müsabiqəsi", "Nümunə kart: həm yerli, həm beynəlxalq iştirakçılar üçün açıq müsabiqə mətni."],
      ["Демо-конкурс эссе", "Пример карточки: текст конкурса, открытого как для местных, так и для международных участников."],
      ["Demo essay competition", "Sample card: competition text open to both local and international participants."]),
    // Remote, no host country, no eligibility limits → "both" markets.
    fields: { opportunityType: "competition", locationType: "remote", country: null, educationLevels: ["high_school", "bachelor"], fundingType: "unpaid" },
  },
  {
    id: "demo-07", slug: "demo-data-analytics-training", org: ORGS.academy, original: "az", publishedDaysAgo: 15, deadline: null,
    rows: trio("az",
      ["Demo məlumat analitikası təlimi", "Nümunə kart: davamlı qəbulu olan pulsuz onlayn təlim üçün vizual test mətni."],
      ["Демо-тренинг по аналитике данных", "Пример карточки: тестовый текст для бесплатного онлайн-тренинга с непрерывным набором."],
      ["Demo data analytics training", "Sample card: test text for a free online training with rolling admission."]),
    fields: { opportunityType: "training", locationType: "remote", country: "AZ", educationLevels: ["bachelor", "graduate", "professional"],
      eligibleFields: ["ict", "business_law"], fundingType: "unpaid" },
  },
  {
    id: "demo-08", slug: "demo-project-management-certificate", org: ORGS.professional, original: "en", publishedDaysAgo: 20, deadline: null,
    rows: trio("en",
      ["Demo layihə idarəetməsi sertifikatı", "Nümunə kart: iştirakçının ödədiyi onlayn sertifikat proqramı üçün test mətni."],
      ["Демо-сертификат по управлению проектами", "Пример карточки: тестовый текст для онлайн-программы сертификации с оплатой участником."],
      ["Demo project management certificate", "Sample card: test text for an online certification program paid by the participant."]),
    fields: { opportunityType: "certification", locationType: "remote", country: "GB", educationLevels: ["professional", "graduate"],
      eligibleFields: ["business_law"], fundingType: "unpaid", participationFeeAmount: 300, participationFeeCurrency: "USD" },
  },
  {
    id: "demo-09", slug: "demo-research-fellowship", org: ORGS.research, original: "en", publishedDaysAgo: 9, deadline: 90,
    rows: [
      ["en", "original", "Demo research fellowship", "Sample card: test text for a fully funded PhD-level research program.", {
        description: "This is a fictional example for visual testing. It is not a real fellowship.",
        requirements: "Sample requirement: a research proposal.",
        benefits: "Sample benefit: full funding for the research period.",
      }],
      // Machine-approved by a moderator: public, but must carry the "machine-translated" notice.
      ["az", "machine_approved", "Demo tədqiqat qrantı", "Nümunə kart: doktorantura səviyyəsində tam maliyyələşdirilən tədqiqat proqramı üçün test mətni.", {
        description: "Bu, vizual test üçün uydurulmuş nümunədir. Real qrant deyil.",
      }],
      ["ru", "human", "Демо-исследовательский грант", "Пример карточки: тестовый текст для полностью финансируемой исследовательской программы уровня PhD."],
    ],
    fields: { opportunityType: "research", locationType: "onsite", country: "GB", cityId: "cambridge-gb", educationLevels: ["phd"],
      eligibleFields: ["natural_sciences", "ict"], fundingType: "fully_funded", featured: true },
  },
  {
    id: "demo-10", slug: "demo-university-admission-tr", org: ORGS.cityUniversity, original: "tr", publishedDaysAgo: 11, deadline: 50,
    rows: [
      // Original in Turkish; only English was added. Azerbaijani and Russian visitors see the Turkish original, labelled.
      ["tr", "original", "Demo lisans başvurusu", "Örnek kart: finansman bilgisi belirtilmeyen lisans başvurusu için görsel test metni."],
      ["en", "human", "Demo undergraduate admission", "Sample card: visual test text for an undergraduate admission with a tuition discount."],
    ],
    fields: { opportunityType: "admission", locationType: "onsite", country: "TR", cityId: "istanbul", educationLevels: ["bachelor"],
      fundingType: "tuition_discount", fundingPercent: 30 },
  },
  {
    id: "demo-11", slug: "demo-graduate-internship-nl", org: ORGS.consulting, original: "en", publishedDaysAgo: 4, deadline: 75,
    rows: trio("en",
      ["Demo məzunlar üçün beynəlxalq təcrübə", "Nümunə kart: məzunlar üçün ödənişli xaricdə təcrübə proqramı üçün test mətni."],
      ["Демо-международная стажировка для выпускников", "Пример карточки: тестовый текст для оплачиваемой стажировки за рубежом для выпускников."],
      ["Demo international graduate internship", "Sample card: test text for a paid internship abroad for graduates."]),
    fields: { opportunityType: "internship", locationType: "onsite", country: "NL", cityId: "amsterdam", educationLevels: ["graduate"],
      eligibleFields: ["business_law"], fundingType: "paid", fundingAmount: 1500, fundingCurrency: "EUR", fundingPeriod: "monthly" },
  },
  {
    id: "demo-12", slug: "demo-masters-scholarship-us", org: ORGS.fellowship, original: "en", publishedDaysAgo: 7, deadline: 120,
    rows: trio("en",
      ["Demo magistr təqaüdü", "Nümunə kart: xaricdə təhsil üçün tam maliyyələşdirilən təqaüd proqramı üçün test mətni."],
      ["Демо-стипендия для магистратуры", "Пример карточки: тестовый текст для полностью финансируемой стипендии для обучения за рубежом."],
      ["Demo master's scholarship", "Sample card: test text for a fully funded scholarship to study abroad."]),
    fields: { opportunityType: "scholarship", locationType: "onsite", country: "US", cityId: "boston", educationLevels: ["master", "phd"],
      eligibleFields: ["social_sciences", "business_law"], eligibleCountries: ["AZ", "GE", "KZ"], fundingType: "fully_funded" },
  },
  {
    id: "demo-13", slug: "demo-bank-trainee-program", org: ORGS.bank, original: "az", publishedDaysAgo: 10, deadline: 40,
    // Azerbaijani only: Russian and English visitors see the original, labelled.
    rows: [["az", "original", "Demo bank trainee proqramı", "Nümunə kart: yalnız Azərbaycan dilində mövcud olan trainee proqramı üçün vizual test mətni."]],
    fields: { opportunityType: "internship", locationType: "onsite", country: "AZ", cityId: "baku", educationLevels: ["bachelor", "graduate"],
      eligibleFields: ["business_law"], fundingType: "paid" },
  },
  {
    id: "demo-14", slug: "demo-regional-skills-training", org: ORGS.regional, original: "az", publishedDaysAgo: 13, deadline: 25,
    // Azerbaijani + English only.
    rows: [
      ["az", "original", "Demo regional bacarıq təlimi", "Nümunə kart: regionlarda keçirilən pulsuz təlim üçün vizual test mətni."],
      ["en", "human", "Demo regional skills training", "Sample card: visual test text for a free training held in the regions."],
    ],
    fields: { opportunityType: "training", locationType: "onsite", country: "AZ", cityId: "ganja", educationLevels: ["high_school"], fundingType: "unpaid" },
  },
  {
    id: "demo-15", slug: "demo-youth-leadership-program", org: ORGS.civic, original: "az", publishedDaysAgo: 1, deadline: 18,
    rows: trio("az",
      ["Demo gənc liderlik proqramı", "Nümunə kart: könüllülük və liderlik bacarıqlarına yönəlmiş pulsuz proqram üçün test mətni."],
      ["Демо-программа молодёжного лидерства", "Пример карточки: тестовый текст для бесплатной программы по волонтёрству и лидерским навыкам."],
      ["Demo youth leadership program", "Sample card: test text for a free program focused on volunteering and leadership skills."]),
    fields: { opportunityType: "other", otherTypeLabel: "Leadership program", locationType: "hybrid", country: "AZ", cityId: "baku",
      educationLevels: ["bachelor", "graduate"], eligibleFields: ["social_sciences"], fundingType: "unpaid" },
  },
  {
    id: "demo-16", slug: "demo-expired-scholarship", org: ORGS.stateAgency, original: "az", publishedDaysAgo: 40, deadline: -6,
    // Deadline already passed: must never appear in listings (kept to prove expiry handling).
    rows: trio("az",
      ["Demo bitmiş təqaüd (müddəti keçib)", "Nümunə kart: son tarixi keçmiş, siyahıda göstərilməməli olan test qeydi."],
      ["Демо-стипендия с истёкшим сроком", "Пример карточки: тестовая запись с истёкшим сроком, которая не должна показываться в списках."],
      ["Demo expired scholarship", "Sample card: test record with a passed deadline that must not appear in listings."]),
    fields: { opportunityType: "scholarship", locationType: "onsite", country: "AZ", cityId: "baku", educationLevels: ["bachelor"], fundingType: "partially_funded" },
  },
  {
    id: "demo-17", slug: "demo-startup-grant", org: ORGS.startupFund, original: "az", publishedDaysAgo: 6, deadline: 55,
    rows: trio("az",
      ["Demo startap qrantı", "Nümunə kart: gənc sahibkarlar üçün birdəfəlik maliyyə dəstəyi nəzərdə tutan qrant mətni."],
      ["Демо-грант для стартапов", "Пример карточки: текст гранта с разовой финансовой поддержкой для молодых предпринимателей."],
      ["Demo startup grant", "Sample card: grant text offering one-off financial support for young entrepreneurs."]),
    fields: { opportunityType: "grant", locationType: "onsite", country: "AZ", cityId: "sumgait", educationLevels: ["bachelor", "graduate", "professional"],
      eligibleFields: ["business_law", "ict"], eligibleCountries: ["AZ"], fundingType: "fully_funded", fundingAmount: 5000, fundingCurrency: "USD", fundingPeriod: "total" },
  },
  {
    id: "demo-18", slug: "demo-nakhchivan-scholarship", org: ORGS.nakhchivanFund, original: "az", publishedDaysAgo: 2, deadline: 33,
    rows: trio("az",
      ["Demo Naxçıvan regional təqaüdü", "Nümunə kart: Naxçıvanda təhsil alan tələbələr üçün qismən maliyyələşdirilən yerli təqaüd mətni."],
      ["Демо-региональная стипендия Нахичевани", "Пример карточки: текст местной стипендии с частичным финансированием для студентов, обучающихся в Нахичевани."],
      ["Demo Nakhchivan regional scholarship", "Sample card: text of a local, partially funded scholarship for students studying in Nakhchivan."]),
    fields: { opportunityType: "scholarship", locationType: "onsite", country: "AZ", cityId: "nakhchivan", educationLevels: ["bachelor"],
      eligibleFields: ["education", "social_sciences"], eligibleCountries: ["AZ"], fundingType: "partially_funded", fundingAmount: 250, fundingCurrency: "AZN", fundingPeriod: "monthly" },
  },
  {
    id: "demo-19", slug: "demo-mingachevir-engineering-internship", org: ORGS.energy, original: "az", publishedDaysAgo: 3, deadline: 48,
    rows: trio("az",
      ["Demo Mingəçevir mühəndislik təcrübəsi", "Nümunə kart: Mingəçevirdə ödənişli mühəndislik təcrübə proqramı üçün vizual test mətni."],
      ["Демо-инженерная стажировка в Мингечевире", "Пример карточки: тестовый текст для оплачиваемой инженерной стажировки в Мингечевире."],
      ["Demo Mingachevir engineering internship", "Sample card: visual test text for a paid engineering internship in Mingachevir."]),
    fields: { opportunityType: "internship", locationType: "onsite", country: "AZ", cityId: "mingachevir", educationLevels: ["bachelor", "graduate"],
      eligibleFields: ["engineering"], fundingType: "paid", fundingAmount: 600, fundingCurrency: "AZN", fundingPeriod: "monthly" },
  },
  {
    id: "demo-20", slug: "demo-ganja-it-internship", org: ORGS.digital, original: "az", publishedDaysAgo: 4, deadline: 9,
    rows: trio("az",
      ["Demo Gəncə İT təcrübə proqramı", "Nümunə kart: Gəncədə hibrid formatlı İT təcrübəsi üçün vizual test mətni."],
      ["Демо-IT-стажировка в Гяндже", "Пример карточки: тестовый текст для IT-стажировки в гибридном формате в Гяндже."],
      ["Demo Ganja IT internship", "Sample card: visual test text for a hybrid IT internship in Ganja."]),
    fields: { opportunityType: "internship", locationType: "hybrid", country: "AZ", cityId: "ganja", educationLevels: ["bachelor"],
      eligibleFields: ["ict"], fundingType: "paid", fundingAmount: 500, fundingCurrency: "AZN", fundingPeriod: "monthly" },
  },
  {
    id: "demo-21", slug: "demo-expired-internship", org: ORGS.bank, original: "az", publishedDaysAgo: 35, deadline: -12,
    // Second expired record: lets the "Expired" filter and the expired card style be tested.
    rows: trio("az",
      ["Demo bitmiş təcrübə proqramı (müddəti keçib)", "Nümunə kart: müraciət müddəti başa çatmış təcrübə proqramı üçün test qeydi."],
      ["Демо-стажировка с истёкшим сроком", "Пример карточки: тестовая запись о стажировке, приём заявок на которую завершён."],
      ["Demo expired internship", "Sample card: test record for an internship whose application period has ended."]),
    fields: { opportunityType: "internship", locationType: "onsite", country: "AZ", cityId: "baku", educationLevels: ["bachelor"],
      eligibleFields: ["business_law"], fundingType: "paid" },
  },
  {
    id: "demo-22", slug: "demo-shaki-crafts-training", org: ORGS.craftsCenter, original: "az", publishedDaysAgo: 14, deadline: 29, // not exactly 30: keeps the "within 30 days" demo off the boundary
    rows: trio("az",
      ["Demo Şəki sənətkarlıq təlimi", "Nümunə kart: Şəkidə keçirilən pulsuz ənənəvi sənətkarlıq təlimi üçün vizual test mətni."],
      ["Демо-обучение ремёслам в Шеки", "Пример карточки: тестовый текст для бесплатного обучения традиционным ремёслам в Шеки."],
      ["Demo Shaki crafts training", "Sample card: visual test text for a free traditional crafts training held in Shaki."]),
    fields: { opportunityType: "training", locationType: "onsite", country: "AZ", cityId: "shaki", educationLevels: ["high_school", "bachelor"],
      eligibleFields: ["arts_humanities", "services"], fundingType: "unpaid" },
  },
];

/** Built per call so relative dates are always computed from the current time. */
export function getDemoRecords(): OpportunityRecord[] {
  const now = new Date().toISOString();
  return seeds.map((seed, index): OpportunityRecord => {
    const f = seed.fields ?? {};
    // The index offset (≈86 s per record) keeps timestamps distinct, so date sorting is deterministic.
    const published = at(-seed.publishedDaysAgo - index / 1000);
    const updatedDaysAgo = Math.min(seed.publishedDaysAgo, seed.updatedDaysAgo ?? (index * 5) % 9);
    const opportunity: Opportunity = {
      id: seed.id,
      slug: seed.slug,
      organizationId: seed.org.id,
      opportunityType: "other",
      otherTypeLabel: null,
      locationType: "onsite",
      country: null,
      cityId: null,
      cityText: null,
      educationLevels: [],
      eligibleFields: [],
      eligibleCountries: null,
      fundingType: "not_specified",
      fundingAmount: null,
      fundingCurrency: null,
      fundingPeriod: null,
      fundingPercent: null,
      participationFeeAmount: null,
      participationFeeCurrency: null,
      applicationUrl: `https://example.com/demo/${seed.slug}/apply`,
      officialSourceUrl: `https://example.com/demo/${seed.slug}`,
      applicationStartDate: seed.start === undefined ? at(-seed.publishedDaysAgo) : at(seed.start),
      applicationDeadline: seed.deadline === null ? null : at(seed.deadline),
      deadlineType: seed.deadline === null ? "rolling" : "fixed",
      deadlineTimezone: "Asia/Baku",
      publicationStatus: "published",
      // Demo data never claims to be verified.
      verificationStatus: "unverified",
      lastVerifiedAt: null,
      verifiedBy: null,
      originalLanguage: seed.original,
      contentVersion: 1,
      isDemo: true,
      featured: false,
      publishedAt: published,
      createdBy: null,
      createdAt: published,
      updatedAt: at(-updatedDaysAgo - index / 1000),
      ...f,
    };
    return {
      ...opportunity,
      organization: seed.org,
      translations: makeRows(seed.id, seed.original, seed.rows, now),
      categories: [opportunity.opportunityType],
    };
  });
}
