"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { AI_TASKS, QUESTION_MAX_LENGTH, type AiTask } from "@/lib/ai/tasks";

type Answer = { text: string; warnings: string[]; task: AiTask };
type Failure = { code: string; retryAfter?: number };

const BUTTON_TASKS = AI_TASKS.filter((t) => t !== "ask");
const KNOWN_ERRORS = ["ai_unavailable", "rate_limited", "invalid_question", "invalid_request", "not_found", "ai_failed", "unauthorized", "forbidden"];

/**
 * AI explanations for one opportunity. Everything here is visibly separate from the official
 * record: a labelled card ("AI-generated"), a standing notice that it is not official, and the
 * answer rendered as plain text (never as HTML). The browser sends only an id, a task name, its
 * language and a short question; the provider key never reaches this component.
 */
export function AiAssistant({ opportunityId }: { opportunityId: string }) {
  const t = useTranslations("ai");
  const locale = useLocale();
  const [busy, setBusy] = useState<AiTask | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [question, setQuestion] = useState("");
  const inFlight = useRef(false);

  async function run(task: AiTask) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(task);
    setFailure(null);
    try {
      const response = await fetch("/api/ai/opportunity", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId, task, locale, ...(task === "ask" ? { question } : {}) }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; retryAfterSeconds?: number; answer?: { text: string; warnings: string[] } } | null;
      if (response.ok && data?.ok && data.answer) setAnswer({ text: data.answer.text, warnings: data.answer.warnings, task });
      else setFailure({ code: data?.error ?? "ai_failed", retryAfter: data?.retryAfterSeconds });
    } catch {
      setFailure({ code: "ai_failed" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const errorText = failure ? t(`errors.${KNOWN_ERRORS.includes(failure.code) ? failure.code : "ai_failed"}` as never, { seconds: failure.retryAfter ?? 30 } as never) : null;
  const canAsk = question.trim().length >= 3 && question.length <= QUESTION_MAX_LENGTH && busy === null;

  return (
    <section aria-labelledby="ai-heading" className="rounded-2xl border border-dashed border-accent/50 bg-secondary/40 p-5" data-testid="ai-assistant">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="ai-heading" className="text-lg font-semibold text-primary">
          {t("title")}
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
          <Sparkles className="size-3.5" aria-hidden="true" />
          {t("badge")}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t("notOfficial")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("privacy")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {BUTTON_TASKS.map((task) => (
          <Button key={task} type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(task)} data-task={task}>
            {t(`tasks.${task}` as never)}
          </Button>
        ))}
      </div>

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAsk) void run("ask");
        }}
      >
        <Label htmlFor="ai-question">{t("ask.label")}</Label>
        <Textarea id="ai-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={QUESTION_MAX_LENGTH} placeholder={t("ask.placeholder")} aria-describedby="ai-question-hint" className="min-h-16" />
        <p id="ai-question-hint" className="mt-1.5 text-xs text-muted-foreground">
          {t("ask.hint", { max: QUESTION_MAX_LENGTH })}
        </p>
        <Button type="submit" size="sm" className="mt-3" disabled={!canAsk}>
          {t("ask.submit")}
        </Button>
      </form>

      <div aria-live="polite" className="mt-4">
        {busy && (
          <p role="status" className="text-sm text-muted-foreground" data-testid="ai-working">
            {t("working")}
          </p>
        )}
        {errorText && (
          <p role="alert" className="text-sm text-destructive" data-testid="ai-error" data-code={failure?.code}>
            {errorText}
          </p>
        )}
        {answer && !busy && (
          <div className="rounded-xl border bg-background p-4" data-testid="ai-answer" data-task={answer.task}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">{t("answerLabel")}</p>
            {/* Plain text: whitespace preserved, never interpreted as HTML or Markdown. */}
            <div lang={locale} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground" data-testid="ai-answer-text">
              {answer.text}
            </div>
            {answer.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="ai-warnings">
                {answer.warnings.map((w) => (
                  <li key={w}>{t(`warnings.${w}` as never)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
