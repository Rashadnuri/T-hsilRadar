# TəhsilRadar — Matching engine and AI explanations

Status: implemented. Two layers, deliberately separate:

1. **Rule-based matching** (`src/lib/matching/`) — deterministic, transparent, always available.
2. **AI explanations** (`src/lib/ai/`) — optional; explains and answers questions about one opportunity, grounded in its official record.

> **A match score is not an admission probability.** It says how well a profile fits the *published* criteria. It is labelled so everywhere it is shown (UI, API docs, AI prompt) in az, ru and en.

## 1. Rule-based engine

Pure functions (`matchOpportunity(profile, record, now)`): same inputs → same result; no network, database, LLM or clock other than the injected `now`. Reads only: education level, academic field, graduation year, country of residence, preferred countries, skills, languages, career interests, preferred opportunity types. Name, e-mail and university are not part of its input type.

| Criterion | Kind | Weight | Rule |
|---|---|---|---|
| `open` | mandatory | 10 | Expired (deadline passed / flagged expired) → unmet ("closed"). Rolling / unknown deadline / not open yet → met with a note. |
| `education` | mandatory | 20 | Applies when the record lists levels. Level must be accepted. "Graduate" programmes also accept bachelor/master/PhD holders whose graduation year is ≤ the current year; the year is required (otherwise *unknown*). |
| `field` | mandatory | 15 | Applies when the record lists fields (and not `general`). |
| `country` | mandatory | 15 | Applies when the record limits eligible countries. Compared with the country of **residence** (citizenship is not stored); the explanation says to check the official page. |
| `type` | preference | 15 | Opportunity type ∈ preferred types. |
| `location` | preference | 10 | Host country ∈ preferred countries; remote = partial credit (0.7). |
| `interests` | preference | 15 | Skills + career interests found (accent/case-folded, word-start match) in the record's public text in any language. Two terms = full credit, one among several = partial. No/too little text → *unknown*. |
| `language` | preference | 5 | A published language the user reads at ≥ B1 (full) or A1–A2 (partial). |

**Statuses:** `met`, `partial`, `unmet`, `unknown`. *Unknown* (missing profile data) never counts against the person: it is excluded from the score and lowers `completeness`.

**Score** = round(100 × Σ earned ÷ Σ weight) over criteria that apply **and** could be evaluated. If any mandatory criterion is unmet the score is capped at 39 and eligibility is `not_eligible`. If a mandatory one is unknown, eligibility is `unknown`.

**Bands:** `closed` (deadline passed) → `ineligible` → `insufficient` (completeness < 50 %) → `strong` ≥ 75 → `good` ≥ 55 → `partial` ≥ 40 → `low`.

**Explanations are data, not prose:** each criterion carries a status plus codes (`accepted`, `yours`, `matched`, `note`); the UI maps `criterionMessageKey()` to `matching.criteria.<id>.<variant>` in the visitor's language. A test proves every key the engine can produce exists in all three message files.

`reasons` (met/partial), `missing` (unmet, mandatory first) and `unknown` (needs data) partition the criteria. `needsManualReview` is set when the record has free-text requirements (grades, tests, documents) the engine cannot check — the UI says so.

Where it is shown: `/[locale]/matches` (ranked list, server-rendered, own profile only) and the "How well it fits you" panel on every opportunity page (client fetch of `GET /api/matching/[id]`, signed-in only, `no-store`).

**Known limits:** skills are compared by text, so an English skill list won't match an Azerbaijani-only description; graduation year handles only the "graduate" rule; there is no structured language/GPA requirement in the data model yet.

## 2. AI explanations

`POST /api/ai/opportunity` `{ opportunityId, task, locale, question? }`, tasks: `why_suits`, `eligibility_summary`, `application_steps`, `profile_improvements`, `ask`.

Pipeline (`src/lib/ai/service.ts`): availability → input validation → rate limit → read public record + own profile → grounded prompt → (cache) → model → sanitize + verify → answer.

* **Provider:** the official `@anthropic-ai/sdk` (server only), model from `AI_MODEL` (default `claude-opus-5-5`, effort `low`, refusal fallbacks on). The request has **no tools**.
* **Optional:** no `ANTHROPIC_API_KEY` (or `AI_ENABLED=false`) → the AI panel says it is unavailable, the endpoint answers `503 ai_unavailable`; matching and the rest of the site are unaffected. `AI_FAKE=1` (development only) swaps in a deterministic stand-in so the pipeline can be tested without a key.
* **Languages:** the system prompt requires the answer in az/ru/en (set from the page language); the answer is script-checked (`language_mismatch` warning). The answer has two headings in that language — official record vs AI suggestions.
* **Grounding:** the model sees only a facts packet built from the public record (+ `not_stated` list), the deterministic match result and a minimal profile summary. The prompt forbids inventing deadlines, criteria, benefits, amounts, steps or URLs. Output is checked: numbers (≥ 2 digits) that do not occur in the input are flagged `unverified_numbers`; links/HTML/e-mails are removed (`links_removed`).
* **Official vs AI:** the answer is shown in a separate card labelled "AI-generated", with a standing "not official — check the source" notice; official data stays in the normal page sections.

### Security
See SECURITY.md §18: key server-side only, same-origin + session required, strict validation, per-user and global rate limits, prompt-injection defences (fixed system prompt, delimited untrusted data, bracket neutralisation, question screening, output sanitising), minimal personal data, read-only by construction.

### Not verified here
The real provider call could not be made in the development sandbox (no key, no network): the Anthropic client is tested with a mocked SDK (request shape, error mapping). Run one real request per language with a key before launch and review the answers with native speakers.
