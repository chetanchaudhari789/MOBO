import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { makeInviteController } from '../controllers/inviteController.js';
import { makeOpsController } from '../controllers/opsController.js';

export function opsRoutes(env: Env): Router {
  const router = Router();
  const invites = makeInviteController();
  const ops = makeOpsController();

  router.use(requireAuth(env));
  router.use(requireRoles('agency', 'mediator', 'ops', 'admin'));

  router.post('/invites/generate', invites.opsGenerateMediatorInvite);
  router.post('/invites/generate-buyer', invites.opsGenerateBuyerInvite);

  router.post('/brands/connect', ops.requestBrandConnection);

  router.get('/mediators', ops.getMediators);
  router.get('/campaigns', ops.getCampaigns);
  router.get('/deals', ops.getDeals);
  router.get('/orders', ops.getOrders);
  router.get('/users/pending', ops.getPendingUsers);
  router.get('/users/verified', ops.getVerifiedUsers);
  router.get('/ledger', ops.getLedger);

  router.post('/mediators/approve', ops.approveMediator);
  router.post('/users/approve', ops.approveUser);
  router.post('/users/reject', ops.rejectUser);
  router.post('/orders/settle', ops.settleOrderPayment);
  router.post('/orders/unsettle', ops.unsettleOrderPayment);
  router.post('/verify', ops.verifyOrderClaim);
  router.post('/orders/verify-requirement', ops.verifyOrderRequirement);
  router.post('/campaigns', ops.createCampaign);
  router.post('/campaigns/assign', ops.assignSlots);
  router.post('/deals/publish', ops.publishDeal);
  router.post('/payouts', ops.payoutMediator);

  return router;
}
