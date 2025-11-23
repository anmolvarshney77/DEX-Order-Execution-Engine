/**
 * Error handling and classification system for DEX Order Execution Engine
 * Implements error categories, retry logic, circuit breaker, and error events
 */

import { EventEmitter } from 'events';
import { logger } from '@utils/logger';

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  VALIDATION = 'ERROR_VALIDATION',
  ROUTING = 'ERROR_ROUTING',
  EXECUTION = 'ERROR_EXECUTION',
  SYSTEM = 'ERROR_SYSTEM'
}

/**
 * Base error class with category and context
 */
export class CategorizedError extends Error {
  public readonly category: ErrorCategory;
  public readonly context: Record<string, any>;
  public readonly timestamp: number;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    category: ErrorCategory,
    context: Record<string, any> = {},
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.context = context;
    this.timestamp = Date.now();
    this.isRetryable = isRetryable;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Converts error to JSON format for logging and responses
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      context: this.context,
      timestamp: this.timestamp,
      isRetryable: this.isRetryable,
      stack: this.stack
    };
  }
}

/**
 * Validation errors (HTTP 400) - Not retryable
 */
export class ValidationError extends CategorizedError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.VALIDATION, context, false);
  }
}

/**
 * Routing errors - Retryable
 */
export class RoutingError extends CategorizedError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.ROUTING, context, true);
  }
}

/**
 * Execution errors - Retryable
 */
export class ExecutionError extends CategorizedError {
  constructor(message: string, context: Record<string, any> = {}) {
    super(message, ErrorCategory.EXECUTION, context, true);
  }
}

/**
 * System errors - Critical, may be retryable
 */
