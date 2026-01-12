import { User, Product, Order, Campaign, WithdrawalRequest, KycStatus } from '../types';

// --- CONFIGURATION ---
const BRANDS_CONFIG = [
  {
    name: 'Nike India',
    code: 'BRD_NIKE',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Samsung',
    code: 'BRD_SAMSUNG',
    category: 'Electronics',
    logo: 'https://images.unsplash.com/photo-1610945431162-b5ef81157977?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Apple',
    code: 'BRD_APPLE',
    category: 'Electronics',
    logo: 'https://images.unsplash.com/photo-1621768216002-5ac171876625?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Sony',
    code: 'BRD_SONY',
    category: 'Electronics',
    logo: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Adidas',
    code: 'BRD_ADIDAS',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Puma',
    code: 'BRD_PUMA',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Boat',
    code: 'BRD_BOAT',
    category: 'Audio',
    logo: 'https://images.unsplash.com/photo-1572569028738-411a29630308?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Lenskart',
    code: 'BRD_LENS',
    category: 'Accessories',
    logo: 'https://images.unsplash.com/photo-1577803645773-f96470509666?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'MyProtein',
    code: 'BRD_PROT',
    category: 'Health',
    logo: 'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'H&M',
    code: 'BRD_HM',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'OnePlus',
    code: 'BRD_ONEPLUS',
    category: 'Electronics',
    logo: 'https://images.unsplash.com/photo-1628116904846-9d332d78f731?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Urbanic',
    code: 'BRD_URBAN',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Nykaa',
    code: 'BRD_NYKAA',
    category: 'Beauty',
    logo: 'https://images.unsplash.com/photo-1596462502278-27bfdd403348?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Noise',
    code: 'BRD_NOISE',
    category: 'Audio',
    logo: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?auto=format&fit=crop&w=100&q=80',
  },
  {
    name: 'Levis',
    code: 'BRD_LEVI',
    category: 'Fashion',
    logo: 'https://images.unsplash.com/photo-1542272454315-4c01d7abdf4a?auto=format&fit=crop&w=100&q=80',
  },
];

const AGENCIES_CONFIG = [
  { name: 'Alpha Growth', code: 'AGY_ALPHA', mobile: '9100000001' },
  { name: 'Beta Networks', code: 'AGY_BETA', mobile: '9100000002' },
  { name: 'Gamma Force', code: 'AGY_GAMMA', mobile: '9100000003' },
  { name: 'Delta Ops', code: 'AGY_DELTA', mobile: '9100000004' },
];

const CAMPAIGN_TEMPLATES = [
  {
    title: 'Air Jordan 1 High OG',
    brand: 'Nike India',
    price: 16995,
    original: 18995,
    payout: 800,
    img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80',
  },
  {
    title: 'Galaxy S24 Ultra 5G',
    brand: 'Samsung',
    price: 129999,
    original: 134999,
    payout: 2500,
    img: 'https://images.unsplash.com/photo-1610945431162-b5ef81157977?w=600&q=80',
  },
  {
    title: 'iPhone 15 Pro Max',
    brand: 'Apple',
    price: 159900,
    original: 169900,
    payout: 1500,
    img: 'https://images.unsplash.com/photo-1696446701796-da61225697cc?w=600&q=80',
  },
  {
    title: 'WH-1000XM5 Cancelling',
    brand: 'Sony',
    price: 26990,
    original: 34990,
    payout: 1200,
    img: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=600&q=80',
  },
  {
    title: 'Ultraboost Light Running',
    brand: 'Adidas',
    price: 11000,
    original: 19000,
    payout: 900,
    img: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600&q=80',
  },
  {
    title: 'RS-X Efekt Sneakers',
    brand: 'Puma',
    price: 6499,
    original: 12999,
    payout: 600,
    img: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600&q=80',
  },
  {
    title: 'Airdopes 141 ANC',
    brand: 'Boat',
    price: 1499,
    original: 4999,
    payout: 150,
    img: 'https://images.unsplash.com/photo-1572569028738-411a29630308?w=600&q=80',
  },
  {
    title: 'Vincent Chase Gold',
    brand: 'Lenskart',
    price: 1499,
    original: 3000,
    payout: 300,
    img: 'https://images.unsplash.com/photo-1577803645773-f96470509666?w=600&q=80',
  },
  {
    title: 'Impact Whey Protein',
    brand: 'MyProtein',
    price: 4500,
    original: 6500,
    payout: 400,
    img: 'https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=600&q=80',
  },
  {
    title: 'Oversized Cotton Tee',
    brand: 'H&M',
    price: 799,
    original: 1299,
    payout: 80,
    img: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&q=80',
  },
  {
    title: 'Nord CE 3 Lite 5G',
    brand: 'OnePlus',
    price: 19999,
    original: 21999,
    payout: 500,
    img: 'https://images.unsplash.com/photo-1628116904846-9d332d78f731?w=600&q=80',
  },
  {
    title: 'Floral Summer Dress',
    brand: 'Urbanic',
    price: 1290,
    original: 2490,
    payout: 150,
    img: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80',
  },
  {
    title: 'Matte Lipstick Set',
    brand: 'Nykaa',
    price: 899,
    original: 1500,
    payout: 100,
    img: 'https://images.unsplash.com/photo-1596462502278-27bfdd403348?w=600&q=80',
  },
  {
    title: 'ColorFit Pro 4',
    brand: 'Noise',
    price: 2499,
    original: 5999,
    payout: 250,
    img: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=600&q=80',
  },
  {
    title: '501 Original Jeans',
    brand: 'Levis',
    price: 3299,
    original: 4999,
    payout: 350,
    img: 'https://images.unsplash.com/photo-1542272454315-4c01d7abdf4a?w=600&q=80',
  },
];

