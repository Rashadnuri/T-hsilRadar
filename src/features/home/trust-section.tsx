import { getTranslations } from "next-intl/server";
import { Container } from "@/components/layout/container";
import { SectionHeading } from "@/components/shared/section-heading";
import { PrincipleList } from "./principles";

export async function TrustSection() {
  const t = await getTranslations("home");
  return (
    <section aria-labelledby="trust-heading" className="py-16 sm:py-20">
      <Container>
        <SectionHeading id="trust-heading" title={t("trust.title")} description={t("trust.subtitle")} />
        <div className="mt-8">
          <PrincipleList />
        </div>
      </Container>
    </section>
  );
}
