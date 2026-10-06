import Razorpay from 'razorpay';
import prisma from './db';
import { logAuditEvent } from '../core/auditLogger';
import crypto from 'crypto';

// ==============================================================================
// Revenue Lift — Payment Provider Interfaces & Abstraction
// ==============================================================================

export interface ExecuteCampaignActionParams {
  actionId: string;
  opportunityId: string;
  opportunityType: string;
  title: string;
  targetSegment: string;
  eligibleCustomers: number;
  incrementalRevenuePerCustomer?: number;
  incentiveCostPerCustomer?: number;
  forceFailure?: boolean;
}

export interface RazorpayExecutionResult {
  success: boolean;
  status: string;
  provider: string;
  providerReferenceId?: string;
  paymentLinksCreated: number;
  payloadSent?: any;
  responseReceived?: any;
  errorMessage?: string;
  errorCode?: string;
  isSimulated: boolean;
  createdAt: Date;
}

export interface PaymentProvider {
  name: string;
  isSimulated: boolean;
  execute(params: ExecuteCampaignActionParams): Promise<RazorpayExecutionResult>;
}

/**
 * Deterministic Synthetic / Demo Payment Provider
 * Safely simulates Razorpay payment link batch generation without touching live customer rails.
 */
export class DemoPaymentProvider implements PaymentProvider {
  name = 'RAZORPAY_SIMULATED';
  isSimulated = true;

  async execute(params: ExecuteCampaignActionParams): Promise<RazorpayExecutionResult> {
    const {
      actionId,
      title,
      targetSegment,
      eligibleCustomers,
      forceFailure = false,
    } = params;

    const batchId = `plink_test_batch_${Date.now()}`;
    const paymentLinksCreated = forceFailure ? 0 : eligibleCustomers;
    const success = !forceFailure;
    const status = success ? 'SUCCESS' : 'FAILED';
    const errorMessage = forceFailure
      ? 'DEMO FAILURE SIMULATION: Execution failed. No customer was notified or charged.'
      : undefined;
    const errorCode = forceFailure ? 'DEMO_GATEWAY_TIMEOUT' : undefined;

    // Audit the simulated execution
    await logAuditEvent({
      merchantId: undefined,
      actor: 'SYSTEM',
      eventType: success ? 'EXECUTION_SUCCESS' : 'EXECUTION_FAILED',
      entityType: 'Execution',
      entityId: actionId,
      previousState: 'INITIATED',
      newState: success ? 'COMPLETED' : 'FAILED',
      summary: success
        ? `Simulated Razorpay execution succeeded for action ${actionId}`
        : `Simulated Razorpay execution failed for action ${actionId}`,
      metadata: {
        batchId,
        provider: 'RAZORPAY_SIMULATED',
        linksCreated: paymentLinksCreated,
        isSimulated: true,
        errorMessage,
        errorCode,
      },
    });

    return {
      success,
      status,
      provider: 'RAZORPAY_SIMULATED',
      providerReferenceId: batchId,
      paymentLinksCreated,
      isSimulated: true,
      createdAt: new Date(),
      errorMessage,
      errorCode,
    };
  }
}

/**
 * Real Razorpay Payment Provider (Test / Live Mode)
 * Calls Razorpay API to generate actual test/live payment links with webhook callback configuration.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  name = 'RAZORPAY';
  isSimulated = false;

  async execute(params: ExecuteCampaignActionParams): Promise<RazorpayExecutionResult> {
    const {
      actionId,
      title,
      targetSegment,
      incrementalRevenuePerCustomer = 800,
    } = params;

    try {
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials not configured (RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing)');
      }

      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

      // Amount in integer paise (e.g. ₹800 -> 80000 paise)
      const amountPaise = Math.round(incrementalRevenuePerCustomer * 100);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const payload = {
        amount: amountPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: actionId,
        description: `Revenue Lift: ${title}`,
        customer: {
          name: targetSegment,
        },
        notes: {
          actionId,
          opportunityId: params.opportunityId,
          opportunityType: params.opportunityType,
        },
        expire_by: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days expiry
        callback_url: `${appUrl}/api/webhooks/razorpay`,
        callback_method: 'get',
      };

      const response = await razorpay.paymentLink.create(payload);

      return {
        success: true,
        status: 'SUCCESS',
        provider: 'RAZORPAY',
        providerReferenceId: (response as any).id,
        paymentLinksCreated: 1,
        payloadSent: payload,
        responseReceived: response,
        isSimulated: false,
        createdAt: new Date(),
      };
    } catch (err: any) {
      // Log failure safely without leaking API secret
      await logAuditEvent({
        merchantId: undefined,
        actor: 'SYSTEM',
        eventType: 'EXECUTION_FAILED',
        entityType: 'Execution',
        entityId: actionId,
        previousState: 'INITIATED',
        newState: 'FAILED',
        summary: `Razorpay execution error for action ${actionId}: ${err.message}`,
        metadata: { errorMessage: err.message, errorCode: err.code },
      });

      return {
        success: false,
        status: 'FAILED',
        provider: 'RAZORPAY',
        paymentLinksCreated: 0,
        errorMessage: err.message,
        errorCode: err.code || 'RAZORPAY_API_ERROR',
        isSimulated: false,
        createdAt: new Date(),
      };
    }
  }
}

/**
 * Provider factory returning appropriate payment provider based on configuration or simulation flag
 */
export function getPaymentProvider(isDemo: boolean = true): PaymentProvider {
  if (isDemo) {
    return new DemoPaymentProvider();
  }
  return new RazorpayPaymentProvider();
}

/**
 * Canonical entrypoint for executing Razorpay Campaign Actions.
 * Preserves compatibility while delegating to the PaymentProvider architecture.
 */
export async function executeRazorpayCampaignAction(
  params: ExecuteCampaignActionParams
): Promise<RazorpayExecutionResult> {
  const isDemoMode = process.env.DEMO_MODE === 'true' || Boolean(params.forceFailure);
  const provider = getPaymentProvider(isDemoMode);
  return provider.execute(params);
}

/**
 * Verify Razorpay webhook signature using HMAC SHA256.
 * Timing-safe comparison prevents timing attacks.
 * Returns true if the payload matches the provided signature.
 */
export function verifyRazorpaySignature(payload: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  try {
    const generated = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    const generatedBuffer = Buffer.from(generated, 'utf8');

    if (signatureBuffer.length !== generatedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, generatedBuffer);
  } catch (err) {
    return false;
  }
}
