import { Target } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/container";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MatchView, ScoreMeter } from "@/features/matching/match-view";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { getAuthContext, requireUser } from "@/lib/auth/session";
import { rankMatches, toMatchProfile } from "@/lib/matching/engine";
import { buildMetadata } from "@/lib/metadata";
import { resolveContent } from "@/lib/opportunities/translations";
import { cn } from "@/lib/utils";
import { listOpportunitiesForMatching } from "@/services/opportunities";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return buildMetadata({ locale, path: "/matches", title: t("matchesTitle"), description: t("matchesDescription"), noindex: true });
}

const MAX_SHOWN = 30;

/**
 * Rule-based matches for the signed-in visitor: pure computation, no AI, no external service.
 * The profile is the visitor's own (server-verified session, row level security).
 */
export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await requireUser(locale, "/matches");
  const { profiles } = await getAuthContext();
  const [profile, records] = await Promise.all([profiles ? profiles.get(user.id) : null, listOpportunitiesForMatching(200)]);
  const ranked = rankMatches(toMatchProfile(profile), records).slice(0, MAX_SHOWN);
  const t = await getTranslations("matching");
  const tLife = await getTranslations("lifecycle");
  const tDemo = await getTranslations("demo");

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        <p className="mt-4 rounded-xl border bg-secondary px-3.5 py-3 text-sm text-primary" data-testid="matches-disclaimer">
          {t("disclaimer")}
        </p>

        {profile === null && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed px-4 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="matches-no-profile">
            <div>
              <p className="font-semibold text-primary">{t("list.emptyProfileTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("list.emptyProfileText")}</p>
            </div>
            <Button asChild size="sm">
              <Link href="/profile">{t("panel.completeProfile")}</Link>
            </Button>
          </div>
        )}

        <p className="mt-6 text-sm text-muted-foreground">{t("list.rankedBy")}</p>

        <div className="mt-4">
          {ranked.length === 0 ? (
            <EmptyState icon={Target} title={t("list.empty")} />
          ) : (
            <ul className="space-y-4" data-testid="matches-list">
              {ranked.map(({ record, match }) => {
                const content = resolveContent(record, locale as Locale);
                const dimmed = match.band === "closed" || match.band === "ineligible";
                return (
                  <li key={record.id} className={cn("rounded-2xl border p-5 sm:p-6", dimmed ? "border-dashed bg-muted/50" : "bg-card shadow-card")} data-testid="match-item" data-band={match.band} data-slug={record.slug}>
                    <div className="flex flex-wrap items-center gap-2">
                      {match.band === "closed" && <Badge variant="muted">{tLife("expired")}</Badge>}
                      {record.isDemo && <Badge variant="demo">{tDemo("badge")}</Badge>}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold leading-snug">
                      <Link href={`/opportunities/${record.slug}`} lang={content.title.language} className="text-primary hover:underline">
                        {content.title.value}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted-foreground">{record.organization.name}</p>
                    <div className="mt-4">
                      <ScoreMeter match={match} />
                    </div>
                    <details className="mt-4 group">
                      <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent hover:underline">
                        {t(`band.${match.band}`)}
                        {match.missing.length > 0 && <span className="ml-2 font-normal text-muted-foreground">· {t("list.missingCount", { count: match.missing.length })}</span>}
                      </summary>
                      <div className="mt-3">
                        <MatchView match={match} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Container>
  );
}
