import { GoogleGenAI, Type } from '@google/genai';
import sharp from 'sharp';
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

function createInputError(message: string, statusCode = 400) {
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

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateTokensFromImage(base64: string): number {
  if (!base64) return 0;
  return Math.ceil(base64.length / 4);
}

function sanitizeUserMessage(env: Env, message: string): string {
  if (!message) return '';
  if (message.length > env.AI_MAX_INPUT_CHARS) {
    message = message.slice(0, env.AI_MAX_INPUT_CHARS);
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
      await ai.models.generateContent({
        model,
        contents: 'ping',
      });
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
  cleaned = cleaned.replace(/\bjson\b/gi, ' ');
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
    summary: string
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
`;

  let systemPrompt = buildSystemPrompt(dealContext, ordersSnippet, ticketsSnippet, historySummary);

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
    systemPrompt = buildSystemPrompt(dealContext, ordersSnippet, ticketsSnippet, reducedSummary);
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
    systemPrompt = buildSystemPrompt('', '', '', '');
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
        const response = await ai.models.generateContent({
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
        });

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

type ExtractOrderPayload = {
  imageBase64: string;
};
export async function verifyProofWithAi(env: Env, payload: ProofPayload): Promise<any> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

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

  try {
    let lastError: unknown = null;

    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: payload.imageBase64.split(',')[1] ?? payload.imageBase64,
              },
            },
            {
              text: `Validate if this receipt/screenshot shows Order ID: ${payload.expectedOrderId} and Amount: ₹${payload.expectedAmount}. Extract the visible order ID and amount, then compare them.`,
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
        });

        const parsed = safeJsonParse<any>(response.text);
        if (!parsed) {
          throw new Error('Failed to parse AI verification response');
        }

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
    // Return low-confidence result on error
    return {
      orderIdMatch: false,
      amountMatch: false,
      confidenceScore: 0,
      discrepancyNote: `AI verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}


export async function extractOrderDetailsWithAi(
  env: Env,
  payload: ExtractOrderPayload
): Promise<{ orderId?: string | null; amount?: number | null; confidenceScore: number; notes?: string }> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

  if (payload.imageBase64.length > env.AI_MAX_IMAGE_CHARS) {
    return {
      orderId: null,
      amount: null,
      confidenceScore: 0,
      notes: 'Auto extraction unavailable. Please enter details manually.',
    };
  }

  const estimatedTokens = estimateTokensFromImage(payload.imageBase64);
  if (estimatedTokens > env.AI_MAX_ESTIMATED_TOKENS) {
    return {
      orderId: null,
      amount: null,
      confidenceScore: 0,
      notes: 'Auto extraction unavailable. Please enter details manually.',
    };
  }

  try {
    let lastError: unknown = null;

    const ORDER_KEYWORD_RE = /order\s*(id|no\.?|number|#)/i;
    const EXCLUDED_LINE_RE = /tracking|shipment|awb|invoice|transaction|utr|payment|upi|ref(erence)?|ship/i;
    const ORDER_LABEL_PATTERN = 'order\\s*(?:id|no\\.?|number|#)\\s*[:\\-#]?\\s*([A-Z0-9\\-_/]{6,40})';
    const AMAZON_ORDER_PATTERN = '\\b\\d{3}-\\d{7}-\\d{7}\\b';
    const FLIPKART_ORDER_PATTERN = '\\bOD\\d{6,}\\b';
    const MYNTRA_ORDER_PATTERN = '\\b(?:MYN|MNT|ORD)\\d{6,}\\b';
    const MEESHO_ORDER_PATTERN = '\\b(?:MSH|MEESHO)\\d{6,}\\b';
    const AMAZON_SPACED_PATTERN = '(?:\\d[\\s\\-]?){17}';
    const GENERIC_ID_PATTERN = '\\b[A-Z0-9]{8,}\\b';
    const AMOUNT_LABEL_RE = /(grand total|amount paid|paid amount|you paid|order total|final total|total|net amount|payable)/i;
    const AMOUNT_VALUE_PATTERN = '₹?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
    const INR_VALUE_PATTERN = '(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
    const BARE_AMOUNT_PATTERN = '\\b([0-9]{2,7}(?:\\.[0-9]{1,2})?)\\b';

    const ORDER_LABEL_RE = new RegExp(ORDER_LABEL_PATTERN, 'i');
    const AMAZON_ORDER_RE = new RegExp(AMAZON_ORDER_PATTERN, 'i');
    const AMAZON_ORDER_GLOBAL_RE = new RegExp(AMAZON_ORDER_PATTERN, 'gi');
    const FLIPKART_ORDER_RE = new RegExp(FLIPKART_ORDER_PATTERN, 'i');
    const FLIPKART_ORDER_GLOBAL_RE = new RegExp(FLIPKART_ORDER_PATTERN, 'gi');
    const MYNTRA_ORDER_RE = new RegExp(MYNTRA_ORDER_PATTERN, 'i');
    const MYNTRA_ORDER_GLOBAL_RE = new RegExp(MYNTRA_ORDER_PATTERN, 'gi');
    const MEESHO_ORDER_RE = new RegExp(MEESHO_ORDER_PATTERN, 'i');
    const MEESHO_ORDER_GLOBAL_RE = new RegExp(MEESHO_ORDER_PATTERN, 'gi');
    const AMAZON_SPACED_GLOBAL_RE = new RegExp(AMAZON_SPACED_PATTERN, 'g');
    const GENERIC_ID_RE = new RegExp(GENERIC_ID_PATTERN, 'i');
    const AMOUNT_VALUE_GLOBAL_RE = new RegExp(AMOUNT_VALUE_PATTERN, 'g');
    const INR_VALUE_GLOBAL_RE = new RegExp(INR_VALUE_PATTERN, 'gi');
    const BARE_AMOUNT_GLOBAL_RE = new RegExp(BARE_AMOUNT_PATTERN, 'g');

    const sanitizeOrderId = (value: unknown) => {
      if (typeof value !== 'string') return null;
      const raw = value.trim();
      if (!raw) return null;
      const upper = raw.toUpperCase();
      if (upper.startsWith('E2E-') || upper.startsWith('SYS') || upper.includes('MOBO') || upper.includes('BUZZMA')) {
        return null;
      }
      if (/^[a-f0-9]{24}$/i.test(raw)) return null; // Mongo ObjectId
      if (raw.length < 4 || raw.length > 64) return null;
      return raw;
    };

    const normalizeOcrText = (value: unknown) =>
      typeof value === 'string' ? value.replace(/\r/g, '\n') : '';

    const normalizeLine = (line: string) => line.trim();

    const hasOrderKeyword = (line: string) => ORDER_KEYWORD_RE.test(line);
    const hasExcludedKeyword = (line: string) => EXCLUDED_LINE_RE.test(line);

    const normalizeCandidate = (value: string) => value.replace(/[\s:]/g, '').replace(/[\.,]$/, '').trim();

    const scoreOrderId = (value: string, context: { hasKeyword: boolean; occursInText: boolean }) => {
      const upper = value.toUpperCase();
      let score = 0;
      if (context.hasKeyword) score += 4;
      if (upper.includes('-')) score += 2;
      if (/\d/.test(upper) && /[A-Z]/.test(upper)) score += 2;
      if (/^\d{10,20}$/.test(upper)) score += 1;
      if (new RegExp(`^${AMAZON_ORDER_PATTERN}$`).test(upper)) score += 5;
      if (new RegExp(`^${FLIPKART_ORDER_PATTERN}$`).test(upper)) score += 4;
      if (new RegExp(`^${MYNTRA_ORDER_PATTERN}$`).test(upper)) score += 4;
      if (new RegExp(`^${MEESHO_ORDER_PATTERN}$`).test(upper)) score += 4;
      if (context.occursInText) score += 1;
      return score;
    };

    const normalizeDigits = (value: string) =>
      value
        .replace(/[Oo]/g, '0')
        .replace(/[Il]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/Z/g, '2');

    const coerceAmazonOrderId = (value: string) => {
      const normalized = normalizeDigits(value);
      const digitsOnly = normalized.replace(/[^0-9]/g, '');
      if (digitsOnly.length === 17) {
        return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 10)}-${digitsOnly.slice(10)}`;
      }
      return null;
    };

    const parseAmountString = (raw: string | undefined | null) => {
      if (!raw) return null;
      const cleaned = raw.replace(/,/g, '');
      const value = Number(cleaned);
      return Number.isFinite(value) ? value : null;
    };

    const extractAmounts = (text: string) => {
      const lines = text.split('\n').map(normalizeLine).filter(Boolean);
      const labeledAmounts: number[] = [];

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!AMOUNT_LABEL_RE.test(line)) continue;
        const matches = line.matchAll(AMOUNT_VALUE_GLOBAL_RE);
        for (const match of matches) {
          const value = parseAmountString(match[1]);
          if (value) labeledAmounts.push(value);
        }

        if (!labeledAmounts.length && lines[i + 1]) {
          const nextLineMatches = lines[i + 1].matchAll(AMOUNT_VALUE_GLOBAL_RE);
          for (const match of nextLineMatches) {
            const value = parseAmountString(match[1]);
            if (value) labeledAmounts.push(value);
          }
        }
      }

      if (labeledAmounts.length) return Math.max(...labeledAmounts);

      const inrMatches = text.matchAll(INR_VALUE_GLOBAL_RE);
      const inrValues: number[] = [];
      for (const match of inrMatches) {
        const value = parseAmountString(match[1]);
        if (value) inrValues.push(value);
      }
      if (inrValues.length) return Math.max(...inrValues);

      const bareMatches = text.matchAll(BARE_AMOUNT_GLOBAL_RE);
      const bareValues: number[] = [];
      for (const match of bareMatches) {
        const value = parseAmountString(match[1]);
        if (!value) continue;
        if (value < 1 || value > 500000) continue;
        bareValues.push(value);
      }
      if (bareValues.length) return Math.max(...bareValues);

      return null;
    };

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
        const line = lines[i];
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

        const flipkart = line.match(FLIPKART_ORDER_RE);
        if (flipkart?.[0]) pushCandidate(flipkart[0], hasKeyword);

        const myntra = line.match(MYNTRA_ORDER_RE);
        if (myntra?.[0]) pushCandidate(myntra[0], hasKeyword);

        const meesho = line.match(MEESHO_ORDER_RE);
        if (meesho?.[0]) pushCandidate(meesho[0], hasKeyword);

        if (hasKeyword) {
          const generic = line.match(GENERIC_ID_RE);
          if (generic?.[0]) pushCandidate(generic[0], true);
        }
      }

      const globalAmazon = Array.from(text.matchAll(AMAZON_ORDER_GLOBAL_RE)).map((m) => m[0]);
      const globalFlipkart = Array.from(text.matchAll(FLIPKART_ORDER_GLOBAL_RE)).map((m) => m[0]);
      const globalMyntra = Array.from(text.matchAll(MYNTRA_ORDER_GLOBAL_RE)).map((m) => m[0]);
      const globalMeesho = Array.from(text.matchAll(MEESHO_ORDER_GLOBAL_RE)).map((m) => m[0]);
      for (const value of [...globalAmazon, ...globalFlipkart, ...globalMyntra, ...globalMeesho]) {
        pushCandidate(value, false);
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
      'You are a strict OCR engine.',
      'Return ONLY the exact visible text from the image.',
      'Do NOT summarize.',
      'Do NOT infer.',
      'Do NOT fix spelling.',
      'Do NOT add or remove words.',
      'Preserve line breaks and spacing.',
    ].join('\n');

    const getImageBuffer = (base64: string) => {
      const raw = base64.includes(',') ? base64.split(',')[1] ?? base64 : base64;
      return Buffer.from(raw, 'base64');
    };

    const preprocessForOcr = async (base64: string, crop?: { top: number; height: number }) => {
      try {
        const input = sharp(getImageBuffer(base64));
        const metadata = await input.metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;

        let pipeline = input;
        if (crop && width > 0 && height > 0) {
          const top = Math.max(0, Math.min(height - 1, Math.floor(height * crop.top)));
          const cropHeight = Math.max(1, Math.min(height - top, Math.floor(height * crop.height)));
          pipeline = pipeline.extract({ left: 0, top, width, height: cropHeight });
        }

        const processed = await pipeline
          // Upscale to help OCR with small fonts; avoid stripping info by keeping aspect ratio.
          .resize({ width: 2200, withoutEnlargement: false })
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
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: imageBase64.split(',')[1] ?? imageBase64,
            },
          },
          { text: strictOcrPrompt },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS_EXTRACT, 512),
          responseMimeType: 'text/plain',
        },
      });
      return normalizeOcrText(response.text || '');
    };

    const runDeterministicExtraction = (text: string) => {
      const orderId = extractOrderId(text);
      const amount = extractAmounts(text);
      const notes: string[] = [];
      if (orderId) notes.push('Deterministic order ID extracted.');
      if (amount) notes.push('Deterministic amount extracted.');
      return { orderId, amount, notes };
    };

    const refineWithAi = async (
      model: string,
      ocrText: string,
      deterministic: { orderId: string | null; amount: number | null }
    ) => {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            text: [
              'You are verifying OCR text for an e-commerce order.',
              'Only respond with values that are explicitly visible in the OCR text provided.',
              'Do NOT guess or invent values.',
              `OCR_TEXT:\n${ocrText}`,
              `DETERMINISTIC_ORDER_ID: ${deterministic.orderId ?? 'null'}`,
              `DETERMINISTIC_AMOUNT: ${deterministic.amount ?? 'null'}`,
              'If the OCR text contains a different Order ID or Amount, suggest the exact value.',
              'If OCR text does not clearly show a value, omit it.',
              'Return JSON only.',
            ].join('\n'),
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: Math.min(env.AI_MAX_OUTPUT_TOKENS_EXTRACT, 256),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedOrderId: { type: Type.STRING },
              suggestedAmount: { type: Type.NUMBER },
              confidenceScore: { type: Type.INTEGER },
              notes: { type: Type.STRING },
            },
            required: ['confidenceScore'],
          },
        },
      });

      return safeJsonParse<any>(response.text) ?? null;
    };

    const runOcrPass = async (imageBase64: string, label: string) => {
      let text = '';
      for (const model of GEMINI_MODEL_FALLBACKS) {
        try {
          // eslint-disable-next-line no-await-in-loop
          text = await extractTextOnly(model, imageBase64);
          if (text) {
            console.info('Order extract OCR pass', { label, model, length: text.length });
            return text;
          }
        } catch (innerError) {
          lastError = innerError;
          continue;
        }
      }
      return '';
    };

    const ocrVariants: Array<{ label: string; image: string }> = [
      { label: 'original', image: payload.imageBase64 },
      { label: 'enhanced', image: await preprocessForOcr(payload.imageBase64) },
      { label: 'top-55', image: await preprocessForOcr(payload.imageBase64, { top: 0, height: 0.55 }) },
      { label: 'top-35', image: await preprocessForOcr(payload.imageBase64, { top: 0, height: 0.35 }) },
      { label: 'middle-50', image: await preprocessForOcr(payload.imageBase64, { top: 0.25, height: 0.5 }) },
    ];

    let ocrText = '';
    let deterministic: { orderId: string | null; amount: number | null; notes: string[] } = {
      orderId: null,
      amount: null,
      notes: [],
    };
    let bestScore = 0;

    for (const variant of ocrVariants) {
      const candidateText = await runOcrPass(variant.image, variant.label);
      if (!candidateText) continue;
      const candidateDeterministic = runDeterministicExtraction(candidateText);
      const score = (candidateDeterministic.orderId ? 1 : 0) + (candidateDeterministic.amount ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        ocrText = candidateText;
        deterministic = candidateDeterministic;
      }
      if (score === 2) break;
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

    console.info('Order extract OCR', { length: ocrText.length, preview: ocrText.slice(0, 400) });

    // deterministic already computed from the best OCR pass above
    const deterministicConfidence = deterministic.orderId && deterministic.amount ? 78 :
      deterministic.orderId || deterministic.amount ? 72 : 0;

    console.info('Order extract deterministic', {
      orderId: deterministic.orderId,
      amount: deterministic.amount,
      confidence: deterministicConfidence,
    });

    let finalOrderId = deterministic.orderId;
    let finalAmount = deterministic.amount;
    let confidenceScore = deterministicConfidence;
    const notes: string[] = [...deterministic.notes];

    let aiUsed = false;
    if (!(finalOrderId && finalAmount)) {
      for (const model of GEMINI_MODEL_FALLBACKS.slice(0, 1)) {
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

        const orderIdVisible = aiSuggestedOrderId
          ? ocrText.toLowerCase().includes(aiSuggestedOrderId.toLowerCase())
          : false;
        const amountVisible = aiSuggestedAmount
          ? ocrText.includes(String(aiSuggestedAmount))
          : false;

        if (!finalOrderId && aiSuggestedOrderId && orderIdVisible) {
          finalOrderId = aiSuggestedOrderId;
          notes.push('AI suggested order ID validated against OCR text.');
        }
        if (!finalAmount && aiSuggestedAmount && amountVisible) {
          finalAmount = aiSuggestedAmount;
          notes.push('AI suggested amount validated against OCR text.');
        }

        if (finalOrderId && finalAmount && deterministic.orderId && deterministic.amount) {
          confidenceScore = 90;
          notes.push('AI agreed with deterministic extraction.');
        } else if (finalOrderId || finalAmount) {
          confidenceScore = Math.max(confidenceScore, deterministicConfidence || 55);
        }

        if (aiResult.notes) notes.push(aiResult.notes);
          aiUsed = true;
          console.info('Order extract AI', {
            suggestedOrderId: aiSuggestedOrderId,
            suggestedAmount: aiSuggestedAmount,
            confidence: aiConfidence,
          });
          break;
        } catch (innerError) {
          lastError = innerError;
          continue;
        }
      }
    }

    if (!finalOrderId && !finalAmount) {
      confidenceScore = 25;
      notes.push('Unable to extract order details from OCR text.');
    } else if (!confidenceScore) {
      confidenceScore = 55;
    }

    console.info('Order extract final', {
      orderId: finalOrderId,
      amount: finalAmount,
      confidence: confidenceScore,
      aiUsed,
    });

    return {
      orderId: finalOrderId,
      amount: finalAmount,
      confidenceScore,
      notes: notes.join(' '),
    };
  } catch (error) {
    console.error('Gemini extraction error:', error);
    return {
      orderId: null,
      amount: null,
      confidenceScore: 0,
      notes: `AI extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
