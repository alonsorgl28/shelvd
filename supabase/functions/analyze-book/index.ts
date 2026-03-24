import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

type ImageInput = {
  data: string;
  mediaType: string;
};

type EditionSignals = {
  title: string | null;
  author: string | null;
  pages: number | null;
  isbn_13: string | null;
  isbn_10: string | null;
  publisher: string | null;
  published_year: number | null;
  edition: string | null;
  language: string | null;
  translator: string | null;
  format: string | null;
  confidence: number;
  missing_fields: string[];
  notes: string | null;
};

type CandidateEdition = {
  source: "google_books" | "open_library";
  source_id: string;
  title: string | null;
  author: string | null;
  pages: number | null;
  isbn_13: string | null;
  isbn_10: string | null;
  publisher: string | null;
  published_year: number | null;
  edition: string | null;
  language: string | null;
  format: string | null;
  cover_url: string | null;
  info_url: string | null;
  cover_quality: number;
  score?: number;
};

type MatchDecision = {
  selected_source_id: string | null;
  confidence: number;
  rationale: string | null;
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: DEFAULT_HEADERS,
  });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned : null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function parseYear(value: unknown): number | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match ? parseInt(match[1], 10) : null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeIsbn(value: unknown, length?: 10 | 13): string | null {
  if (value == null) return null;
  const raw = String(value).toUpperCase().replace(/[^0-9X]/g, "");
  if (!raw) return null;
  if (length) {
    if (raw.length !== length) return null;
    if (length === 10 && !/^\d{9}[\dX]$/.test(raw)) return null;
    if (length === 13 && !/^\d{13}$/.test(raw)) return null;
    return raw;
  }
  if (/^\d{13}$/.test(raw)) return raw;
  if (/^\d{9}[\dX]$/.test(raw)) return raw;
  return null;
}

function isbn10To13(isbn10: string | null): string | null {
  const normalized = normalizeIsbn(isbn10, 10);
  if (!normalized) return null;
  const core = `978${normalized.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < core.length; index += 1) {
    const digit = parseInt(core[index], 10);
    sum += digit * (index % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${core}${checkDigit}`;
}

function isbnVariants(value: string | null): string[] {
  const normalized = normalizeIsbn(value);
  if (!normalized) return [];
  if (normalized.length === 13) return [normalized];
  const isbn13 = isbn10To13(normalized);
  return isbn13 ? [normalized, isbn13] : [normalized];
}

function isSameIsbn(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const leftVariants = new Set(isbnVariants(left));
  return isbnVariants(right).some((variant) => leftVariants.has(variant));
}

function normalizeLanguage(value: unknown): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  if (cleaned.length <= 5) return cleaned.toLowerCase();
  return cleaned;
}

function normalizeMissingFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, arr) => arr.indexOf(entry) === index);
}

function normalizeEditionSignals(raw: Record<string, unknown>): EditionSignals {
  const normalized: EditionSignals = {
    title: cleanText(raw.title),
    author: cleanText(raw.author),
    pages: parsePositiveInt(raw.pages),
    isbn_13: normalizeIsbn(raw.isbn_13, 13),
    isbn_10: normalizeIsbn(raw.isbn_10, 10),
    publisher: cleanText(raw.publisher),
    published_year: parseYear(raw.published_year),
    edition: cleanText(raw.edition),
    language: normalizeLanguage(raw.language),
    translator: cleanText(raw.translator),
    format: cleanText(raw.format),
    confidence: clampConfidence(raw.confidence),
    missing_fields: normalizeMissingFields(raw.missing_fields),
    notes: cleanText(raw.notes),
  };

  if (!normalized.missing_fields.length) {
    const inferredMissing = [];
    if (!normalized.title) inferredMissing.push("title");
    if (!normalized.author) inferredMissing.push("author");
    if (!normalized.isbn_13 && !normalized.isbn_10) inferredMissing.push("isbn_13");
    if (!normalized.publisher) inferredMissing.push("publisher");
    normalized.missing_fields = inferredMissing;
  }

  return normalized;
}

function emptyEditionSignals(): EditionSignals {
  return normalizeEditionSignals({
    confidence: 0,
    missing_fields: ["title", "author", "isbn_13", "publisher"],
  });
}

