import type { Locale } from "@/i18n/routing";
import type { FundingPeriod, FundingType, Opportunity } from "@/types/opportunity";

type FundingFields = Pick<
  Opportunity,
  "fundingType" | "fundingAmount" | "fundingCurrency" | "fundingPeriod" | "fundingPercent" | "participationFeeAmount" | "participationFeeCurrency"
>;

/** Funding types where the provider gives the participant something of value. */
const PROVIDER_FUNDED: readonly FundingType[] = ["fully_funded", "partially_funded", "paid", "tuition_discount"];
export const providesFunding = (type: FundingType) => PROVIDER_FUNDED.includes(type);

/** Funding types that may carry a monetary amount. */
const AMOUNT_ALLOWED: readonly FundingType[] = ["fully_funded", "partially_funded", "paid", "tuition_discount"];
export const allowsFundingAmount = (type: FundingType) => AMOUNT_ALLOWED.includes(type);

export const hasFundingAmount = (o: Pick<FundingFields, "fundingAmount" | "fundingCurrency">) =>
  o.fundingAmount !== null && o.fundingCurrency !== null;

export const hasParticipationFee = (o: Pick<FundingFields, "participationFeeAmount" | "participationFeeCurrency">) =>
  o.participationFeeAmount !== null && o.participationFeeCurrency !== null;

/** Money in the source's own currency; amounts are never converted silently (INTERNATIONALIZATION.md §5). */
export function formatAmount(amount: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
}

export function formatFundingAmount(o: Pick<FundingFields, "fundingAmount" | "fundingCurrency">, locale: Locale): string | null {
  return o.fundingAmount !== null && o.fundingCurrency !== null ? formatAmount(o.fundingAmount, o.fundingCurrency, locale) : null;
}

export function formatParticipationFee(o: Pick<FundingFields, "participationFeeAmount" | "participationFeeCurrency">, locale: Locale): string | null {
  return o.participationFeeAmount !== null && o.participationFeeCurrency !== null
    ? formatAmount(o.participationFeeAmount, o.participationFeeCurrency, locale)
    : null;
}

/** Message key suffix for the period ("funding.period.monthly"); null for one-off totals. */
export const fundingPeriodKey = (period: FundingPeriod | null): "monthly" | "yearly" | null =>
  period === "monthly" || period === "yearly" ? period : null;
