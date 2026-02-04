// Adaptive rate limiting for Microsoft Graph API
interface RateLimitState {
  currentLimit: number
  requestCount: number
  windowStart: number
  windowSizeMs: number
  backoffUntil: number
  consecutiveErrors: number
}

interface RateLimitConfig {
  initialLimit: number
  maxLimit: number
  minLimit: number
  windowSizeMs: number
  backoffMultiplier: number
  maxBackoffMs: number
  adaptationFactor: number
}

interface RequestMetrics {
  timestamp: number
  duration: number
  status: number
  retryAfter?: number
}

/**
 * Adaptive rate limiter that adjusts limits based on API responses
 */
export class AdaptiveRateLimiter {
  private state: RateLimitState
  private config: RateLimitConfig
  private metrics: RequestMetrics[] = []
  private readonly maxMetricsHistory = 100

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      initialLimit: 100,
      maxLimit: 1000,
      minLimit: 10,
      windowSizeMs: 60 * 1000, // 1 minute
      backoffMultiplier: 2,
      maxBackoffMs: 5 * 60 * 1000, // 5 minutes
      adaptationFactor: 0.1,
      ...config
    }

    this.state = {
      currentLimit: this.config.initialLimit,
      requestCount: 0,
      windowStart: Date.now(),
      windowSizeMs: this.config.windowSizeMs,
      backoffUntil: 0,
      consecutiveErrors: 0
    }
  }

  /**
   * Wait for available slot before making request
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now()

    // Check if we're in backoff period
    if (now < this.state.backoffUntil) {
      const waitTime = this.state.backoffUntil - now
      console.log(`⏳ Rate limiter: Backing off for ${waitTime}ms`)
      await this.sleep(waitTime)
    }

    // Reset window if needed
    if (now - this.state.windowStart >= this.state.windowSizeMs) {
      this.resetWindow()
    }

    // Check if we've hit the limit
    if (this.state.requestCount >= this.state.currentLimit) {
      const waitTime = this.state.windowSizeMs - (now - this.state.windowStart)
      if (waitTime > 0) {
        console.log(`⏳ Rate limiter: Waiting ${waitTime}ms for window reset`)
        await this.sleep(waitTime)
        this.resetWindow()
      }
    }

    this.state.requestCount++
  }

  /**
   * Record response and adjust rate limits
   */
  recordResponse(response: Response, duration: number): void {
    const now = Date.now()
    const retryAfter = this.parseRetryAfter(response)

    // Store metrics
    this.metrics.push({
      timestamp: now,
      duration,
      status: response.status,
      retryAfter
    })

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory)
    }

    // Adjust rate limits based on response
    this.adjustRateLimit(response, retryAfter)
  }

  private adjustRateLimit(response: Response, retryAfter?: number): void {
    if (response.status === 429) {
      // Rate limited - reduce limit and set backoff
      this.handleRateLimit(retryAfter)
    } else if (response.status >= 500) {
      // Server error - moderate reduction
      this.handleServerError()
    } else if (response.ok) {
      // Success - gradually increase limit
      this.handleSuccess()
    } else if (response.status >= 400) {
      // Client error - slight reduction
      this.handleClientError()
    }

    // Ensure limits stay within bounds
    this.state.currentLimit = Math.max(
      this.config.minLimit,
      Math.min(this.config.maxLimit, this.state.currentLimit)
    )

    console.log(`📊 Rate limiter: Status ${response.status}, Limit: ${this.state.currentLimit}`)
  }

  private handleRateLimit(retryAfter?: number): void {
    this.state.consecutiveErrors++
    
    // Aggressive reduction for rate limits
    this.state.currentLimit = Math.floor(this.state.currentLimit * 0.5)
    
    // Set backoff period
    const backoffTime = retryAfter 
      ? retryAfter * 1000 
      : Math.min(
          1000 * Math.pow(this.config.backoffMultiplier, this.state.consecutiveErrors),
          this.config.maxBackoffMs
        )
    
    this.state.backoffUntil = Date.now() + backoffTime
    
    console.log(`🚨 Rate limited! Reduced limit to ${this.state.currentLimit}, backing off for ${backoffTime}ms`)
  }

  private handleServerError(): void {
    this.state.consecutiveErrors++
    
    // Moderate reduction for server errors
    this.state.currentLimit = Math.floor(this.state.currentLimit * 0.8)
    
    // Short backoff
    this.state.backoffUntil = Date.now() + (1000 * this.state.consecutiveErrors)
    
    console.log(`⚠️ Server error! Reduced limit to ${this.state.currentLimit}`)
  }

  private handleClientError(): void {
    // Slight reduction for client errors (might be temporary)
    this.state.currentLimit = Math.floor(this.state.currentLimit * 0.95)
  }

  private handleSuccess(): void {
    // Reset consecutive errors
    this.state.consecutiveErrors = 0
    
    // Gradually increase limit if we're consistently successful
    const recentSuccessRate = this.getRecentSuccessRate()
    
    if (recentSuccessRate > 0.9 && this.state.currentLimit < this.config.maxLimit) {
      // Conservative increase
      const increase = Math.max(1, Math.floor(this.state.currentLimit * this.config.adaptationFactor))
      this.state.currentLimit += increase
      
      console.log(`✅ High success rate (${(recentSuccessRate * 100).toFixed(1)}%), increased limit to ${this.state.currentLimit}`)
    }
  }

  private getRecentSuccessRate(): number {
    const recentMetrics = this.metrics.filter(m => 
      Date.now() - m.timestamp < this.config.windowSizeMs
    )
    
    if (recentMetrics.length === 0) return 1
    
    const successCount = recentMetrics.filter(m => m.status >= 200 && m.status < 300).length
    return successCount / recentMetrics.length
  }

  private parseRetryAfter(response: Response): number | undefined {
    const retryAfter = response.headers.get('Retry-After')
    if (!retryAfter) return undefined
    
    const seconds = parseInt(retryAfter, 10)
    return isNaN(seconds) ? undefined : seconds
  }

  private resetWindow(): void {
    this.state.windowStart = Date.now()
    this.state.requestCount = 0
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): {
    currentLimit: number
    requestCount: number
    windowProgress: number
    isInBackoff: boolean
    backoffTimeRemaining: number
    consecutiveErrors: number
    recentSuccessRate: number
    averageResponseTime: number
  } {
    const now = Date.now()
    const windowProgress = (now - this.state.windowStart) / this.state.windowSizeMs
    const isInBackoff = now < this.state.backoffUntil
    const backoffTimeRemaining = Math.max(0, this.state.backoffUntil - now)
    
    const recentMetrics = this.metrics.filter(m => 
      now - m.timestamp < this.config.windowSizeMs
    )
    
    const averageResponseTime = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length
      : 0

    return {
      currentLimit: this.state.currentLimit,
      requestCount: this.state.requestCount,
      windowProgress,
      isInBackoff,
      backoffTimeRemaining,
      consecutiveErrors: this.state.consecutiveErrors,
      recentSuccessRate: this.getRecentSuccessRate(),
      averageResponseTime
    }
  }

  /**
   * Reset rate limiter to initial state
   */
  reset(): void {
    this.state = {
      currentLimit: this.config.initialLimit,
      requestCount: 0,
      windowStart: Date.now(),
      windowSizeMs: this.config.windowSizeMs,
      backoffUntil: 0,
      consecutiveErrors: 0
    }
    this.metrics = []
  }
}

