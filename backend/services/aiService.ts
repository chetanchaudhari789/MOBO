import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import type { Env } from '../config/env.js';

type ChatPayload = {
  message: string;
  userName: string;
  products?: Array<{
    id?: string;
    title?: string;
    price?: number;
    originalPrice?: number;
    platform?: string;
  }>;
  orders?: unknown[];
  tickets?: unknown[];
  image?: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
};

type ChatModelResponse = {
  responseText: string;
  intent:
    | 'greeting'
    | 'search_deals'
    | 'check_order_status'
    | 'check_ticket_status'
    | 'navigation'
    | 'unknown';
  navigateTo?: 'home' | 'explore' | 'orders' | 'profile';
  recommendedProductIds?: string[];
};

export type ChatUiResponse = {
  text: string;
  intent: ChatModelResponse['intent'];
  navigateTo?: ChatModelResponse['navigateTo'];
  uiType?: 'product_card';
  data?: unknown;
};

const GEMINI_MODEL_FALLBACKS = [
  // Use fully-qualified model names as returned by `ai.models.list()`.
  'models/gemini-2.5-flash',
  'models/gemini-2.0-flash',
  'models/gemini-2.0-flash-001',
  'models/gemini-2.0-flash-exp',
  'models/gemini-2.5-pro',
] as const;

export function isGeminiConfigured(env: Env): boolean {
  return Boolean(env.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim());
}

function requireGeminiKey(env: Env): string {
  if (env.AI_ENABLED === false) {
    throw Object.assign(new Error('AI is disabled. Set AI_ENABLED=true to enable Gemini calls.'), {
      statusCode: 503,
    });
  }
  if (!env.GEMINI_API_KEY) {
    throw Object.assign(new Error('Gemini is not configured. Set GEMINI_API_KEY on the backend.'), {
      statusCode: 503,
    });
  }
  return env.GEMINI_API_KEY;
}

function sanitizeAiError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    // Avoid leaking stack traces or any accidental sensitive info.
    return String(err.message || 'AI request failed').slice(0, 300);
  }
  return String(err).slice(0, 300);
}

/** Per-model timeout (15s). Prevents a single slow model from blocking the whole fallback chain. */
const PER_MODEL_TIMEOUT_MS = 15_000;

function withModelTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Model response timed out')), PER_MODEL_TIMEOUT_MS)
    ),
  ]);
}

function _createInputError(message: string, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function stripUnsafeContent(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ') // HTML
    .replace(/```[\s\S]*?```/g, ' ') // code blocks
    .replace(/\{[\s\S]*\}/g, ' ') // JSON blobs
    .replace(/(stack trace:|traceback:)[\s\S]*/gi, ' ') // stack traces
    .replace(/[\r\n]+/g, ' ') // logs/newlines
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Detect adversarial prompt injection attempts.
 * Returns `true` if the input contains suspicious patterns that try to override system instructions.
 */
function containsPromptInjection(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const patterns = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    /\byou\s+are\s+now\b/i,
    /\bsystem\s*prompt\b/i,
    /\bforget\s+(your|all|everything)\b/i,
    /\bdo\s+not\s+follow\s+(any|your|the)\s+(rules?|instructions?)\b/i,
    /\boverride\s+(all|your|the|system)\b/i,
    /\bact\s+as\s+(if|though)\s+you\s+(are|were)\b/i,
    /\bjailbreak\b/i,
    /\bDAN\s*mode\b/i,
  ];
  return patterns.some((p) => p.test(lower));
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateTokensFromImage(base64: string): number {
  if (!base64) return 0;
  // Gemini processes images as fixed 768×768 tiles.
  // Most images fit in 1–4 tiles → ~258–1030 tokens regardless of file size.
  // The base64 length only tells us the file size, NOT the token count.
  // A conservative estimate: 1 tile (258 tokens) per 500KB of raw image data.
  const rawBytes = Math.ceil(base64.length * 3 / 4);
  const tilesEstimate = Math.max(1, Math.ceil(rawBytes / 500_000));
  return tilesEstimate * 258;
}

function sanitizeUserMessage(env: Env, message: string): string {
  if (!message) return '';
  if (message.length > env.AI_MAX_INPUT_CHARS) {
    message = message.slice(0, env.AI_MAX_INPUT_CHARS);
  }

  // Reject prompt injection attempts before further processing.
  if (containsPromptInjection(message)) {
    return 'How can I help you today?';
  }

  const cleaned = stripUnsafeContent(message);
  if (!cleaned) return '';

  if (cleaned.length > env.AI_MAX_INPUT_CHARS) {
    return cleaned.slice(0, env.AI_MAX_INPUT_CHARS);
  }

  return cleaned;
}

function sanitizeHistory(env: Env, history: ChatPayload['history']) {
  const items = Array.isArray(history) ? history : [];
  const maxHistoryChars = Math.min(env.AI_MAX_INPUT_CHARS, 600);
  const trimmed = items.slice(-env.AI_MAX_HISTORY_MESSAGES).map((item) => ({
    role: item.role,
    content: sanitizeUserMessage(env, item.content).slice(0, maxHistoryChars),
  }));

  const older = items.slice(0, Math.max(0, items.length - trimmed.length));
  const summary = older.length
    ? older
        .map((m) => stripUnsafeContent(m.content))
        .join(' | ')
        .slice(0, env.AI_HISTORY_SUMMARY_CHARS)
    : '';

  return { trimmed, summary };
}

export async function checkGeminiApiKey(env: Env): Promise<{ ok: boolean; model: string; error?: string }> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

  for (const model of GEMINI_MODEL_FALLBACKS) {
    try {
      // A tiny request whose only purpose is to validate connectivity + auth.
      await withModelTimeout(ai.models.generateContent({
        model,
        contents: 'ping',
      }));
      return { ok: true, model };
    } catch (err) {
      // Try the next model; return last error if all fail.
      const error = sanitizeAiError(err);
      if (model === GEMINI_MODEL_FALLBACKS[GEMINI_MODEL_FALLBACKS.length - 1]) {
        return { ok: false, model, error };
      }
    }
  }

  return { ok: false, model: GEMINI_MODEL_FALLBACKS[0], error: 'AI request failed' };
}

function safeJsonParse<T>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractJsonObject(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    const inner = codeBlockMatch[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) return inner;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1).trim();
}

function parseModelResponse(raw: string | undefined | null): ChatModelResponse | null {
  if (!raw) return null;
  const direct = safeJsonParse<ChatModelResponse>(raw);
  if (direct) return direct;
  const extracted = extractJsonObject(raw);
  if (!extracted) return null;
  return safeJsonParse<ChatModelResponse>(extracted);
}

function sanitizeModelText(raw: string | undefined | null): string {
  if (!raw) return '';
  let cleaned = String(raw);
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');
  cleaned = cleaned.replace(/here is the json requested:?/gi, ' ');
  // Only strip "json" when it's a standalone formatting artifact (e.g., model returning "json {}")
  // Avoid stripping it from legitimate sentences like "I can export JSON files".
  cleaned = cleaned.replace(/^\s*json\s*$/gim, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

export async function generateChatUiResponse(
  env: Env,
  payload: ChatPayload
): Promise<ChatUiResponse> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

  const clampText = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

  let imageForPrompt = payload.image;
  if (imageForPrompt && imageForPrompt.length > env.AI_MAX_IMAGE_CHARS) {
    imageForPrompt = undefined;
  }

  const sanitizedMessage = sanitizeUserMessage(env, payload.message || '');
  const { trimmed: historyMessages, summary: historySummary } = sanitizeHistory(env, payload.history);

  const products = Array.isArray(payload.products) ? payload.products : [];
  const dealContextRaw = products
    .slice(0, 10)
    .map((p) => {
      const id = p.id ?? 'unknown';
      const title = p.title ?? 'Untitled';
      const price = typeof p.price === 'number' ? p.price : 0;
      const originalPrice = typeof p.originalPrice === 'number' ? p.originalPrice : price;
      const platform = p.platform ?? 'Unknown';
      return `[ID: ${id}] ${title} - Price: ₹${price} (MRP: ₹${originalPrice}) on ${platform}`;
    })
    .join('\n');

  let dealContext = clampText(dealContextRaw, 800);

  let ordersSnippet = clampText(
    JSON.stringify((payload.orders || []).slice(0, 3)),
    Math.min(env.AI_MAX_INPUT_CHARS, 600)
  );
  let ticketsSnippet = clampText(
    JSON.stringify((payload.tickets || []).slice(0, 2)),
    Math.min(env.AI_MAX_INPUT_CHARS, 600)
  );

  let historyMessagesForPrompt = historyMessages;

  const buildSystemPrompt = (
    deals: string,
    orders: string,
    tickets: string,
    summary: string,
    hasImage: boolean
  ) => `
You are 'BUZZMA', a world-class AI shopping strategist for ${payload.userName || 'Guest'}.

CONTEXT:
- DEALS: ${deals}
- RECENT ORDERS: ${orders}
- TICKETS: ${tickets}
${summary ? `- SUMMARY: ${summary}` : ''}

BEHAVIOR:
1. Be concise and friendly.
2. If user mentions "shoes", "deals", "offers", identify matching IDs and put them in 'recommendedProductIds'.
3. Classify intent: 'search_deals', 'check_order_status', 'check_ticket_status', 'navigation', 'greeting', or 'unknown'.
4. For navigation, use: 'home', 'explore', 'orders', 'profile'.
5. Use **bold** for key info like **₹599** or **Delivered**.
6. Always respond in JSON format with responseText, intent, and optional fields.
${
  hasImage
    ? `7. IMAGE ANALYSIS (HIGHEST PRIORITY):
   - The user has uploaded an image. IGNORE the 'RECENT ORDERS' list for identification purposes.
   - EXTRACT the Order ID exactly as appearing in the image (e.g., Amazon '404-1234567...', Flipkart 'OD123...', Myntra, etc.).
   - EXTRACT the Final Order Amount/Total.
   - STRICTLY IGNORE any "system" IDs (e.g., random UUIDs, IDs starting with SYS/MOBO, or single/double digit numbers).
   - If you see an Order ID in the image, your response text MUST begin with: "Found Order ID: <ID>".
   - If you cannot clearly read an Order ID, say "Could not read Order ID from image".`
    : ''
}
`;

  let systemPrompt = buildSystemPrompt(
    dealContext,
    ordersSnippet,
    ticketsSnippet,
    historySummary,
    !!imageForPrompt
  );

  let historyText = clampText(
    historyMessagesForPrompt.map((m) => `[${m.role}] ${m.content}`).join('\n'),
    Math.min(env.AI_MAX_INPUT_CHARS, 1200)
  );
  const safeMessage = sanitizedMessage || 'Hello';

  let estimatedTokens =
    estimateTokensFromText(systemPrompt) +
    estimateTokensFromText(safeMessage) +
    estimateTokensFromText(historyText) +
    estimateTokensFromImage(imageForPrompt || '');

  if (estimatedTokens > env.AI_MAX_ESTIMATED_TOKENS) {
    historyMessagesForPrompt = historyMessages.slice(-2);
    historyText = clampText(
      historyMessagesForPrompt.map((m) => `[${m.role}] ${m.content}`).join('\n'),
      Math.min(env.AI_MAX_INPUT_CHARS, 600)
    );
    dealContext = clampText(dealContextRaw, 300);
    ordersSnippet = '';
    ticketsSnippet = '';
    const reducedSummary = historySummary ? clampText(historySummary, 120) : '';
    systemPrompt = buildSystemPrompt(
      dealContext,
      ordersSnippet,
      ticketsSnippet,
      reducedSummary,
      !!imageForPrompt
    );
    estimatedTokens =
      estimateTokensFromText(systemPrompt) +
      estimateTokensFromText(safeMessage) +
      estimateTokensFromText(historyText) +
      estimateTokensFromImage(imageForPrompt || '');
  }

  if (estimatedTokens > env.AI_MAX_ESTIMATED_TOKENS) {
    historyMessagesForPrompt = [];
    historyText = '';
    dealContext = '';
    ordersSnippet = '';
    ticketsSnippet = '';
    systemPrompt = buildSystemPrompt('', '', '', '', !!imageForPrompt);
    estimatedTokens =
      estimateTokensFromText(systemPrompt) +
      estimateTokensFromText(safeMessage) +
      estimateTokensFromText(historyText) +
      estimateTokensFromImage(imageForPrompt || '');
  }

  if (estimatedTokens > env.AI_MAX_ESTIMATED_TOKENS && imageForPrompt) {
    imageForPrompt = undefined;
    estimatedTokens =
      estimateTokensFromText(systemPrompt) +
      estimateTokensFromText(safeMessage) +
      estimateTokensFromText(historyText);
  }

  const contents = imageForPrompt
    ? [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageForPrompt.split(',')[1] ?? imageForPrompt,
          },
        },
        { text: safeMessage || 'Analyze this image.' },
      ]
    : [
        ...(historyMessagesForPrompt.length
          ? historyMessagesForPrompt.map((m) => ({ text: `[${m.role}] ${m.content}` }))
          : []),
        { text: safeMessage },
      ];

  try {
    let lastError: unknown = null;

    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await withModelTimeout(ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS_CHAT,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                responseText: { type: Type.STRING },
                intent: {
                  type: Type.STRING,
                  enum: [
                    'greeting',
                    'search_deals',
                    'check_order_status',
                    'check_ticket_status',
                    'navigation',
                    'unknown',
                  ],
                },
                navigateTo: { type: Type.STRING, enum: ['home', 'explore', 'orders', 'profile'] },
                recommendedProductIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['responseText', 'intent'],
            },
          },
        }));

        const parsed = parseModelResponse(response.text) ?? {
          responseText:
            sanitizeModelText(response.text) ||
            "I'm here to help with deals, orders, or tickets. What would you like?",
          intent: 'unknown',
        };

        const recommendedIds = Array.isArray(parsed.recommendedProductIds)
          ? parsed.recommendedProductIds
          : [];
        let recommendedProducts = recommendedIds.length
          ? products.filter((p) => p.id && recommendedIds.includes(String(p.id)))
          : [];

        if (parsed.intent === 'search_deals' && recommendedProducts.length === 0 && products.length) {
          recommendedProducts = products.slice(0, 5);
        }

        console.info('Gemini chat usage estimate', {
          model,
          estimatedTokens,
        });

        return {
          text: parsed.responseText,
          intent: parsed.intent ?? 'unknown',
          navigateTo: parsed.navigateTo,
          ...(recommendedProducts.length
            ? { uiType: 'product_card' as const, data: recommendedProducts }
            : {}),
        };
      } catch (innerError) {
        lastError = innerError;
        continue;
      }
    }

    throw lastError ?? new Error('Gemini request failed');
  } catch (error) {
    // Fallback response if AI fails
    console.error('Gemini API error:', error);
    return {
      text: `Hi ${payload.userName}! I'm experiencing some technical difficulties right now, but I'm here to help. Could you try rephrasing your question?`,
      intent: 'unknown',
    };
  }
}

