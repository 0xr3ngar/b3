export type OptInCategory = "health" | "religion" | "politics" | "sexuality" | "gender_identity";

export type SensitiveResult = {
  blocked: boolean;
  reason?: string;
  optInCategory?: OptInCategory;
};

type SecretSpan = { start: number; end: number };

const KEYWORD_WINDOW = 80;
const REDACTED = "[redacted]";

const SSN_KEYWORDS = ["ssn", "social security"];
const ID_KEYWORDS = [
  "passport",
  "national id",
  "national identity",
  "id number",
  "identity number",
  "identity card",
  "id card",
  "citizen number",
  "registration number",
  "tax id",
  "taxpayer number",
  "driver's license",
  "drivers license",
  "driving licence",
  "license number",
  "licence number",
  "government id",
];
const TOKEN_KEYWORDS = [
  "api key",
  "apikey",
  "token",
  "secret",
  "credential",
  "password",
  "bearer",
  "access key",
  "private key",
  "auth",
];

const CRIMINAL_PATTERN =
  /\b(?:criminal record|police record|arrested|convicted of|charged with|felony|misdemeanour|misdemeanor|incarcerated|on probation|on parole|parole officer|in jail|in prison|went to jail|went to prison|spent time in (?:jail|prison)|dui|dwai)\b/i;
const IMMIGRATION_PATTERN =
  /\b(?:green card|visa status|visa application|visa renewal|visa interview|asylum|refugee status|undocumented|deportation|deported|immigration status|citizenship application|naturalization|permanent resident(?: card)?|i-94)\b/i;

