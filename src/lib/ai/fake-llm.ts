import type { Locale } from "@/i18n/routing";
import type { LlmClient, LlmRequest, LlmResult } from "./llm";
import { SECTION_HEADINGS } from "./prompt";

/**
 * DEVELOPMENT / TEST ONLY. A deterministic stand-in for the language model (AI_FAKE=1), so the
 * whole AI pipeline — routes, limits, sanitising, checks and UI in all three languages — can be
 * exercised where no provider key or network exists. It only rephrases the structured data it is
 * given; it knows nothing else. Special words in the question trigger the failure modes the
 * service must survive (TEST-UNGROUNDED, TEST-LINK, TEST-WRONG-LANGUAGE, TEST-FAIL).
 */
if (process.env.NODE_ENV === "production") throw new Error("The fake LLM must never be loaded in production.");

const L: Record<Locale, { title: string; org: string; deadline: string; none: string; score: (n: number) => string; notAdmission: string; met: string; unmet: string; unknown: string; question: string; notStated: string; steps: string; improve: string }> = {
  az: {
    title: "Başlıq", org: "Təşkilat", deadline: "Son tarix", none: "rəsmi qeydə göstərilməyib", score: (n) => `Uyğunluq balı ${n}/100`, notAdmission: "Bu bal qəbul ehtimalı deyil, yalnız elan edilmiş meyarlara uyğunluğu göstərir.",
    met: "Uyğun gələnlər", unmet: "Uyğun gəlməyənlər", unknown: "Yoxlana bilməyənlər", question: "Sualınız", notStated: "Rəsmi qeydə bu barədə məlumat yoxdur; rəsmi mənbəni yoxlayın.", steps: "Müraciət üçün rəsmi səhifəni açın və tələbləri oxuyun.", improve: "Profilinizdə çatışmayan sahələri doldurun.",
  },
  ru: {
    title: "Название", org: "Организация", deadline: "Срок подачи", none: "в официальной записи не указано", score: (n) => `Балл соответствия ${n}/100`, notAdmission: "Этот балл не вероятность поступления, а лишь соответствие опубликованным критериям.",
    met: "Подходит", unmet: "Не подходит", unknown: "Нельзя проверить", question: "Ваш вопрос", notStated: "В официальной записи об этом не сказано; проверьте официальный источник.", steps: "Откройте официальную страницу и прочитайте требования.", improve: "Заполните недостающие поля профиля.",
  },
  en: {
    title: "Title", org: "Organization", deadline: "Deadline", none: "not stated in the official record", score: (n) => `Match score ${n}/100`, notAdmission: "This score is not a probability of admission; it only shows fit with the published criteria.",
    met: "Fits", unmet: "Does not fit", unknown: "Cannot be checked", question: "Your question", notStated: "The official record does not state this; check the official source.", steps: "Open the official page and read the requirements.", improve: "Fill in the missing profile fields.",
  },
};

const CRITERIA: Record<Locale, Record<string, string>> = {
  az: { open: "müraciət açıqdır", education: "təhsil səviyyəsi", field: "təhsil sahəsi", country: "ölkə şərti", type: "imkan növü", location: "məkan", interests: "bacarıq və maraqlar", language: "dil" },
  ru: { open: "приём заявок открыт", education: "уровень образования", field: "направление", country: "страна", type: "тип возможности", location: "место", interests: "навыки и интересы", language: "язык" },
  en: { open: "applications are open", education: "education level", field: "field of study", country: "country", type: "opportunity type", location: "location", interests: "skills and interests", language: "language" },
};

export class FakeLlm implements LlmClient {
  async complete({ meta }: LlmRequest): Promise<LlmResult> {
    const { locale, facts, match, task, question } = meta;
    const t = L[locale];
    const names = CRITERIA[locale];
    const q = question ?? "";
    if (q.includes("TEST-FAIL")) return { ok: false, reason: "failed" };
    if (q.includes("TEST-WRONG-LANGUAGE")) return { ok: true, text: "This answer is deliberately written in the wrong language for the interface. ".repeat(3), truncated: false };

    const list = (status: string) => match.criteria.filter((c) => c.status === status).map((c) => names[c.id] ?? c.id);
    const headings = SECTION_HEADINGS[locale];
    const official = [
      `${t.title}: ${facts.title.text}`,
      `${t.org}: ${facts.organization.name}`,
      `${t.deadline}: ${facts.deadline.iso ? facts.deadline.iso.slice(0, 10) : t.none}`,
    ];
    if (task === "ask" && q.includes("deadline") === false && /(salary|maaş|зарплат|stipend|стипенд|təqaüd)/i.test(q) && facts.funding.amount === null) official.push(t.notStated);

    const ai: string[] = [t.score(match.score), t.notAdmission];
    if (task === "ask") ai.push(`${t.question}: ${q.slice(0, 120)}`);
    if (task === "application_steps") ai.push(t.steps);
    if (task === "profile_improvements") ai.push(t.improve);
    for (const [label, status] of [[t.met, "met"], [t.unmet, "unmet"], [t.unknown, "unknown"]] as const) {
      const items = list(status);
      if (items.length) ai.push(`${label}: ${items.join(", ")}`);
    }
    let text = `${headings.official}\n- ${official.join("\n- ")}\n\n${headings.ai}\n- ${ai.join("\n- ")}`;
    if (q.includes("TEST-UNGROUNDED")) text += "\n- 98765";
    if (q.includes("TEST-LINK")) text += "\n- https://evil.example/apply [click](https://evil.example)";
    return { ok: true, text, truncated: false };
  }
}
