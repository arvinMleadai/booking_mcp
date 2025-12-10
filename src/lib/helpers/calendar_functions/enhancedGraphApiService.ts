// Enhanced Microsoft Graph API service with all optimizations
import type {
  GraphCalendarConnection,
  GraphEvent,
  GraphEventsListResponse,
  CreateGraphEventRequest
} from '@/types'
import { makeGraphRequest } from './graphHelper'
import { AdaptiveRateLimiter, SmartRequestBatcher } from './adaptiveRateLimiter'
import { EnhancedErrorHandler, ErrorClassifier } from './enhancedErrorHandler'
import { AdvancedCacheService } from '../cache/advancedCacheService'

interface BatchRequest {
  id: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: unknown
}

interface RequestMetrics {
  operation: string
  startTime: number
  endTime: number
  success: boolean
  cacheHit: boolean
  retryCount: number
}

/**
 * Enhanced Microsoft Graph API service with comprehensive optimizations
 */
export class EnhancedGraphApiService {
  private static rateLimiter = new AdaptiveRateLimiter({
    initialLimit: 100,
    maxLimit: 1000,
    minLimit: 10,
    windowSizeMs: 60 * 1000,
    adaptationFactor: 0.1
  })

  private static batcher = new SmartRequestBatcher<BatchRequest>({
    maxBatchSize: 20,
    maxBatchSizeBytes: 1024 * 1024, // 1MB
    maxWaitTimeMs: 100
  })

  private static metrics: RequestMetrics[] = []
  private static readonly maxMetricsHistory = 1000

  // Optimized field sets for different use cases
  private static readonly FIELD_SETS = {
    MINIMAL: 'id,subject,start,end,isCancelled',
    STANDARD: 'id,subject,body,start,end,location,attendees,organizer,isAllDay,isCancelled,onlineMeeting,webLink',
    FULL: 'id,subject,body,start,end,location,attendees,organizer,isAllDay,isCancelled,importance,showAs,responseStatus,onlineMeeting,createdDateTime,lastModifiedDateTime,webLink,categories,sensitivity'
  }

  /**
   * Get events with full optimization stack
   */
  static async getEventsOptimized(
    connection: GraphCalendarConnection,
    options: {
      calendarId?: string
      startDateTime?: string
      endDateTime?: string
      fieldSet?: keyof typeof EnhancedGraphApiService.FIELD_SETS
      timeZone?: string
      maxResults?: number
      useCache?: boolean
    } = {}
  ): Promise<GraphEventsListResponse> {
    const startTime = Date.now()
    let cacheHit = false
    let retryCount = 0

    const {
      calendarId = 'primary',
      startDateTime,
      endDateTime,
      fieldSet = 'STANDARD',
      timeZone,
      maxResults = 250, // eslint-disable-line @typescript-eslint/no-unused-vars
      useCache = true
    } = options

    // Generate cache key
    const cacheKey = `enhanced-events:${connection.id}:${calendarId}:${startDateTime}:${endDateTime}:${fieldSet}:${timeZone}`

    try {
      // Try cache first if enabled
      if (useCache) {
        const cachedResult = await AdvancedCacheService.getGraphEvents(
          cacheKey,
          async () => {
            throw new Error('Cache miss')
          },
          2 * 60 // 2 minutes TTL
        ).catch(() => null)

        if (cachedResult) {
          cacheHit = true
          this.recordMetrics('getEvents', startTime, Date.now(), true, cacheHit, retryCount)
          return cachedResult as GraphEventsListResponse
        }
      }

      // Execute with enhanced error handling
      const result = await EnhancedErrorHandler.executeWithRetry(
        async () => {
          retryCount++
          return await this.fetchEventsWithRateLimit(connection, options)
        },
        {
          operation: 'getEventsOptimized',
          clientId: connection.client_id,
          connectionId: connection.id,
          timestamp: Date.now(),
          metadata: { calendarId, fieldSet, timeZone }
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          backoffFactor: 2
        },
        {
          gracefulDegradation: true,
          useCachedData: true,
          useSimplifiedResponse: true
        }
      )

      // Cache successful result
      if (useCache && result.success) {
        await AdvancedCacheService.getGraphEvents(
          cacheKey,
          async () => result,
          2 * 60 // 2 minutes TTL
        )
      }

      this.recordMetrics('getEvents', startTime, Date.now(), result.success, cacheHit, retryCount - 1)
      return result

    } catch (error) {
      this.recordMetrics('getEvents', startTime, Date.now(), false, cacheHit, retryCount - 1)
      
      const classification = ErrorClassifier.classify(error instanceof Error ? error : new Error(String(error)))
      
      return {
        success: false,
        error: classification.userMessage,
        details: { 
          originalError: error instanceof Error ? error.message : String(error),
          classification 
        }
      }
    }
  }

