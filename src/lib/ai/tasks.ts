/** Shared (browser + server) constants of the AI feature. Deliberately free of prompt text and server code. */
export const AI_TASKS = ["why_suits", "eligibility_summary", "application_steps", "profile_improvements", "ask"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const QUESTION_MAX_LENGTH = 500;