function mergeSignalNotes(...notes: Array<string | null | undefined>) {
  const merged = notes
    .map((entry) => cleanText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
  return merged || null;
}

function mergeSignalsPreferExisting(base: EditionSignals, detail: Partial<EditionSignals>): EditionSignals {
  return normalizeEditionSignals({
    title: base.title || detail.title,
    author: base.author || detail.author,
    pages: base.pages || detail.pages,
    isbn_13: base.isbn_13 || detail.isbn_13,
    isbn_10: base.isbn_10 || detail.isbn_10,
    publisher: base.publisher || detail.publisher,
    published_year: base.published_year || detail.published_year,
    edition: base.edition || detail.edition,
    language: base.language || detail.language,
    translator: base.translator || detail.translator,
    format: base.format || detail.format,
    confidence: Math.max(base.confidence, detail.confidence || 0),
    missing_fields: [],
    notes: mergeSignalNotes(base.notes, detail.notes),
  });
}

function applyManualOverrides(signals: EditionSignals, raw: unknown): EditionSignals {
  const overrides = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return normalizeEditionSignals({
    title: cleanText(overrides.title) || signals.title,
    author: cleanText(overrides.author) || signals.author,
    pages: parsePositiveInt(overrides.pages) || signals.pages,
    isbn_13: normalizeIsbn(overrides.isbn_13, 13) || signals.isbn_13,
    isbn_10: normalizeIsbn(overrides.isbn_10, 10) || signals.isbn_10,
    publisher: cleanText(overrides.publisher) || signals.publisher,
    published_year: parseYear(overrides.published_year) || signals.published_year,
    edition: cleanText(overrides.edition) || signals.edition,
    language: normalizeLanguage(overrides.language) || signals.language,
    translator: cleanText(overrides.translator) || signals.translator,
    format: cleanText(overrides.format) || signals.format,
    confidence: signals.confidence,
    missing_fields: [],
    notes: signals.notes,
  });
}

async function callAnthropicJson<T>(
  content: Array<Record<string, unknown>>,
  maxTokens = 600,
): Promise<T> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Vision API error: ${JSON.stringify(data)}`);
  }

  const text = data.content?.[0]?.text || "";
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse JSON from vision response");
    return JSON.parse(match[0]) as T;
  }
}

async function extractEditionSignals(images: {
  cover: ImageInput;
  spine?: ImageInput | null;
  back?: ImageInput | null;
}): Promise<EditionSignals> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: "Front cover photo" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: images.cover.mediaType,
        data: images.cover.data,
      },
    },
  ];

  if (images.spine) {
    content.push({ type: "text", text: "Optional spine photo" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.spine.mediaType,
        data: images.spine.data,
      },
    });
  }

  if (images.back) {
    content.push({ type: "text", text: "Optional barcode / back cover photo" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.back.mediaType,
        data: images.back.data,
      },
    });
  }

  content.push({
    type: "text",
    text:
      `You are identifying a specific printed edition of a book from user photos.

Extract only what is strongly supported by the images. Prefer null over guessing.
Return ONLY valid JSON:
{
  "title": string|null,
  "author": string|null,
  "pages": number|null,
  "isbn_13": string|null,
  "isbn_10": string|null,
  "publisher": string|null,
  "published_year": number|null,
  "edition": string|null,
  "language": string|null,
  "translator": string|null,
  "format": string|null,
  "confidence": number,
  "missing_fields": string[],
  "notes": string|null
}

Rules:
- confidence is 0..1 and should reflect how reliable the extracted edition signals are.
- missing_fields may only include: title, author, isbn_13, publisher.
- If a barcode or ISBN is visible, extract it exactly.
- Pay special attention to tiny publisher marks, imprints, logos, and lower-edge text on the front cover.
- edition should be a human-readable label only if explicitly shown.
- format can be values like hardcover, paperback, mass market paperback, unknown; otherwise null.
- pages can be null if not visible and not strongly inferable.
- notes should briefly mention what remains ambiguous, or null.`,
  });

  const raw = await callAnthropicJson<Record<string, unknown>>(content, 500);
  return normalizeEditionSignals(raw);
}

async function extractFinePrintSignals(images: {
  cover: ImageInput;
  spine?: ImageInput | null;
  back?: ImageInput | null;
}): Promise<Partial<EditionSignals>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: "Inspect this cover carefully for tiny metadata: publisher imprint, logos, ISBN digits, year, subtitle, and author text.",
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: images.cover.mediaType,
        data: images.cover.data,
      },
    },
  ];

  if (images.spine) {
    content.push({ type: "text", text: "Inspect the spine for publisher, series, year, or ISBN fragments." });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.spine.mediaType,
        data: images.spine.data,
      },
    });
  }

  if (images.back) {
    content.push({ type: "text", text: "Inspect the back cover or barcode image. Prioritize ISBN/barcode digits and publisher details." });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.back.mediaType,
        data: images.back.data,
      },
    });
  }

  content.push({
    type: "text",
    text:
      `Return ONLY valid JSON:
{
  "title": string|null,
  "author": string|null,
  "isbn_13": string|null,
  "isbn_10": string|null,
  "publisher": string|null,
  "published_year": number|null,
  "confidence": number,
  "notes": string|null
}

Rules:
- Prefer null over guessing.
- Extract ISBN only when digits are visually supported.
- If you can read a publisher mark, use the publisher name, not a guess.
- confidence is 0..1.`,
  });

  const raw = await callAnthropicJson<Record<string, unknown>>(content, 280);
  return {
    title: cleanText(raw.title),
    author: cleanText(raw.author),
    isbn_13: normalizeIsbn(raw.isbn_13, 13),
    isbn_10: normalizeIsbn(raw.isbn_10, 10),
    publisher: cleanText(raw.publisher),
    published_year: parseYear(raw.published_year),
    confidence: clampConfidence(raw.confidence),
    notes: cleanText(raw.notes),
  };
}

async function extractReadableCoverSignals(images: {
  cover: ImageInput;
  spine?: ImageInput | null;
  back?: ImageInput | null;
}): Promise<Partial<EditionSignals>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: "Read the obvious large text on this printed book cover. Focus on the main title, author, and publisher imprint only.",
    },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: images.cover.mediaType,
        data: images.cover.data,
      },
    },
  ];

  if (images.spine) {
    content.push({ type: "text", text: "Use the spine only as support for title, author, or publisher if it is clearer there." });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.spine.mediaType,
        data: images.spine.data,
      },
    });
  }

  content.push({
    type: "text",
    text:
      `Return ONLY valid JSON:
{
  "title": string|null,
  "author": string|null,
  "publisher": string|null,
  "published_year": number|null,
  "confidence": number,
  "notes": string|null
}

Rules:
- Prefer null over guessing, but do extract the obvious front-cover title and author when they are clearly readable.
- Ignore edition matching and online covers.
- Ignore ISBN unless it is large and plainly readable.
- publisher should only be filled if a publisher mark or imprint is visible.
- confidence is 0..1.`,
  });

  const raw = await callAnthropicJson<Record<string, unknown>>(content, 220);
  return {
    title: cleanText(raw.title),
    author: cleanText(raw.author),
    publisher: cleanText(raw.publisher),
    published_year: parseYear(raw.published_year),
    confidence: clampConfidence(raw.confidence),
    notes: cleanText(raw.notes),
  };
}

function normalizeTitle(value: string | null): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePublisher(value: string | null): string {
  return normalizeTitle(value);
}

function normalizeAuthor(value: string | null): string {
  return normalizeTitle(value);
}

function normalizeCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/^http:\/\//i, "https://")
    .replace("&edge=curl", "")
    .replace("zoom=1", "zoom=2");
}

function estimateGoogleCoverQuality(sizeLabel: string | null): number {
  switch (sizeLabel) {
    case "extraLarge": return 10;
    case "large": return 9;
    case "medium": return 8;
    case "small": return 7;
    case "thumbnail": return 6;
    case "smallThumbnail": return 5;
    default: return 0;
  }
}

function estimateOpenLibraryCoverQuality(sizeLabel: "large" | "medium" | "small" | "generated" | null): number {
  switch (sizeLabel) {
    case "large": return 9;
    case "medium": return 7;
    case "small": return 5;
    case "generated": return 7;
    default: return 0;
  }
}

function candidateCompletenessScore(candidate: CandidateEdition): number {
  let score = candidate.cover_quality || 0;
  if (candidate.publisher) score += 2;
  if (candidate.published_year) score += 1;
  if (candidate.pages) score += 1;
  if (candidate.language) score += 0.5;
  return score;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": "Shelvd/1.0" } });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return await response.json();
}

async function safeCandidateFetch(
  label: string,
  fetcher: () => Promise<CandidateEdition[]>,
): Promise<CandidateEdition[]> {
  try {
    return await fetcher();
  } catch (err) {
    console.error(`[analyze-book] ${label} failed`, err);
    return [];
  }
}

function googleIdentifiersToIsbns(identifiers: Array<{ type?: string; identifier?: string }> | undefined) {
  const isbn13 = identifiers?.find((entry) => entry.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers?.find((entry) => entry.type === "ISBN_10")?.identifier;
  return {
    isbn_13: normalizeIsbn(isbn13, 13),
    isbn_10: normalizeIsbn(isbn10, 10),
  };
}

function normalizeGoogleCandidate(item: Record<string, unknown>): CandidateEdition | null {
  const id = cleanText(item.id);
  const info = (item.volumeInfo && typeof item.volumeInfo === "object")
    ? item.volumeInfo as Record<string, unknown>
    : {};
  if (!id || !info) return null;
  const identifiers = Array.isArray(info.industryIdentifiers)
    ? info.industryIdentifiers as Array<{ type?: string; identifier?: string }>
    : [];
  const isbns = googleIdentifiersToIsbns(identifiers);
  const authors = Array.isArray(info.authors) ? info.authors.filter(Boolean).join(", ") : null;
  const imageLinks = typeof info.imageLinks === "object" && info.imageLinks
    ? info.imageLinks as Record<string, unknown>
    : null;
  let coverSource: string | null = null;
  let coverSize: string | null = null;
  if (imageLinks) {
    for (const size of ["extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"]) {
      const maybeUrl = cleanText(imageLinks[size]);
      if (maybeUrl) {
        coverSource = maybeUrl;
        coverSize = size;
        break;
      }
    }
  }
  const coverUrl = normalizeCoverUrl(coverSource);

  return {
    source: "google_books",
    source_id: `google_books:${id}`,
    title: cleanText(info.title),
    author: cleanText(authors),
    pages: parsePositiveInt(info.pageCount),
    isbn_13: isbns.isbn_13,
    isbn_10: isbns.isbn_10,
    publisher: cleanText(info.publisher),
    published_year: parseYear(info.publishedDate),
    edition: cleanText(info.subtitle),
    language: normalizeLanguage(info.language),
    format: cleanText(info.printType),
    cover_url: coverUrl,
    info_url: cleanText(item.selfLink),
    cover_quality: estimateGoogleCoverQuality(coverSize),
  };
}

function normalizeOpenLibraryCandidate(raw: Record<string, unknown>, sourceId: string): CandidateEdition | null {
  const title = cleanText(raw.title);
  if (!title) return null;
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((entry) => cleanText((entry as Record<string, unknown>).name)).filter(Boolean).join(", ")
    : Array.isArray(raw.author_name)
    ? raw.author_name.filter(Boolean).join(", ")
    : null;
  const publishers = Array.isArray(raw.publishers)
    ? raw.publishers.map((entry) => cleanText((entry as Record<string, unknown>).name)).filter(Boolean).join(", ")
    : Array.isArray(raw.publisher)
    ? raw.publisher.filter(Boolean).join(", ")
    : null;
  const identifiers = (raw.identifiers && typeof raw.identifiers === "object")
    ? raw.identifiers as Record<string, unknown>
    : {};
  const isbn13 = Array.isArray(identifiers.isbn_13)
    ? normalizeIsbn((identifiers.isbn_13 as unknown[])[0], 13)
    : normalizeIsbn(Array.isArray(raw.isbn) ? (raw.isbn as unknown[]).find((entry) => String(entry).replace(/[^0-9]/g, "").length === 13) : null, 13);
  const isbn10 = Array.isArray(identifiers.isbn_10)
    ? normalizeIsbn((identifiers.isbn_10 as unknown[])[0], 10)
    : normalizeIsbn(Array.isArray(raw.isbn) ? (raw.isbn as unknown[]).find((entry) => normalizeIsbn(entry, 10)) : null, 10);
  let cover: string | null = null;
  let coverSize: "large" | "medium" | "small" | "generated" | null = null;
  if (raw.cover && typeof raw.cover === "object") {
    const coverObject = raw.cover as Record<string, unknown>;
    cover = cleanText(coverObject.large);
    if (cover) coverSize = "large";
    if (!cover) {
      cover = cleanText(coverObject.medium);
      if (cover) coverSize = "medium";
    }
    if (!cover) {
      cover = cleanText(coverObject.small);
      if (cover) coverSize = "small";
    }
  } else if (typeof raw.cover_i === "number") {
    cover = `https://covers.openlibrary.org/b/id/${raw.cover_i}-L.jpg`;
    coverSize = "generated";
  }

  return {
    source: "open_library",
    source_id: sourceId,
    title,
    author: cleanText(authors),
    pages: parsePositiveInt(raw.number_of_pages),
    isbn_13: isbn13,
    isbn_10: isbn10,
    publisher: cleanText(publishers),
    published_year: parseYear(raw.publish_date ?? raw.first_publish_year),
    edition: cleanText(raw.subtitle),
    language: Array.isArray(raw.languages)
      ? cleanText(((raw.languages[0] as Record<string, unknown>)?.key ?? raw.languages[0]))
      : normalizeLanguage(Array.isArray(raw.language) ? raw.language[0] : null),
    format: cleanText(raw.physical_format),
    cover_url: normalizeCoverUrl(cover),
    info_url: typeof raw.url === "string" ? raw.url : null,
    cover_quality: estimateOpenLibraryCoverQuality(coverSize),
  };
}