type ProofPayload = {
  imageBase64: string;
  expectedOrderId: string;
  expectedAmount: number;
};

type ProofVerificationResult = {
  orderIdMatch: boolean;
  amountMatch: boolean;
  confidenceScore: number;
  detectedOrderId?: string;
  detectedAmount?: number;
  discrepancyNote?: string;
};

type ExtractOrderPayload = {
  imageBase64: string;
};

/**
 * Detect MIME type from a base64 data-URL or raw base64 magic bytes.
 * Returns a safe default of 'image/jpeg' when detection fails.
 */
function detectImageMimeType(base64: string): string {
  // data:image/png;base64,...
  const dataMatch = base64.match(/^data:(image\/[a-z+]+);base64,/i);
  if (dataMatch) return dataMatch[1].toLowerCase();

  // Check raw base64 magic bytes
  const raw = base64.slice(0, 16);
  if (raw.startsWith('iVBOR')) return 'image/png';
  if (raw.startsWith('/9j/') || raw.startsWith('/9J/')) return 'image/jpeg';
  if (raw.startsWith('R0lGOD')) return 'image/gif';
  if (raw.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * OCR-based proof verification fallback.
 * When Gemini is unavailable, run Tesseract on the proof image and do deterministic matching
 * against the expected order ID and amount.
 */
async function verifyProofWithOcr(
  imageBase64: string,
  expectedOrderId: string,
  expectedAmount: number,
): Promise<ProofVerificationResult> {
  try {
    const rawData = imageBase64.includes(',') ? imageBase64.split(',')[1]! : imageBase64;
    const imgBuffer = Buffer.from(rawData, 'base64');

    // Preprocess with Sharp for better OCR accuracy
    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(imgBuffer)
        .greyscale()
        .normalize()
        .sharpen()
        .toBuffer();
    } catch {
      processedBuffer = imgBuffer;
    }

    const worker = await createWorker('eng');
    const { data } = await worker.recognize(processedBuffer);
    await worker.terminate();

    const ocrText = (data.text || '').trim();
    if (!ocrText || ocrText.length < 5) {
      return {
        orderIdMatch: false,
        amountMatch: false,
        confidenceScore: 15,
        discrepancyNote: 'OCR could not read text from the image. Please verify manually.',
      };
    }

    // Normalize OCR digit confusion
    const normalized = ocrText
      .replace(/[Oo]/g, (m) => (/[A-Za-z]/.test(m) ? m : '0'))
      .replace(/[Il|]/g, '1')
      .replace(/[Ss]/g, (m) => (/[A-Za-z]/.test(m) ? m : '5'));

    // Check if expected order ID appears in OCR text
    const orderIdNormalized = expectedOrderId.replace(/[\s\-]/g, '');
    const ocrNormalized = normalized.replace(/[\s\-]/g, '');
    const orderIdMatch = ocrNormalized.toUpperCase().includes(orderIdNormalized.toUpperCase());

    // Check if expected amount appears in OCR text (allow ±1 tolerance for OCR errors)
    const amountPatterns = [
      String(expectedAmount),
      expectedAmount.toFixed(2),
      // Indian comma format: 1,23,456
      expectedAmount.toLocaleString('en-IN'),
    ];
    const amountMatch = amountPatterns.some((p) => ocrText.includes(p));

    let confidenceScore = 30; // base OCR confidence
    if (orderIdMatch) confidenceScore += 30;
    if (amountMatch) confidenceScore += 25;
    if (orderIdMatch && amountMatch) confidenceScore = Math.min(confidenceScore + 10, 85);

    const detectedNotes: string[] = [];
    if (!orderIdMatch) detectedNotes.push(`Order ID "${expectedOrderId}" not found in screenshot.`);
    if (!amountMatch) detectedNotes.push(`Amount ₹${expectedAmount} not found in screenshot.`);
    if (orderIdMatch && amountMatch) detectedNotes.push('Both order ID and amount matched via OCR.');

    return {
      orderIdMatch,
      amountMatch,
      confidenceScore,
      discrepancyNote: detectedNotes.join(' ') || 'OCR fallback verification complete.',
    };
  } catch (err) {
    console.error('OCR proof verification error:', err);
    return {
      orderIdMatch: false,
      amountMatch: false,
      confidenceScore: 0,
      discrepancyNote: 'Auto verification unavailable. Please verify manually.',
    };
  }
}

export async function verifyProofWithAi(env: Env, payload: ProofPayload): Promise<ProofVerificationResult> {
  const geminiAvailable = isGeminiConfigured(env);

  if (payload.imageBase64.length > env.AI_MAX_IMAGE_CHARS) {
    return {
      orderIdMatch: false,
      amountMatch: false,
      confidenceScore: 0,
      discrepancyNote: 'Auto verification unavailable. Please verify manually.',
    };
  }

  const estimatedTokens =
    estimateTokensFromImage(payload.imageBase64) +
    estimateTokensFromText(payload.expectedOrderId) +
    estimateTokensFromText(String(payload.expectedAmount));

  if (estimatedTokens > env.AI_MAX_ESTIMATED_TOKENS) {
    return {
      orderIdMatch: false,
      amountMatch: false,
      confidenceScore: 0,
      discrepancyNote: 'Auto verification unavailable. Please verify manually.',
    };
  }

  // If Gemini is not available, fall back to OCR-based verification.
  if (!geminiAvailable) {
    return verifyProofWithOcr(payload.imageBase64, payload.expectedOrderId, payload.expectedAmount);
  }

  const apiKey = env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = detectImageMimeType(payload.imageBase64);

  try {
    let lastError: unknown = null;

    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await withModelTimeout(ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType,
                data: payload.imageBase64.split(',')[1] ?? payload.imageBase64,
              },
            },
            {
              text: [
                `PROOF VERIFICATION TASK — GOD-LEVEL ACCURACY REQUIRED`,
                ``,
                `You must verify whether this screenshot proves a purchase with:`,
                `  Expected Order ID: ${payload.expectedOrderId}`,
                `  Expected Amount: ₹${payload.expectedAmount}`,
                ``,
                `MULTI-DEVICE: This screenshot may be from a mobile phone, desktop browser, tablet, or laptop.`,
                `- Desktop/laptop screenshots have wide layouts with info spread across columns.`,
                `- Mobile screenshots are narrow and vertical. Read ALL visible text regardless of device.`,
                ``,
                `RULES:`,
                `1. Extract the ACTUAL order ID visible in the screenshot. Look for labels like "Order ID", "Order No", "Order #", or platform-specific patterns (Amazon: 3-7-7 digits, Flipkart: OD..., Myntra: MYN..., Meesho: MSH..., etc.)`,
                `2. IGNORE tracking IDs, shipment numbers, AWB numbers, transaction IDs, UTR numbers, UPI references, and invoice numbers — these are NOT order IDs.`,
                `3. Extract the GRAND TOTAL / FINAL amount paid (look for "Grand Total", "Amount Paid", "You Paid", "Order Total", "Net Amount", "Payable"). IGNORE MRP, List Price, Item Price, Subtotal unless no other total exists.`,
                `4. For amount matching: ₹${payload.expectedAmount} should match even if displayed as ₹${payload.expectedAmount}.00 or with Indian comma formatting (e.g., ₹1,23,456). Allow ±₹1 tolerance for rounding.`,
                `5. For order ID matching: Compare after removing spaces, hyphens, and case differences. Partial matches count as mismatches.`,
                `6. Also extract the PRODUCT NAME visible in the screenshot. This helps detect fraud (wrong product uploaded).`,
                `7. Set confidenceScore 0-100: 90+ if both clearly visible and matched, 60-89 if partially matched or slightly unclear, below 60 if mismatched or unreadable.`,
                `8. Always fill detectedOrderId and detectedAmount with what you actually see in the image, even if they don't match the expected values.`,
              ].join('\n'),
            },
          ],
          config: {
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS_PROOF,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                orderIdMatch: { type: Type.BOOLEAN },
                amountMatch: { type: Type.BOOLEAN },
                confidenceScore: { type: Type.INTEGER },
                detectedOrderId: { type: Type.STRING },
                detectedAmount: { type: Type.NUMBER },
                discrepancyNote: { type: Type.STRING },
              },
              required: ['orderIdMatch', 'amountMatch', 'confidenceScore'],
            },
          },
        }));

        const parsed = safeJsonParse<ProofVerificationResult>(response.text);
        if (!parsed) {
          throw new Error('Failed to parse AI verification response');
        }

        // Clamp confidenceScore to 0-100
        parsed.confidenceScore = Math.max(0, Math.min(100, parsed.confidenceScore ?? 0));

        console.info('Gemini proof usage estimate', { model, estimatedTokens });

        return parsed;
      } catch (innerError) {
        lastError = innerError;
        continue;
      }
    }

    throw lastError ?? new Error('Gemini proof verification failed');
  } catch (error) {
    console.error('Gemini proof verification error:', error);
    // Fall back to OCR when Gemini fails at runtime.
    return verifyProofWithOcr(payload.imageBase64, payload.expectedOrderId, payload.expectedAmount);
  }
}


