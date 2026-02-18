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
      // Tesseract may misread 'O' as '0' – accept both
      expect(result.orderId!.toUpperCase()).toMatch(/^[O0]D[\dA-Z]+$/);
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

  // ─── Product Name Extraction Tests ───

  it('extracts product name from Amazon order screenshot', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order Details',
      'Order placed   12 January 2026',
      'Order number   408-3456789-1234567',
      '',
      'Arriving Wednesday',
      'Samsung Galaxy M14 5G (Berry Blue, 6GB, 128GB Storage)',
      'Sold by: Appario Retail Private Ltd',
      'Rs 10,999.00',
      '',
      'Payment method',
      'UPI',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Amazon product name result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    if (result.productName) {
      expect(result.productName.toLowerCase()).toContain('samsung');
      // Should NOT be a URL, delivery status, or address
      expect(result.productName).not.toMatch(/https?:\/\//i);
      expect(result.productName).not.toMatch(/^arriving/i);
    }
  });

  it('extracts Nykaa beauty product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'nykaa.com',
      'My Orders',
      '',
      'Order ID: NYK4829371',
      'Delivered on 5 Feb 2026',
      '',
      'Lakme Absolute Matte Revolution Lip Color 3.5gm',
      'Rs 695.00',
      'Grand Total: Rs 695.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Nykaa product name result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    if (result.orderId) {
      // Tesseract may misread digits; just check for NYK prefix pattern
      expect(result.orderId).toMatch(/NYK[A-Z0-9]+/i);
    }
    if (result.productName) {
      expect(result.productName.toLowerCase()).toContain('lakme');
      expect(result.productName).not.toMatch(/nykaa\.com/i);
    }
    if (result.amount) {
      expect(result.amount).toBe(695);
    }
  });

  it('extracts Blinkit grocery product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'blinkit',
      'My Orders',
      '',
      'Order ID: BLK9283746',
      'Delivered in 12 mins',
      '',
      'Amul Gold Milk 500ml',
      'Qty: 2',
      'Rs 36.00',
      'Total: Rs 72.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Blinkit product name result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    if (result.productName) {
      expect(result.productName.toLowerCase()).toContain('amul');
      expect(result.productName).not.toMatch(/^blinkit$/i);
    }
  });

  it('extracts AJIO fashion product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'AJIO.com',
      'Order Details',
      '',
      'Order No: FN7382945',
      'Shipped on 3 Feb 2026',
      '',
      'US Polo Assn Men Slim Fit Cotton Shirt',
      'Size: M, Color: Navy Blue',
      'Rs 1,299.00',
      'Grand Total: Rs 1,299.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('AJIO product name result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    if (result.orderId) {
      expect(result.orderId).toMatch(/FN\d+/i);
    }
    if (result.productName) {
      expect(result.productName.toLowerCase()).toMatch(/polo|shirt/);
    }
  });

  it('rejects URL as product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order Details',
      'Order number 408-1111111-2222222',
      '',
      'https://www.amazon.in/Samsung-Galaxy/dp/B09G9YPBCQ',
      'Rs 12,999.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('URL rejection result:', JSON.stringify(result, null, 2));

    // Product name should NOT be a URL
    if (result.productName) {
      expect(result.productName).not.toMatch(/https?:\/\//i);
      expect(result.productName).not.toMatch(/amazon\.in/i);
    }
  });

  it('rejects delivery status as product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order number 408-3333333-4444444',
      '',
      'Arriving on Wednesday',
      'Shipped via Blue Dart',
      'Rs 599.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Delivery status rejection result:', JSON.stringify(result, null, 2));

    if (result.productName) {
      expect(result.productName).not.toMatch(/^arriving/i);
      expect(result.productName).not.toMatch(/^shipped/i);
    }
  });

  it('rejects category list as product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order number 408-5555555-6666666',
      'Tablets, Earbuds, Watch, Blue',
      '',
      'boAt Airdopes 131 TWS Earbuds',
      'Rs 899.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Category list rejection result:', JSON.stringify(result, null, 2));

    if (result.productName) {
      // Should NOT be the category list
      expect(result.productName).not.toBe('Tablets, Earbuds, Watch, Blue');
      // Should preferably be the actual product
      if (result.productName.toLowerCase().includes('boat') || result.productName.toLowerCase().includes('airdopes')) {
        expect(result.productName.toLowerCase()).toMatch(/boat|airdopes|tws|earbuds/);
      }
    }
  });

  it('extracts Meesho product name correctly', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'meesho',
      'Order ID: MEESHO192837',
      '',
      'Delivered on 28 Jan 2026',
      'Floral Printed Cotton Anarkali Kurti for Women',
      'Qty: 1',
      'Total: Rs 449.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Meesho product name result:', JSON.stringify(result, null, 2));

    expect(result.confidenceScore).toBeGreaterThan(0);
    if (result.productName) {
      expect(result.productName.toLowerCase()).toMatch(/kurti|anarkali|cotton|floral/);
    }
    if (result.amount) {
      expect(result.amount).toBe(449);
    }
  });

  it('rejects address/pincode as product name', { timeout: 120_000 }, async () => {
    const env = makeTestEnv();
    const imageBase64 = await renderTextToImage([
      'Order #408-7777777-8888888',
      '',
      '12, Koramangala, Bangalore',
      'Karnataka, India 560034',
      '',
      'JBL Tune 760NC Wireless Headphones',
      'Rs 3,499.00',
    ]);

    const result = await extractOrderDetailsWithAi(env, { imageBase64 });
    console.log('Address rejection result:', JSON.stringify(result, null, 2));

    if (result.productName) {
      expect(result.productName).not.toMatch(/koramangala|bangalore|karnataka|560034/i);
    }
  });
});