async function fetchGoogleBooksByIsbn(isbn: string): Promise<CandidateEdition[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=5`;
  const data = await fetchJson(url) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : [];
  return items.map(normalizeGoogleCandidate).filter((entry): entry is CandidateEdition => Boolean(entry));
}

async function fetchGoogleBooksByMetadata(signals: EditionSignals): Promise<CandidateEdition[]> {
  const queryParts: string[] = [];
  if (signals.title) queryParts.push(`intitle:${signals.title}`);
  if (signals.author) queryParts.push(`inauthor:${signals.author}`);
  if (signals.publisher) queryParts.push(`inpublisher:${signals.publisher}`);
  if (!queryParts.length) return [];
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(queryParts.join(" "))}&maxResults=5`;
  const data = await fetchJson(url) as Record<string, unknown>;
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : [];
  return items.map(normalizeGoogleCandidate).filter((entry): entry is CandidateEdition => Boolean(entry));
}

async function fetchOpenLibraryByIsbn(isbn: string): Promise<CandidateEdition[]> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const data = await fetchJson(url) as Record<string, unknown>;
  const key = `ISBN:${isbn}`;
  const book = data[key];
  if (!book || typeof book !== "object") return [];
  const candidate = normalizeOpenLibraryCandidate(book as Record<string, unknown>, `open_library:isbn:${isbn}`);
  return candidate ? [candidate] : [];
}