// ──────────────────────────────────────────────────────────
// RATING SCREENSHOT VERIFICATION
// Verifies: 1) Account holder name matches buyer name
//           2) Product name in rating matches expected product
// ──────────────────────────────────────────────────────────

export type RatingVerificationPayload = {
  imageBase64: string;
  expectedBuyerName: string;
  expectedProductName: string;
};

export type RatingVerificationResult = {
  accountNameMatch: boolean;
  productNameMatch: boolean;
  detectedAccountName?: string;
  detectedProductName?: string;
  confidenceScore: number;
  discrepancyNote?: string;
};

async function verifyRatingWithOcr(
  imageBase64: string,
  expectedBuyerName: string,
  expectedProductName: string,
): Promise<RatingVerificationResult> {
  try {
    const rawData = imageBase64.includes(',') ? imageBase64.split(',')[1]! : imageBase64;
    const imgBuffer = Buffer.from(rawData, 'base64');
    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(imgBuffer).greyscale().normalize().sharpen().toBuffer();
    } catch { processedBuffer = imgBuffer; }

    const worker = await createWorker('eng');
    const { data } = await worker.recognize(processedBuffer);
    await worker.terminate();
    const ocrText = (data.text || '').trim();
    if (!ocrText || ocrText.length < 5) {
      return { accountNameMatch: false, productNameMatch: false, confidenceScore: 10,
        discrepancyNote: 'OCR could not read text from the rating screenshot.' };
    }

    const lower = ocrText.toLowerCase();
    // Account name matching: fuzzy — check if any 2+ word segment of the buyer name appears
    const buyerParts = expectedBuyerName.toLowerCase().split(/\s+/).filter(p => p.length >= 2);
    const nameMatches = buyerParts.filter(p => lower.includes(p));
    const accountNameMatch = nameMatches.length >= Math.max(1, Math.ceil(buyerParts.length * 0.5));

    // Product name matching: check if significant keywords from product name appear
    const productTokens = expectedProductName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3);
    const matchedTokens = productTokens.filter(t => lower.includes(t));
    const productNameMatch = matchedTokens.length >= Math.max(1, Math.ceil(productTokens.length * 0.3));

    let confidenceScore = 20;
    if (accountNameMatch) confidenceScore += 35;
    if (productNameMatch) confidenceScore += 35;

    // Try to detect the actual account name shown
    const nameLineRe = /(?:public\s*name|profile|account|by|reviewer|reviewed|written\s*by|posted\s*by)\s*[:\-]?\s*(.{2,40})/i;
    const nameMatch = ocrText.match(nameLineRe);
    const detectedAccountName = nameMatch?.[1]?.trim() || undefined;

    return {
      accountNameMatch, productNameMatch, confidenceScore,
      detectedAccountName,
      detectedProductName: matchedTokens.length > 0 ? matchedTokens.join(' ') : undefined,
      discrepancyNote: [
        !accountNameMatch ? `Buyer name "${expectedBuyerName}" not found in screenshot.` : '',
        !productNameMatch ? `Product name not matching in screenshot.` : '',
        accountNameMatch && productNameMatch ? 'Account name and product matched via OCR.' : '',
      ].filter(Boolean).join(' '),
    };
  } catch (err) {
    console.error('OCR rating verification error:', err);
    return { accountNameMatch: false, productNameMatch: false, confidenceScore: 0,
      discrepancyNote: 'Rating verification unavailable. Please verify manually.' };
  }
}

export async function verifyRatingScreenshotWithAi(
  env: Env,
  payload: RatingVerificationPayload,
): Promise<RatingVerificationResult> {
  if (payload.imageBase64.length > env.AI_MAX_IMAGE_CHARS) {
    return { accountNameMatch: false, productNameMatch: false, confidenceScore: 0,
      discrepancyNote: 'Image too large for auto verification.' };
  }

  if (!isGeminiConfigured(env)) {
    return verifyRatingWithOcr(payload.imageBase64, payload.expectedBuyerName, payload.expectedProductName);
  }

  const apiKey = env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = detectImageMimeType(payload.imageBase64);

  try {
    let lastError: unknown = null;
    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        const response = await withModelTimeout(ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType, data: payload.imageBase64.split(',')[1] ?? payload.imageBase64 } },
            { text: [
              `RATING SCREENSHOT VERIFICATION — GOD-LEVEL ACCURACY REQUIRED`,
              ``,
              `Verify this RATING/REVIEW screenshot:`,
              `  Expected Account Name (buyer): ${payload.expectedBuyerName}`,
              `  Expected Product Name: ${payload.expectedProductName}`,
              ``,
              `RULES:`,
              `1. Find the REVIEWER / ACCOUNT NAME shown in the screenshot. This is the person who wrote the review or gave the rating. It may appear as "public name", "profile name", or at the top of the review.`,
              `2. Compare the account name with "${payload.expectedBuyerName}" — allow for nickname variations, case differences, and abbreviated names. The key name words must match.`,
              `3. Find the PRODUCT NAME visible in the rating screenshot. Compare it to "${payload.expectedProductName}" — key words should match (brand, model, type). Exact match not required.`,
              `4. If the account name or product does not match, this is potential FRAUD (someone rating a different product or using a different account).`,
              `5. Set confidenceScore 0-100 based on how clearly visible and matching both fields are.`,
              `6. Always fill detectedAccountName and detectedProductName with what you actually see.`,
            ].join('\n') },
          ],
          config: {
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS_PROOF,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                accountNameMatch: { type: Type.BOOLEAN },
                productNameMatch: { type: Type.BOOLEAN },
                confidenceScore: { type: Type.INTEGER },
                detectedAccountName: { type: Type.STRING },
                detectedProductName: { type: Type.STRING },
                discrepancyNote: { type: Type.STRING },
              },
              required: ['accountNameMatch', 'productNameMatch', 'confidenceScore'],
            },
          },
        }));

        const parsed = safeJsonParse<RatingVerificationResult>(response.text);
        if (!parsed) throw new Error('Failed to parse AI rating verification response');
        parsed.confidenceScore = Math.max(0, Math.min(100, parsed.confidenceScore ?? 0));
        return parsed;
      } catch (innerError) { lastError = innerError; continue; }
    }
    throw lastError ?? new Error('Gemini rating verification failed');
  } catch (error) {
    console.error('Gemini rating verification error:', error);
    return verifyRatingWithOcr(payload.imageBase64, payload.expectedBuyerName, payload.expectedProductName);
  }
}


// ──────────────────────────────────────────────────────────
// RETURN WINDOW / DELIVERY SCREENSHOT VERIFICATION
// Verifies: product name, order number, sold by, grand total, delivery status
// ──────────────────────────────────────────────────────────

export type ReturnWindowVerificationPayload = {
  imageBase64: string;
  expectedOrderId: string;
  expectedProductName: string;
  expectedAmount: number;
  expectedSoldBy?: string;
};

export type ReturnWindowVerificationResult = {
  orderIdMatch: boolean;
  productNameMatch: boolean;
  amountMatch: boolean;
  soldByMatch: boolean;
  returnWindowClosed: boolean;
  confidenceScore: number;
  detectedReturnWindow?: string;
  discrepancyNote?: string;
};

async function verifyReturnWindowWithOcr(
  imageBase64: string,
  expected: ReturnWindowVerificationPayload,
): Promise<ReturnWindowVerificationResult> {
  try {
    const rawData = imageBase64.includes(',') ? imageBase64.split(',')[1]! : imageBase64;
    const imgBuffer = Buffer.from(rawData, 'base64');
    let processedBuffer: Buffer;
    try { processedBuffer = await sharp(imgBuffer).greyscale().normalize().sharpen().toBuffer(); }
    catch { processedBuffer = imgBuffer; }

    const worker = await createWorker('eng');
    const { data } = await worker.recognize(processedBuffer);
    await worker.terminate();
    const ocrText = (data.text || '').trim();
    if (!ocrText || ocrText.length < 5) {
      return { orderIdMatch: false, productNameMatch: false, amountMatch: false, soldByMatch: false,
        returnWindowClosed: false, confidenceScore: 10,
        discrepancyNote: 'OCR could not read text from the delivery screenshot.' };
    }

    const lower = ocrText.toLowerCase();
    const orderIdNorm = expected.expectedOrderId.replace(/[\s\-]/g, '').toLowerCase();
    const ocrNorm = ocrText.replace(/[\s\-]/g, '').toLowerCase();
    const orderIdMatch = ocrNorm.includes(orderIdNorm);

    const productTokens = expected.expectedProductName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3);
    const matchedProd = productTokens.filter(t => lower.includes(t));
    const productNameMatch = matchedProd.length >= Math.max(1, Math.ceil(productTokens.length * 0.3));

    const amountStr = String(expected.expectedAmount);
    const amountMatch = ocrText.includes(amountStr) || ocrText.includes(expected.expectedAmount.toFixed(2));

    const soldByMatch = expected.expectedSoldBy
      ? lower.includes(expected.expectedSoldBy.toLowerCase().trim())
      : true;

    // Check for return window closure keywords
    const returnWindowRe = /return\s*window\s*(closed|expired|ended|over|passed)|no\s*return|non.?returnable|delivered/i;
    const returnWindowClosed = returnWindowRe.test(ocrText);

    let confidenceScore = 15;
    if (orderIdMatch) confidenceScore += 20;
    if (productNameMatch) confidenceScore += 20;
    if (amountMatch) confidenceScore += 15;
    if (soldByMatch) confidenceScore += 10;
    if (returnWindowClosed) confidenceScore += 10;

    return {
      orderIdMatch, productNameMatch, amountMatch, soldByMatch, returnWindowClosed, confidenceScore,
      discrepancyNote: [
        !orderIdMatch ? `Order ID "${expected.expectedOrderId}" not found.` : '',
        !productNameMatch ? 'Product name mismatch.' : '',
        !amountMatch ? `Amount ₹${expected.expectedAmount} not found.` : '',
        !soldByMatch && expected.expectedSoldBy ? `Seller "${expected.expectedSoldBy}" not found.` : '',
        !returnWindowClosed ? 'Return window status not confirmed.' : '',
      ].filter(Boolean).join(' ') || 'OCR verification complete.',
    };
  } catch (err) {
    console.error('OCR return window verification error:', err);
    return { orderIdMatch: false, productNameMatch: false, amountMatch: false, soldByMatch: false,
      returnWindowClosed: false, confidenceScore: 0,
      discrepancyNote: 'Return window verification unavailable. Please verify manually.' };
  }
}