export class SystemError extends CategorizedError {
  constructor(message: string, context: Record<string, any> = {}, isRetryable: boolean = true) {
    super(message, ErrorCategory.SYSTEM, context, isRetryable);
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  backoffMultiplier: 2,
  maxDelay: 4000 // 4 seconds
};

/**
 * Calculates exponential backoff delay
 * @param attempt - Current attempt number (1-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelay);
}

/**
 * Retry options for retry wrapper
 */
export interface RetryOptions {
  config?: RetryConfig;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Wraps an async function with retry logic
 * @param fn - Async function to retry
 * @param options - Retry options
 * @returns Result of the function
 * @throws Error if all retry attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = options.config || DEFAULT_RETRY_CONFIG;
  const shouldRetry = options.shouldRetry || ((error: Error) => {
    return error instanceof CategorizedError && error.isRetryable;
  });

  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (attempt >= config.maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateBackoffDelay(attempt, config);
      
      // Call retry callback if provided
      if (options.onRetry) {
        options.onRetry(lastError, attempt, delay);
      }

      // Log retry attempt
      logger.warn({
        message: 'Retrying operation after failure',
        attempt,
        maxAttempts: config.maxAttempts,
        delay,
        error: lastError.message
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation
  OPEN = 'OPEN',         // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Open circuit after N failures
  resetTimeout: number;          // Try to close after N milliseconds
  monitoringPeriod: number;      // Monitor failures over N milliseconds
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000,      // 60 seconds
  monitoringPeriod: 120000  // 2 minutes
};

/**
 * Circuit breaker implementation for external dependencies
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private nextAttemptTime: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {
    super();
    this.name = name;
    this.config = config;
  }

  /**
   * Gets current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Gets current failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Executes a function with circuit breaker protection
   * @param fn - Async function to execute
   * @returns Result of the function
   * @throws Error if circuit is open or function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      
      // Check if we should try half-open
      if (now >= this.nextAttemptTime) {
        this.state = CircuitState.HALF_OPEN;
        logger.info({
          message: 'Circuit breaker transitioning to HALF_OPEN',
          circuitBreaker: this.name
        });
        this.emit('halfOpen', this.name);
      } else {
        const error = new SystemError(
          `Circuit breaker is OPEN for ${this.name}`,
          { circuitBreaker: this.name, state: this.state },
          false
        );
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handles successful execution
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.reset();
      logger.info({
        message: 'Circuit breaker closed after successful test',
        circuitBreaker: this.name
      });
      this.emit('closed', this.name);
    }
    
    // Reset failure count if outside monitoring period
    const now = Date.now();
    if (now - this.lastFailureTime > this.config.monitoringPeriod) {
      this.failureCount = 0;
    }
  }

  /**
   * Handles failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failureCount++;

    logger.warn({
      message: 'Circuit breaker recorded failure',
      circuitBreaker: this.name,
      failureCount: this.failureCount,
      threshold: this.config.failureThreshold,
      state: this.state
    });

    // If in half-open state, immediately open
    if (this.state === CircuitState.HALF_OPEN) {
      this.open();
      return;
    }

    // Check if we should open the circuit
    if (this.failureCount >= this.config.failureThreshold) {
      this.open();
    }
  }

  /**
   * Opens the circuit
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.config.resetTimeout;
    
    logger.error({
      message: 'Circuit breaker opened',
      circuitBreaker: this.name,
      failureCount: this.failureCount,
      resetTimeout: this.config.resetTimeout
    });
    
    this.emit('open', this.name);
  }

  /**
   * Resets the circuit breaker
   */
  private reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }

  /**
   * Manually resets the circuit breaker (for testing/admin)
   */
  public forceReset(): void {
    this.reset();
    logger.info({
      message: 'Circuit breaker manually reset',
      circuitBreaker: this.name
    });
    this.emit('reset', this.name);
  }
}

/**
 * Error event emitter for critical errors
 */
export class ErrorEventEmitter extends EventEmitter {
  /**
   * Emits a critical error event
   * @param error - The error that occurred
   * @param context - Additional context
   */
  emitCriticalError(error: Error, context: Record<string, any> = {}): void {
    const errorData = {
      error: error instanceof CategorizedError ? error.toJSON() : {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      timestamp: Date.now()
    };

    // Log critical error
    logger.error({
      message: 'Critical error occurred',
      ...errorData
    });

    // Emit event for monitoring systems
    this.emit('criticalError', errorData);
  }

  /**
   * Emits an error event with full context
   * @param error - The error that occurred
   * @param context - Additional context including orderId
   */
  emitError(error: Error, context: Record<string, any> = {}): void {
    const errorData = {
      error: error instanceof CategorizedError ? error.toJSON() : {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      timestamp: Date.now()
    };

    // Log error with full context
    logger.error({
      message: 'Error occurred',
      ...errorData
    });

    // Emit event
    this.emit('error', errorData);
  }
}

/**
 * Global error event emitter instance
 */
export const errorEmitter = new ErrorEventEmitter();

/**
 * Logs error with full context
 * @param error - The error to log
 * @param context - Additional context
 */
export function logError(error: Error, context: Record<string, any> = {}): void {
  const errorData = error instanceof CategorizedError ? error.toJSON() : {
    name: error.name,
    message: error.message,
    stack: error.stack
  };

  logger.error({
    message: 'Error logged',
    error: errorData,
    context,
    timestamp: Date.now()
  });
}

/**
 * Determines if an error is critical
 * @param error - The error to check
 * @returns True if error is critical
 */
export function isCriticalError(error: Error): boolean {
  if (error instanceof CategorizedError) {
    return error.category === ErrorCategory.SYSTEM;
  }
  return false;
}

/**
 * Classifies an unknown error into a categorized error
 * @param error - The error to classify
 * @returns Categorized error
 */
export function classifyError(error: unknown): CategorizedError {
  // Already categorized
  if (error instanceof CategorizedError) {
    return error;
  }

  // Convert to Error if not already
  const err = error instanceof Error ? error : new Error(String(error));

  // Try to classify based on error message patterns
  const message = err.message.toLowerCase();

  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return new ValidationError(err.message, { originalError: err.name });
  }

  if (message.includes('quote') || message.includes('dex') || message.includes('routing')) {
    return new RoutingError(err.message, { originalError: err.name });
  }

  if (message.includes('transaction') || message.includes('swap') || message.includes('slippage')) {
    return new ExecutionError(err.message, { originalError: err.name });
  }

  // Default to system error
  return new SystemError(err.message, { originalError: err.name });
}
