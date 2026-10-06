// ==============================================================================
// Revenue Lift — Razorpay Webhook Endpoint
// ==============================================================================
// POST /api/webhooks/razorpay
// Secure, idempotent webhook ingestion for Razorpay payment events.
// Verified via HMAC SHA-256 signature against RAZORPAY_WEBHOOK_SECRET.
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyRazorpaySignature } from '@/lib/razorpay';
import { logAuditEvent } from '@/core/auditLogger';

export async function POST(req: NextRequest) {
  try {
    // 1. Extract raw body text and signature header
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    // 2. Validate signature presence
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing x-razorpay-signature header' },
        { status: 400 }
      );
    }

    // 3. Verify cryptographic HMAC signature
    const isValid = verifyRazorpaySignature(rawBody, signature);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid webhook signature. Request rejected.' },
        { status: 400 }
      );
    }

    // 4. Parse verified JSON payload
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (parseErr) {
      return NextResponse.json(
        { error: 'Malformed JSON payload' },
        { status: 400 }
      );
    }

    const eventType = body.event || 'unknown';
    // Event ID for deduplication / idempotency
    const eventId = body.id || body.event_id || `evt_${eventType}_${Date.now()}`;

    // 5. Check Idempotency via WebhookEvent table
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent && existingEvent.processed) {
      return NextResponse.json(
        {
          received: true,
          idempotent: true,
          eventId,
          message: 'Webhook event was already processed previously.',
        },
        { status: 200 }
      );
    }

    // 6. Record or update incoming webhook event record
    const webhookRecord = await prisma.webhookEvent.upsert({
      where: { eventId },
      update: {
        eventType,
        payload: rawBody,
        signature,
        verified: true,
      },
      create: {
        eventId,
        provider: 'RAZORPAY',
        eventType,
        payload: rawBody,
        signature,
        verified: true,
        processed: false,
      },
    });

    // 7. Extract event entities
    const paymentEntity = body.payload?.payment?.entity;
    const paymentLinkEntity = body.payload?.payment_link?.entity;
    const orderEntity = body.payload?.order?.entity;

    // Determine references: actionId, provider reference (plink_id, pay_id, etc.)
    const actionId =
      paymentLinkEntity?.notes?.actionId ||
      paymentEntity?.notes?.actionId ||
      paymentLinkEntity?.reference_id ||
      body.payload?.notes?.actionId;

    const providerReferenceId =
      paymentLinkEntity?.id ||
      paymentEntity?.order_id ||
      orderEntity?.id ||
      paymentEntity?.id;

    // 8. Find matching Execution and CampaignAction
    let execution = null;
    let action = null;

    if (actionId) {
      execution = await prisma.execution.findFirst({
        where: { actionId },
        include: { action: { include: { opportunity: { include: { goal: true } } } } },
        orderBy: { executedAt: 'desc' },
      });
      if (!execution) {
        action = await prisma.campaignAction.findUnique({
          where: { id: actionId },
          include: { opportunity: { include: { goal: true } } },
        });
      }
    }

    if (!execution && !action && providerReferenceId) {
      execution = await prisma.execution.findFirst({
        where: {
          OR: [
            { providerReferenceId },
            { batchId: providerReferenceId },
          ],
        },
        include: { action: { include: { opportunity: { include: { goal: true } } } } },
        orderBy: { executedAt: 'desc' },
      });
    }

    if (execution && !action) {
      action = execution.action;
    }

    // 9. Process by Event Type
    let processingNotes = '';
    const merchantId = action?.opportunity?.goal?.merchantId;

    if (
      eventType === 'payment.captured' ||
      eventType === 'payment_link.paid' ||
      eventType === 'order.paid'
    ) {
      const amountPaise = paymentEntity?.amount || paymentLinkEntity?.amount || 0;
      const amountRupees = amountPaise / 100;
      const paymentId = paymentEntity?.id || `pay_${Date.now()}`;
      const rzpOrderId = paymentEntity?.order_id || paymentLinkEntity?.order_id || null;

      // Persist or record Payment in database
      await prisma.payment.create({
        data: {
          razorpayPaymentId: paymentId,
          razorpayOrderId: rzpOrderId,
          amount: amountRupees,
          currency: paymentEntity?.currency || 'INR',
          status: 'captured',
          isSynthetic: false,
        },
      });

      if (action) {
        if (execution) {
          await prisma.execution.update({
            where: { id: execution.id },
            data: { status: 'SUCCESS' },
          });
        }

        await prisma.campaignAction.update({
          where: { id: action.id },
          data: { status: 'COMPLETED' },
        });

        processingNotes = `Payment captured ₹${amountRupees} for action ${action.id}. Action updated to COMPLETED.`;

        // Log audit trail
        await logAuditEvent({
          merchantId,
          actor: 'SYSTEM',
          eventType: 'WEBHOOK_RECEIVED',
          entityType: 'CampaignAction',
          entityId: action.id,
          previousState: action.status,
          newState: 'COMPLETED',
          summary: `Razorpay webhook confirmed payment (${paymentId}) of ₹${amountRupees.toLocaleString('en-IN')}. Action marked COMPLETED.`,
          metadata: {
            eventId,
            paymentId,
            amountRupees,
            eventType,
            providerReferenceId,
          },
        });
      } else {
        processingNotes = `Payment captured ₹${amountRupees} but no active campaign action was mapped for reference ${providerReferenceId}.`;
      }
    } else if (eventType === 'payment.failed') {
      const failureReason =
        paymentEntity?.error_description ||
        paymentEntity?.error_reason ||
        'Gateway transaction failed';

      if (action) {
        // Only mark failed if not already completed by another transaction
        if (action.status !== 'COMPLETED') {
          await prisma.campaignAction.update({
            where: { id: action.id },
            data: { status: 'FAILED' },
          });
        }

        if (execution && execution.status !== 'SUCCESS') {
          await prisma.execution.update({
            where: { id: execution.id },
            data: { status: 'FAILED' },
          });
        }

        processingNotes = `Payment failure recorded for action ${action.id}: ${failureReason}`;

        await logAuditEvent({
          merchantId,
          actor: 'SYSTEM',
          eventType: 'PAYMENT_FAILED',
          entityType: 'CampaignAction',
          entityId: action.id,
          previousState: action.status,
          newState: action.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
          summary: `Razorpay payment failed for action ${action.id}: ${failureReason}`,
          metadata: {
            eventId,
            failureReason,
            eventType,
            providerReferenceId,
          },
        });
      } else {
        processingNotes = `Payment failure received for unmapped reference ${providerReferenceId}: ${failureReason}`;
      }
    } else {
      processingNotes = `Unhandled event type: ${eventType}. Acknowledged.`;
    }

    // 10. Mark WebhookEvent as processed
    await prisma.webhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processed: true,
        processedAt: new Date(),
        executionId: execution?.id || null,
        actionId: action?.id || execution?.actionId || null,
        processingError: action ? null : 'Unmapped reference',
      },
    });

    return NextResponse.json(
      {
        received: true,
        eventId,
        eventType,
        mapped: Boolean(action),
        actionId: action?.id || execution?.actionId || null,
        message: processingNotes,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Webhook processing exception:', error);
    return NextResponse.json(
      {
        error: 'Webhook processing error',
        message: 'The server encountered an error processing the webhook safely.',
      },
      { status: 500 }
    );
  }
}