export async function verifyReturnWindowWithAi(
  env: Env,
  payload: ReturnWindowVerificationPayload,
): Promise<ReturnWindowVerificationResult> {
  if (payload.imageBase64.length > env.AI_MAX_IMAGE_CHARS) {
    return { orderIdMatch: false, productNameMatch: false, amountMatch: false, soldByMatch: false,
      returnWindowClosed: false, confidenceScore: 0,
      discrepancyNote: 'Image too large for auto verification.' };
  }

  if (!isGeminiConfigured(env)) {
    return verifyReturnWindowWithOcr(payload.imageBase64, payload);
  }

  const apiKey = env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = detectImageMimeType(payload.imageBase64);

  try {
    let lastError: unknown = null;
    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        const response = await withModelTimeout(ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType, data: payload.imageBase64.split(',')[1] ?? payload.imageBase64 } },
            { text: [
              `RETURN WINDOW / DELIVERY SCREENSHOT VERIFICATION — GOD-LEVEL ACCURACY REQUIRED`,
              ``,
              `Verify this delivery/return window screenshot against the order:`,
              `  Expected Order ID: ${payload.expectedOrderId}`,
              `  Expected Product Name: ${payload.expectedProductName}`,
              `  Expected Grand Total: ₹${payload.expectedAmount}`,
              `  Expected Sold By: ${payload.expectedSoldBy || 'N/A'}`,
              ``,
              `RULES:`,
              `1. Find the ORDER ID in the screenshot and compare to "${payload.expectedOrderId}".`,
              `2. Find the PRODUCT NAME and compare key words to "${payload.expectedProductName}".`,
              `3. Find the GRAND TOTAL / AMOUNT and compare to ₹${payload.expectedAmount} (±₹1 tolerance).`,
              `4. Find "Sold by" / "Seller" and compare to "${payload.expectedSoldBy || 'N/A'}".`,
              `5. Check if the RETURN WINDOW is CLOSED/EXPIRED. Look for: "Return window closed", "No longer returnable", delivery date that is > 7 days ago, or text indicating the item cannot be returned.`,
              `6. Set confidenceScore 0-100 based on match quality.`,
              `7. Fill all detected fields with what you actually see in the image.`,
            ].join('\n') },
          ],
          config: {
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS_PROOF,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                orderIdMatch: { type: Type.BOOLEAN },
                productNameMatch: { type: Type.BOOLEAN },
                amountMatch: { type: Type.BOOLEAN },
                soldByMatch: { type: Type.BOOLEAN },
                returnWindowClosed: { type: Type.BOOLEAN },
                confidenceScore: { type: Type.INTEGER },
                detectedReturnWindow: { type: Type.STRING },
                discrepancyNote: { type: Type.STRING },
              },
              required: ['orderIdMatch', 'productNameMatch', 'amountMatch', 'soldByMatch', 'returnWindowClosed', 'confidenceScore'],
            },
          },
        }));

        const parsed = safeJsonParse<ReturnWindowVerificationResult>(response.text);
        if (!parsed) throw new Error('Failed to parse AI return window verification response');
        parsed.confidenceScore = Math.max(0, Math.min(100, parsed.confidenceScore ?? 0));
        return parsed;
      } catch (innerError) { lastError = innerError; continue; }
    }
    throw lastError ?? new Error('Gemini return window verification failed');
  } catch (error) {
    console.error('Gemini return window verification error:', error);
    return verifyReturnWindowWithOcr(payload.imageBase64, payload);
  }
}