async function fetchOpenLibraryByMetadata(signals: EditionSignals): Promise<CandidateEdition[]> {
  const params = new URLSearchParams({
    limit: "5",
    fields: "key,title,author_name,publisher,first_publish_year,isbn,cover_i,language",
  });
  if (signals.title) params.set("title", signals.title);
  if (signals.author) params.set("author", signals.author);
  if (!signals.title && !signals.author) return [];
  const url = `https://openlibrary.org/search.json?${params.toString()}`;
  const data = await fetchJson(url) as Record<string, unknown>;
  const docs = Array.isArray(data.docs) ? data.docs as Array<Record<string, unknown>> : [];
  return docs
    .map((doc) => normalizeOpenLibraryCandidate(doc, `open_library:${cleanText(doc.key) || crypto.randomUUID()}`))
    .filter((entry): entry is CandidateEdition => Boolean(entry));
}

function dedupeCandidates(candidates: CandidateEdition[]): CandidateEdition[] {
  const deduped = new Map<string, CandidateEdition>();
  for (const candidate of candidates) {
    const canonicalIsbn = candidate.isbn_13 || isbn10To13(candidate.isbn_10);
    const key = canonicalIsbn
      ? `isbn:${canonicalIsbn}`
      : candidate.isbn_10
      ? `isbn10:${candidate.isbn_10}`
      : candidate.source_id;
    const existing = deduped.get(key);
    if (!existing || candidateCompletenessScore(candidate) > candidateCompletenessScore(existing)) {
      deduped.set(key, candidate);
    }
  }
  return [...deduped.values()];
}

