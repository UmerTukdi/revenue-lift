// Structured Domain Errors for Revenue Lift

export class RevenueLiftError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'INTERNAL_ERROR', statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RevenueLiftError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class IllegalStateTransitionError extends RevenueLiftError {
  constructor(fromState: string, toState: string, actionId?: string) {
    super(
      `Illegal state transition: Cannot transition from '${fromState}' to '${toState}'${actionId ? ` for Action ${actionId}` : ''}. Consequential actions require explicit merchant approval.`,
      'ILLEGAL_STATE_TRANSITION',
      400,
      { fromState, toState, actionId }
    );
    this.name = 'IllegalStateTransitionError';
  }
}

export class ConstraintViolationError extends RevenueLiftError {
  constructor(opportunityTitle: string, violations: string[]) {
    super(
      `Hard constraint check failed for '${opportunityTitle}': ${violations.join('; ')}`,
      'CONSTRAINT_VIOLATION',
      422,
      { opportunityTitle, violations }
    );
    this.name = 'ConstraintViolationError';
  }
}

export class RazorpayExecutionError extends RevenueLiftError {
  public readonly isRetryable: boolean;

  constructor(message: string, isRetryable = true, details?: Record<string, unknown>) {
    super(message, 'RAZORPAY_EXECUTION_ERROR', 502, details);
    this.name = 'RazorpayExecutionError';
    this.isRetryable = isRetryable;
  }
}