export async function extractOrderDetailsWithAi(
  env: Env,
  payload: ExtractOrderPayload
): Promise<{
  orderId?: string | null;
  amount?: number | null;
  orderDate?: string | null;
  soldBy?: string | null;
  productName?: string | null;
  confidenceScore: number;
  notes?: string;
}> {
  const geminiAvailable = isGeminiConfigured(env);
  const ai = geminiAvailable ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! }) : null;

  if (payload.imageBase64.length > env.AI_MAX_IMAGE_CHARS) {
    return {
      orderId: null,
      amount: null,
      confidenceScore: 0,
      notes: 'Image too large. Please upload a smaller screenshot.',
    };
  }

  // NOTE: Token estimation is NOT used as a gate here.
  // Tesseract.js is local and free — no token limit applies.
  // For Gemini, the API enforces its own token limits.
  // The AI_MAX_IMAGE_CHARS check above is the sole size gate.

  try {
    let _lastError: unknown = null;

    // ─── REGEX PATTERNS ─── //

    const ORDER_KEYWORD_RE = /order\s*(id|no\.?|number|#|:)/i;
    const EXCLUDED_LINE_RE = /\b(tracking\s*(id|no|number|#)|shipment\s*(id|no|number|#)|awb|invoice\s*(id|no|number|#)|transaction\s*(id|no|number|#)|utr|upi\s*(ref|id)|ref(erence)?\s*(id|no|number|#))\b/i;
    const ORDER_LABEL_PATTERN = 'order\\s*(?:id|no\\.?|number|#)\\s*[:\\-#]?\\s*([A-Z0-9\\-_/]{4,40})';

    // ── Platform-specific order ID patterns ──
    const AMAZON_ORDER_PATTERN     = '\\b\\d{3}[\\-\\s]?\\d{7}[\\-\\s]?\\d{7}\\b';
    const FLIPKART_ORDER_PATTERN   = '\\b[O0][Dd]\\d{10,}\\b';
    const MYNTRA_ORDER_PATTERN     = '\\b(?:MYN|MNT|ORD|PP)[\\-\\s]?\\d{6,}\\b';
    const MEESHO_ORDER_PATTERN     = '\\b(?:MSH|MEESH[O0])[\\-\\s]?\\d{6,}\\b';
    const AJIO_ORDER_PATTERN       = '\\bFN[\\-\\s]?\\d{6,}\\b';
    const JIO_ORDER_PATTERN        = '\\b(?:JIO|OM)[\\-\\s]?\\d{8,}\\b';
    const NYKAA_ORDER_PATTERN      = '\\bNYK[\\-\\s]?\\d{6,}\\b';
    const TATA_ORDER_PATTERN       = '\\b(?:TCL|TATA)[\\-\\s]?\\d{6,}\\b';
    const SNAPDEAL_ORDER_PATTERN   = '\\b(?:SD)[\\-\\s]?\\d{8,}\\b';
    const BIGBASKET_ORDER_PATTERN  = '\\b(?:BB)[\\-\\s]?\\d{8,}\\b';
    const ONMG_ORDER_PATTERN       = '\\b(?:1MG)[\\-\\s]?\\d{6,}\\b';
    const CROMA_ORDER_PATTERN      = '\\b(?:CRM|CROMA)[\\-\\s]?\\d{6,}\\b';
    const PURPLLE_ORDER_PATTERN    = '\\b(?:PUR|PURP)[\\-\\s]?\\d{6,}\\b';
    const AMAZON_SPACED_PATTERN    = '(?:\\d[\\s\\-\\.]{0,2}){17}';
    const GENERIC_ID_PATTERN       = '\\b[A-Z][A-Z0-9\\-]{7,}\\b';

    // ── Amount patterns (₹, Rs, INR, bare) ──
    const AMOUNT_LABEL_RE = /(grand\s*total|amount\s*paid|paid\s*amount|you\s*paid|order\s*total|final\s*total|total\s*amount|net\s*amount|payable|item\s*total|subtotal|sub\s*total|bag\s*total|cart\s*value|deal\s*price|offer\s*price|sale\s*price|final\s*price|price|your\s*price|estimated\s*total|total)/i;
    // Priority labels that indicate the FINAL price paid (not MRP)
    const FINAL_AMOUNT_LABEL_RE = /(grand\s*total|amount\s*paid|paid\s*amount|you\s*paid|order\s*total|final\s*total|total\s*amount|net\s*amount|payable|estimated\s*total)/i;
    const AMOUNT_VALUE_PATTERN = '₹?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
    // Indian currency: ₹, Rs, Rs., INR, plus Tesseract variants (Rs, R5, R$)
    const INR_VALUE_PATTERN = '(?:₹|(?:rs|r[5s$])\\.?|inr)\\s*\\.?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
    const BARE_AMOUNT_PATTERN = '\\b([0-9]{2,8}(?:\\.[0-9]{1,2})?)\\b';

    // ── Compiled regexes ──
    const ORDER_LABEL_RE             = new RegExp(ORDER_LABEL_PATTERN, 'i');
    const AMAZON_ORDER_RE            = new RegExp(AMAZON_ORDER_PATTERN, 'i');
    const AMAZON_ORDER_GLOBAL_RE     = new RegExp(AMAZON_ORDER_PATTERN, 'gi');
    const FLIPKART_ORDER_RE          = new RegExp(FLIPKART_ORDER_PATTERN, 'i');
    const FLIPKART_ORDER_GLOBAL_RE   = new RegExp(FLIPKART_ORDER_PATTERN, 'gi');
    const MYNTRA_ORDER_RE            = new RegExp(MYNTRA_ORDER_PATTERN, 'i');
    const MYNTRA_ORDER_GLOBAL_RE     = new RegExp(MYNTRA_ORDER_PATTERN, 'gi');
    const MEESHO_ORDER_RE            = new RegExp(MEESHO_ORDER_PATTERN, 'i');
    const MEESHO_ORDER_GLOBAL_RE     = new RegExp(MEESHO_ORDER_PATTERN, 'gi');
    const AJIO_ORDER_RE              = new RegExp(AJIO_ORDER_PATTERN, 'i');
    const AJIO_ORDER_GLOBAL_RE       = new RegExp(AJIO_ORDER_PATTERN, 'gi');
    const JIO_ORDER_RE               = new RegExp(JIO_ORDER_PATTERN, 'i');
    const NYKAA_ORDER_RE             = new RegExp(NYKAA_ORDER_PATTERN, 'i');
    const TATA_ORDER_RE              = new RegExp(TATA_ORDER_PATTERN, 'i');
    const SNAPDEAL_ORDER_RE          = new RegExp(SNAPDEAL_ORDER_PATTERN, 'i');
    const BIGBASKET_ORDER_RE         = new RegExp(BIGBASKET_ORDER_PATTERN, 'i');
    const ONMG_ORDER_RE              = new RegExp(ONMG_ORDER_PATTERN, 'i');
    const CROMA_ORDER_RE             = new RegExp(CROMA_ORDER_PATTERN, 'i');
    const PURPLLE_ORDER_RE           = new RegExp(PURPLLE_ORDER_PATTERN, 'i');
    const AMAZON_SPACED_GLOBAL_RE    = new RegExp(AMAZON_SPACED_PATTERN, 'g');
    const GENERIC_ID_RE              = new RegExp(GENERIC_ID_PATTERN, 'i');
    const AMOUNT_VALUE_GLOBAL_RE     = new RegExp(AMOUNT_VALUE_PATTERN, 'g');
    const INR_VALUE_GLOBAL_RE        = new RegExp(INR_VALUE_PATTERN, 'gi');
    const BARE_AMOUNT_GLOBAL_RE      = new RegExp(BARE_AMOUNT_PATTERN, 'g');

    const sanitizeOrderId = (value: unknown) => {
      if (typeof value !== 'string') return null;
      const raw = value.trim().replace(/[\s]+/g, '');
      if (!raw) return null;
      const upper = raw.toUpperCase();
      if (upper.startsWith('E2E-') || upper.startsWith('SYS') || upper.includes('MOBO') || upper.includes('BUZZMA')) {
        return null;
      }
      if (/^[a-f0-9]{24}$/i.test(raw)) return null; // Mongo ObjectId
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return null; // UUID
      if (raw.length < 4 || raw.length > 64) return null;
      // Must contain at least one digit to be a valid order ID
      if (!/\d/.test(raw)) return null;
      return raw;
    };

    const normalizeOcrText = (value: unknown) =>
      typeof value === 'string'
        ? value
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Fix common OCR ligature/encoding artifacts
            .replace(/ﬁ/g, 'fi')
            .replace(/ﬂ/g, 'fl')
            .replace(/\u00a0/g, ' ')  // non-breaking space
        : '';

    const normalizeLine = (line: string) => line.trim();

    const hasOrderKeyword = (line: string) => ORDER_KEYWORD_RE.test(line);
    const hasExcludedKeyword = (line: string) => EXCLUDED_LINE_RE.test(line);

    const normalizeCandidate = (value: string) =>
      value.replace(/[\s:]/g, '').replace(/[\.,]$/, '').trim().toUpperCase();

    const scoreOrderId = (value: string, context: { hasKeyword: boolean; occursInText: boolean }) => {
      const upper = value.toUpperCase().replace(/\s/g, '');
      let score = 0;
      if (context.hasKeyword) score += 4;
      if (upper.includes('-')) score += 2;
      if (/\d/.test(upper) && /[A-Z]/.test(upper)) score += 2;
      if (/^\d{10,20}$/.test(upper)) score += 1;
      // Platform-specific bonus scoring
      if (new RegExp(`^${AMAZON_ORDER_PATTERN}$`).test(upper)) score += 10;
      if (/^OD\d{10,}$/.test(upper)) score += 8;
      if (new RegExp(`^${MYNTRA_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (new RegExp(`^${MEESHO_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (new RegExp(`^${AJIO_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (new RegExp(`^${JIO_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (new RegExp(`^${SNAPDEAL_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (new RegExp(`^${BIGBASKET_ORDER_PATTERN}$`).test(upper)) score += 8;
      if (context.occursInText) score += 1;
      return score;
    };

    /** Map OCR-confused characters to digits (for Amazon 17-digit extraction). */
    const normalizeDigits = (value: string) =>
      value
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2')
        .replace(/[—–]/g, '-')    // em-dash / en-dash → hyphen
        .replace(/\./g, '-');     // period sometimes confused with dash

    const coerceAmazonOrderId = (value: string) => {
      // Try direct match first (already well-formed)
      const directMatch = value.match(/(\d{3})-(\d{7})-(\d{7})/);
      if (directMatch) return directMatch[0];
      // Try with normalized digits
      const normalized = normalizeDigits(value);
      const digitsOnly = normalized.replace(/[^0-9]/g, '');
      if (digitsOnly.length === 17) {
        return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 10)}-${digitsOnly.slice(10)}`;
      }
      // If 18-19 digits, try trimming leading/trailing zeros from OCR noise
      if (digitsOnly.length >= 18 && digitsOnly.length <= 20) {
        for (let start = 0; start <= digitsOnly.length - 17; start++) {
          const candidate = digitsOnly.slice(start, start + 17);
          const formatted = `${candidate.slice(0, 3)}-${candidate.slice(3, 10)}-${candidate.slice(10)}`;
          if (/^\d{3}-\d{7}-\d{7}$/.test(formatted)) return formatted;
        }
      }
      return null;
    };

    const parseAmountString = (raw: string | undefined | null) => {
      if (!raw) return null;
      // Indian format: 1,23,456.00 → remove commas. Standard: 123,456.00 → remove commas.
      const cleaned = raw.replace(/,/g, '');
      const value = Number(cleaned);
      if (!Number.isFinite(value) || value <= 0) return null;
      // Round to 2 decimals to avoid floating point noise
      return Math.round(value * 100) / 100;
    };

    const extractAmounts = (text: string) => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);
      const finalAmounts: number[] = [];   // "grand total", "amount paid", etc.
      const labeledAmounts: number[] = [];  // "total", "price", "subtotal", etc.

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const isFinalLabel = FINAL_AMOUNT_LABEL_RE.test(line);
        const isAnyLabel = AMOUNT_LABEL_RE.test(line);
        if (!isAnyLabel) continue;

        // Look for amounts on the same line
        const matches = line.matchAll(AMOUNT_VALUE_GLOBAL_RE);
        for (const match of matches) {
          const value = parseAmountString(match[1]);
          if (!value) continue;
          if (isFinalLabel) finalAmounts.push(value);
          else labeledAmounts.push(value);
        }

        // Also try INR-prefixed patterns on the same line
        const inrMatches = line.matchAll(new RegExp(INR_VALUE_PATTERN, 'gi'));
        for (const match of inrMatches) {
          const value = parseAmountString(match[1]);
          if (!value) continue;
          if (isFinalLabel) finalAmounts.push(value);
          else labeledAmounts.push(value);
        }

        // If no amount on this line, check the next line (label on one line, value on next)
        if (!finalAmounts.length && !labeledAmounts.length && lines[i + 1]) {
          const nextLineMatches = lines[i + 1].matchAll(AMOUNT_VALUE_GLOBAL_RE);
          for (const match of nextLineMatches) {
            const value = parseAmountString(match[1]);
            if (!value) continue;
            if (isFinalLabel) finalAmounts.push(value);
            else labeledAmounts.push(value);
          }
        }
      }

      // Priority: "final" labels (amount paid, grand total) > general labels (total, price)
      if (finalAmounts.length) return Math.max(...finalAmounts);
      if (labeledAmounts.length) return Math.max(...labeledAmounts);

      // Fallback: any INR-prefixed value in the entire text
      const inrMatches = text.matchAll(INR_VALUE_GLOBAL_RE);
      const inrValues: number[] = [];
      for (const match of inrMatches) {
        const value = parseAmountString(match[1]);
        if (value) inrValues.push(value);
      }
      if (inrValues.length) return Math.max(...inrValues);

      // Last resort: bare numbers that look like prices (₹10 – ₹9,99,999)
      const bareMatches = text.matchAll(BARE_AMOUNT_GLOBAL_RE);
      const bareValues: number[] = [];
      for (const match of bareMatches) {
        const value = parseAmountString(match[1]);
        if (!value) continue;
        if (value < 1 || value > 9_999_999) continue;
        // Skip values that look like dates, years, phone numbers, pin codes
        if (/^\d{4}$/.test(match[1]) && value >= 1900 && value <= 2100) continue;
        if (/^\d{6}$/.test(match[1]) && value >= 100000 && value <= 999999) continue; // 6-digit pincode
        if (/^\d{10}$/.test(match[1])) continue; // phone number
        bareValues.push(value);
      }
      if (bareValues.length) return Math.max(...bareValues);

      return null;
    };

    /** Extract order date from OCR text. */
    const extractOrderDate = (text: string): string | null => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);

      // Look for lines containing date-related keywords
      const dateKeywordRe = /\b(order\s*(placed|date)|placed\s*on|date|ordered\s*on|purchase\s*date|bought\s*on)\b/i;
      // Date patterns: "7 February 2026", "07-02-2026", "07/02/2026", "Feb 7, 2026", "2026-02-07"
      const datePatterns = [
        /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
        /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/,
        /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/,
        /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i,
      ];

      // First try lines with date keywords
      for (const line of lines) {
        if (!dateKeywordRe.test(line)) continue;
        for (const pattern of datePatterns) {
          const match = line.match(pattern);
          if (match) return match[0].trim();
        }
      }

      // Fallback: look for any date-like pattern in the entire text
      for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) return match[0].trim();
      }

      return null;
    };

    /** Extract "Sold by" merchant name from OCR text. */
    const extractSoldBy = (text: string): string | null => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);

      const soldByRe = /\b(sold\s*by|seller|shipped\s*by|fulfilled\s*by|dispatched\s*by)\s*[:\-]?\s*/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(soldByRe);
        if (match) {
          // Extract the text after "Sold by:"
          const afterKeyword = line.slice(match.index! + match[0].length).trim();
          if (afterKeyword && afterKeyword.length >= 2 && afterKeyword.length <= 120) {
            // Clean up common OCR artifacts
            const cleaned = afterKeyword
              .replace(/[^A-Za-z0-9\s&.,\-'()]/g, '')
              .replace(/\s{2,}/g, ' ')
              .trim();
            if (cleaned.length >= 2) return cleaned;
          }
          // Check next line if this line only has the label
          const nextLine = lines[i + 1];
          if (nextLine && nextLine.length >= 2 && nextLine.length <= 120) {
            const cleaned = nextLine
              .replace(/[^A-Za-z0-9\s&.,\-'()]/g, '')
              .replace(/\s{2,}/g, ' ')
              .trim();
            if (cleaned.length >= 2) return cleaned;
          }
        }
      }

      return null;
    };

    /** Extract product name from OCR text. */
    const extractProductName = (text: string): string | null => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);

      // Look for common product name patterns in e-commerce screenshots
      // Typically the product name is the longest descriptive line near the top
      // or near price/amount information
      const excludePatterns = [
        /^(order|tracking|invoice|payment|ship|deliver|cancel|return|refund|subtotal|total|grand|amount|paid|you paid|item|qty|quantity)/i,
        /^\d+$/,
        /^[₹$€]\s*\d/,
        /^(rs|inr)\b/i,
        /^(sold|seller|fulfilled|dispatched)\s*by/i,
        /^(arriving|expected|estimated)\s*(on|by|date|delivery)/i,
        /^(your|my)\s*(account|order|address)/i,
        /^(ship\s*to|deliver\s*to|billing)/i,
        /^\d{1,2}\s*(january|february|march|april|may|june|july|august|september|october|november|december)/i,
      ];

      // Heuristic: find lines that look like product titles
      // Product names tend to be: 20-200 chars, contain mixed case or title case,
      // contain brand/product words, are near image or price references
      const candidates: Array<{ name: string; score: number }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length < 10 || line.length > 250) continue;
        if (excludePatterns.some(p => p.test(line))) continue;

        let score = 0;
        // Longer descriptive lines score higher (likely product names)
        if (line.length >= 20 && line.length <= 150) score += 3;
        if (line.length >= 30) score += 1;
        // Contains common product keywords
        if (/\b(for|with|pack|set|kit|box|ml|gm|kg|ltr|pcs|combo)\b/i.test(line)) score += 3;
        // Contains pipe or dash separators (common in e-commerce titles)
        if (/[|]/.test(line)) score += 2;
        // Mixed case (product titles tend to be mixed case)
        if (/[A-Z]/.test(line) && /[a-z]/.test(line)) score += 1;
        // Near price/amount lines
        if (i > 0 && /₹|rs\.?|inr|price/i.test(lines[i - 1] || '')) score += 1;
        if (i < lines.length - 1 && /₹|rs\.?|inr|price/i.test(lines[i + 1] || '')) score += 2;
        // Near "sold by" lines
        if (i > 0 && /sold\s*by/i.test(lines[i - 1] || '')) score += 1;
        if (i < lines.length - 1 && /sold\s*by/i.test(lines[i + 1] || '')) score += 2;

        if (score >= 3) {
          candidates.push({ name: line.replace(/\s{2,}/g, ' ').trim(), score });
        }
      }

      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].name;
    };

    /** Fix common OCR letter/digit confusion for platform prefixes. */
    const fixOcrPrefixes = (line: string) =>
      line
        // Flipkart: 0D / 0d → OD (zero mistaken for O, any case)
        .replace(/\b0[Dd](\d{10,})\b/g, 'OD$1')
        // Myntra: 0RD → ORD
        .replace(/\b0RD(\d{6,})\b/gi, 'ORD$1')
        // Meesho: MEESH0 → MEESHO
        .replace(/\bMEESH0/gi, 'MEESHO')
        // Snapdeal: S0 → SD (if followed by digits)
        .replace(/\bS0(\d{8,})\b/g, 'SD$1')
        // BigBasket: 88 → BB (OCR reads B as 8)
        .replace(/\b88(\d{8,})\b/g, 'BB$1')
        // Nykaa: NYK already fine
        // Tata: TCL already fine
        ;

    const extractOrderId = (text: string) => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);
      const candidates: Array<{ value: string; score: number }> = [];

      const pushCandidate = (value: string, hasKeyword: boolean) => {
        const sanitized = sanitizeOrderId(value);
        if (!sanitized) return;
        const occursInText = text.toLowerCase().includes(sanitized.toLowerCase());
        const score = scoreOrderId(sanitized, { hasKeyword, occursInText });
        candidates.push({ value: sanitized, score });
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = fixOcrPrefixes(lines[i]);
        if (hasExcludedKeyword(line)) continue;
        const hasKeyword = hasOrderKeyword(line);

        if (hasKeyword) {
          const labeled = line.match(ORDER_LABEL_RE);
          if (labeled?.[1]) {
            const coerced = coerceAmazonOrderId(labeled[1]);
            pushCandidate(coerced ?? labeled[1], true);
          }

          const spaced = line.match(new RegExp(AMAZON_SPACED_PATTERN));
          if (spaced?.[0]) {
            const coerced = coerceAmazonOrderId(spaced[0]);
            if (coerced) pushCandidate(coerced, true);
          }

          const nextLine = lines[i + 1];
          if (nextLine) {
            const amazonNext = nextLine.match(AMAZON_ORDER_RE);
            if (amazonNext?.[0]) {
              const coerced = coerceAmazonOrderId(amazonNext[0]);
              pushCandidate(coerced ?? amazonNext[0], true);
            }
            const spacedNext = nextLine.match(new RegExp(AMAZON_SPACED_PATTERN));
            if (spacedNext?.[0]) {
              const coerced = coerceAmazonOrderId(spacedNext[0]);
              if (coerced) pushCandidate(coerced, true);
            }
            const genericNext = nextLine.match(GENERIC_ID_RE);
            if (genericNext?.[0]) pushCandidate(genericNext[0], true);
          }
        }

        const amazon = line.match(AMAZON_ORDER_RE);
        if (amazon?.[0]) {
          const coerced = coerceAmazonOrderId(amazon[0]);
          pushCandidate(coerced ?? amazon[0], hasKeyword);
        }

        // All platform-specific patterns (applied to each line)
        const platformRegexes: Array<[RegExp, boolean]> = [
          [FLIPKART_ORDER_RE, false],
          [MYNTRA_ORDER_RE, false],
          [MEESHO_ORDER_RE, false],
          [AJIO_ORDER_RE, false],
          [JIO_ORDER_RE, false],
          [NYKAA_ORDER_RE, false],
          [TATA_ORDER_RE, false],
          [SNAPDEAL_ORDER_RE, false],
          [BIGBASKET_ORDER_RE, false],
          [ONMG_ORDER_RE, false],
          [CROMA_ORDER_RE, false],
          [PURPLLE_ORDER_RE, false],
        ];
        for (const [re] of platformRegexes) {
          const m = line.match(re);
          if (m?.[0]) {
            // Normalize Flipkart prefix to uppercase OD
            let val = m[0];
            if (/^[0o][Dd]/i.test(val)) val = 'OD' + val.slice(2);
            pushCandidate(val, hasKeyword);
          }
        }

        if (hasKeyword) {
          const generic = line.match(GENERIC_ID_RE);
          if (generic?.[0]) pushCandidate(generic[0], true);
        }
      }

      // ── Global scan (full text) with OCR prefix fixes ──
      const fixedText = fixOcrPrefixes(text);
      const globalPlatformRegexes: RegExp[] = [
        AMAZON_ORDER_GLOBAL_RE,
        FLIPKART_ORDER_GLOBAL_RE,
        MYNTRA_ORDER_GLOBAL_RE,
        MEESHO_ORDER_GLOBAL_RE,
        AJIO_ORDER_GLOBAL_RE,
      ];
      for (const re of globalPlatformRegexes) {
        re.lastIndex = 0; // Reset global regex state
        for (const m of fixedText.matchAll(re)) {
          let val = m[0];
          if (/^[0o][Dd]/i.test(val)) val = 'OD' + val.slice(2);
          pushCandidate(val, false);
        }
      }

      const spacedAmazon = Array.from(text.matchAll(AMAZON_SPACED_GLOBAL_RE)).map((m) => m[0]);
      for (const chunk of spacedAmazon) {
        const coerced = coerceAmazonOrderId(chunk);
        if (coerced) pushCandidate(coerced, false);
      }

      const globalDigits = normalizeDigits(text).match(/\d{17}/g) || [];
      for (const digits of globalDigits) {
        if (digits.length === 17) {
          pushCandidate(`${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`, false);
        }
      }

      const unique = Array.from(new Map(candidates.map((c) => [normalizeCandidate(c.value), c])).values());
      const sorted = unique.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
      return sorted[0]?.value || null;
    };

    const strictOcrPrompt = [
      'You are a strict OCR engine with GOD-LEVEL accuracy.',
      'Return ONLY the exact visible text from the image.',
      'Do NOT summarize, infer, fix spelling, or add/remove words.',
      'Preserve line breaks and spacing.',
      '',
      'MULTI-DEVICE HANDLING:',
      '- This screenshot may come from ANY device: mobile phone, desktop browser, tablet, or laptop.',
      '- For DESKTOP/LAPTOP screenshots: the order info may be in the center or right side of a wide layout. Read ALL columns.',
      '- For TABLET screenshots: layout may be a mix of mobile and desktop. Read ALL visible text.',
      '- For MOBILE screenshots: layout is vertical. Read top-to-bottom.',
      '- Handle both light mode and dark mode UIs.',
      '',
      'CRITICAL FIELDS TO CAPTURE (extract these with highest priority):',
      '- Order ID / Order Number (e.g., Amazon: 404-xxx-xxx, Flipkart: OD..., Myntra: MYN...)',
      '- Grand Total / Amount Paid / You Paid / Final Total (the actual amount customer paid)',
      '- Product Name / Item Title (full name as shown)',
      '- Sold By / Seller name',
      '- Order Date',
      '',
      'Read every word visible in the image. Do not skip any text, even if partially obscured.',
    ].join('\n');

    const parseDataUrl = (dataUrl: string) => {
      if (!dataUrl.includes(',')) {
        return { mimeType: 'image/jpeg', data: dataUrl };
      }
      const [meta, data] = dataUrl.split(',', 2);
      const match = meta.match(/data:([^;]+);base64/i);
      return { mimeType: match?.[1] || 'image/jpeg', data: data || dataUrl };
    };

    const getImageBuffer = (base64: string) => {
      const parsed = parseDataUrl(base64);
      return Buffer.from(parsed.data, 'base64');
    };

    /**
     * Check if a buffer starts with known image magic bytes.
     * Prevents Sharp from crashing on garbage / corrupt / too-small data.
     */
    const isRecognizedImageBuffer = (buf: Buffer): boolean => {
      if (buf.length < 4) return false;
      // JPEG: FF D8 FF
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
      // PNG: 89 50 4E 47
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
      // WebP: RIFF....WEBP
      if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
      // GIF: GIF87a / GIF89a
      if (buf.toString('ascii', 0, 3) === 'GIF') return true;
      // BMP: BM
      if (buf[0] === 0x42 && buf[1] === 0x4D) return true;
      // TIFF: II (little-endian) or MM (big-endian)
      if ((buf[0] === 0x49 && buf[1] === 0x49) || (buf[0] === 0x4D && buf[1] === 0x4D)) return true;
      // AVIF / HEIF: ....ftyp
      if (buf.length >= 8 && buf.toString('ascii', 4, 8) === 'ftyp') return true;
      return false;
    };

    const preprocessForOcr = async (
      base64: string,
      crop?: { top?: number; left?: number; height?: number; width?: number },
    ) => {
      try {
        const rawBuf = getImageBuffer(base64);
        if (!isRecognizedImageBuffer(rawBuf)) {
          return base64; // Not a valid image — skip Sharp processing
        }
        const input = sharp(rawBuf);
        const metadata = await input.metadata();
        const imgWidth = metadata.width ?? 0;
        const imgHeight = metadata.height ?? 0;

        let pipeline = input;
        if (crop && imgWidth > 0 && imgHeight > 0) {
          const left = Math.max(0, Math.floor(imgWidth * (crop.left ?? 0)));
          const top = Math.max(0, Math.floor(imgHeight * (crop.top ?? 0)));
          const cw = Math.max(1, Math.min(imgWidth - left, Math.floor(imgWidth * (crop.width ?? 1))));
          const ch = Math.max(1, Math.min(imgHeight - top, Math.floor(imgHeight * (crop.height ?? 1))));
          pipeline = pipeline.extract({ left, top, width: cw, height: ch });
        }

        const processed = await pipeline
          // Upscale to help OCR with small fonts; avoid stripping info by keeping aspect ratio.
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .sharpen()
          .jpeg({ quality: 90 })
          .toBuffer();

        return `data:image/jpeg;base64,${processed.toString('base64')}`;
      } catch (err) {
        console.warn('OCR preprocessing failed, using original image.', err);
        return base64;
      }
    };

    const extractTextOnly = async (model: string, imageBase64: string) => {
      const parsed = parseDataUrl(imageBase64);
      const response = await withModelTimeout(ai!.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.data,
            },
          },
          { text: strictOcrPrompt },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS_EXTRACT, 1024),
          responseMimeType: 'text/plain',
        },
      }));
      return normalizeOcrText(response.text || '');
    };

    const runDeterministicExtraction = (text: string) => {
      const orderId = extractOrderId(text);
      const amount = extractAmounts(text);
      const orderDate = extractOrderDate(text);
      const soldBy = extractSoldBy(text);
      const productName = extractProductName(text);
      const notes: string[] = [];
      if (orderId) notes.push('Deterministic order ID extracted.');
      if (amount) notes.push('Deterministic amount extracted.');
      if (orderDate) notes.push('Order date extracted.');
      if (soldBy) notes.push('Seller info extracted.');
      if (productName) notes.push('Product name extracted.');
      return { orderId, amount, orderDate, soldBy, productName, notes };
    };

    /** Tesseract.js fallback: local OCR that works without any external API. */
    const runTesseractOcr = async (imageBase64: string): Promise<string> => {
      let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
      try {
        const buf = getImageBuffer(imageBase64);
        if (!isRecognizedImageBuffer(buf)) {
          return ''; // Not a valid image — skip Tesseract entirely
        }
        // Enhance the image for better Tesseract accuracy
        const enhanced = await sharp(buf)
          .resize({ width: 2400, withoutEnlargement: false })
          .grayscale()
          .normalize()
          .sharpen({ sigma: 1.5 })
          .linear(1.2, -20) // Increase contrast
          .jpeg({ quality: 95 })
          .toBuffer();

        worker = await createWorker('eng');
        // Try default PSM first (automatic), then PSM 6 (uniform block of text)
        const { data } = await worker.recognize(enhanced);
        let text = normalizeOcrText(data.text || '');

        // If default PSM yielded poor results, try PSM 6 (assumes a uniform block of text)
        if (!text || text.length < 20) {
          await worker.setParameters({ tessedit_pageseg_mode: '6' as any });
          const { data: data6 } = await worker.recognize(enhanced);
          const text6 = normalizeOcrText(data6.text || '');
          if (text6.length > text.length) text = text6;
        }

        return text;
      } catch (err) {
        console.warn('Tesseract OCR failed:', err);
        return '';
      } finally {
        // Always terminate the worker to prevent resource leaks.
        try { await worker?.terminate(); } catch { /* ignore cleanup errors */ }
      }
    };

    const refineWithAi = async (
      model: string,
      ocrText: string,
      deterministic: { orderId: string | null; amount: number | null; orderDate: string | null; soldBy: string | null; productName: string | null }
    ) => {
      if (!ai) return null;
      const response = await withModelTimeout(ai.models.generateContent({
        model,
        contents: [
          {
            text: [
              'TASK: EXTRACT E-COMMERCE ORDER DETAILS FROM OCR TEXT.',
              'PRIORITY: GOD-LEVEL ACCURACY REQUIRED.',
              '1. EXTRACT the Order ID exactly as it appears (Amazon 404-..., Flipkart OD..., Myntra, Jio, etc.).',
              '2. EXTRACT the GRAND TOTAL / FINAL AMOUNT PAID. This is the amount the customer actually paid AFTER all discounts, coupons, and offers.',
              '   - Look for labels like: "Grand Total", "Amount Paid", "You Paid", "Order Total", "Total Amount", "Payable", "Net Amount".',
              '   - Do NOT use "MRP", "List Price", "Item Price", "Subtotal", or "Cart Value" unless no other total is available.',
              '   - If multiple amounts are shown, pick the FINAL one (usually the largest labeled total at the bottom).',
              '3. EXTRACT the Order Date (when the order was placed).',
              '4. EXTRACT "Sold by" / Seller name.',
              '5. EXTRACT the Product Name / Item title — the full product title as shown in the order.',
              '   - This is CRITICAL for fraud detection. Extract the complete product name, not just a partial match.',
              '   - Look near the product image, near the price, or at the top of the order details section.',
              '6. IGNORE ambiguous single/double digit numbers.',
              '7. IGNORE system UUIDs or IDs that look like "SYS-..." or internal codes.',
              '8. If a DETERMINISTIC value is provided and looks correct, confirm it.',
              '9. If OCR text is messy but contains a likely Order ID, EXTRACT IT. Do not return null if a partial match exists.',
              '10. Handle screenshots from ALL device types: mobile phones, desktop browsers, tablets, laptops. Layout may be vertical (phone) or horizontal (desktop).',
              `OCR_TEXT (Start):\n${ocrText}\n(End OCR_TEXT)`,
              `DETERMINISTIC_ORDER_ID: ${deterministic.orderId ?? 'null'}`,
              `DETERMINISTIC_AMOUNT: ${deterministic.amount ?? 'null'}`,
              `DETERMINISTIC_ORDER_DATE: ${deterministic.orderDate ?? 'null'}`,
              `DETERMINISTIC_SOLD_BY: ${deterministic.soldBy ?? 'null'}`,
              `DETERMINISTIC_PRODUCT_NAME: ${deterministic.productName ?? 'null'}`,
              'Return JSON with suggestedOrderId, suggestedAmount, suggestedOrderDate, suggestedSoldBy, suggestedProductName, confidenceScore (0-100), and notes.',
            ].join('\n'),
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS_EXTRACT, 512),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedOrderId: { type: Type.STRING },
              suggestedAmount: { type: Type.NUMBER },
              suggestedOrderDate: { type: Type.STRING },
              suggestedSoldBy: { type: Type.STRING },
              suggestedProductName: { type: Type.STRING },
              confidenceScore: { type: Type.INTEGER },
              notes: { type: Type.STRING },
            },
            required: ['confidenceScore'],
          },
        },
      }));

      return safeJsonParse<any>(response.text) ?? null;
    };

    /** Direct image-to-structured-data extraction (bypasses OCR text entirely). */
    const extractDirectFromImage = async (model: string, imageBase64: string) => {
      if (!ai) return null;
      const imgMimeType = detectImageMimeType(imageBase64);
      const response = await withModelTimeout(ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: imgMimeType, data: imageBase64.split(',')[1] ?? imageBase64 } },
          { text: [
            'TASK: EXTRACT E-COMMERCE ORDER DETAILS FROM THIS SCREENSHOT.',
            'PRIORITY: GOD-LEVEL ACCURACY REQUIRED.',
            'This screenshot may be from ANY device: mobile, desktop, tablet, laptop.',
            '',
            'EXTRACT:',
            '1. ORDER ID — The unique order identifier. Look for "Order ID", "Order No", "Order #".',
            '   Platform patterns: Amazon (3-7-7 digits like 404-1234567-1234567), Flipkart (OD+digits), Myntra (MYN/ORD), Meesho (MSH), AJIO (FN), JIO, Nykaa (NYK), Tata (TCL), Snapdeal (SD), BigBasket (BB), etc.',
            '   IGNORE: Tracking IDs, Shipment numbers, AWB, Invoice numbers, Transaction IDs, UTR, UPI references.',
            '2. GRAND TOTAL / FINAL AMOUNT PAID — Amount ACTUALLY paid after all discounts.',
            '   Look for: "Grand Total", "Amount Paid", "You Paid", "Order Total", "Payable", "Net Amount".',
            '   IGNORE: MRP, List Price, Item Price, Subtotal unless no other total exists.',
            '3. ORDER DATE — When the order was placed.',
            '4. SOLD BY / SELLER NAME.',
            '5. PRODUCT NAME — Full product title/name as shown.',
            '',
            'Return JSON. Set confidenceScore 0-100 based on clarity.',
          ].join('\n') },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              orderId: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              orderDate: { type: Type.STRING },
              soldBy: { type: Type.STRING },
              productName: { type: Type.STRING },
              confidenceScore: { type: Type.INTEGER },
            },
            required: ['confidenceScore'],
          },
        },
      }));
      return safeJsonParse<any>(response.text) ?? null;
    };

    const runOcrPass = async (imageBase64: string, label: string) => {
      // Try Gemini OCR first (if available)
      if (ai) {
        let text = '';
        for (const model of GEMINI_MODEL_FALLBACKS) {
          try {
            // eslint-disable-next-line no-await-in-loop
            text = await extractTextOnly(model, imageBase64);
            if (text) {
              console.log('Order extract OCR pass', { label, model, length: text.length });
              return text;
            }
          } catch (innerError) {
            _lastError = innerError;
            continue;
          }
        }
      }
      // Fallback: Tesseract.js local OCR (works without Gemini API key)
      const tesseractText = await runTesseractOcr(imageBase64);
      if (tesseractText) {
        console.log('Order extract OCR pass (Tesseract)', { label, length: tesseractText.length });
      }
      return tesseractText;
    };

    // ── Build OCR variants: phone (vertical) + desktop (horizontal) crops ──
    // Detect if image is landscape (desktop/laptop) or portrait (phone)
    let isLandscape = false;
    try {
      const orientBuf = getImageBuffer(payload.imageBase64);
      if (isRecognizedImageBuffer(orientBuf)) {
        const meta = await sharp(orientBuf).metadata();
        isLandscape = (meta.width ?? 0) > (meta.height ?? 0);
      }
    } catch { /* ignore — default to portrait */ }

    const allOcrVariants: Array<{ label: string; image: string }> = [
      { label: 'original', image: payload.imageBase64 },
      { label: 'enhanced', image: await preprocessForOcr(payload.imageBase64) },
    ];

    if (isLandscape) {
      // Desktop/laptop: order info is often in the center or right portion
      allOcrVariants.push(
        { label: 'center-60', image: await preprocessForOcr(payload.imageBase64, { left: 0.2, width: 0.6 }) },
        { label: 'right-50', image: await preprocessForOcr(payload.imageBase64, { left: 0.5, width: 0.5 }) },
        { label: 'left-50', image: await preprocessForOcr(payload.imageBase64, { left: 0, width: 0.5 }) },
        { label: 'center-top-half', image: await preprocessForOcr(payload.imageBase64, { left: 0.15, width: 0.7, top: 0, height: 0.55 }) },
        { label: 'center-bottom-half', image: await preprocessForOcr(payload.imageBase64, { left: 0.15, width: 0.7, top: 0.4, height: 0.6 }) },
      );
    } else {
      // Phone/portrait: order info is vertically distributed
      allOcrVariants.push(
        { label: 'top-55', image: await preprocessForOcr(payload.imageBase64, { top: 0, height: 0.55 }) },
        { label: 'top-35', image: await preprocessForOcr(payload.imageBase64, { top: 0, height: 0.35 }) },
        { label: 'middle-50', image: await preprocessForOcr(payload.imageBase64, { top: 0.2, height: 0.5 }) },
        { label: 'bottom-50', image: await preprocessForOcr(payload.imageBase64, { top: 0.45, height: 0.55 }) },
      );
    }

    // When using Tesseract (no Gemini), limit variants — but try more than before
    const ocrVariants = ai ? allOcrVariants : allOcrVariants.slice(0, 5);

    let ocrText = '';
    let ocrLabel = 'none';
    let deterministic: { orderId: string | null; amount: number | null; orderDate: string | null; soldBy: string | null; productName: string | null; notes: string[] } = {
      orderId: null,
      amount: null,
      orderDate: null,
      soldBy: null,
      productName: null,
      notes: [],
    };
    let bestScore = 0;
    // Accumulate results across OCR passes — one crop may find the ID, another the amount
    let accumulatedOrderId: string | null = null;
    let accumulatedOrderIdScore = 0;
    let accumulatedAmount: number | null = null;
    let accumulatedOrderDate: string | null = null;
    let accumulatedSoldBy: string | null = null;
    let accumulatedProductName: string | null = null;
    const allOcrTexts: string[] = [];

    if (env.AI_DEBUG_OCR) {
      const parsed = parseDataUrl(payload.imageBase64);
      console.log('Order extract input', {
        mimeType: parsed.mimeType,
        imageChars: payload.imageBase64.length,
      });
    }

    for (const variant of ocrVariants) {
      const candidateText = await runOcrPass(variant.image, variant.label);
      if (!candidateText) continue;
      allOcrTexts.push(candidateText);
      const candidateDeterministic = runDeterministicExtraction(candidateText);

      // Accumulate best-scored order ID across all passes (not just first-found)
      if (candidateDeterministic.orderId) {
        const candidateIdScore = scoreOrderId(candidateDeterministic.orderId, { hasKeyword: true, occursInText: true });
        if (!accumulatedOrderId || candidateIdScore > accumulatedOrderIdScore) {
          accumulatedOrderId = candidateDeterministic.orderId;
          accumulatedOrderIdScore = candidateIdScore;
        }
      }
      if (candidateDeterministic.amount && !accumulatedAmount) {
        accumulatedAmount = candidateDeterministic.amount;
      }
      if (candidateDeterministic.orderDate && !accumulatedOrderDate) {
        accumulatedOrderDate = candidateDeterministic.orderDate;
      }
      if (candidateDeterministic.soldBy && !accumulatedSoldBy) {
        accumulatedSoldBy = candidateDeterministic.soldBy;
      }
      if (candidateDeterministic.productName && !accumulatedProductName) {
        accumulatedProductName = candidateDeterministic.productName;
      }

      const score = (candidateDeterministic.orderId ? 1 : 0) + (candidateDeterministic.amount ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        ocrText = candidateText;
        ocrLabel = variant.label;
        deterministic = candidateDeterministic;
      }
      // Early exit if we have both from the same pass
      if (score === 2) break;
      // Also exit early if accumulated results from different passes give us both
      if (accumulatedOrderId && accumulatedAmount) break;
    }

    // If individual passes found different pieces, merge them
    if (!deterministic.orderId && accumulatedOrderId) {
      deterministic.orderId = accumulatedOrderId;
      deterministic.notes.push('Order ID from alternate crop.');
    }
    if (!deterministic.amount && accumulatedAmount) {
      deterministic.amount = accumulatedAmount;
      deterministic.notes.push('Amount from alternate crop.');
    }
    if (!deterministic.orderDate && accumulatedOrderDate) {
      deterministic.orderDate = accumulatedOrderDate;
      deterministic.notes.push('Order date from alternate crop.');
    }
    if (!deterministic.soldBy && accumulatedSoldBy) {
      deterministic.soldBy = accumulatedSoldBy;
      deterministic.notes.push('Seller info from alternate crop.');
    }
    if (!deterministic.productName && accumulatedProductName) {
      deterministic.productName = accumulatedProductName;
      deterministic.notes.push('Product name from alternate crop.');
    }

    // Last resort: concatenate all OCR text and run deterministic extraction on the combined text
    if (!deterministic.orderId || !deterministic.amount) {
      const combinedText = allOcrTexts.join('\n');
      if (combinedText.length > (ocrText?.length ?? 0)) {
        const combined = runDeterministicExtraction(combinedText);
        if (!deterministic.orderId && combined.orderId) {
          deterministic.orderId = combined.orderId;
          deterministic.notes.push('Order ID from combined OCR text.');
        }
        if (!deterministic.amount && combined.amount) {
          deterministic.amount = combined.amount;
          deterministic.notes.push('Amount from combined OCR text.');
        }
        if (!deterministic.orderDate && combined.orderDate) {
          deterministic.orderDate = combined.orderDate;
          deterministic.notes.push('Order date from combined OCR text.');
        }
        if (!deterministic.soldBy && combined.soldBy) {
          deterministic.soldBy = combined.soldBy;
          deterministic.notes.push('Seller info from combined OCR text.');
        }
        if (!deterministic.productName && combined.productName) {
          deterministic.productName = combined.productName;
          deterministic.notes.push('Product name from combined OCR text.');
        }
        if (!ocrText) {
          ocrText = combinedText;
          ocrLabel = 'combined';
        }
      }
    }

    if (!ocrText) {
      console.warn('Order extract OCR failed: empty OCR output.');
      return {
        orderId: null,
        amount: null,
        confidenceScore: 15,
        notes: 'OCR failed to read text. Please upload a clearer screenshot.',
      };
    }

    if (env.AI_DEBUG_OCR) {
      console.log('Order extract OCR', {
        label: ocrLabel,
        length: ocrText.length,
        preview: ocrText.slice(0, 600),
      });
    }

    // deterministic already computed from the best OCR pass above
    const deterministicConfidence = deterministic.orderId && deterministic.amount ? 78 :
      deterministic.orderId || deterministic.amount ? 72 : 0;

    console.log('Order extract deterministic', {
      orderId: deterministic.orderId,
      amount: deterministic.amount,
      confidence: deterministicConfidence,
    });

    let finalOrderId = deterministic.orderId;
    let finalAmount = deterministic.amount;
    let confidenceScore = deterministicConfidence;
    const notes: string[] = [...deterministic.notes];

    let finalOrderDate = deterministic.orderDate;
    let finalSoldBy = deterministic.soldBy;
    let finalProductName = deterministic.productName;
    let aiUsed = false;

    // ALWAYS run AI when available — for validation, gap-filling, and cross-checking
    if (ai) {
      // Step 1: Text-based refinement (cheap — sends OCR text only)
      for (const model of GEMINI_MODEL_FALLBACKS.slice(0, 3)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const aiResult = await refineWithAi(model, ocrText, deterministic);
          if (!aiResult) continue;

          const aiSuggestedOrderId = sanitizeOrderId(aiResult.suggestedOrderId);
          const aiSuggestedAmount =
            typeof aiResult.suggestedAmount === 'number' && Number.isFinite(aiResult.suggestedAmount)
              ? aiResult.suggestedAmount
              : null;
          const aiConfidence =
            typeof aiResult.confidenceScore === 'number' && Number.isFinite(aiResult.confidenceScore)
              ? Math.max(0, Math.min(100, Math.round(aiResult.confidenceScore)))
              : 0;

          // Relaxed validation: accept AI suggestions if visible in OCR text OR confidence >= 75
          const ocrNorm = ocrText.replace(/[\s\-]/g, '').toLowerCase();
          const orderIdVisible = aiSuggestedOrderId
            ? ocrText.toLowerCase().includes(aiSuggestedOrderId.toLowerCase()) ||
              ocrNorm.includes(aiSuggestedOrderId.replace(/[\s\-]/g, '').toLowerCase())
            : false;
          const amountVisible = aiSuggestedAmount
            ? ocrText.includes(String(aiSuggestedAmount)) ||
              ocrText.includes(aiSuggestedAmount.toFixed(2))
            : false;

          // Fill missing fields from AI
          if (!finalOrderId && aiSuggestedOrderId && (orderIdVisible || aiConfidence >= 75)) {
            finalOrderId = aiSuggestedOrderId;
            notes.push(orderIdVisible ? 'AI order ID confirmed in OCR text.' : 'AI extracted order ID (high confidence).');
          }
          if (!finalAmount && aiSuggestedAmount && (amountVisible || aiConfidence >= 75)) {
            finalAmount = aiSuggestedAmount;
            notes.push(amountVisible ? 'AI amount confirmed in OCR text.' : 'AI extracted amount (high confidence).');
          }

          // AI can correct deterministic if it disagrees AND AI value IS in OCR but deterministic is NOT
          if (finalOrderId && aiSuggestedOrderId && finalOrderId !== aiSuggestedOrderId && orderIdVisible && aiConfidence >= 80) {
            const detInText = ocrNorm.includes(finalOrderId.replace(/[\s\-]/g, '').toLowerCase());
            if (!detInText) {
              finalOrderId = aiSuggestedOrderId;
              notes.push('AI corrected order ID (deterministic not in OCR text).');
            }
          }

          // Fill metadata from AI: orderDate, soldBy, productName
          if (!finalOrderDate && aiResult.suggestedOrderDate) {
            finalOrderDate = aiResult.suggestedOrderDate;
            notes.push('Order date from AI.');
          }
          if (!finalSoldBy && aiResult.suggestedSoldBy) {
            finalSoldBy = aiResult.suggestedSoldBy;
            notes.push('Seller from AI.');
          }
          if (!finalProductName && aiResult.suggestedProductName) {
            finalProductName = aiResult.suggestedProductName;
            notes.push('Product name from AI.');
          }

          // Update confidence
          if (finalOrderId && finalAmount && deterministic.orderId && deterministic.amount) {
            confidenceScore = 92;
            notes.push('AI validated deterministic extraction.');
          } else if (finalOrderId && finalAmount) {
            confidenceScore = Math.max(confidenceScore, 80);
          } else if (finalOrderId || finalAmount) {
            confidenceScore = Math.max(confidenceScore, deterministicConfidence || 60);
          }

          if (aiResult.notes) notes.push(aiResult.notes);
          aiUsed = true;
          console.log('Order extract AI refine', {
            suggestedOrderId: aiSuggestedOrderId,
            suggestedAmount: aiSuggestedAmount,
            confidence: aiConfidence,
          });
          break;
        } catch (innerError) {
          _lastError = innerError;
          continue;
        }
      }

      // Step 2: Direct image extraction (fallback — sends image to Gemini vision)
      if (!finalOrderId || !finalAmount) {
        for (const model of GEMINI_MODEL_FALLBACKS.slice(0, 2)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const directResult = await extractDirectFromImage(model, payload.imageBase64);
            if (!directResult) continue;

            const directOrderId = sanitizeOrderId(directResult.orderId);
            const directAmount =
              typeof directResult.amount === 'number' && Number.isFinite(directResult.amount)
                ? directResult.amount
                : null;
            const directConfidence =
              typeof directResult.confidenceScore === 'number'
                ? Math.max(0, Math.min(100, directResult.confidenceScore))
                : 0;

            if (!finalOrderId && directOrderId && directConfidence >= 60) {
              finalOrderId = directOrderId;
              notes.push('Order ID from direct image AI.');
            }
            if (!finalAmount && directAmount && directAmount >= 10 && directConfidence >= 60) {
              finalAmount = directAmount;
              notes.push('Amount from direct image AI.');
            }
            if (!finalOrderDate && directResult.orderDate) finalOrderDate = directResult.orderDate;
            if (!finalSoldBy && directResult.soldBy) finalSoldBy = directResult.soldBy;
            if (!finalProductName && directResult.productName) finalProductName = directResult.productName;

            if (finalOrderId || finalAmount) {
              confidenceScore = Math.max(confidenceScore, directConfidence);
              aiUsed = true;
              console.log('Order extract direct AI', {
                orderId: directOrderId,
                amount: directAmount,
                confidence: directConfidence,
              });
            }
            break;
          } catch (innerError) {
            _lastError = innerError;
            continue;
          }
        }
      }
    }

    if (!finalOrderId && !finalAmount) {
      confidenceScore = 25;
      notes.push('Unable to extract order details.');
    } else if (!confidenceScore) {
      confidenceScore = 55;
    }

    console.log('Order extract final', {
      orderId: finalOrderId,
      amount: finalAmount,
      orderDate: finalOrderDate,
      soldBy: finalSoldBy,
      productName: finalProductName,
      confidence: confidenceScore,
      aiUsed,
    });

    return {
      orderId: finalOrderId,
      amount: finalAmount,
      orderDate: finalOrderDate,
      soldBy: finalSoldBy,
      productName: finalProductName,
      confidenceScore,
      notes: notes.join(' '),
    };
  } catch (error) {
    console.error('Order extraction error:', error);
    return {
      orderId: null,
      amount: null,
      orderDate: null,
      soldBy: null,
      productName: null,
      confidenceScore: 0,
      notes: `Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
