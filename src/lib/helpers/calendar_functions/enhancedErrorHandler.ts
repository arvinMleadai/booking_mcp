// Enhanced error handling with classification and graceful degradation
interface ErrorContext {
  operation: string
  clientId?: number
  connectionId?: string
  timestamp: number
  metadata?: Record<string, unknown>
}

interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  retryableErrors: ErrorType[]
}

interface FallbackOptions<T> {
  useCachedData?: boolean
  useSimplifiedResponse?: boolean
  customFallback?: () => Promise<T>
  gracefulDegradation?: boolean
}

type ErrorType = 
  | 'RATE_LIMITED'
  | 'TIMEOUT' 
  | 'NETWORK'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'CLIENT_ERROR'
  | 'VALIDATION'
  | 'UNKNOWN'

interface ErrorClassification {
  type: ErrorType
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  isRetryable: boolean
  suggestedAction: string
  userMessage: string
}

/**
 * Enhanced error classifier that categorizes errors for appropriate handling
 */
export class ErrorClassifier {
  private static readonly ERROR_PATTERNS: Array<{
    pattern: RegExp | string
    type: ErrorType
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    isRetryable: boolean
    suggestedAction: string
    userMessage: string
  }> = [
    {
      pattern: /429|rate.?limit/i,
      type: 'RATE_LIMITED',
      severity: 'MEDIUM',
      isRetryable: true,
      suggestedAction: 'Implement exponential backoff and reduce request frequency',
      userMessage: 'Service is temporarily busy. Please try again in a moment.'
    },
    {
      pattern: /timeout|ETIMEDOUT|ECONNRESET/i,
      type: 'TIMEOUT',
      severity: 'MEDIUM',
      isRetryable: true,
      suggestedAction: 'Retry with increased timeout',
      userMessage: 'Request timed out. Please try again.'
    },
    {
      pattern: /network|ENOTFOUND|ECONNREFUSED|fetch/i,
      type: 'NETWORK',
      severity: 'HIGH',
      isRetryable: true,
      suggestedAction: 'Check network connectivity and retry',
      userMessage: 'Network connection issue. Please check your internet connection.'
    },
    {
      pattern: /401|unauthorized|invalid.?token|token.?expired/i,
      type: 'AUTHENTICATION',
      severity: 'HIGH',
      isRetryable: false,
      suggestedAction: 'Refresh authentication tokens',
      userMessage: 'Authentication required. Please reconnect your calendar.'
    },
    {
      pattern: /403|forbidden|access.?denied/i,
      type: 'AUTHORIZATION',
      severity: 'HIGH',
      isRetryable: false,
      suggestedAction: 'Check user permissions and scopes',
      userMessage: 'Access denied. Please check your calendar permissions.'
    },
    {
      pattern: /404|not.?found/i,
      type: 'NOT_FOUND',
      severity: 'MEDIUM',
      isRetryable: false,
      suggestedAction: 'Verify resource exists',
      userMessage: 'The requested calendar or event was not found.'
    },
    {
      pattern: /5\d{2}|server.?error|internal.?error/i,
      type: 'SERVER_ERROR',
      severity: 'HIGH',
      isRetryable: true,
      suggestedAction: 'Retry after delay, escalate if persistent',
      userMessage: 'Server error occurred. Please try again later.'
    },
    {
      pattern: /4\d{2}|bad.?request|invalid/i,
      type: 'CLIENT_ERROR',
      severity: 'MEDIUM',
      isRetryable: false,
      suggestedAction: 'Fix request parameters',
      userMessage: 'Invalid request. Please check your input and try again.'
    },
    {
      pattern: /validation|required|missing/i,
      type: 'VALIDATION',
      severity: 'LOW',
      isRetryable: false,
      suggestedAction: 'Validate input parameters',
      userMessage: 'Please check your input and ensure all required fields are provided.'
    }
  ]

  static classify(error: Error | string): ErrorClassification {
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined

    // Try to match against known patterns
    for (const pattern of this.ERROR_PATTERNS) {
      const regex = pattern.pattern instanceof RegExp 
        ? pattern.pattern 
        : new RegExp(pattern.pattern, 'i')

      if (regex.test(errorMessage) || (errorStack && regex.test(errorStack))) {
        return {
          type: pattern.type,
          severity: pattern.severity,
          isRetryable: pattern.isRetryable,
          suggestedAction: pattern.suggestedAction,
          userMessage: pattern.userMessage
        }
      }
    }

    // Default classification for unknown errors
    return {
      type: 'UNKNOWN',
      severity: 'MEDIUM',
      isRetryable: true,
      suggestedAction: 'Log error details and investigate',
      userMessage: 'An unexpected error occurred. Please try again or contact support.'
    }
  }
}

/**
 * Enhanced error handler with retry logic and graceful degradation
 */
export class EnhancedErrorHandler {
  private static errorCounts = new Map<string, number>()
  private static lastErrors = new Map<string, number>()

