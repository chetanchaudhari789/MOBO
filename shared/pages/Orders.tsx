import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { subscribeRealtime } from '../services/realtime';
import { Order, Product } from '../types';
import { Button, EmptyState, Spinner } from '../components/ui';
import {
  Clock,
  CheckCircle2,
  X,
  Plus,
  Search,
  ScanLine,
  Check,
  Loader2,
  CalendarClock,
  HelpCircle,
  AlertTriangle,
  ShieldCheck,
  Package,
  Zap,
  Star,
} from 'lucide-react';

const getPrimaryOrderId = (order: Order) =>
  String(order.externalOrderId || order.id || '').trim();

const getSecondaryOrderId = (order: Order) => {
  const primary = getPrimaryOrderId(order);
  const internal = String(order.id || '').trim();
  if (!primary || primary === internal) return '';
  return internal;
};

const MAX_PROOF_SIZE_BYTES = 5 * 1024 * 1024;

const isValidImageFile = (file: File) => {
  if (!file.type.startsWith('image/')) return false;
  if (file.size > MAX_PROOF_SIZE_BYTES) return false;
  return true;
};

const isValidReviewLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const Orders: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [uploadType, setUploadType] = useState<'order' | 'payment' | 'rating' | 'review'>('order');
  const [proofToView, setProofToView] = useState<Order | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [dealTypeFilter, setDealTypeFilter] = useState<'Discount' | 'Rating' | 'Review'>(
    'Discount'
  );
  const [formSearch, setFormSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [formScreenshot, setFormScreenshot] = useState<string | null>(null);
  const [ratingScreenshot, setRatingScreenshot] = useState<string | null>(null);
  const [reviewLinkInput, setReviewLinkInput] = useState('');

  const [extractedDetails, setExtractedDetails] = useState({ orderId: '', amount: '' });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // [AI] Smart Extraction UI State
  const [matchStatus, setMatchStatus] = useState<{
    id: 'match' | 'mismatch' | 'none';
    amount: 'match' | 'mismatch' | 'none';
  }>({ id: 'none', amount: 'none' });

  const [ticketModal, setTicketModal] = useState<Order | null>(null);
  const [ticketIssue, setTicketIssue] = useState('Cashback not received');
  const [ticketDesc, setTicketDesc] = useState('');

  // Fixed: Defined filteredProducts logic for the New Order Modal
  const filteredProducts = useMemo(() => {
    return availableProducts.filter((p) => {
      const matchesType = p.dealType === dealTypeFilter;
      const matchesSearch =
        p.title.toLowerCase().includes(formSearch.toLowerCase()) ||
        p.brandName.toLowerCase().includes(formSearch.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [availableProducts, dealTypeFilter, formSearch]);

  useEffect(() => {
    if (user) {
      loadOrders();
      api.products.getAll().then((data) => {
        setAvailableProducts(Array.isArray(data) ? data : []);
      }).catch((err) => {
        console.error('Failed to load products:', err);
        setAvailableProducts([]);
      });
    }
  }, [user]);
  const loadOrders = async () => {
    try {
      const data = await api.orders.getUserOrders(user!.id);
      setOrders(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  // Realtime: refresh order list when any order changes.
  useEffect(() => {
    if (!user) return;
    let timer: any = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        loadOrders();
      }, 500);
    };
    const unsub = subscribeRealtime((msg) => {
      if (msg.type === 'orders.changed') schedule();
      if (msg.type === 'deals.changed') {
        // Keep filters/product titles in sync (non-critical, but avoids stale UI).
        api.products
          .getAll()
          .then((data) => setAvailableProducts(Array.isArray(data) ? data : []))
          .catch((err) => {
            console.error('Failed to load products:', err);
            setAvailableProducts([]);
          });
      }
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !selectedOrder) return;
    setIsUploading(true);
    try {
      const file = e.target.files[0];
      if (!isValidImageFile(file)) {
        throw new Error('Please upload a valid image (PNG/JPG, max 5MB).');
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const apiType = uploadType === 'rating' || uploadType === 'order' ? uploadType : null;
      if (!apiType) throw new Error('Unsupported proof type');

      await api.orders.submitClaim(selectedOrder.id, { type: apiType, data: base64 });
      toast.success('Proof uploaded successfully!');
      setSelectedOrder(null);
      loadOrders();
    } catch (err: any) {
      toast.error(String(err?.message || 'Failed to upload proof'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmitLink = async () => {
    if (!inputValue || !selectedOrder) return;
    setIsUploading(true);
    try {
      if (!isValidReviewLink(inputValue)) {
        throw new Error('Please enter a valid https review link.');
      }
      await api.orders.submitClaim(selectedOrder.id, { type: 'review', data: inputValue });
      toast.success('Link submitted!');
      setSelectedOrder(null);
      setInputValue('');
      loadOrders();
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to submit link'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewOrderScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isValidImageFile(file)) {
      toast.error('Please upload a valid order image (PNG/JPG, max 5MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setFormScreenshot(reader.result as string);
    reader.readAsDataURL(file);

    setIsAnalyzing(true);
    setMatchStatus({ id: 'none', amount: 'none' });
    try {
      const details = await api.orders.extractDetails(file);
      setExtractedDetails({
        orderId: details.orderId || '',
        amount: details.amount?.toString() || '',
      });

      // [AI] Smart Extraction Verification Logic
      if (selectedProduct) {
        const amountMatch = details.amount && Math.abs(details.amount - selectedProduct.price) < 10;
        const idValid = details.orderId && details.orderId.length > 5;
        setMatchStatus({
          id: idValid ? 'match' : 'mismatch',
          amount: amountMatch ? 'match' : 'mismatch',
        });
      }
    } catch (e) {
      console.error(e);
      const msg = String((e as any)?.message || 'Failed to extract details from screenshot');
      toast.error(msg, { title: 'Extraction' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNewRatingScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isValidImageFile(file)) {
      toast.error('Please upload a valid rating image (PNG/JPG, max 5MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setRatingScreenshot(reader.result as string);
    reader.readAsDataURL(file);
  };

  const submitNewOrder = async () => {
    if (!selectedProduct || !user) return;
    if (!formScreenshot) {
      toast.error('Please upload a valid order image before submitting.');
      return;
    }
    const hasExtraction = Boolean(extractedDetails.orderId || extractedDetails.amount);
    if (hasExtraction && (matchStatus.id === 'mismatch' || matchStatus.amount === 'mismatch')) {
      toast.error('Order proof does not look valid. Please upload a clearer proof.');
      return;
    }
    if (selectedProduct.dealType === 'Rating' && !ratingScreenshot) {
      toast.error('Please upload a valid rating image to continue.');
      return;
    }
    if (selectedProduct.dealType === 'Review' && !isValidReviewLink(reviewLinkInput)) {
      toast.error('Please add a valid https review link to continue.');
      return;
    }
    setIsUploading(true);
    try {
      const screenshots: any = { order: formScreenshot };
      if (ratingScreenshot && selectedProduct.dealType === 'Rating')
        screenshots.rating = ratingScreenshot;

      await api.orders.create(
        user.id,
        [
          {
            productId: selectedProduct.id,
            title: selectedProduct.title,
            image: selectedProduct.image,
            priceAtPurchase: parseFloat(extractedDetails.amount) || selectedProduct.price,
            commission: selectedProduct.commission,
            campaignId: selectedProduct.campaignId,
            dealType: selectedProduct.dealType,
            quantity: 1,
            platform: selectedProduct.platform,
            brandName: selectedProduct.brandName,
          },
        ],
        {
          screenshots: screenshots,
          externalOrderId: extractedDetails.orderId ? extractedDetails.orderId : undefined,
          reviewLink: selectedProduct.dealType === 'Review' ? reviewLinkInput : undefined,
        }
      );

      setIsNewOrderModalOpen(false);
      setSelectedProduct(null);
      setFormScreenshot(null);
      setRatingScreenshot(null);
      setReviewLinkInput('');
      setExtractedDetails({ orderId: '', amount: '' });
      setMatchStatus({ id: 'none', amount: 'none' });
      loadOrders();
      toast.success('Order submitted successfully!');
    } catch (e: any) {
      toast.error(String(e.message || 'Failed to submit order.'));
    } finally {
      setIsUploading(false);
    }
  };

  const submitTicket = async () => {
    if (!ticketModal || !ticketDesc || !user) return;
    setIsUploading(true);
    try {
      await api.tickets.create({
        userId: user.id,
        userName: user.name,
        role: 'user',
        orderId: ticketModal.id,
        issueType: ticketIssue,
        description: ticketDesc,
      });
      toast.success('Ticket raised! Support will contact you shortly.');
      setTicketModal(null);
      setTicketDesc('');
    } catch {
      toast.error('Failed to raise ticket.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#f8f9fa]">
      <div className="p-6 pb-4 bg-white shadow-sm z-10 sticky top-0 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">My Orders</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-500 font-medium">Track purchases & cashback.</p>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          onClick={() => setIsNewOrderModalOpen(true)}
          aria-label="New order"
          className="bg-black text-lime-400 hover:bg-zinc-800 focus-visible:ring-lime-400"
        >
          <Plus size={20} strokeWidth={3} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24 scrollbar-hide">
        {isLoading ? (
          <div className="flex justify-center py-10 text-lime-500">
            <Spinner className="w-6 h-6" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Create your first order from Explore."
            icon={<Package size={40} className="text-zinc-300" />}
            action={
              <Button type="button" variant="secondary" onClick={() => setIsNewOrderModalOpen(true)}>
                Create Order
              </Button>
            }
          />
        ) : (
          orders.map((order) => {
            const dealType = order.items[0].dealType || 'Discount';
            const isDiscount = dealType === 'Discount';
            const isReview = dealType === 'Review';
            const isRating = dealType === 'Rating';
            const rejectionType = order.rejection?.type;
            const rejectionReason = order.rejection?.reason;

            const purchaseVerified = !!order.verification?.orderVerified;
            const missingProofs = order.requirements?.missingProofs ?? [];
            const missingVerifications = order.requirements?.missingVerifications ?? [];
            let displayStatus = 'PENDING';
            let statusClass = 'bg-orange-50 text-orange-700 border-orange-100';

            if (order.paymentStatus === 'Paid' && order.affiliateStatus === 'Approved_Settled') {
              displayStatus = 'SETTLED';
              statusClass = 'bg-green-100 text-green-700 border-green-200';
            } else if (order.affiliateStatus === 'Frozen_Disputed') {
              displayStatus = 'FROZEN';
              statusClass = 'bg-red-50 text-red-700 border-red-200';
            } else if (rejectionReason) {
              displayStatus = 'ACTION REQUIRED';
              statusClass = 'bg-red-50 text-red-700 border-red-200';
            } else if (String((order as any).workflowStatus || '') === 'UNDER_REVIEW' && !purchaseVerified) {
              displayStatus = 'UNDER REVIEW';
              statusClass = 'bg-slate-50 text-slate-700 border-slate-200';
            } else if (purchaseVerified && missingProofs.length > 0) {
              displayStatus = 'ACTION REQUIRED';
              statusClass = 'bg-yellow-50 text-yellow-800 border-yellow-200';
            } else if (purchaseVerified && missingVerifications.length > 0) {
              displayStatus = 'AWAITING APPROVAL';
              statusClass = 'bg-purple-50 text-purple-700 border-purple-200';
            } else if (order.affiliateStatus === 'Pending_Cooling') {
              displayStatus = 'VERIFIED';
              statusClass = 'bg-blue-50 text-blue-700 border-blue-100';
            }

            const settlementDate = order.expectedSettlementDate
              ? new Date(order.expectedSettlementDate)
              : null;
            const isPastSettlement = settlementDate && settlementDate < new Date();

            return (
              <div
                key={order.id}
                className={`bg-white rounded-[1.5rem] p-5 shadow-sm border relative overflow-hidden group ${order.affiliateStatus === 'Frozen_Disputed' ? 'border-red-200' : 'border-slate-100'}`}
              >
                {order.affiliateStatus === 'Frozen_Disputed' && (
                  <div className="absolute top-0 left-0 w-full bg-red-500 text-white text-[9px] font-black py-1 text-center uppercase tracking-widest z-20">
                    Support Hold Active
                  </div>
                )}
                <div className="flex justify-between items-start mb-4 pl-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                        {getPrimaryOrderId(order)}
                      </span>
                      {getSecondaryOrderId(order) && (
                        <span className="text-[9px] text-slate-400 font-mono">
                          SYS {getSecondaryOrderId(order)}
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${isReview ? 'bg-purple-50 text-purple-600' : isRating ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}
                      >
                        {isDiscount ? 'PURCHASE' : dealType}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-gray-400 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 max-w-[40%]">
                    <span
                      className={`px-3 py-1 text-[10px] font-bold rounded-full border shadow-sm truncate max-w-full ${statusClass}`}
                    >
                      {displayStatus}
                    </span>
                  </div>
                </div>

                <div className="flex gap-4 mb-4">
                  <div className="w-20 h-20 bg-gray-50 rounded-2xl p-2 border border-gray-100 flex-shrink-0">
                    <img
                      src={order.items[0].image}
                      className="w-full h-full object-contain mix-blend-multiply"
                      alt="prod"
                    />
                  </div>
                  <div className="flex-1 min-w-0 py-1">
                    <h3 className="font-bold text-slate-900 text-base line-clamp-2 leading-tight mb-2">
                      {order.items[0].title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
                      <span>₹{order.total}</span>
                      <span>•</span>
                      <span className="text-lime-600">+₹{order.items[0].commission} Reward</span>
                    </div>
                  </div>
                </div>

                {(order.affiliateStatus === 'Pending_Cooling' || order.paymentStatus === 'Paid') &&
                  settlementDate &&
                  order.affiliateStatus !== 'Frozen_Disputed' && (
                    <div className="mb-4 bg-slate-50 rounded-xl p-3 border border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`p-1.5 rounded-lg ${isPastSettlement ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}
                        >
                          <CalendarClock size={16} />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                            Unlock Date
                          </p>
                          <p className="text-xs font-bold text-slate-900">
                            {settlementDate.toDateString()}
                          </p>
                        </div>
                      </div>
                      {isPastSettlement && order.paymentStatus !== 'Paid' && (
                        <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">
                          Settling...
                        </span>
                      )}
                    </div>
                  )}

                {rejectionReason && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
                    {rejectionReason}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-green-100 text-green-600">
                      <CheckCircle2 size={14} />
                    </div>
                    <button
                      onClick={() => {
                        setProofToView(order);
                      }}
                      className="text-[10px] font-bold uppercase hover:underline text-slate-500"
                    >
                      VIEW PROOFS
                    </button>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {(rejectionType === 'order' || !order.screenshots?.order) && (
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setUploadType('order');
                        }}
                        className="text-[10px] font-bold uppercase text-blue-600"
                      >
                        Upload Order Proof
                      </button>
                    )}
                    {isReview && (!order.reviewLink || rejectionType === 'review') && (
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setUploadType('review');
                        }}
                        className="text-[10px] font-bold uppercase text-blue-600"
                      >
                        {rejectionType === 'review' ? 'Reupload Review' : 'Add Review'}
                      </button>
                    )}
                    {isRating && (!order.screenshots?.rating || rejectionType === 'rating') && (
                      <button
                        onClick={() => {
                          setSelectedOrder(order);
                          setUploadType('rating');
                        }}
                        className="text-[10px] font-bold uppercase text-blue-600"
                      >
                        {rejectionType === 'rating' ? 'Reupload Rating' : 'Add Rating'}
                      </button>
                    )}
                    <button
                      onClick={() => setTicketModal(order)}
                      className="w-7 h-7 bg-red-50 text-red-500 rounded-full flex items-center justify-center hover:bg-red-100 ml-2"
                      title="Report Issue"
                    >
                      <HelpCircle size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* SUBMIT PURCHASE MODAL (SMART UI) */}
      {isNewOrderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setIsNewOrderModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-[2.5rem] p-6 shadow-2xl animate-slide-up flex flex-col max-h-[85vh] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsNewOrderModalOpen(false)}
              aria-label="Close"
              className="absolute top-6 right-6 p-2 bg-gray-50 rounded-full hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-extrabold text-slate-900 mb-6">Claim Cashback</h3>

            <div className="flex gap-2 p-1 bg-gray-50 rounded-2xl mb-4">
              {['Discount', 'Rating', 'Review'].map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setDealTypeFilter(type as any);
                    setSelectedProduct(null);
                  }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all ${dealTypeFilter === type ? 'bg-black text-white shadow-md' : 'text-slate-500'}`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-4">
              {!selectedProduct ? (
                <>
                  <div className="relative">
                    <Search
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                      size={18}
                    />
                    <input
                      type="text"
                      placeholder="Search product..."
                      value={formSearch}
                      onChange={(e) => setFormSearch(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-lime-400"
                    />
                  </div>
                  <div className="space-y-2">
                    {filteredProducts.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-2xl hover:bg-gray-50 cursor-pointer active:scale-95 transition-transform"
                      >
                        <img
                          src={p.image}
                          className="w-12 h-12 object-contain mix-blend-multiply"
                          alt=""
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{p.title}</p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">
                              {p.platform}
                            </span>
                            <span className="text-xs font-bold text-lime-600">₹{p.price}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-5">
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex items-center gap-4 relative">
                    <img
                      src={selectedProduct.image}
                      className="w-16 h-16 object-contain mix-blend-multiply"
                      alt=""
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 line-clamp-2">
                        {selectedProduct.title}
                      </p>
                      <p className="text-xs font-bold text-lime-600 mt-1">
                        Target Price: ₹{selectedProduct.price}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedProduct(null)}
                      aria-label="Clear selected product"
                      className="absolute -top-2 -right-2 bg-white border border-gray-200 p-1.5 rounded-full shadow-sm text-slate-400 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div>
                    <label
                      className={`w-full aspect-[2/1] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all group overflow-hidden relative ${formScreenshot ? 'border-lime-200' : 'border-gray-200'}`}
                    >
                      {formScreenshot ? (
                        <img
                          src={formScreenshot}
                          className="w-full h-full object-cover opacity-80"
                          alt="preview"
                        />
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                            <ScanLine size={20} className="text-slate-400" />
                          </div>
                          <span className="text-xs font-bold text-slate-400">
                            Upload Order Screenshot
                          </span>
                        </>
                      )}
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleNewOrderScreenshot}
                      />
                      {isAnalyzing && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                          <Loader2
                            size={24}
                            className="animate-spin motion-reduce:animate-none text-lime-600 mb-2"
                          />
                          <span className="text-xs font-bold text-lime-600 animate-pulse motion-reduce:animate-none">
                            AI Checking Proof...
                          </span>
                        </div>
                      )}
                    </label>
                  </div>

                  {/* [AI] Smart Extraction UI: Field Highlighting */}
                  {formScreenshot && (
                    <div className="space-y-3 animate-enter">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Order ID
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={extractedDetails.orderId}
                              onChange={(e) =>
                                setExtractedDetails({
                                  ...extractedDetails,
                                  orderId: e.target.value,
                                })
                              }
                              className={`w-full p-3 rounded-xl font-bold text-sm outline-none transition-all ${matchStatus.id === 'match' ? 'bg-green-50 border-green-200 focus:ring-green-100' : matchStatus.id === 'mismatch' ? 'bg-red-50 border-red-200 focus:ring-red-100' : 'bg-gray-50 border-gray-100 focus:ring-lime-100'}`}
                              placeholder="e.g. 404-..."
                            />
                            {matchStatus.id === 'match' && (
                              <ShieldCheck
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500"
                                size={16}
                              />
                            )}
                            {matchStatus.id === 'mismatch' && (
                              <AlertTriangle
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500"
                                size={16}
                              />
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Paid Amount
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              value={extractedDetails.amount}
                              onChange={(e) =>
                                setExtractedDetails({ ...extractedDetails, amount: e.target.value })
                              }
                              className={`w-full p-3 rounded-xl font-bold text-sm outline-none transition-all ${matchStatus.amount === 'match' ? 'bg-green-50 border-green-200 focus:ring-green-100' : matchStatus.amount === 'mismatch' ? 'bg-red-50 border-red-200 focus:ring-red-100' : 'bg-gray-50 border-gray-100 focus:ring-lime-100'}`}
                              placeholder="e.g. 1299"
                            />
                            {matchStatus.amount === 'match' && (
                              <Zap
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 fill-current"
                                size={16}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                      {matchStatus.id === 'match' && matchStatus.amount === 'match' && (
                        <p className="text-[10px] text-green-600 font-bold bg-green-50 p-2 rounded-lg flex items-center gap-1.5">
                          <ShieldCheck size={12} /> AI suggests this is a valid proof.
                        </p>
                      )}
                    </div>
                  )}

                  {selectedProduct?.dealType === 'Rating' && (
                    <div className="space-y-2 animate-enter">
                      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                        Rating Screenshot
                      </label>
                      <label
                        className={`w-full aspect-[2/1] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all group overflow-hidden relative ${ratingScreenshot ? 'border-orange-200' : 'border-gray-200'}`}
                      >
                        {ratingScreenshot ? (
                          <img
                            src={ratingScreenshot}
                            className="w-full h-full object-cover opacity-80"
                            alt="rating preview"
                          />
                        ) : (
                          <>
                            <div className="w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                              <Star size={20} className="text-orange-400" />
                            </div>
                            <span className="text-xs font-bold text-slate-400">
                              Upload Rating Screenshot
                            </span>
                          </>
                        )}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleNewRatingScreenshot}
                        />
                      </label>
                    </div>
                  )}

                  {selectedProduct?.dealType === 'Review' && (
                    <div className="space-y-2 animate-enter">
                      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                        Review Link
                      </label>
                      <input
                        value={reviewLinkInput}
                        onChange={(e) => setReviewLinkInput(e.target.value)}
                        placeholder="https://..."
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      {reviewLinkInput && !isValidReviewLink(reviewLinkInput) && (
                        <p className="text-[10px] font-bold text-red-500">
                          Enter a valid https link.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={submitNewOrder}
                disabled={
                  !selectedProduct ||
                  !formScreenshot ||
                  isUploading ||
                  (selectedProduct?.dealType === 'Rating' && !ratingScreenshot) ||
                  (selectedProduct?.dealType === 'Review' && !isValidReviewLink(reviewLinkInput))
                }
                className="w-full py-4 bg-black text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-lime-400 hover:text-black transition-all disabled:opacity-50 active:scale-95 shadow-lg"
              >
                {isUploading ? (
                  <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Check size={18} />
                )}
                {isUploading ? 'Submitting...' : 'Submit Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TICKET MODAL */}
      {ticketModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setTicketModal(null)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-slide-up relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setTicketModal(null)}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <X size={16} />
            </button>
            <h3 className="text-xl font-extrabold text-slate-900 mb-1 flex items-center gap-2">
              <AlertTriangle className="text-red-500" /> Dispute Order
            </h3>
            <p className="text-xs text-slate-500 font-bold uppercase mb-6">
              Order {getPrimaryOrderId(ticketModal)}
              {getSecondaryOrderId(ticketModal) && (
                <span className="text-[10px] text-slate-400 font-mono ml-2">
                  SYS {getSecondaryOrderId(ticketModal)}
                </span>
              )}
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">
                  Issue Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {['Cashback Delay', 'Wrong Amount', 'Fake Deal', 'Other'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setTicketIssue(type)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${ticketIssue === type ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">
                  Details
                </label>
                <textarea
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-red-400 h-24 resize-none"
                  placeholder="Describe the issue..."
                />
              </div>
              <button
                onClick={submitTicket}
                disabled={isUploading || !ticketDesc}
                className="w-full py-4 bg-black text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-red-600 transition-all disabled:opacity-50 active:scale-95"
              >
                {isUploading ? (
                  <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  'Open Dispute'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {proofToView && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in"
          onClick={() => setProofToView(null)}
        >
          <div
            className="max-w-lg w-full bg-white p-4 rounded-2xl relative shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setProofToView(null)}
              aria-label="Close"
              className="absolute -top-4 -right-4 bg-white text-black p-2 rounded-full shadow-lg hover:bg-red-500 hover:text-white transition-colors z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <X size={20} />
            </button>
            <div className="mb-3">
              <h3 className="text-lg font-extrabold text-slate-900">Proofs</h3>
              <p className="text-xs text-slate-500 font-bold uppercase">
                Order {getPrimaryOrderId(proofToView)}
              </p>
            </div>
            <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase text-slate-400">Order Proof</div>
                {proofToView.screenshots?.order ? (
                  <img
                    src={proofToView.screenshots.order}
                    className="w-full h-auto rounded-xl max-h-[60vh] object-contain border border-slate-100"
                    alt="Order proof"
                  />
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 font-bold">
                    Order proof not submitted.
                  </div>
                )}
              </div>

              {proofToView.items?.[0]?.dealType === 'Rating' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Rating Proof</div>
                  {proofToView.screenshots?.rating ? (
                    <img
                      src={proofToView.screenshots.rating}
                      className="w-full h-auto rounded-xl max-h-[60vh] object-contain border border-slate-100"
                      alt="Rating proof"
                    />
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 font-bold">
                      Rating proof not submitted.
                    </div>
                  )}
                </div>
              )}

              {proofToView.items?.[0]?.dealType === 'Review' && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Review Link</div>
                  {proofToView.reviewLink ? (
                    <a
                      href={proofToView.reviewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block p-3 rounded-xl border border-slate-200 text-xs font-bold text-blue-600 bg-blue-50 break-all"
                    >
                      {proofToView.reviewLink}
                    </a>
                  ) : (
                    <div className="p-4 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 font-bold">
                      Review link not submitted.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD REVIEW / RATING MODAL */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => {
            setSelectedOrder(null);
            setInputValue('');
          }}
        >
          <div
            className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-slide-up relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setSelectedOrder(null);
                setInputValue('');
              }}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              <X size={16} />
            </button>

            <h3 className="text-lg font-extrabold text-slate-900 mb-1">
              {uploadType === 'review' ? 'Submit Review Link' : 'Upload Proof'}
            </h3>
            <p className="text-xs text-slate-500 font-bold uppercase mb-5">
              Order {getPrimaryOrderId(selectedOrder)}
              {getSecondaryOrderId(selectedOrder) && (
                <span className="text-[10px] text-slate-400 font-mono ml-2">
                  SYS {getSecondaryOrderId(selectedOrder)}
                </span>
              )}
            </p>

            {uploadType === 'review' ? (
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block">
                  Review Link
                </label>
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="https://..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={handleSubmitLink}
                  disabled={isUploading || !inputValue}
                  className="w-full py-3.5 bg-black text-white font-bold rounded-2xl hover:bg-blue-600 transition-all disabled:opacity-50"
                >
                  {isUploading ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block">
                  {uploadType === 'rating' ? 'Rating Screenshot' : 'Proof'}
                </label>
                <label className="block w-full rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center cursor-pointer hover:border-slate-300">
                  <div className="text-sm font-bold text-slate-700">Choose an image</div>
                  <div className="text-[11px] text-slate-400 font-bold mt-1">PNG/JPG</div>
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                </label>
                {isUploading && (
                  <div className="text-xs font-bold text-slate-500 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> Uploading...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
