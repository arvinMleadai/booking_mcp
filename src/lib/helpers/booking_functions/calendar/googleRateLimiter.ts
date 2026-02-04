// Rate limiting wrapper for Google Calendar API
// Google Calendar API limits: 1,000,000 queries per day per project, 100 queries per 100 seconds per user

interface GoogleRateLimitState {
  requestCount: number
  windowStart: number
  windowSizeMs: number
  backoffUntil: number
}

interface GoogleRateLimitConfig {
  maxRequestsPerWindow: number
  windowSizeMs: number
  backoffMs: number
}

/**
 * Simple rate limiter for Google Calendar API
 * Google's limits are generous, but we still want to prevent bursts
 */
export class GoogleRateLimiter {
  private static instances: Map<string, GoogleRateLimiter> = new Map()
  private state: GoogleRateLimitState
  private config: GoogleRateLimitConfig

  constructor(config: Partial<GoogleRateLimitConfig> = {}) {
    this.config = {
      maxRequestsPerWindow: 90, // Conservative limit (100 per 100 seconds)
      windowSizeMs: 100 * 1000, // 100 seconds
      backoffMs: 1000, // 1 second backoff on rate limit
      ...config,
    }

    this.state = {
      requestCount: 0,
      windowStart: Date.now(),
      windowSizeMs: this.config.windowSizeMs,
      backoffUntil: 0,
    }
  }

  /**
   * Get or create rate limiter instance for a connection
   */
  static getInstance(connectionId: string): GoogleRateLimiter {
    if (!this.instances.has(connectionId)) {
      this.instances.set(connectionId, new GoogleRateLimiter())
    }
    return this.instances.get(connectionId)!
  }

  /**
   * Wait for available slot before making request
   */
  async waitForSlot(): Promise<void> {
    const now = Date.now()

    // Check if we're in backoff period
    if (now < this.state.backoffUntil) {
      const waitTime = this.state.backoffUntil - now
      console.log(`⏳ Google rate limiter: Backing off for ${waitTime}ms`)
      await this.sleep(waitTime)
    }

    // Reset window if needed
    if (now - this.state.windowStart >= this.state.windowSizeMs) {
      this.resetWindow()
    }

    // Check if we've hit the limit
    if (this.state.requestCount >= this.config.maxRequestsPerWindow) {
      const waitTime = this.state.windowSizeMs - (now - this.state.windowStart)
      if (waitTime > 0) {
        console.log(`⏳ Google rate limiter: Waiting ${waitTime}ms for window reset`)
        await this.sleep(waitTime)
        this.resetWindow()
      }
    }

    this.state.requestCount++
  }

  /**
   * Record response and handle rate limit errors
   */
  recordResponse(error: any): void {
    const now = Date.now()

    // Check for rate limit errors (429)
    if (error?.code === 429 || error?.response?.status === 429) {
      const retryAfter = this.parseRetryAfter(error)
      this.state.backoffUntil = now + (retryAfter || this.config.backoffMs)
      console.log(`⚠️ Google rate limiter: Rate limit hit, backing off until ${new Date(this.state.backoffUntil).toISOString()}`)
    }
  }

  /**
   * Reset rate limit window
   */
  private resetWindow(): void {
    this.state.requestCount = 0
    this.state.windowStart = Date.now()
  }

  /**
   * Parse retry-after header or error message
   */
  private parseRetryAfter(error: any): number | null {
    if (error?.response?.headers?.['retry-after']) {
      return parseInt(error.response.headers['retry-after'], 10) * 1000
    }
    if (error?.message?.includes('retry after')) {
      const match = error.message.match(/retry after (\d+)/i)
      if (match) {
        return parseInt(match[1], 10) * 1000
      }
    }
    return null
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