function scoreCandidate(candidate: CandidateEdition, signals: EditionSignals): number {
  let score = 0;
  if (signals.isbn_13 && isSameIsbn(candidate.isbn_13 || candidate.isbn_10, signals.isbn_13)) score += 30;
  if (signals.isbn_10 && isSameIsbn(candidate.isbn_13 || candidate.isbn_10, signals.isbn_10)) score += 24;

  const titleA = normalizeTitle(signals.title);
  const titleB = normalizeTitle(candidate.title);
  if (titleA && titleB) {
    if (titleA === titleB) score += 12;
    else if (titleB.includes(titleA) || titleA.includes(titleB)) score += 7;
  }

  const authorA = normalizeAuthor(signals.author);
  const authorB = normalizeAuthor(candidate.author);
  if (authorA && authorB) {
    if (authorA === authorB) score += 8;
    else if (authorA.split(" ").some((part) => part && authorB.includes(part))) score += 4;
  }

  const publisherA = normalizePublisher(signals.publisher);
  const publisherB = normalizePublisher(candidate.publisher);
  if (publisherA && publisherB) {
    if (publisherA === publisherB) score += 8;
    else if (publisherA.includes(publisherB) || publisherB.includes(publisherA)) score += 4;
  }

  if (
    signals.published_year &&
    candidate.published_year &&
    signals.published_year === candidate.published_year
  ) {
    score += 3;
  }

  if (candidate.cover_url) score += 2;
  return score;
}

