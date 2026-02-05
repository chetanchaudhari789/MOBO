import { GoogleGenAI, Type } from '@google/genai';
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
              text: [
                'Extract the external marketplace Order ID and the final paid amount from this receipt/screenshot.',
                'Return JSON only. If a value is not clearly visible, omit the field.',
                'Amount must be a number in INR without currency symbols (e.g., 1499).',
              ].join('\n'),
            },
          ],
          config: {
            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS_EXTRACT,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                orderId: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                confidenceScore: { type: Type.INTEGER },
                notes: { type: Type.STRING },
              },
              required: ['confidenceScore'],
            },
          },
        });

        const parsed = safeJsonParse<any>(response.text);
        if (!parsed) throw new Error('Failed to parse AI extraction response');

        const orderId = typeof parsed.orderId === 'string' ? parsed.orderId : null;
        const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : null;
        const confidenceScore =
          typeof parsed.confidenceScore === 'number' && Number.isFinite(parsed.confidenceScore)
            ? Math.max(0, Math.min(100, Math.round(parsed.confidenceScore)))
            : 0;

        console.info('Gemini extract usage estimate', { model, estimatedTokens });

        return {
          orderId,
          amount,
          confidenceScore,
          notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        };
      } catch (innerError) {
        lastError = innerError;
        continue;
      }
    }

    throw lastError ?? new Error('Gemini extraction failed');
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
