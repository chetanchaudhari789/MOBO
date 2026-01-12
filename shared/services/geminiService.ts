import { GoogleGenAI, Type } from '@google/genai';
import { Product, Order, Ticket } from '../types';

// Initialize the engine with the environment key
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * MOBOT: THE INTELLIGENT ASSISTANT
 * Handles intent classification, deal recommendations, and status updates.
 */
export const generateBotResponse = async (
  userMessage: string,
  allProducts: Product[],
  userOrders: Order[] | null,
  userTickets: Ticket[] | null,
  userName: string,
  imageBase64?: string
): Promise<any> => {
  try {
    const ai = getAI();

    // Context Preparation: Efficiently slicing data to stay within token limits
    const dealContext = allProducts
      .slice(0, 15)
      .map(
        (p) =>
          `[ID: ${p.id}] ${p.title} - Price: ₹${p.price} (MRP: ₹${p.originalPrice}) on ${p.platform}`
      )
      .join('\n');

    const systemPrompt = `
      You are 'Mobo', a world-class AI shopping strategist for ${userName}.
      
      CONTEXT:
      - DEALS: ${dealContext}
      - RECENT ORDERS: ${JSON.stringify(userOrders?.slice(0, 3))}
      - TICKETS: ${JSON.stringify(userTickets?.slice(0, 2))}
      
      BEHAVIOR:
      1. Keep responses concise and professional. Use emojis sparingly (0–1 per message).
      2. If user mentions "shoes", "deals", "offers", identify matching IDs and put them in 'recommendedProductIds'.
      3. Classify intent: 'search_deals', 'check_order_status', 'check_ticket_status', 'navigation', or 'greeting'.
      4. For navigation, use: 'home', 'explore', 'orders', 'profile'.
      5. Bold key info like **₹599** or **Delivered**.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: imageBase64
        ? [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64.split(',')[1] } },
            { text: userMessage || 'Analyze this image.' },
          ]
        : userMessage,
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

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error('Mobo Engine Error:', error);
    return {
      responseText: "I'm having trouble right now. Please try again.",
      intent: 'unknown',
    };
  }
};

/**
 * AI AUDITOR: RECEIPT VERIFICATION
 * Validates buyer screenshots against database records.
 */
export const verifyProofWithAI = async (
  imageBase64: string,
  expectedOrderId: string,
  expectedAmount: number
): Promise<any> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64.split(',')[1] } },
        {
          text: `Validate if this receipt shows Order ID: ${expectedOrderId} and Amount: ${expectedAmount}.`,
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
    return JSON.parse(response.text || '{}');
  } catch {
    return { confidenceScore: 0, discrepancyNote: 'AI Analysis Failed' };
  }
};