async function fetchImageAsBase64(url: string): Promise<ImageInput | null> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Shelvd/1.0" } });
    if (!response.ok) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of buffer) binary += String.fromCharCode(byte);
    const mediaType = response.headers.get("content-type") || "image/jpeg";
    return {
      data: btoa(binary),
      mediaType,
    };
  } catch {
    return null;
  }
}

async function compareCandidateCovers(
  images: { cover: ImageInput; spine?: ImageInput | null; back?: ImageInput | null },
  candidates: CandidateEdition[],
): Promise<MatchDecision | null> {
  const candidatesWithImages = [];
  for (const candidate of candidates.slice(0, 4)) {
    if (!candidate.cover_url) continue;
    const image = await fetchImageAsBase64(candidate.cover_url);
    if (!image) continue;
    candidatesWithImages.push({ candidate, image });
  }

  if (!candidatesWithImages.length) return null;

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: "User cover photo" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: images.cover.mediaType,
        data: images.cover.data,
      },
    },
  ];

  if (images.spine) {
    content.push({ type: "text", text: "User spine photo" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.spine.mediaType,
        data: images.spine.data,
      },
    });
  }

  if (images.back) {
    content.push({ type: "text", text: "User barcode / back photo" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: images.back.mediaType,
        data: images.back.data,
      },
    });
  }

  for (const [index, entry] of candidatesWithImages.entries()) {
    content.push({
      type: "text",
      text:
        `Candidate ${index + 1}
source_id: ${entry.candidate.source_id}
title: ${entry.candidate.title ?? "unknown"}
author: ${entry.candidate.author ?? "unknown"}
publisher: ${entry.candidate.publisher ?? "unknown"}
year: ${entry.candidate.published_year ?? "unknown"}
isbn13: ${entry.candidate.isbn_13 ?? "unknown"}
isbn10: ${entry.candidate.isbn_10 ?? "unknown"}`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: entry.image.mediaType,
        data: entry.image.data,
      },
    });
  }

  content.push({
    type: "text",
    text:
      `Choose whether any candidate is the exact same printed edition as the user's book.
Return ONLY valid JSON:
{
  "selected_source_id": string|null,
  "confidence": number,
  "rationale": string|null
}

Rules:
- selected_source_id must be one of the provided candidate source_ids or null.
- Only select a candidate when the cover design appears to be the same edition, not just the same work.
- Consider subtitle placement, publisher clues, typography, badges, and barcode/ISBN evidence.
- If no candidate is clearly the same edition, return null.
- confidence is 0..1.`,
  });

  const result = await callAnthropicJson<Record<string, unknown>>(content, 450);
  return {
    selected_source_id: cleanText(result.selected_source_id),
    confidence: clampConfidence(result.confidence),
    rationale: cleanText(result.rationale),
  };
}

