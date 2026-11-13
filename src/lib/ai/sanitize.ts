/**
 * Everything that reaches the model from outside our own code is UNTRUSTED: opportunity text
 * (written by third parties), the user's question, even profile free text (skills, interests).
 * These helpers shrink the attack surface; they are one layer of several (see prompt.ts).
 */

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

/**
 * Plain text, bounded, with no control or bidi-override characters (used to hide instructions)
 * and with angle brackets replaced by look-alikes, so untrusted text can never close or open
 * one of the delimiter tags the prompt uses.
 */
export function sanitizeUntrusted(value: string, maxLength: number): string {
  const cleaned = value
    .replace(CONTROL, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trimEnd()}…` : cleaned;
}

/**
 * Phrases typical of prompt-injection attempts. Used to REJECT a user's question (they are
 * pointless in a question about an opportunity) and to FLAG suspicious opportunity text; the
 * real protection is the prompt structure and the output checks, not this list.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|system)/i,
  /(reveal|show|print|repeat|output)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?|rules)/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /\bsystem\s*(prompt|message)\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\bjailbreak\b|\bDAN\s+mode\b/i,
  // Russian
  /игнориру(й|йте)\s+(все\s+)?(предыдущие|прежние|выше)/i,
  /(покажи|выведи|раскрой)\s+(свои\s+|системный\s+)?(инструкции|промпт)/i,
  /забудь\s+(все\s+)?(предыдущие|свои)\s+(инструкции|правила)/i,
  // Azerbaijani
  /(əvvəlki|yuxarıdakı)\s+(təlimat|qayda)\S*\s+(unut|nəzərə\s+alma|ignor)/i,
  /(unut|nəzərə\s+alma)\s+(bütün\s+)?(əvvəlki|yuxarıdakı)/i,
  /sistem\s+(təlimat|prompt)/i,
];

export const looksLikeInjection = (text: string): boolean => INJECTION_PATTERNS.some((p) => p.test(text));

/** Output cleanup: the model's answer is untrusted too. No HTML, no links, no addresses. */
export function sanitizeOutput(text: string, maxLength = 4000): { text: string; removedLinks: boolean } {
  let removedLinks = false;
  let out = text.replace(CONTROL, "");
  out = out.replace(/<[^>]*>/g, "");
  // [label](url) → label ; bare URLs and e-mail addresses are removed
  out = out.replace(/\[([^\]]*)\]\((?:[^)]*)\)/g, (_m, label: string) => {
    removedLinks = true;
    return label;
  });
  out = out.replace(/\b(?:https?:\/\/|www\.)\S+/gi, () => {
    removedLinks = true;
    return "";
  });
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => {
    removedLinks = true;
    return "";
  });
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (out.length > maxLength) out = `${out.slice(0, maxLength).trimEnd()}…`;
  return { text: out, removedLinks };
}