/**
 * Smart request batcher that groups requests efficiently
 */
export class SmartRequestBatcher<T> {
  private pendingRequests: Array<{
    id: string
    request: T
    resolve: (value: T[]) => void
    reject: (error: Error) => void
    timestamp: number
    estimatedSize: number
  }> = []

  private batchTimer?: NodeJS.Timeout
  private readonly maxBatchSize: number
  private readonly maxBatchSizeBytes: number
  private readonly maxWaitTimeMs: number

  constructor(options: {
    maxBatchSize?: number
    maxBatchSizeBytes?: number
    maxWaitTimeMs?: number
  } = {}) {
    this.maxBatchSize = options.maxBatchSize || 20
    this.maxBatchSizeBytes = options.maxBatchSizeBytes || 1024 * 1024 // 1MB
    this.maxWaitTimeMs = options.maxWaitTimeMs || 100 // 100ms
  }

  /**
   * Add request to batch
   */
  async addRequest(id: string, request: T): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const estimatedSize = this.estimateRequestSize(request)
      
      this.pendingRequests.push({
        id,
        request,
        resolve,
        reject,
        timestamp: Date.now(),
        estimatedSize
      })

      // Check if we should flush immediately
      if (this.shouldFlushBatch()) {
        this.flushBatch()
      } else if (!this.batchTimer) {
        // Set timer for automatic flush
        this.batchTimer = setTimeout(() => {
          this.flushBatch()
        }, this.maxWaitTimeMs)
      }
    })
  }

  private shouldFlushBatch(): boolean {
    if (this.pendingRequests.length >= this.maxBatchSize) {
      return true
    }

    const totalSize = this.pendingRequests.reduce((sum, req) => sum + req.estimatedSize, 0)
    if (totalSize >= this.maxBatchSizeBytes) {
      return true
    }

    return false
  }

  private flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = undefined
    }

    if (this.pendingRequests.length === 0) {
      return
    }

    const batch = this.pendingRequests.splice(0)
    const requests = batch.map(item => item.request)

    // For now, resolve each request with the full batch
    // In a real implementation, you'd process the batch and return individual results
    batch.forEach(item => {
      try {
        item.resolve(requests)
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error('Batch processing failed'))
      }
    })

    console.log(`📦 Processed batch of ${batch.length} requests`)
  }

  private estimateRequestSize(request: T): number {
    try {
      return JSON.stringify(request).length * 2 // UTF-16 approximation
    } catch {
      return 1024 // Default 1KB
    }
  }

  /**
   * Get batcher statistics
   */
  getStats(): {
    pendingRequests: number
    totalPendingSize: number
    hasPendingTimer: boolean
  } {
    const totalPendingSize = this.pendingRequests.reduce((sum, req) => sum + req.estimatedSize, 0)
    
    return {
      pendingRequests: this.pendingRequests.length,
      totalPendingSize,
      hasPendingTimer: !!this.batchTimer
    }
  }
}

export default AdaptiveRateLimiter