  /**
   * Execute operation with intelligent retry and error handling
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    config: Partial<RetryConfig> = {},
    fallbackOptions: FallbackOptions<T> = {}
  ): Promise<T> {
    const retryConfig: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffFactor: 2,
      retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'SERVER_ERROR'],
      ...config
    }

    let lastError: Error | null = null
    let attempt = 0

    while (attempt <= retryConfig.maxRetries) {
      try {
        const result = await operation()
        
        // Reset error count on success
        this.resetErrorCount(context.operation)
        
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        attempt++

        // Classify the error
        const classification = ErrorClassifier.classify(lastError)
        
        // Log error with context
        this.logError(lastError, context, classification, attempt)

        // Check if we should retry
        if (attempt > retryConfig.maxRetries || !classification.isRetryable) {
          break
        }

        // Calculate delay for next retry
        const delay = Math.min(
          retryConfig.baseDelayMs * Math.pow(retryConfig.backoffFactor, attempt - 1),
          retryConfig.maxDelayMs
        )

        console.log(`🔄 Retrying ${context.operation} in ${delay}ms (attempt ${attempt}/${retryConfig.maxRetries})`)
        
        await this.sleep(delay)
      }
    }

    // All retries failed, try fallback options
    if (fallbackOptions.gracefulDegradation) {
      return await this.handleGracefulDegradation(lastError!, context, fallbackOptions)
    }

    // No fallback available, throw the error
    throw lastError
  }

  /**
   * Handle graceful degradation when primary operation fails
   */
  private static async handleGracefulDegradation<T>(
    error: Error,
    context: ErrorContext,
    options: FallbackOptions<T>
  ): Promise<T> {
    console.log(`🛡️ Attempting graceful degradation for ${context.operation}`)

    // Try custom fallback first
    if (options.customFallback) {
      try {
        return await options.customFallback()
      } catch (fallbackError) {
        console.error('Custom fallback failed:', fallbackError)
      }
    }

    // Try cached data
    if (options.useCachedData && context.clientId) {
      try {
        return await this.getCachedFallback<T>(context)
      } catch (cacheError) {
        console.error('Cached fallback failed:', cacheError)
      }
    }

    // Try simplified response
    if (options.useSimplifiedResponse) {
      return this.getSimplifiedResponse<T>(context)
    }

    // No fallback worked, throw original error
    throw error
  }

  /**
   * Get cached data as fallback
   */
  private static async getCachedFallback<T>(context: ErrorContext): Promise<T> {
    const { AdvancedCacheService } = await import('../cache/advancedCacheService')
    
    if (context.operation.includes('events') && context.clientId) {
      // Try to get cached events
      const cacheKey = `events-fallback:${context.clientId}`
      const cachedEvents = await AdvancedCacheService.getGraphEvents(
        cacheKey,
        async () => {
          throw new Error('No cached data available')
        }
      )
      return cachedEvents as T
    }

    throw new Error('No cached fallback available')
  }

  /**
   * Generate simplified response as fallback
   */
  private static getSimplifiedResponse<T>(context: ErrorContext): T {
    if (context.operation.includes('events')) {
      return {
        success: true,
        events: [],
        formattedEvents: '📅 Unable to fetch events at this time. Please try again later.',
        error: 'Service temporarily unavailable'
      } as T
    }

    if (context.operation.includes('create')) {
      return {
        success: false,
        error: 'Unable to create event at this time. Please try again later.'
      } as T
    }

    // Generic fallback
    return {
      success: false,
      error: 'Service temporarily unavailable. Please try again later.'
    } as T
  }

  /**
   * Log error with comprehensive context
   */
  private static logError(
    error: Error,
    context: ErrorContext,
    classification: ErrorClassification,
    attempt: number
  ): void {
    const errorKey = `${context.operation}:${classification.type}`
    
    // Track error frequency
    const currentCount = this.errorCounts.get(errorKey) || 0
    this.errorCounts.set(errorKey, currentCount + 1)
    this.lastErrors.set(errorKey, Date.now())

    const logLevel = classification.severity === 'CRITICAL' ? 'error' 
      : classification.severity === 'HIGH' ? 'error'
      : classification.severity === 'MEDIUM' ? 'warn' 
      : 'info'

    const logData: Record<string, unknown> = {
      operation: context.operation,
      errorType: classification.type,
      severity: classification.severity,
      attempt,
      isRetryable: classification.isRetryable,
      clientId: context.clientId,
      connectionId: context.connectionId,
      errorMessage: error.message,
      suggestedAction: classification.suggestedAction,
      errorCount: currentCount + 1,
      timestamp: new Date().toISOString(),
      metadata: context.metadata
    }

    console[logLevel](`❌ ${classification.severity} Error in ${context.operation}:`, logData)

    // Alert on critical errors or high frequency
    if (classification.severity === 'CRITICAL' || currentCount > 10) {
      this.alertOnCriticalError(errorKey, logData)
    }
  }

  /**
   * Alert on critical errors (placeholder for monitoring integration)
   */
  private static alertOnCriticalError(errorKey: string, logData: Record<string, unknown>): void {
    console.error(`🚨 CRITICAL ERROR ALERT: ${errorKey}`, logData)
  }

  /**
   * Reset error count for successful operations
   */
  private static resetErrorCount(operation: string): void {
    const keysToReset = Array.from(this.errorCounts.keys())
      .filter(key => key.startsWith(`${operation}:`))
    
    keysToReset.forEach(key => {
      this.errorCounts.delete(key)
      this.lastErrors.delete(key)
    })
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export type { ErrorType, ErrorClassification, ErrorContext, RetryConfig, FallbackOptions }