function mergeSignalsWithCandidate(
  signals: EditionSignals,
  candidate: CandidateEdition | null,
): EditionSignals {
  if (!candidate) return signals;
  return {
    ...signals,
    title: signals.title || candidate.title,
    author: signals.author || candidate.author,
    pages: signals.pages || candidate.pages,
    isbn_13: signals.isbn_13 || candidate.isbn_13,
    isbn_10: signals.isbn_10 || candidate.isbn_10,
    publisher: signals.publisher || candidate.publisher,
    published_year: signals.published_year || candidate.published_year,
    edition: signals.edition || candidate.edition,
    language: signals.language || candidate.language,
    format: signals.format || candidate.format,
  };
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const coverImage = cleanText(body.cover_image) || cleanText(body.image);
    const spineImage = cleanText(body.spine_image);
    const backImage = cleanText(body.back_image);
    const manualOverrides = body.manual_overrides && typeof body.manual_overrides === "object"
      ? body.manual_overrides as Record<string, unknown>
      : {};
    const overrideIsbn13 = normalizeIsbn(manualOverrides.isbn_13, 13);
    const overrideIsbn10 = normalizeIsbn(manualOverrides.isbn_10, 10);
    const lookupOnly = Boolean(body.lookup_only) && Boolean(overrideIsbn13 || overrideIsbn10);

    if (!coverImage && !lookupOnly) {
      return jsonResponse({ error: "No cover image provided" }, 400);
    }

    const images = coverImage
      ? {
        cover: { data: coverImage, mediaType: "image/jpeg" },
        spine: spineImage ? { data: spineImage, mediaType: "image/jpeg" } : null,
        back: backImage ? { data: backImage, mediaType: "image/jpeg" } : null,
      }
      : null;

    let extracted = emptyEditionSignals();
    let analysisIssue: string | null = null;
    let lookupIssue: string | null = null;

    if (lookupOnly) {
      extracted = applyManualOverrides(extracted, manualOverrides);
    } else if (images) {
      try {
        extracted = await extractEditionSignals(images);
      } catch (err) {
        console.error("[analyze-book] cover analysis failed", err);
        analysisIssue = "Could not read the cover metadata from these photos.";
        extracted = emptyEditionSignals();
      }

      if (
        extracted.missing_fields.includes("title") ||
        extracted.missing_fields.includes("author") ||
        extracted.missing_fields.includes("publisher") ||
        extracted.missing_fields.includes("isbn_13") ||
        !extracted.published_year
      ) {
        try {
          const finePrintSignals = await extractFinePrintSignals(images);
          extracted = mergeSignalsPreferExisting(extracted, finePrintSignals);
        } catch (err) {
          console.error("[analyze-book] fine print analysis failed", err);
          analysisIssue = analysisIssue || "Could not read the small-print metadata from these photos.";
        }
      }

      if (!extracted.title || !extracted.author) {
        try {
          const readableSignals = await extractReadableCoverSignals(images);
          extracted = mergeSignalsPreferExisting(extracted, readableSignals);
        } catch (err) {
          console.error("[analyze-book] readable cover fallback failed", err);
        }
      }
    }

    extracted = applyManualOverrides(extracted, manualOverrides);
    const candidates = dedupeCandidates([
      ...(extracted.isbn_13 ? await safeCandidateFetch("google-isbn13", () => fetchGoogleBooksByIsbn(extracted.isbn_13!)) : []),
      ...(extracted.isbn_10 ? await safeCandidateFetch("google-isbn10", () => fetchGoogleBooksByIsbn(extracted.isbn_10!)) : []),
      ...(extracted.isbn_13 ? await safeCandidateFetch("openlibrary-isbn13", () => fetchOpenLibraryByIsbn(extracted.isbn_13!)) : []),
      ...(extracted.isbn_10 ? await safeCandidateFetch("openlibrary-isbn10", () => fetchOpenLibraryByIsbn(extracted.isbn_10!)) : []),
      ...((extracted.title || extracted.author || extracted.publisher)
        ? await safeCandidateFetch("google-metadata", () => fetchGoogleBooksByMetadata(extracted))
        : []),
      ...((extracted.title || extracted.author)
        ? await safeCandidateFetch("openlibrary-metadata", () => fetchOpenLibraryByMetadata(extracted))
        : []),
    ]).map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, extracted),
    })).sort((a, b) => (b.score || 0) - (a.score || 0));

    const topCandidates = candidates.slice(0, 5);
    const exactIsbnCandidate = topCandidates
      .filter((candidate) =>
      (extracted.isbn_13 && isSameIsbn(candidate.isbn_13 || candidate.isbn_10, extracted.isbn_13)) ||
      (extracted.isbn_10 && isSameIsbn(candidate.isbn_13 || candidate.isbn_10, extracted.isbn_10))
      )
      .sort((a, b) => ((b.score || 0) + b.cover_quality) - ((a.score || 0) + a.cover_quality))[0] || null;

    let matchStatus: "exact_match" | "needs_confirmation" | "manual_required" = "manual_required";
    let matchedCandidate: CandidateEdition | null = null;
    let decision: MatchDecision | null = null;

    if (exactIsbnCandidate && exactIsbnCandidate.cover_url) {
      matchedCandidate = exactIsbnCandidate;
      matchStatus = "exact_match";
      decision = {
        selected_source_id: exactIsbnCandidate.source_id,
        confidence: 0.97,
        rationale: "Matched by exact ISBN with an online edition cover.",
      };
    } else if (exactIsbnCandidate && !exactIsbnCandidate.cover_url) {
      matchedCandidate = exactIsbnCandidate;
      matchStatus = "manual_required";
      decision = {
        selected_source_id: exactIsbnCandidate.source_id,
        confidence: 0.82,
        rationale: "Exact ISBN found, but there is no verifiable online cover for this edition.",
      };
    } else if (topCandidates.length && images && !lookupOnly) {
      try {
        decision = await compareCandidateCovers(images, topCandidates);
        if (decision?.selected_source_id) {
          matchedCandidate = topCandidates.find((candidate) => candidate.source_id === decision?.selected_source_id) || null;
          matchStatus = "needs_confirmation";
        } else {
          matchStatus = "needs_confirmation";
        }
      } catch (err) {
        console.error("[analyze-book] cover comparison failed", err);
        analysisIssue = analysisIssue || "Could not verify the exact cover against online editions.";
        matchStatus = "manual_required";
      }
    }

    if (!topCandidates.length && extracted.title && extracted.author) {
      matchStatus = "manual_required";
    }

    if (!topCandidates.length && (overrideIsbn13 || overrideIsbn10)) {
      lookupIssue = "Could not find metadata for that ISBN yet.";
    }

    if (
      analysisIssue &&
      (extracted.title || extracted.author || extracted.publisher || extracted.isbn_13 || extracted.isbn_10)
    ) {
      analysisIssue = null;
    }

    const metadataCandidate = exactIsbnCandidate || (matchStatus === "exact_match" ? matchedCandidate : null);
    const verifiedCandidate = matchStatus === "exact_match" ? matchedCandidate : null;
    const merged = mergeSignalsWithCandidate(extracted, metadataCandidate);
    return jsonResponse({
      ...merged,
      match_status: matchStatus,
      confidence: Math.max(merged.confidence, decision?.confidence || 0),
      matched_cover_url: verifiedCandidate?.cover_url || null,
      recommended_candidate_source_id: verifiedCandidate?.source_id || null,
      candidate_editions: topCandidates,
      rationale: decision?.rationale || lookupIssue || analysisIssue || extracted.notes || null,
      analysis_issue: analysisIssue,
      lookup_issue: lookupIssue,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
