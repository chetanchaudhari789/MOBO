import type { ReactNode } from 'react';

export type Role = 'user' | 'agency' | 'mediator' | 'brand' | 'admin';
export type KycStatus = 'pending' | 'verified' | 'rejected' | 'none';
export type OrderStatus = 'Ordered' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Returned';
export type PaymentStatus = 'Pending' | 'Paid' | 'Refunded' | 'Failed';
export type AffiliateStatus =
  | 'Unchecked'
  | 'Pending_Cooling'
  | 'Approved_Settled'
  | 'Rejected'
  | 'Fraud_Alert'
  | 'Cap_Exceeded'
  | 'Frozen_Disputed';
export type WithdrawalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Processed';
export type TicketStatus = 'Open' | 'Resolved' | 'Rejected';

export interface User {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  token?: string;
  role: Role;
  status: 'active' | 'suspended' | 'pending';

  // Ops & Hierarchy
  mediatorCode?: string;
  parentCode?: string;
  generatedCodes?: string[];

  // Brand Specific
  brandCode?: string;
  connectedAgencies?: string[];
  pendingConnections?: Array<{
    agencyId: string;
    agencyName: string;
    agencyCode: string;
    timestamp: string;
  }>;

  // KYC & Verification
  kycStatus?: KycStatus;
  kycDocuments?: any;

  // Consumer
  isVerifiedByMediator?: boolean;

  // Financials
  upiId?: string;
  qrCode?: string;
  bankDetails?: {
    accountNumber: string;
    ifsc: string;
    bankName: string;
    holderName: string;
  };
  walletBalance: number;
  walletPending: number;

  avatar?: string;
  createdAt?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: ReactNode;
  type: 'success' | 'info' | 'alert';
  duration?: number;
  action?: { label: string; onClick: () => void };
  createdAt?: string;
  read?: boolean;
  source?: 'inbox' | 'local';
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  originalPrice: number;
  commission: number;
  image: string;
  productUrl: string;
  rating: number;
  category: string;
  platform: string;
  dealType: 'Discount' | 'Review' | 'Rating';
  brandName: string;
  mediatorCode: string;
  campaignId: string;
  active: boolean;
  inventoryCount?: number;
}

export interface Order {
  id: string;
  userId: string;
  items: Array<{
    productId: string;
    title: string;
    image: string;
    priceAtPurchase: number;
    commission: number;
    campaignId: string;
    dealType: string;
    quantity: number;
    platform?: string;
    brandName?: string;
  }>;
  total: number;
  status: OrderStatus;
  workflowStatus?: string;
  paymentStatus: PaymentStatus;
  affiliateStatus: AffiliateStatus;
  externalOrderId?: string;
  frozen?: boolean;
  frozenAt?: string;
  frozenReason?: string;
  settlementRef?: string;
  screenshots: { order?: string; payment?: string; review?: string; rating?: string };
  reviewLink?: string;
  managerName: string;
  agencyName?: string;
  buyerName: string;
  buyerMobile: string;
  brandName?: string;
  createdAt: string;
  expectedSettlementDate?: string;

  // Step-level verification / requirements (optional for backward compatibility)
  verification?: {
    orderVerified?: boolean;
    orderVerifiedAt?: string;
    reviewVerified?: boolean;
    reviewVerifiedAt?: string;
    ratingVerified?: boolean;
    ratingVerifiedAt?: string;
  };
  requirements?: {
    required?: Array<'review' | 'rating'>;
    missingProofs?: Array<'review' | 'rating'>;
    missingVerifications?: Array<'review' | 'rating'>;
  };
  rejection?: {
    type?: 'order' | 'review' | 'rating';
    reason?: string;
    rejectedAt?: string;
    rejectedBy?: string;
  };
  missingProofRequests?: Array<{
    type?: 'review' | 'rating';
    note?: string;
    requestedAt?: string;
    requestedBy?: string;
  }>;
}

export interface Campaign {
  id: string;
  title: string;
  brand: string;
  brandId: string;
  platform: string;
  price: number;
  originalPrice: number;
  payout: number;
  assignmentCommission?: number;
  assignmentPayout?: number;
  assignmentDetails?: Record<string, { limit: number; payout: number; commission: number }>;
  image: string;
  productUrl: string;
  totalSlots: number;
  usedSlots: number;
  status: 'Active' | 'Paused' | 'Completed' | 'Draft';
  assignments: Record<string, number>;
  allowedAgencies: string[];
  createdAt: number;
  returnWindowDays?: number;
  dealType?: 'Discount' | 'Review' | 'Rating';
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  amount: number;
  upiId: string;
  status: WithdrawalStatus;
  requestedAt: string;
}

export interface Invite {
  code: string;
  role: 'agency' | 'brand' | 'mediator' | 'shopper';
  label: string;
  status: 'active' | 'used' | 'revoked' | 'expired';
  createdAt: string;
  parentCode?: string;

  maxUses?: number;
  useCount?: number;
  expiresAt?: string;
}

export interface Ticket {
  id: string;
  userId: string;
  userName: string;
  role: Role;
  orderId?: string;
  issueType: string;
  description: string;
  status: TicketStatus;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  image?: string;
  timestamp: number;
  isError?: boolean;
  relatedProducts?: Product[];
  relatedOrders?: Order[];
}
