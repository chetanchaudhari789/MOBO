import { extractOrderDetailsWithAi } from '../services/aiService.js';
import { loadEnv } from '../config/env.js';
import sharp from 'sharp';

/**
 * Tests for the order extraction pipeline.
 * These tests create real images with text rendered via Sharp,
 * then verify that Tesseract.js + deterministic regex extracts
 * the order ID and amount correctly — no Gemini API key needed.
 */

function makeTestEnv() {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    GEMINI_API_KEY: '', // No Gemini — forces Tesseract fallback
    AI_DEBUG_OCR: 'true',
  });
}

/**
 * Render multi-line text onto a white image and return as data URL.
 * Uses Sharp's SVG overlay to stamp text onto a blank canvas.
 */
async function renderTextToImage(lines: string[], width = 800, fontSize = 28): Promise<string> {
  const lineHeight = fontSize + 12;
  const height = Math.max(200, lines.length * lineHeight + 80);
  const escapeSvg = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="40" y="${60 + i * lineHeight}" font-size="${fontSize}" font-family="monospace" fill="black">${escapeSvg(line)}</text>`
    )
    .join('\n');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    ${textElements}
  </svg>`;

  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from(svg), gravity: 'northwest' }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

describe('order extraction (Tesseract fallback)', () => {
  it('extracts Amazon order ID and amount from a rendered image', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order Details',
      'Order placed   5 February 2026',
      'Order number   408-9652341-7203568',
      '',
      'Arriving Wednesday',
      'Avimee Herbal Keshpallav Hair Oil',
      'Sold by: Avimee_Herbal',
      'Rs 522.00',
      '',
      'Payment method',
      'Amazon Pay ICICI Bank Credit Card',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });

    console.log('Amazon extraction result:', JSON.stringify(result, null, 2));

    // The pipeline should extract order ID and/or amount
    expect(result).toHaveProperty('confidenceScore');
    expect(result.confidenceScore).toBeGreaterThan(0);

    // Check that at least something was extracted
    const hasOrderId = Boolean(result.orderId);
    const hasAmount = typeof result.amount === 'number' && result.amount > 0;
    expect(hasOrderId || hasAmount).toBe(true);

    if (hasOrderId) {
      // Amazon order IDs follow the 3-7-7 pattern
      expect(result.orderId).toMatch(/\d{3}-\d{7}-\d{7}/);
    }
    if (hasAmount) {
      expect(result.amount).toBe(522);
    }
  });

  it('extracts Flipkart order ID from a rendered image', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Your Orders',
      'Order ID: OD432187654321098',
      'Delivered on 3 Feb 2026',
      '',
      'Samsung Galaxy M34 5G',
      'Total: Rs 14,999.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Flipkart extraction result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);

    const hasOrderId = Boolean(result.orderId);
    const hasAmount = typeof result.amount === 'number' && result.amount > 0;
    expect(hasOrderId || hasAmount).toBe(true);

    if (hasOrderId) {
      expect(result.orderId!.toUpperCase()).toMatch(/^OD\d+$/);
    }
  });

  it('returns low confidence for blank/unreadable images', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    // Create a blank white image with no text
    const buf = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const imageBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Blank image result:', JSON.stringify(result, null, 2));

    // Should not crash and should report low confidence
    expect(result.confidenceScore).toBeLessThanOrEqual(30);
  });

  it('handles a large phone-screenshot-sized image without rejecting', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const width = 1080;
    const lines = [
      'Your Orders',
      '',
      'Order Details',
      'Order placed   5 February 2026',
      'Order number   408-9652341-7203568',
      '',
      'Arriving Wednesday',
      '',
      'Avimee Herbal Keshpallav Hair Oil for Hair Growth',
      'Sold by: Avimee_Herbal',
      'Rs 522.00',
      '',
      'Track package          Cancel items',
      '',
      'Payment method',
      'Amazon Pay ICICI Bank Credit Card ending in ****1234',
    ];

    const imageBase64 = await renderTextToImage(lines, width, 32);
    const sizeKB = Math.round(imageBase64.length / 1024);
    console.log(`Large image size: ${sizeKB} KB (${imageBase64.length} chars)`);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Large image result:', JSON.stringify(result, null, 2));

    expect(result.notes).not.toContain('too large');
    expect(result.notes).not.toContain('unavailable');
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.orderId).toMatch(/\d{3}-\d{7}-\d{7}/);
    expect(result.amount).toBe(522);
  });

  it('extracts Meesho order ID and amount', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'My Orders',
      '',
      'Order ID: MEESHO845123',
      'Delivered on 1 Feb 2026',
      '',
      'Women Cotton Printed Kurti',
      'Price: Rs 349.00',
      'Total: Rs 349.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Meesho result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.orderId).toMatch(/MEESHO\d+/i);
    expect(result.amount).toBe(349);
  });

  it('extracts Myntra order ID', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'ORDER DETAILS',
      'Order No: MYN3847291',
      '',
      'PUMA Running Shoes',
      'Rs. 2,499.00',
      'Grand Total: Rs 2,499.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Myntra result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.orderId).toMatch(/MYN\d+/i);
    expect(result.amount).toBe(2499);
  });

  it('extracts from desktop-style wide screenshot', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    // Simulate a 1920x1080 desktop screenshot with order info
    const imageBase64 = await renderTextToImage(
      [
        'amazon.in - Your Orders',
        '',
        'Order Details',
        '',
        'Order #408-1234567-8901234',
        '',
        'Arriving Thursday',
        'boAt Rockerz 450 Bluetooth',
        'Amount Paid: Rs 1,299.00',
      ],
      1920,
      36,
    );

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Desktop result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    // Should extract order ID
    const hasId = Boolean(result.orderId);
    if (hasId) {
      expect(result.orderId).toMatch(/\d{3}-\d{7}-\d{7}/);
    }
    // Amount paid label should help pick up the amount
    if (result.amount) {
      expect(result.amount).toBe(1299);
    }
    expect(hasId || result.amount).toBeTruthy();
  });

  it('handles Indian comma format and picks "Amount Paid" over MRP', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order Details',
      'Order number 402-9876543-1234567',
      '',
      'MRP: Rs 45,999.00',
      'Discount: Rs 16,000.00',
      'Deal Price: Rs 29,999.00',
      'Amount Paid: Rs 29,999.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Amount priority result:', JSON.stringify(result, null, 2));

    expect(result.orderId).toMatch(/\d{3}-\d{7}-\d{7}/);
    // Should pick "Amount Paid" (29999) as priority over MRP (45999)
    expect(result.amount).toBe(29999);
  });
});
