// Unified Calendar Service - Works with any provider (Microsoft, Google, etc.)
import type { GraphCalendarConnection } from '@/types'
import { getProviderForConnection } from './providers'
import type {
  CalendarEvent,
  Calendar,
  CreateEventRequest,
  UpdateEventRequest,
  GetEventsRequest,
  GetAvailabilityRequest,
} from './providers/types'
import { AdvancedCacheService } from '../cache/advancedCacheService'
import {
  getCalendarConnectionByAgentId,
  getCalendarConnectionByClientId,
  getCalendarConnectionById,
} from './graphDatabase'

/**
 * Unified Calendar Service
 * Provides a single interface for all calendar operations regardless of provider
 */
export class CalendarService {
  /**
   * Get calendar connection for client or agent
   */
  private static async getConnection(
    clientId: number,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<GraphCalendarConnection | null> {
    // Priority 1: Explicit calendar override (board/pipeline calendar)
    if (calendarConnectionId) {
      console.log(`📅 Using explicit calendar connection: ${calendarConnectionId}`)
      return await getCalendarConnectionById(calendarConnectionId, clientId)
    }
    
    // Priority 2: Agent's assigned calendar
    if (agentId) {
      console.log(`📅 Checking agent calendar for: ${agentId}`)
      const agentCalendar = await getCalendarConnectionByAgentId(agentId, clientId)
      if (agentCalendar) {
        console.log(`✅ Using agent's calendar: ${agentCalendar.email}`)
        return agentCalendar
      }
      console.warn(`⚠️ Agent ${agentId} has no calendar assigned`)
    }
    
    // Priority 3: Client-level fallback (only if no agent specified)
    // This is the "receptionist" or default calendar
    if (!agentId) {
      console.log(`📅 Using client-level calendar (no agent specified)`)
      return await getCalendarConnectionByClientId(clientId)
    }
    
    // If agent specified but has no calendar, and no board calendar provided, return null
    console.error(`❌ No calendar found: Agent ${agentId} has no calendar, and no board calendar provided`)
    return null
  }

  /**
   * Get provider for connection
   */
  private static getProvider(connection: GraphCalendarConnection) {
    const provider = getProviderForConnection(connection)
    if (!provider) {
      throw new Error(`No provider found for calendar type: ${connection.provider_name}`)
    }
    return provider
  }

  /**
   * Get calendar events
   */
  static async getEvents(
    clientId: number,
    request: GetEventsRequest & { dateRequest?: string },
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    events?: CalendarEvent[]
    formattedEvents?: string
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      
      // Get timezone directly from database (don't need calendar connection for this)
      const timeZone = await AdvancedCacheService.getClientTimezone(clientId) || 'UTC'

      // Parse date request if provided
      let startDateTime = request.startDateTime
      let endDateTime = request.endDateTime

      if (request.dateRequest) {
        const { parseGraphDateRequest } = await import('./graphHelper')
        const dateRange = parseGraphDateRequest(request.dateRequest, timeZone)
        startDateTime = dateRange.start
        endDateTime = dateRange.end
      }

      const result = await provider.getEvents(connection, {
        ...request,
        startDateTime,
        endDateTime,
        timeZone: request.timeZone || timeZone,
      })

      if (!result.success) {
        return result
      }

      // Format events for display
      const formattedEvents = this.formatEventsAsString(result.events || [])

      return {
        success: true,
        events: result.events,
        formattedEvents,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Create calendar event
   */
  static async createEvent(
    clientId: number,
    request: CreateEventRequest,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    eventId?: string
    error?: string
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      
      // Get timezone directly from database (don't need calendar connection for this)
      const timeZone = await AdvancedCacheService.getClientTimezone(clientId) || 'UTC'

      // Check for conflicts using optimized conflict detection
      const { OptimizedConflictDetection } = await import('./optimizedConflictDetection')
      const conflictCheck = await OptimizedConflictDetection.checkForConflicts(
        connection,
        request.startDateTime,
        request.endDateTime,
        timeZone,
        undefined, // officeHours - will be passed from CalendarService.findAvailableSlots
        undefined, // agentTimezone - will be passed from CalendarService.findAvailableSlots
        clientId, // Pass clientId so it can use CalendarService
        connection.id // Ensure conflict detection fetches events from the SAME connection
      )

      // Block booking if there's ANY conflict
      if (conflictCheck.hasConflict) {
        // Try to find available slots as alternatives
        const availableSlotsResult = await OptimizedConflictDetection.findAvailableSlots(
          connection,
          request.startDateTime,
          request.endDateTime,
          timeZone,
          {
            durationMinutes: Math.round(
              (new Date(request.endDateTime).getTime() - new Date(request.startDateTime).getTime()) / (1000 * 60)
            ) || 30,
            maxSuggestions: 3,
          },
          clientId,
          undefined,
          connection.id
        )

        return {
          success: false,
          error: `Scheduling conflict detected: ${conflictCheck.conflictDetails || 'Time slot is already booked'}`,
          availableSlots: availableSlotsResult.availableSlots?.map(slot => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            confidence: slot.confidence,
          })),
        }
      }

      const result = await provider.createEvent(connection, {
        ...request,
        timeZone,
      })

      if (!result.success) {
        return result
      }

      // Invalidate cache
      if (result.event) {
        const eventDate = new Date(request.startDateTime).toISOString().split('T')[0]
        await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id, eventDate)
      }

      return {
        success: true,
        event: result.event,
        eventId: result.event?.id,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update calendar event
   */
  static async updateEvent(
    clientId: number,
    eventId: string,
    request: UpdateEventRequest,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      
      // Get timezone directly from database (don't need calendar connection for this)
      const timeZone = await AdvancedCacheService.getClientTimezone(clientId) || 'UTC'

      const result = await provider.updateEvent(connection, eventId, {
        ...request,
        timeZone: request.timeZone || timeZone,
      })

      if (!result.success) {
        return result
      }

      // Invalidate cache
      if (request.startDateTime) {
        const eventDate = new Date(request.startDateTime).toISOString().split('T')[0]
        await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id, eventDate)
      }
      await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id)

      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Delete calendar event
   */
  static async deleteEvent(
    clientId: number,
    eventId: string,
    calendarId?: string,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      const result = await provider.deleteEvent(connection, eventId, calendarId)

      if (result.success) {
        // Invalidate cache
        await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id)
      }

      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get calendars
   */
  static async getCalendars(
    clientId: number,
    agentId?: string
  ): Promise<{
    success: boolean
    calendars?: Calendar[]
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      return await provider.getCalendars(connection)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get availability
   */
  static async getAvailability(
    clientId: number,
    request: GetAvailabilityRequest,
    agentId?: string
  ): Promise<{
    success: boolean
    availability?: Array<{
      email: string
      slots: Array<{
        start: string
        end: string
        status: 'free' | 'busy' | 'tentative' | 'outOfOffice'
      }>
    }>
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      const provider = this.getProvider(connection)
      
      // Use connection email if no emails specified
      const emails = request.emails.length > 0 ? request.emails : [connection.email]
      
      return await provider.getAvailability(connection, {
        ...request,
        emails,
      })
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check connection status
   */
  static async checkConnection(
    clientId: number,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    connected: boolean
    connectionDetails?: {
      userEmail: string
      userName: string
      provider: string
      connectedAt: string
      calendarsCount?: number
    }
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: true,
          connected: false,
          error: 'No calendar connection found',
        }
      }

      const provider = this.getProvider(connection)
      const checkResult = await provider.checkConnection(connection)

      if (!checkResult.connected) {
        return {
          success: true,
          connected: false,
          error: checkResult.error,
        }
      }

      // Get calendars count
      const calendarsResult = await provider.getCalendars(connection)
      const calendarsCount = calendarsResult.calendars?.length || 0

      return {
        success: true,
        connected: true,
        connectionDetails: {
          userEmail: connection.email,
          userName: connection.display_name,
          provider: connection.provider_name,
          connectedAt: connection.created_at,
          calendarsCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Find available slots (conflict detection)
   */
  static async findAvailableSlots(
    clientId: number,
    requestedStartTime: string,
    requestedEndTime: string,
    options: {
      durationMinutes?: number
      maxSuggestions?: number
      officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null
      agentTimezone?: string
    } = {},
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    success: boolean
    hasConflict: boolean
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    conflictDetails?: string
    error?: string
  }> {
    try {
      const connection = await this.getConnection(clientId, agentId, calendarConnectionId)
      if (!connection) {
        return {
          success: false,
          hasConflict: false,
          error: 'No calendar connection found. Please connect a calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          hasConflict: false,
          error: 'Calendar connection is not active. Please reconnect your calendar.',
        }
      }

      // Use optimized conflict detection if available
      const { OptimizedConflictDetection } = await import('./optimizedConflictDetection')
      
      // Get timezone directly from database (don't need calendar connection for this)
      // Use agent timezone if provided, otherwise get from client database
      const timeZone = options.agentTimezone || await AdvancedCacheService.getClientTimezone(clientId) || 'UTC'

      const result = await OptimizedConflictDetection.findAvailableSlots(
        connection,
        requestedStartTime,
        requestedEndTime,
        timeZone,
        {
          durationMinutes: options.durationMinutes || 30,
          maxSuggestions: options.maxSuggestions || 3,
          officeHours: options.officeHours,
          agentTimezone: options.agentTimezone || timeZone,
          // Use a reasonable search window (4 hours default, or full day if office hours violation)
          searchWindowHours: 4,
        },
        clientId,
        agentId,
        connection.id
      )

      return {
        success: true,
        hasConflict: result.hasConflict,
        availableSlots: result.availableSlots?.map(slot => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          startFormatted: slot.startFormatted,
          endFormatted: slot.endFormatted,
          confidence: slot.confidence,
        })),
        conflictDetails: result.conflictDetails,
      }
    } catch (error) {
      return {
        success: false,
        hasConflict: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Private helper methods
  private static async checkConflicts(
    connection: GraphCalendarConnection,
    startDateTime: string,
    endDateTime: string,
    timeZone: string
  ): Promise<{
    hasConflict: boolean
    conflictDetails?: string
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
  }> {
    try {
      const provider = this.getProvider(connection)
      const eventsResult = await provider.getEvents(connection, {
        startDateTime,
        endDateTime,
        timeZone,
      })

      if (!eventsResult.success || !eventsResult.events) {
        return { hasConflict: false }
      }

      const conflicts = eventsResult.events.filter(event => !event.isCancelled)
      
      if (conflicts.length > 0) {
        return {
          hasConflict: true,
          conflictDetails: `Found ${conflicts.length} conflicting event(s)`,
        }
      }

      return { hasConflict: false }
    } catch {
      return { hasConflict: false }
    }
  }

  private static formatEventsAsString(events: CalendarEvent[]): string {
    if (events.length === 0) {
      return '📅 No events found for the specified time period.'
    }

    let output = `📅 **${events.length} Event(s)**\n\n`

    events.forEach((event, index) => {
      const startDate = new Date(event.start.dateTime)
      const endDate = new Date(event.end.dateTime)
      
      const formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      
      const startTime = startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      
      const endTime = endDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })

      output += `**${index + 1}. ${event.subject || 'Untitled'}**\n`
      output += `📅 ${formattedDate} • 🕐 ${startTime}-${endTime}\n`
      
      if (event.location) {
        output += `📍 ${event.location}\n`
      }
      
      if (event.onlineMeetingUrl) {
        output += `💻 Meeting: ${event.onlineMeetingUrl}\n`
      }
      
      if (event.attendees && event.attendees.length > 0) {
        const attendeeNames = event.attendees
          .filter(a => a.email !== event.organizer?.email)
          .map(a => a.name || a.email)
        if (attendeeNames.length > 0) {
          output += `👤 ${attendeeNames[0]}${attendeeNames.length > 1 ? ` +${attendeeNames.length - 1} more` : ''}\n`
        }
      }
      
      output += `🆔 ${event.id}\n\n`
    })

    return output.trim()
  }
}

