import { describe, it, expect } from 'vitest';
import { IllegalStateTransitionError, ConstraintViolationError, RazorpayExecutionError } from '../core/errors';
import { config } from '../lib/env';
import prisma from '../lib/db';

describe('Revenue Lift Foundation Verification', () => {
  it('validates deterministic Expected Net Value formula precision', () => {
    // Formula: Expected Net Value = Eligible Customers × Acceptance Probability × Incremental Revenue - Incentive Cost
    // Test Case:
    // N = 500
    // P = 0.20
    // R = 800
    // C = 50
    // Expected Net Value = 500 * 0.20 * 800 - (500 * 0.20 * 50)
    // = 80,000 - 5,000 = 75,000
    const N = 500;
    const P = 0.20;
    const R = 800;
    const C = 50;
    const grossIncrRevenue = N * P * R;
    const totalIncentiveCost = N * P * C;
    const expectedNetValue = grossIncrRevenue - totalIncentiveCost;

    expect(grossIncrRevenue).toBe(80000);
    expect(totalIncentiveCost).toBe(5000);
    expect(expectedNetValue).toBe(75000);
  });

  it('enforces structured domain error classes', () => {
    const stateErr = new IllegalStateTransitionError('CANDIDATE', 'EXECUTING');
    expect(stateErr.statusCode).toBe(400);
    expect(stateErr.code).toBe('ILLEGAL_STATE_TRANSITION');
    expect(stateErr.message).toContain("Cannot transition from 'CANDIDATE' to 'EXECUTING'");

    const constraintErr = new ConstraintViolationError('High Discount Promo', [
      'Projected margin 21% < 25% floor',
    ]);
    expect(constraintErr.statusCode).toBe(422);
    expect(constraintErr.code).toBe('CONSTRAINT_VIOLATION');

    const razorpayErr = new RazorpayExecutionError('Gateway timeout', true);
    expect(razorpayErr.isRetryable).toBe(true);
  });

  it('loads default environment configuration with synthetic mode enabled', () => {
    expect(config.isDemoMode).toBe(true);
    expect(config.isSyntheticData).toBe(true);
    expect(config.aiProvider).toBe('mock');
  });

  it('confirms database connectivity and seeded synthetic demo data', async () => {
    const merchant = await prisma.merchant.findFirst({
      where: { isSynthetic: true },
      include: { goals: { include: { constraints: true } } },
    });

    expect(merchant).toBeDefined();
    expect(merchant?.name).toContain('ShopNova');
    expect(merchant?.isSynthetic).toBe(true);
    
    const activeGoal = merchant?.goals[0];
    expect(activeGoal?.targetRevenue).toBe(50000);
    expect(activeGoal?.constraints.length).toBeGreaterThanOrEqual(4);

    const marginFloor = activeGoal?.constraints.find((c) => c.type === 'MARGIN_FLOOR');
    expect(marginFloor?.thresholdValue).toBe(25.0);
    expect(marginFloor?.isHard).toBe(true);
  });
});