const PLATFORMS = ['Amazon', 'Flipkart', 'Myntra', 'Ajio', 'Nykaa', 'TataCliq'];
const REAL_SCREENSHOTS = {
  order: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400&q=60', // Receipt-like
  rating: 'https://plus.unsplash.com/premium_photo-1683288295841-782fa47e4770?w=400&q=60', // Stars/Phone
  payment: 'https://images.unsplash.com/photo-1556742049-0cfed4f7a07d?w=400&q=60', // Payment terminal/screen
};

// --- GENERATORS ---

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
// UPDATED: Now returns a string directly
const randomDate = (start: Date, end: Date): string =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString();

const generateEcosystem = () => {
  const users: User[] = [];
  const campaigns: Campaign[] = [];
  const products: Product[] = [];
  const orders: Order[] = [];

  // 1. ADMIN
  users.push({
    id: 'u-admin',
    name: 'Super Admin',
    mobile: 'admin',
    role: 'admin',
    status: 'active',
    walletBalance: 0,
    walletPending: 0,
  });

  // 2. BRANDS
  BRANDS_CONFIG.forEach((b, i) => {
    users.push({
      id: `u-brand-${b.code}`,
      name: b.name,
      mobile: `90000000${(i + 1).toString().padStart(2, '0')}`,
      role: 'brand',
      status: 'active',
      brandCode: b.code,
      connectedAgencies: ['AGY_ALPHA', 'AGY_BETA'],
      pendingConnections: [],
      walletBalance: 10000000,
      walletPending: 0,
      avatar: b.logo,
    });
  });

  // 3. AGENCIES
  AGENCIES_CONFIG.forEach((a, i) => {
    users.push({
      id: `u-agency-${a.code}`,
      name: a.name,
      mobile: a.mobile,
      role: 'agency',
      status: 'active',
      mediatorCode: a.code,
      walletBalance: randomInt(500000, 2000000),
      walletPending: randomInt(100000, 500000),
      kycStatus: 'verified',
      upiId: `${a.name.split(' ')[0].toLowerCase()}@upi`,
      bankDetails: {
        accountNumber: `123456789${i}`,
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
        holderName: a.name,
      },
    });
  });

  // 4. CAMPAIGNS (Massive)
  // Generate 40 campaigns (Active, Completed, Paused)
  for (let i = 0; i < 40; i++) {
    const tmpl = randomItem(CAMPAIGN_TEMPLATES);
    const platform = randomItem(PLATFORMS);
    const status = Math.random() > 0.8 ? 'Completed' : Math.random() > 0.9 ? 'Paused' : 'Active';
    const dealType = Math.random() > 0.7 ? (Math.random() > 0.5 ? 'Review' : 'Rating') : 'Discount';
    const totalSlots = randomInt(500, 5000);
    const usedSlots = status === 'Completed' ? totalSlots : randomInt(50, totalSlots * 0.8);

    campaigns.push({
      id: `cmp-${i}`,
      title: `${tmpl.title} ${randomItem(['Festival Sale', 'Mega Drop', 'Flash Deal', 'Launch Offer'])}`,
      brand: tmpl.brand,
      brandId: `u-brand-${BRANDS_CONFIG.find((b) => b.name === tmpl.brand)?.code || 'BRD_NIKE'}`,
      platform: platform,
      price: tmpl.price, // Cost to Mediator
      originalPrice: tmpl.original,
      payout: tmpl.payout,
      image: tmpl.img,
      productUrl: `https://${platform.toLowerCase()}.com/dp/${randomInt(10000, 99999)}`,
      totalSlots: totalSlots,
      usedSlots: usedSlots,
      status: status as any,
      assignments: {
        AGY_ALPHA: Math.floor(totalSlots * 0.4),
        AGY_BETA: Math.floor(totalSlots * 0.3),
      },
      allowedAgencies: ['AGY_ALPHA', 'AGY_BETA', 'AGY_GAMMA'],
      createdAt: Date.now() - randomInt(0, 86400000 * 60),
      dealType: dealType as any,
      returnWindowDays: 14,
    });
  }

  // 5. MEDIATORS (30 Real Mediators)
  const mediators = [];

  // Key Mediators
  const keyMediators = [
    { name: 'Mediator Amit', mobile: '9200000001', code: 'MED_AMIT', agency: 'AGY_ALPHA' },
    { name: 'Mediator Sara', mobile: '9200000002', code: 'MED_SARA', agency: 'AGY_ALPHA' },
    { name: 'Mediator John', mobile: '9200000003', code: 'MED_JOHN', agency: 'AGY_BETA' },
  ];

  keyMediators.forEach((k) => {
    const u = {
      id: `u-${k.code}`,
      name: k.name,
      mobile: k.mobile,
      role: 'mediator' as const,
      status: 'active' as const,
      mediatorCode: k.code,
      parentCode: k.agency,
      walletBalance: randomInt(20000, 100000),
      walletPending: randomInt(5000, 20000),
      kycStatus: 'verified' as const,
      upiId: `${k.name.split(' ')[1].toLowerCase()}@okicici`,
      createdAt: new Date().toISOString(),
    };
    users.push(u);
    mediators.push(u);
  });

  // Filler Mediators
  for (let i = 0; i < 25; i++) {
    const parent = randomItem(AGENCIES_CONFIG);
    const name = `Mediator ${i + 100}`;
    const u = {
      id: `u-med-${i}`,
      name: name,
      mobile: `9200000${(i + 10).toString().padStart(3, '0')}`,
      role: 'mediator' as const,
      status: 'active' as const,
      mediatorCode: `MED_${i + 100}`,
      parentCode: parent.code,
      walletBalance: randomInt(5000, 50000),
      walletPending: randomInt(1000, 10000),
      kycStatus: (Math.random() > 0.9 ? 'pending' : 'verified') as KycStatus,
      createdAt: randomDate(new Date(2023, 0, 1), new Date()),
    };
    users.push(u);
    mediators.push(u);
  }

  // 6. PRODUCTS (Distributed Deals)
  mediators.forEach((med) => {
    // Assign 5-10 random campaigns to each mediator
    const myCampaigns = campaigns.filter(() => Math.random() > 0.7).slice(0, 10);
    myCampaigns.forEach((camp) => {
      if (camp.status === 'Active') {
        const commission = randomInt(100, 500);
        products.push({
          id: `prod-${camp.id}-${med.mediatorCode}`,
          title: camp.title,
          description: `Exclusive deal from ${med.name}`,
          price: camp.price + commission, // End User Price
          originalPrice: camp.originalPrice,
          commission: commission,
          image: camp.image,
          productUrl: camp.productUrl,
          rating: 4.8,
          category: 'General',
          platform: camp.platform,
          dealType: camp.dealType || 'Discount',
          brandName: camp.brand,
          mediatorCode: med.mediatorCode!,
          campaignId: camp.id,
          active: true,
          inventoryCount: randomInt(10, 50),
        });
      }
    });
  });

  // 7. CONSUMERS & ORDERS (Massive History)

  // Key Shopper
  const shopperRahul = {
    id: 'u-shopper-rahul',
    name: 'Shopper Rahul',
    mobile: '9300000001',
    role: 'user' as const,
    status: 'active' as const,
    mediatorCode: 'MED_AMIT',
    isVerifiedByMediator: true,
    walletBalance: 12500,
    walletPending: 3400,
    upiId: 'rahul@upi',
    createdAt: new Date().toISOString(),
  };
  users.push(shopperRahul);

  // 150 Random Shoppers
  const shoppers: User[] = [shopperRahul];
  for (let i = 0; i < 150; i++) {
    const med = randomItem(mediators);
    const name = `Shopper ${i + 200}`;
    const u = {
      id: `u-buy-${i}`,
      name: name,
      mobile: `930000${(i + 200).toString().padStart(4, '0')}`,
      role: 'user' as const,
      status: 'active' as const,
      mediatorCode: med.mediatorCode!,
      isVerifiedByMediator: Math.random() > 0.1, // 90% verified
      walletBalance: randomInt(0, 5000),
      walletPending: randomInt(0, 2000),
      createdAt: randomDate(new Date(2023, 6, 1), new Date()),
    };
    users.push(u);
    shoppers.push(u);
  }

  // Generate ~800 Orders
  for (let i = 0; i < 800; i++) {
    const shopper = randomItem(shoppers);
    // Shopper can only buy from their mediator
    const medProducts = products.filter((p) => p.mediatorCode === shopper.mediatorCode);

    if (medProducts.length > 0) {
      const prod = randomItem(medProducts);
      const statusRand = Math.random();
      let status = 'Ordered';
      let paymentStatus = 'Pending';
      let affiliateStatus = 'Unchecked';
      let screenshots = {};
      let reviewLink = undefined;

      // Random creation date in last 90 days (STRING)
      const creationDate = randomDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), new Date());
      let expectedSettlementDate: string | undefined = undefined;

      // Simulate lifecycle
      if (statusRand > 0.3) {
        status = 'Delivered';
        // Delivered orders usually have proofs
        screenshots = { order: REAL_SCREENSHOTS.order };

        // Calculate settlement logic properly
        const createdDateObj = new Date(creationDate);
        const settleDateObj = new Date(createdDateObj);
        settleDateObj.setDate(createdDateObj.getDate() + 14); // 14 days later
        expectedSettlementDate = settleDateObj.toISOString();

        if (statusRand > 0.5) {
          // Paid orders
          paymentStatus = 'Paid';
          affiliateStatus = 'Approved_Settled';
          if (prod.dealType === 'Rating')
            screenshots = { ...screenshots, rating: REAL_SCREENSHOTS.rating };
          if (prod.dealType === 'Review')
            reviewLink = `https://${prod.platform.toLowerCase()}.com/review/${randomInt(1000, 9999)}`;
        } else {
          // Pending verification
          affiliateStatus = 'Pending_Cooling';
        }
      } else if (statusRand > 0.1) {
        status = 'Shipped';
      }

      orders.push({
        id: `ORD-${randomInt(100000, 999999)}`,
        userId: shopper.id,
        items: [
          {
            productId: prod.id,
            title: prod.title,
            image: prod.image,
            priceAtPurchase: prod.price,
            commission: prod.commission,
            campaignId: prod.campaignId,
            dealType: prod.dealType,
            quantity: 1,
            platform: prod.platform,
            brandName: prod.brandName,
          },
        ],
        total: prod.price,
        status: status as any,
        paymentStatus: paymentStatus as any,
        affiliateStatus: affiliateStatus as any,
        externalOrderId:
          status === 'Delivered'
            ? `404-${randomInt(1000000, 9999999)}-${randomInt(1000000, 9999999)}`
            : undefined,
        screenshots: screenshots as any,
        reviewLink: reviewLink,
        managerName: prod.mediatorCode,
        agencyName:
          users.find((u) => u.mediatorCode === prod.mediatorCode)?.parentCode === 'AGY_ALPHA'
            ? 'Alpha Growth'
            : 'Beta Networks', // Simple mapping
        buyerName: shopper.name,
        buyerMobile: shopper.mobile,
        brandName: prod.brandName,
        createdAt: creationDate, // Use the string directly
        expectedSettlementDate: expectedSettlementDate,
      });
    }
  }

  return { users, campaigns, products, orders };
};

const {
  users: SEED_USERS,
  campaigns: SEED_CAMPAIGNS,
  products: SEED_PRODUCTS,
  orders: SEED_ORDERS,
} = generateEcosystem();
export const SEED_WITHDRAWALS: WithdrawalRequest[] = [];

export { SEED_USERS, SEED_CAMPAIGNS, SEED_PRODUCTS, SEED_ORDERS };