  /**
   * Fetch events with rate limiting
   */
  private static async fetchEventsWithRateLimit(
    connection: GraphCalendarConnection,
    options: {
      calendarId?: string
      startDateTime?: string
      endDateTime?: string
      fieldSet?: keyof typeof EnhancedGraphApiService.FIELD_SETS
      timeZone?: string
      maxResults?: number
    }
  ): Promise<GraphEventsListResponse> {
    const {
      calendarId = 'primary',
      startDateTime,
      endDateTime,
      fieldSet = 'STANDARD',
      timeZone,
      maxResults = 250
    } = options

    // Wait for rate limiter
    await this.rateLimiter.waitForSlot()

    // Build endpoint
    let endpoint = calendarId === 'primary' 
      ? '/me/events' 
      : `/me/calendars/${calendarId}/events`

    const params = new URLSearchParams()
    
    // Use calendarView for date-based queries
    if (startDateTime && endDateTime) {
      endpoint = endpoint.replace('/events', '/calendarView')
      params.append('startDateTime', startDateTime)
      params.append('endDateTime', endDateTime)
    }
    
    // Use optimized field selection
    params.append('$select', this.FIELD_SETS[fieldSet])
    params.append('$orderby', 'start/dateTime')
    params.append('$top', maxResults.toString())

    if (params.toString()) {
      endpoint += `?${params.toString()}`
    }

    console.log(`🔍 Enhanced Graph request: ${fieldSet} fields, max ${maxResults} results`)

    const requestStart = Date.now()
    const response = await makeGraphRequest(connection, endpoint, {}, timeZone)
    const requestDuration = Date.now() - requestStart

    // Record response for rate limiter
    this.rateLimiter.recordResponse(response, requestDuration)
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    const events: GraphEvent[] = data.value || []

    return {
      success: true,
      events,
      nextLink: data['@odata.nextLink']
    }
  }

  /**
   * Create event with enhanced error handling
   */
  static async createEventOptimized(
    connection: GraphCalendarConnection,
    eventData: CreateGraphEventRequest,
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; event?: GraphEvent; error?: string }> {
    const startTime = Date.now()
    let retryCount = 0

    try {
      const result = await EnhancedErrorHandler.executeWithRetry(
        async () => {
          retryCount++
          return await this.createEventWithRateLimit(connection, eventData, calendarId)
        },
        {
          operation: 'createEventOptimized',
          clientId: connection.client_id,
          connectionId: connection.id,
          timestamp: Date.now(),
          metadata: { calendarId, subject: eventData.subject }
        },
        {
          maxRetries: 2, // Fewer retries for create operations
          baseDelayMs: 1000,
          backoffFactor: 2
        },
        {
          gracefulDegradation: false // Don't use fallback for create operations
        }
      )

      // Invalidate related cache entries
      await AdvancedCacheService.invalidateConnection(connection.id)

      this.recordMetrics('createEvent', startTime, Date.now(), true, false, retryCount - 1)
      return result

    } catch (error) {
      this.recordMetrics('createEvent', startTime, Date.now(), false, false, retryCount - 1)
      
      const classification = ErrorClassifier.classify(error instanceof Error ? error : new Error(String(error)))
      
      return {
        success: false,
        error: classification.userMessage
      }
    }
  }

  /**
   * Create event with rate limiting
   */
  private static async createEventWithRateLimit(
    connection: GraphCalendarConnection,
    eventData: CreateGraphEventRequest,
    calendarId: string
  ): Promise<{ success: boolean; event?: GraphEvent; error?: string }> {
    // Wait for rate limiter
    await this.rateLimiter.waitForSlot()

    const endpoint = calendarId === 'primary' 
      ? '/me/events' 
      : `/me/calendars/${calendarId}/events`

    const requestStart = Date.now()
    const response = await makeGraphRequest(connection, endpoint, {
      method: 'POST',
      body: JSON.stringify(eventData)
    })
    const requestDuration = Date.now() - requestStart

    // Record response for rate limiter
    this.rateLimiter.recordResponse(response, requestDuration)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
    }

