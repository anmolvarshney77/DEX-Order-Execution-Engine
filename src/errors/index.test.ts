import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorCategory,
  CategorizedError,
  ValidationError,
  RoutingError,
  ExecutionError,
  SystemError,
  calculateBackoffDelay,
  withRetry,
  CircuitBreaker,
  CircuitState,
  ErrorEventEmitter,
  errorEmitter,
  logError,
  isCriticalError,
  classifyError,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_CIRCUIT_CONFIG
} from './index';

describe('Error Classification System', () => {
  describe('CategorizedError', () => {
    it('should create error with category and context', () => {
      const error = new CategorizedError(
        'Test error',
        ErrorCategory.VALIDATION,
        { field: 'amount' },
        false
      );

      expect(error.message).toBe('Test error');
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.context).toEqual({ field: 'amount' });
      expect(error.isRetryable).toBe(false);
      expect(error.timestamp).toBeGreaterThan(0);
    });

    it('should convert to JSON format', () => {
      const error = new CategorizedError(
        'Test error',
        ErrorCategory.ROUTING,
        { dex: 'raydium' },
        true
      );

      const json = error.toJSON();
      expect(json.name).toBe('CategorizedError');
      expect(json.message).toBe('Test error');
      expect(json.category).toBe(ErrorCategory.ROUTING);
      expect(json.context).toEqual({ dex: 'raydium' });
      expect(json.isRetryable).toBe(true);
      expect(json.stack).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should create non-retryable validation error', () => {
      const error = new ValidationError('Invalid amount', { field: 'amount' });

      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.isRetryable).toBe(false);
      expect(error.message).toBe('Invalid amount');
    });
  });

  describe('RoutingError', () => {
    it('should create retryable routing error', () => {
      const error = new RoutingError('DEX quote timeout', { dex: 'meteora' });

      expect(error.category).toBe(ErrorCategory.ROUTING);
      expect(error.isRetryable).toBe(true);
      expect(error.message).toBe('DEX quote timeout');
    });
  });

  describe('ExecutionError', () => {
    it('should create retryable execution error', () => {
      const error = new ExecutionError('Transaction failed', { txHash: '123' });

      expect(error.category).toBe(ErrorCategory.EXECUTION);
      expect(error.isRetryable).toBe(true);
      expect(error.message).toBe('Transaction failed');
    });
  });

  describe('SystemError', () => {
    it('should create system error with configurable retry', () => {
      const error = new SystemError('Database connection failed', {}, true);

      expect(error.category).toBe(ErrorCategory.SYSTEM);
      expect(error.isRetryable).toBe(true);
    });

    it('should create non-retryable system error', () => {
      const error = new SystemError('Critical failure', {}, false);

      expect(error.category).toBe(ErrorCategory.SYSTEM);
      expect(error.isRetryable).toBe(false);
    });
  });
});

describe('Retry Logic', () => {
  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff delays', () => {
      expect(calculateBackoffDelay(1)).toBe(1000); // 1s
      expect(calculateBackoffDelay(2)).toBe(2000); // 2s
      expect(calculateBackoffDelay(3)).toBe(4000); // 4s
    });

    it('should cap delay at maxDelay', () => {
      expect(calculateBackoffDelay(4)).toBe(4000); // Capped at 4s
      expect(calculateBackoffDelay(5)).toBe(4000); // Capped at 4s
    });

    it('should use custom config', () => {
      const config = {
        maxAttempts: 5,
        initialDelay: 500,
        backoffMultiplier: 3,
        maxDelay: 10000
      };

      expect(calculateBackoffDelay(1, config)).toBe(500);   // 500ms
      expect(calculateBackoffDelay(2, config)).toBe(1500);  // 1.5s
      expect(calculateBackoffDelay(3, config)).toBe(4500);  // 4.5s
      expect(calculateBackoffDelay(4, config)).toBe(10000); // Capped at 10s
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new RoutingError('Temporary failure'))
        .mockResolvedValue('success');

      const promise = withRetry(fn);
      
      // Fast-forward through retry delay
      await vi.advanceTimersByTimeAsync(1000);
      
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new ValidationError('Invalid input'));

      await expect(withRetry(fn)).rejects.toThrow('Invalid input');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw last error', async () => {
      const error = new RoutingError('Persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn).catch(err => err);
      
      // Fast-forward through all retry delays
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry
      
      const result = await promise;
      expect(result).toBeInstanceOf(RoutingError);
      expect(result.message).toBe('Persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new RoutingError('Failure'))
        .mockResolvedValue('success');
      
      const onRetry = vi.fn();

      const promise = withRetry(fn, { onRetry });
      
      await vi.advanceTimersByTimeAsync(1000);
      
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.any(RoutingError),
        1,
        1000
      );
    });

    it('should use custom shouldRetry function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Custom error'));
      const shouldRetry = vi.fn().mockReturnValue(false);

      await expect(withRetry(fn, { shouldRetry })).rejects.toThrow('Custom error');
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