const OPT_IN_PATTERNS: [OptInCategory, RegExp][] = [
  [
    "health",
    /\b(?:diagnosed with|my diagnosis|my medication|taking medication|chronic condition|chronic illness|my therapist|in therapy|my symptoms|terminal illness|hiv|hiv positive|my cancer)\b/i,
  ],
  [
    "religion",
    /\b(?:my religion|my faith|i go to church|my church|my mosque|my synagogue|i pray|i converted to|i(?: am|'m) (?:an? )?(?:christian|muslim|jew|jewish|buddhist|hindu|sikh|catholic|protestant|atheist|agnostic))\b/i,
  ],
  [
    "politics",
    /\b(?:my political (?:views|beliefs|opinions)|i(?: am|'m) (?:an? )?(?:democrat|republican|liberal|conservative|socialist|libertarian|anarchist)|i (?:vote|voted) for|who i vote for|my party is)\b/i,
  ],
  [
    "sexuality",
    /\b(?:my sexuality|i(?: am|'m) (?:gay|lesbian|bisexual|asexual|queer|straight|pansexual))\b/i,
  ],
  [
    "gender_identity",
    /\b(?:i(?: am|'m) (?:trans(?:gender)?|non-?binary|agender)|i identify as|my gender (?:identity|is))\b/i,
  ],
];

const hasKeywordNear = (text: string, start: number, end: number, keywords: string[]): boolean => {
  const from = Math.max(0, start - KEYWORD_WINDOW);
  const to = Math.min(text.length, end + KEYWORD_WINDOW);
  const window = text.slice(from, to).toLowerCase();
  return keywords.some((keyword) => window.includes(keyword));
};

const isLetterAt = (text: string, index: number): boolean => {
  if (index < 0 || index >= text.length) return false;
  return /[A-Za-z]/.test(text[index] ?? "");
};

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

const passesLuhn = (digits: string): boolean => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

const isValidSsn = (digits: string): boolean => {
  const area = Number.parseInt(digits.slice(0, 3), 10);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);
  return area !== 0 && area !== 666 && area < 900 && group !== "00" && serial !== "0000";
};

const findSsnSpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  const formatted = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
  for (const match of text.matchAll(formatted)) {
    if (!isValidSsn(digitsOnly(match[0]))) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  const bare = /\b\d{9}\b/g;
  for (const match of text.matchAll(bare)) {
    const start = match.index;
    const end = start + match[0].length;
    const isNearSsnKeyword = hasKeywordNear(text, start, end, SSN_KEYWORDS);
    if (!isNearSsnKeyword) continue;
    if (!isValidSsn(match[0])) continue;
    spans.push({ start, end });
  }
  return spans;
};

const findNationalIdSpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  const digitRun = /\b\d(?:[ -]?\d){5,14}\b/g;
  for (const match of text.matchAll(digitRun)) {
    const start = match.index;
    const end = start + match[0].length;
    const digits = digitsOnly(match[0]);
    const isPlausibleId = digits.length >= 6 && digits.length <= 15;
    if (!isPlausibleId) continue;
    const isStandalone = !isLetterAt(text, start - 1) && !isLetterAt(text, end);
    if (!isStandalone) continue;
    const isNearIdKeyword = hasKeywordNear(text, start, end, ID_KEYWORDS);
    if (!isNearIdKeyword) continue;
    spans.push({ start, end });
  }
  return spans;
};

const findCardSpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  const cardRun = /\b\d(?:[ -]?\d){12,18}\b/g;
  for (const match of text.matchAll(cardRun)) {
    const start = match.index;
    const end = start + match[0].length;
    const digits = digitsOnly(match[0]);
    const isCardLength = digits.length >= 13 && digits.length <= 19;
    if (!isCardLength) continue;
    const isStandalone = !isLetterAt(text, start - 1) && !isLetterAt(text, end);
    if (!isStandalone) continue;
    const allSame = digits.split("").every((digit) => digit === digits[0]);
    if (allSame) continue;
    if (!passesLuhn(digits)) continue;
    spans.push({ start, end });
  }
  return spans;
};

const findIbanSpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  const iban = /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]{4}){2,7} ?[A-Za-z0-9]{1,3}\b/g;
  for (const match of text.matchAll(iban)) {
    const compact = match[0].replace(/ /g, "");
    const isIbanLength = compact.length >= 15 && compact.length <= 34;
    if (!isIbanLength) continue;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
};

const API_KEY_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

const GENERIC_TOKEN_PATTERN = /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g;

const findApiKeySpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  for (const pattern of API_KEY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  for (const match of text.matchAll(GENERIC_TOKEN_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    const hasLetter = /[A-Za-z]/.test(match[0]);
    const hasDigit = /\d/.test(match[0]);
    const looksLikeToken = hasLetter && hasDigit;
    if (!looksLikeToken) continue;
    const isNearTokenKeyword = hasKeywordNear(text, start, end, TOKEN_KEYWORDS);
    if (!isNearTokenKeyword) continue;
    spans.push({ start, end });
  }
  return spans;
};

const PASSWORD_PATTERN =
  /\b(?:my |the )?(?:password|passphrase|passcode|pin)\s*(?:is|:|=)\s*["']?([^\s"']{4,})["']?/gi;

const findPasswordSpans = (text: string): SecretSpan[] => {
  const spans: SecretSpan[] = [];
  for (const match of text.matchAll(PASSWORD_PATTERN)) {
    const rawValue = match[1];
    if (rawValue === undefined) continue;
    const endsWithQuote = /["']$/.test(match[0]);
    const end = match.index + match[0].length - (endsWithQuote ? 1 : 0);
    let value = rawValue;
    while (value.length > 4 && /[.,;:!?)]$/.test(value)) {
      value = value.slice(0, -1);
    }
    if (value.length < 4) continue;
    spans.push({ start: end - value.length, end });
  }
  return spans;
};

const BLOCKED_SPAN_DETECTORS: { reason: string; find: (text: string) => SecretSpan[] }[] = [
  { reason: "US Social Security number", find: findSsnSpans },
  { reason: "passport or national ID number", find: findNationalIdSpans },
  { reason: "credit card number", find: findCardSpans },
  { reason: "IBAN", find: findIbanSpans },
  { reason: "API key or token", find: findApiKeySpans },
  { reason: "password", find: findPasswordSpans },
];

const BLOCKED_PHRASE_DETECTORS: { reason: string; pattern: RegExp }[] = [
  { reason: "criminal history", pattern: CRIMINAL_PATTERN },
  { reason: "immigration status", pattern: IMMIGRATION_PATTERN },
];

export const classifySensitive = (text: string): SensitiveResult => {
  for (const detector of BLOCKED_SPAN_DETECTORS) {
    const isBlocked = detector.find(text).length > 0;
    if (isBlocked) return { blocked: true, reason: detector.reason };
  }
  for (const detector of BLOCKED_PHRASE_DETECTORS) {
    const isBlocked = detector.pattern.test(text);
    if (isBlocked) return { blocked: true, reason: detector.reason };
  }
  for (const [category, pattern] of OPT_IN_PATTERNS) {
    const isPresent = pattern.test(text);
    if (isPresent) return { blocked: false, optInCategory: category };
  }
  return { blocked: false };
};

export const redactSecrets = (text: string): string => {
  const spans = BLOCKED_SPAN_DETECTORS.flatMap((detector) => detector.find(text));
  const hasSpans = spans.length > 0;
  if (!hasSpans) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SecretSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  let result = "";
  let cursor = 0;
  for (const span of merged) {
    result += `${text.slice(cursor, span.start)}${REDACTED}`;
    cursor = span.end;
  }
  return `${result}${text.slice(cursor)}`;
};
