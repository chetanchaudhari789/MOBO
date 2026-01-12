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

export async function generateChatUiResponse(
  env: Env,
  payload: ChatPayload
): Promise<ChatUiResponse> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

  const products = Array.isArray(payload.products) ? payload.products : [];
  const dealContext = products
    .slice(0, 15)
    .map((p) => {
      const id = p.id ?? 'unknown';
      const title = p.title ?? 'Untitled';
      const price = typeof p.price === 'number' ? p.price : 0;
      const originalPrice = typeof p.originalPrice === 'number' ? p.originalPrice : price;
      const platform = p.platform ?? 'Unknown';
      return `[ID: ${id}] ${title} - Price: ₹${price} (MRP: ₹${originalPrice}) on ${platform}`;
    })
    .join('\n');

  const systemPrompt = `
You are 'Mobo', a world-class AI shopping strategist for ${payload.userName || 'Guest'}.

CONTEXT:
- DEALS: ${dealContext}
- RECENT ORDERS: ${JSON.stringify((payload.orders || []).slice(0, 3))}
- TICKETS: ${JSON.stringify((payload.tickets || []).slice(0, 2))}

BEHAVIOR:
1. Be concise and friendly.
2. If user mentions "shoes", "deals", "offers", identify matching IDs and put them in 'recommendedProductIds'.
3. Classify intent: 'search_deals', 'check_order_status', 'check_ticket_status', 'navigation', 'greeting', or 'unknown'.
4. For navigation, use: 'home', 'explore', 'orders', 'profile'.
5. Use **bold** for key info like **₹599** or **Delivered**.
6. Always respond in JSON format with responseText, intent, and optional fields.
`;

  const contents = payload.image
    ? [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: payload.image.split(',')[1] ?? payload.image,
          },
        },
        { text: payload.message || 'Analyze this image.' },
      ]
    : payload.message;

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

        const parsed = safeJsonParse<ChatModelResponse>(response.text) ?? {
          responseText: response.text || "I'm having trouble responding right now.",
          intent: 'unknown',
        };

        const recommendedIds = Array.isArray(parsed.recommendedProductIds)
          ? parsed.recommendedProductIds
          : [];
        const recommendedProducts = recommendedIds.length
          ? products.filter((p) => p.id && recommendedIds.includes(String(p.id)))
          : [];

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

<<<<<<< HEAD
type ExtractOrderPayload = {
  imageBase64: string;
};

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
export async function verifyProofWithAi(env: Env, payload: ProofPayload): Promise<any> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

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
<<<<<<< HEAD

export async function extractOrderDetailsWithAi(
  env: Env,
  payload: ExtractOrderPayload
): Promise<{ orderId?: string | null; amount?: number | null; confidenceScore: number; notes?: string }> {
  const apiKey = requireGeminiKey(env);
  const ai = new GoogleGenAI({ apiKey });

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
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