    const event: GraphEvent = await response.json()
    return {
      success: true,
      event
    }
  }

  /**
   * Update event with enhanced error handling
   */
  static async updateEventOptimized(
    connection: GraphCalendarConnection,
    eventId: string,
    eventData: Partial<CreateGraphEventRequest>,
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; event?: GraphEvent; error?: string }> {
    const startTime = Date.now()
    let retryCount = 0

    try {
      const result = await EnhancedErrorHandler.executeWithRetry(
        async () => {
          retryCount++
          return await this.updateEventWithRateLimit(connection, eventId, eventData, calendarId)
        },
        {
          operation: 'updateEventOptimized',
          clientId: connection.client_id,
          connectionId: connection.id,
          timestamp: Date.now(),
          metadata: { calendarId, eventId }
        },
        {
          maxRetries: 2,
          baseDelayMs: 1000,
          backoffFactor: 2
        }
      )

      // Invalidate related cache entries
      await AdvancedCacheService.invalidateConnection(connection.id)

      this.recordMetrics('updateEvent', startTime, Date.now(), true, false, retryCount - 1)
      return result

    } catch (error) {
      this.recordMetrics('updateEvent', startTime, Date.now(), false, false, retryCount - 1)
      
      const classification = ErrorClassifier.classify(error instanceof Error ? error : new Error(String(error)))
      
      return {
        success: false,
        error: classification.userMessage
      }
    }
  }

  /**
   * Update event with rate limiting
   */
  private static async updateEventWithRateLimit(
    connection: GraphCalendarConnection,
    eventId: string,
    eventData: Partial<CreateGraphEventRequest>,
    calendarId: string
  ): Promise<{ success: boolean; event?: GraphEvent; error?: string }> {
    // Wait for rate limiter
    await this.rateLimiter.waitForSlot()

    const endpoint = calendarId === 'primary' 
      ? `/me/events/${eventId}` 
      : `/me/calendars/${calendarId}/events/${eventId}`

    const updateEndpoint = `${endpoint}?sendNotifications=true`

    const requestStart = Date.now()
    const response = await makeGraphRequest(connection, updateEndpoint, {
      method: 'PATCH',
      body: JSON.stringify(eventData)
    })
    const requestDuration = Date.now() - requestStart

    // Record response for rate limiter
    this.rateLimiter.recordResponse(response, requestDuration)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
    }

    const event: GraphEvent = await response.json()

    return {
      success: true,
      event
    }
  }

  /**
   * Delete event with enhanced error handling
   */
  static async deleteEventOptimized(
    connection: GraphCalendarConnection,
    eventId: string,
    calendarId: string = 'primary'
  ): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now()
    let retryCount = 0

    try {
      await EnhancedErrorHandler.executeWithRetry(
        async () => {
          retryCount++
          return await this.deleteEventWithRateLimit(connection, eventId, calendarId)
        },
        {
          operation: 'deleteEventOptimized',
          clientId: connection.client_id,
          connectionId: connection.id,
          timestamp: Date.now(),
          metadata: { calendarId, eventId }
        },
        {
          maxRetries: 2,
          baseDelayMs: 1000,
          backoffFactor: 2
        }
      )

      // Invalidate related cache entries
      await AdvancedCacheService.invalidateConnection(connection.id)

      this.recordMetrics('deleteEvent', startTime, Date.now(), true, false, retryCount - 1)
      return { success: true }

    } catch (error) {
      this.recordMetrics('deleteEvent', startTime, Date.now(), false, false, retryCount - 1)
      
      const classification = ErrorClassifier.classify(error instanceof Error ? error : new Error(String(error)))
      
      return {
        success: false,
        error: classification.userMessage
      }
    }
  }

  /**
   * Delete event with rate limiting
   */
  private static async deleteEventWithRateLimit(
    connection: GraphCalendarConnection,
    eventId: string,
    calendarId: string
  ): Promise<void> {
    // Wait for rate limiter
    await this.rateLimiter.waitForSlot()

    const endpoint = calendarId === 'primary' 
      ? `/me/events/${eventId}` 
      : `/me/calendars/${calendarId}/events/${eventId}`

    const deleteEndpoint = `${endpoint}?sendNotifications=true`

    const requestStart = Date.now()
    const response = await makeGraphRequest(connection, deleteEndpoint, {
      method: 'DELETE'
    })
    const requestDuration = Date.now() - requestStart

    // Record response for rate limiter
    this.rateLimiter.recordResponse(response, requestDuration)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
    }
  }

  /**
   * Record performance metrics
   */
  private static recordMetrics(
    operation: string,
    startTime: number,
    endTime: number,
    success: boolean,
    cacheHit: boolean,
    retryCount: number
  ): void {
    this.metrics.push({
      operation,
      startTime,
      endTime,
      success,
      cacheHit,
      retryCount
    })

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory)
    }
  }

  /**
   * Reset all statistics (for maintenance)
   */
  static resetStats(): void {
    this.metrics = []
    this.rateLimiter.reset()
  }
}

export default EnhancedGraphApiService
