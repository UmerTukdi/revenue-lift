// ==============================================================================
// Revenue Lift — Deterministic Measurement & Reconciliation Engine
// ==============================================================================
// Compares predicted Expected Net Value against actual merchant outcomes.
// All monetary arithmetic is performed in integer minor units (paise).
// Strictly deterministic: Zero LLM math.
// ==============================================================================

import { inrToPaise, paiseToInr } from './scoring';

export interface MeasurementInputs {
  /** Predicted incremental revenue in INR (from deterministic scoring) */
  predictedRevenue: number;
  /** Actual incremental revenue captured in INR */
  actualRevenue: number;
  /** Predicted Expected Net Value in INR (Revenue - Incentive Cost) */
  predictedNetValue: number;
  /** Actual Net Value realized in INR (Actual Revenue - Actual Incentive Cost) */
  actualNetValue: number;
  /** Merchant overall goal target revenue in INR */
  targetRevenue: number;
  /** Actual converted customers count */
  conversionsCount?: number;
}

export interface MeasurementMetrics {
  predictedRevenue: number;
  actualRevenue: number;
  revenueDelta: number; // actual - predicted
  predictedNetValue: number;
  actualNetValue: number;
  netValueDelta: number; // actual - predicted
  predictionAccuracyPct: number; // percentage (0.0% to 100.0%)
  goalProgressPct: number; // percentage of target revenue achieved
  conversionsCount: number;
  isGoalAchieved: boolean;
}

/**
 * Calculates deterministic measurement reconciliation metrics.
 * Pure function: Uses integer minor units (paise) to guarantee arithmetic precision.
 */
export function calculateMeasurementMetrics(inputs: MeasurementInputs): MeasurementMetrics {
  const {
    predictedRevenue,
    actualRevenue,
    predictedNetValue,
    actualNetValue,
    targetRevenue,
    conversionsCount = 0,
  } = inputs;

  // Convert to paise for integer precision
  const predRevPaise = inrToPaise(predictedRevenue);
  const actRevPaise = inrToPaise(actualRevenue);
  const revDeltaPaise = actRevPaise - predRevPaise;

  const predNetPaise = inrToPaise(predictedNetValue);
  const actNetPaise = inrToPaise(actualNetValue);
  const netDeltaPaise = actNetPaise - predNetPaise;

  // Prediction Accuracy: 100 - (|actual - predicted| / predicted) * 100
  let predictionAccuracyPct = 100.0;
  if (predNetPaise > 0) {
    const errorRatio = Math.abs(actNetPaise - predNetPaise) / predNetPaise;
    predictionAccuracyPct = Math.max(0, Math.min(100, (1 - errorRatio) * 100));
  } else if (predNetPaise === 0 && actNetPaise !== 0) {
    predictionAccuracyPct = 0.0;
  }

  // Goal Progress: (actualRevenue / targetRevenue) * 100
  let goalProgressPct = 0.0;
  if (targetRevenue > 0) {
    goalProgressPct = (actualRevenue / targetRevenue) * 100;
  }

  const isGoalAchieved = actualRevenue >= targetRevenue;

  return {
    predictedRevenue: paiseToInr(predRevPaise),
    actualRevenue: paiseToInr(actRevPaise),
    revenueDelta: paiseToInr(revDeltaPaise),
    predictedNetValue: paiseToInr(predNetPaise),
    actualNetValue: paiseToInr(actNetPaise),
    netValueDelta: paiseToInr(netDeltaPaise),
    predictionAccuracyPct: Number(predictionAccuracyPct.toFixed(1)),
    goalProgressPct: Number(goalProgressPct.toFixed(1)),
    conversionsCount,
    isGoalAchieved,
  };
}