describe('Circuit Breaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      resetTimeout: 5000,
      monitoringPeriod: 10000
    });
  });

  it('should start in CLOSED state', () => {
    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });

  it('should execute function successfully in CLOSED state', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await circuitBreaker.execute(fn);

    expect(result).toBe('success');
    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should open circuit after threshold failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Fail 3 times to reach threshold
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Failure');
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Failure');
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Failure');

    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    expect(circuitBreaker.getFailureCount()).toBe(3);
  });

  it('should reject requests when circuit is OPEN', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();

    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

    // Next request should be rejected without calling fn
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
    expect(fn).toHaveBeenCalledTimes(3); // Not called on 4th attempt
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    vi.useFakeTimers();
    
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();

    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

    // Fast-forward past reset timeout
    vi.advanceTimersByTime(5000);

    // Next request should transition to HALF_OPEN
    fn.mockResolvedValue('success');
    await circuitBreaker.execute(fn);

    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    
    vi.restoreAllMocks();
  });

  it('should close circuit on successful HALF_OPEN test', async () => {
    vi.useFakeTimers();
    
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();

    // Fast-forward and succeed
    vi.advanceTimersByTime(5000);
    fn.mockResolvedValue('success');
    
    const result = await circuitBreaker.execute(fn);

    expect(result).toBe('success');
    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
    
    vi.restoreAllMocks();
  });

  it('should reopen circuit on failed HALF_OPEN test', async () => {
    vi.useFakeTimers();
    
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();

    // Fast-forward and fail again
    vi.advanceTimersByTime(5000);
    
    await expect(circuitBreaker.execute(fn)).rejects.toThrow('Failure');

    expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    
    vi.restoreAllMocks();
  });

  it('should emit events on state changes', async () => {
    const openListener = vi.fn();
    const closedListener = vi.fn();
    
    circuitBreaker.on('open', openListener);
    circuitBreaker.on('closed', closedListener);

    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();
    await expect(circuitBreaker.execute(fn)).rejects.toThrow();

    expect(openListener).toHaveBeenCalledWith('test-service');
  });

  it('should allow manual reset', () => {
    const fn = vi.fn().mockRejectedValue(new Error('Failure'));

    // Open the circuit
    circuitBreaker.execute(fn).catch(() => {});
    circuitBreaker.execute(fn).catch(() => {});
    circuitBreaker.execute(fn).catch(() => {});

    // Manual reset
    circuitBreaker.forceReset();

    expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    expect(circuitBreaker.getFailureCount()).toBe(0);
  });
});

describe('Error Event Emitter', () => {
  let emitter: ErrorEventEmitter;

  beforeEach(() => {
    emitter = new ErrorEventEmitter();
  });

  it('should emit critical error event', () => {
    const listener = vi.fn();
    emitter.on('criticalError', listener);

    const error = new SystemError('Critical failure');
    emitter.emitCriticalError(error, { orderId: '123' });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Critical failure',
          category: ErrorCategory.SYSTEM
        }),
        context: { orderId: '123' },
        timestamp: expect.any(Number)
      })
    );
  });

  it('should emit regular error event', () => {
    const listener = vi.fn();
    emitter.on('error', listener);

    const error = new RoutingError('Routing failed');
    emitter.emitError(error, { orderId: '456' });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Routing failed',
          category: ErrorCategory.ROUTING
        }),
        context: { orderId: '456' }
      })
    );
  });

  it('should handle non-categorized errors', () => {
    const listener = vi.fn();
    emitter.on('error', listener);

    const error = new Error('Generic error');
    emitter.emitError(error);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Generic error'
        })
      })
    );
  });
});

describe('Error Utilities', () => {
  describe('isCriticalError', () => {
    it('should identify system errors as critical', () => {
      const error = new SystemError('Database failure');
      expect(isCriticalError(error)).toBe(true);
    });

    it('should not identify other errors as critical', () => {
      expect(isCriticalError(new ValidationError('Invalid'))).toBe(false);
      expect(isCriticalError(new RoutingError('Failed'))).toBe(false);
      expect(isCriticalError(new ExecutionError('Failed'))).toBe(false);
      expect(isCriticalError(new Error('Generic'))).toBe(false);
    });
  });

  describe('classifyError', () => {
    it('should return categorized error as-is', () => {
      const error = new ValidationError('Invalid input');
      const classified = classifyError(error);
      
      expect(classified).toBe(error);
    });

    it('should classify validation errors by message', () => {
      const error = new Error('Validation failed: invalid amount');
      const classified = classifyError(error);
      
      expect(classified).toBeInstanceOf(ValidationError);
      expect(classified.category).toBe(ErrorCategory.VALIDATION);
    });

    it('should classify routing errors by message', () => {
      const error = new Error('DEX quote request failed');
      const classified = classifyError(error);
      
      expect(classified).toBeInstanceOf(RoutingError);
      expect(classified.category).toBe(ErrorCategory.ROUTING);
    });

    it('should classify execution errors by message', () => {
      const error = new Error('Transaction submission failed');
      const classified = classifyError(error);
      
      expect(classified).toBeInstanceOf(ExecutionError);
      expect(classified.category).toBe(ErrorCategory.EXECUTION);
    });

    it('should default to system error for unknown errors', () => {
      const error = new Error('Unknown error');
      const classified = classifyError(error);
      
      expect(classified).toBeInstanceOf(SystemError);
      expect(classified.category).toBe(ErrorCategory.SYSTEM);
    });

    it('should handle non-Error objects', () => {
      const classified = classifyError('String error');
      
      expect(classified).toBeInstanceOf(SystemError);
      expect(classified.message).toBe('String error');
    });
  });
});
