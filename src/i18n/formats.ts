import type { Formats } from "next-intl";

/** Named formats usable as t("…", { d: date }) or format.dateTime(date, "deadline"). */
export const formats: Formats = {
  dateTime: {
    short: { day: "numeric", month: "short", year: "numeric" },
    long: { day: "numeric", month: "long", year: "numeric" },
    deadline: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" },
  },
  number: {
    plain: { useGrouping: false },
    compact: { notation: "compact" },
  },
};

/** Opportunity deadlines are shown in Baku time unless stated otherwise (PRODUCT_SPEC §7.3). */
export const DEFAULT_TIME_ZONE = "Asia/Baku";
