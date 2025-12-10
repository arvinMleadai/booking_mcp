// Final optimized calendar operations with all enhancements
import type {
  GraphEvent,
  CreateGraphEventRequest,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
} from '@/types'

import { AdvancedCacheService } from '../cache/advancedCacheService'
import { EnhancedGraphApiService } from './enhancedGraphApiService'
import { OptimizedConflictDetection } from './optimizedConflictDetection'
import { parseGraphDateRequest, formatGraphEventsAsString } from './graphHelper'

/**
 * Final optimized calendar operations with all performance enhancements
 */
export class FinalOptimizedCalendarOperations {

  /**
   * Get calendar events with full optimization stack
   */
  static async getCalendarEventsForClient(
    clientId: number,
    request: GetGraphEventsRequest
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    try {
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      // Parse date request if provided
      let startDateTime: string | undefined
      let endDateTime: string | undefined
      
      if (request.dateRequest) {
        const dateRange = parseGraphDateRequest(request.dateRequest, timezone)
        startDateTime = dateRange.start
        endDateTime = dateRange.end
      } else if (request.startDate && request.endDate) {
        startDateTime = request.startDate
        endDateTime = request.endDate
      }

      // Use enhanced Graph API with comprehensive optimizations
      const eventsResponse = await EnhancedGraphApiService.getEventsOptimized(connection, {
        calendarId: request.calendarId || 'primary',
        startDateTime,
        endDateTime,
        fieldSet: 'STANDARD',
        timeZone: timezone,
        maxResults: 100,
        useCache: true
      })

      if (!eventsResponse.success) {
        return {
          success: false,
          error: eventsResponse.error
        }
      }

      const events = eventsResponse.events || []
      const formattedEvents = formatGraphEventsAsString(events)

      return {
        success: true,
        events,
        formattedEvents
      }
    } catch (error) {
      console.error('Error in final optimized getCalendarEventsForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Create calendar event with full optimization and enhanced conflict detection
   */
  static async createCalendarEventForClient(
    clientId: number,
    request: CreateGraphEventMCPRequest
  ): Promise<{
    success: boolean
    event?: GraphEvent
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
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone, agentOfficeHours, agentTimezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      // Use optimized conflict detection with office hours validation
      const conflictResult = await OptimizedConflictDetection.findAvailableSlots(
        connection,
        request.startDateTime,
        request.endDateTime,
        timezone,
        {
          durationMinutes: 60,
          maxSuggestions: 3,
          officeHours: agentOfficeHours,
          agentTimezone: agentTimezone || timezone,
          searchWindowHours: 4 // Optimized search window
        }
      )

      if (conflictResult.hasConflict && conflictResult.availableSlots) {
        let errorMessage = `Scheduling conflict detected: ${conflictResult.conflictDetails}`
        
        if (conflictResult.availableSlots.length > 0) {
          errorMessage += `\n\nSuggested available time slots:\n`
          conflictResult.availableSlots.forEach((slot, index) => {
            errorMessage += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`
          })
          errorMessage += `\nPlease choose one of these available slots or suggest a different time.`
        }
        
        return {
          success: false,
          error: errorMessage,
          availableSlots: conflictResult.availableSlots.map(slot => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            confidence: slot.confidence
          }))
        }
      }

      // Prepare event data
      const eventData: CreateGraphEventRequest = {
        subject: request.subject,
        start: {
          dateTime: request.startDateTime,
          timeZone: timezone,
        },
        end: {
          dateTime: request.endDateTime,
          timeZone: timezone,
        },
        organizer: {
          emailAddress: {
            name: connection.display_name || connection.email,
            address: connection.email
          }
        },
        attendees: [
          // Add organizer as attendee to receive notifications
          {
            type: 'required',
            emailAddress: {
              name: connection.display_name || connection.email,
              address: connection.email,
            },
            status: {
              response: 'organizer',
              time: new Date().toISOString()
            }
          },
          // Add the actual attendee
          {
            type: 'required',
            emailAddress: {
              name: request.attendeeName,
              address: request.attendeeEmail,
            },
            status: {
              response: 'none',
              time: new Date().toISOString()
            }
          }
        ],
        responseRequested: true,
      }

      // Add optional fields
      if (request.description) {
        eventData.body = {
          contentType: 'text',
          content: request.description,
        }
      }

      if (request.location) {
        eventData.location = {
          displayName: request.location,
        }
      }

      if (request.isOnlineMeeting) {
        eventData.isOnlineMeeting = true
        eventData.onlineMeetingProvider = 'teamsForBusiness'
        
        // Add Teams meeting information to the body if not already present
        const teamsInfo = '\n\nJoin the meeting from your calendar or use the Teams app.\n'
        if (eventData.body) {
          eventData.body.content += teamsInfo
        } else {
          eventData.body = {
            contentType: 'html',
            content: `<p>Meeting details:</p>${teamsInfo.replace(/\n/g, '<br>')}`
          }
        }
      } 

      // Create event using enhanced Graph API service
      const eventResponse = await EnhancedGraphApiService.createEventOptimized(
        connection,
        eventData,
        request.calendarId || 'primary'
      )

      if (!eventResponse.success) {
        return {
          success: false,
          error: eventResponse.error,
        }
      }

      // Invalidate busy periods cache after successful event creation
      const eventDate = new Date(request.startDateTime).toISOString().split('T')[0]
      await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id, eventDate)

      return {
        success: true,
        event: eventResponse.event,
        eventId: eventResponse.event?.id,
      }
    } catch (error) {
      console.error('Error in final optimized createCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update calendar event with enhanced error handling
   */
  static async updateCalendarEventForClient(
    clientId: number,
    eventId: string,
    updates: Partial<CreateGraphEventMCPRequest>
  ): Promise<{
    success: boolean
    event?: GraphEvent
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Updating calendar event ${eventId} for client ${clientId}`)
      
      // Get calendar connection with advanced caching
      const connection = await AdvancedCacheService.getCalendarConnection(clientId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Prepare update data
      const updateData: Partial<CreateGraphEventRequest> = {}

      if (updates.subject) {
        updateData.subject = updates.subject
      }

      if (updates.startDateTime && updates.endDateTime) {
        // Get client's timezone from cache
        const clientTimezone = await AdvancedCacheService.getClientTimezone(clientId)
        if (clientTimezone) {
          updateData.start = {
            dateTime: updates.startDateTime,
            timeZone: clientTimezone,
          }
          updateData.end = {
            dateTime: updates.endDateTime,
            timeZone: clientTimezone,
          }
        }
      }

      if (updates.description) {
        updateData.body = {
          contentType: 'text',
          content: updates.description,
        }
      }

      if (updates.location) {
        updateData.location = {
          displayName: updates.location,
        }
      }

      if (updates.attendeeEmail) {
        updateData.attendees = [{
          type: 'required',
          emailAddress: {
            name: updates.attendeeName,
            address: updates.attendeeEmail,
          },
        }]
      }

      // Update event using enhanced Graph API service
      const eventResponse = await EnhancedGraphApiService.updateEventOptimized(
        connection,
        eventId,
        updateData,
        updates.calendarId || 'primary'
      )

      if (!eventResponse.success) {
        return {
          success: false,
          error: eventResponse.error,
        }
      }

      console.log(`✅ FINAL OPTIMIZED: Updated event ${eventId} for client ${clientId}`)

      // Invalidate busy periods cache after successful event update
      // Invalidate both old and new dates if time was changed
      if (updates.startDateTime) {
        const newEventDate = new Date(updates.startDateTime).toISOString().split('T')[0]
        await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id, newEventDate)
      }
      // Also invalidate all dates for this connection to be safe
      await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id)

      return {
        success: true,
        event: eventResponse.event,
      }
    } catch (error) {
      console.error('Error in final optimized updateCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Delete calendar event with enhanced error handling
   */
  static async deleteCalendarEventForClient(
    clientId: number,
    eventId: string,
    calendarId?: string
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Deleting calendar event ${eventId} for client ${clientId}`)
      
      // Get calendar connection with advanced caching
      const connection = await AdvancedCacheService.getCalendarConnection(clientId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Validate event exists before deletion (optional check for better UX)
      try {
        const eventCheck = await EnhancedGraphApiService.getEventsOptimized(connection, {
          calendarId: calendarId || 'primary',
          fieldSet: 'MINIMAL'
        })
        
        if (eventCheck.success && eventCheck.events) {
          const eventExists = eventCheck.events.some(event => event.id === eventId)
          if (!eventExists) {
            console.log(`⚠️ Event ${eventId} not found in calendar, proceeding with deletion anyway`)
          }
        }
      } catch (checkError) {
        console.log(`⚠️ Could not verify event existence, proceeding with deletion: ${checkError}`)
      }

      // Delete event using enhanced Graph API service
      const deleteResponse = await EnhancedGraphApiService.deleteEventOptimized(
        connection,
        eventId,
        calendarId || 'primary'
      )

      if (!deleteResponse.success) {
        return {
          success: false,
          error: deleteResponse.error,
        }
      }

      console.log(`✅ FINAL OPTIMIZED: Deleted event ${eventId} for client ${clientId}`)

      // Invalidate all busy periods cache after successful event deletion
      await AdvancedCacheService.invalidateBusyPeriodsCache(connection.id)

      return {
        success: true,
      }
    } catch (error) {
      console.error('Error in final optimized deleteCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get calendars for client with enhanced optimization
   */
  static async getCalendarsForClient(clientId: number): Promise<{
    success: boolean
    calendars?: Array<{
      id: string
      name: string
      isDefault: boolean
      canEdit: boolean
      owner: string
    }>
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Getting calendars for client ${clientId}`)

      // Get client data with caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData?.connection) {
        return { success: false, error: 'Calendar connection not found' }
      }

      const { connection } = clientData

      // Get calendars using direct Graph API call
      const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        return { success: false, error: `Failed to fetch calendars: ${response.statusText}` }
      }

      const data = await response.json()
      
      // Transform calendar data
      const calendars = (data.value as Array<{
        id: string
        name: string
        isDefaultCalendar?: boolean
        canEdit?: boolean
        owner?: { name?: string; address?: string }
      }>)?.map((cal) => ({
        id: cal.id,
        name: cal.name,
        isDefault: cal.isDefaultCalendar || false,
        canEdit: cal.canEdit !== false,
        owner: cal.owner?.name || cal.owner?.address || 'Unknown'
      })) || []

      console.log(`✅ FINAL OPTIMIZED: Retrieved ${calendars.length} calendars for client ${clientId}`)
      return {
        success: true,
        calendars
      }

    } catch (error) {
      console.error('Error in final optimized getCalendarsForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  /**
   * Check client calendar connection with enhanced optimization
   */
  static async checkClientCalendarConnection(clientId: number): Promise<{
    success: boolean
    connected: boolean
    connectionDetails?: {
      userEmail: string
      userName: string
      connectedAt: string
      lastSync?: string
      calendarsCount?: number
    }
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Checking calendar connection for client ${clientId}`)

      // Get client data with caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData?.connection) {
        return {
          success: true,
          connected: false,
          error: 'No calendar connection found'
        }
      }

      const { connection } = clientData

      // Test connection by making a simple API call
      const testResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      if (!testResponse.ok) {
        return {
          success: true,
          connected: false,
          error: `Connection test failed: ${testResponse.statusText}`
        }
      }

      // Get calendars count
      const calendarsResponse = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      let calendarsCount = 0
      if (calendarsResponse.ok) {
        const calendarsData = await calendarsResponse.json()
        calendarsCount = calendarsData.value?.length || 0
      }

      console.log(`✅ FINAL OPTIMIZED: Calendar connection verified for client ${clientId}`)
      return {
        success: true,
        connected: true,
        connectionDetails: {
          userEmail: connection.email,
          userName: connection.display_name || 'Unknown',
          connectedAt: connection.created_at,
          lastSync: connection.last_sync_at || undefined,
          calendarsCount
        }
      }

    } catch (error) {
      console.error('Error in final optimized checkClientCalendarConnection:', error)
      return {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  /**
   * Get availability for client with enhanced optimization
   */
  static async getAvailabilityForClient(
    clientId: number,
    request: {
      startDate: string
      endDate: string
      emails?: string[]
      intervalInMinutes?: number
    }
  ): Promise<{
    success: boolean
    availability?: Array<{
      email: string
      availability: Array<{
        start: string
        end: string
        status: 'free' | 'busy' | 'tentative' | 'outOfOffice'
      }>
    }>
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Getting availability for client ${clientId}`)

      // Get client data with caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData?.connection) {
        return { success: false, error: 'Calendar connection not found' }
      }

      const { connection } = clientData
      const clientTimezone = await AdvancedCacheService.getClientTimezone(clientId)

      // Use organizer email if no emails specified
      const emailsToCheck = request.emails || [connection.email]
      const intervalMinutes = request.intervalInMinutes || 60

      // Get free/busy information using direct Graph API
      const freeBusyResponse = await fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          schedules: emailsToCheck,
          startTime: {
            dateTime: request.startDate,
            timeZone: clientTimezone || 'UTC'
          },
          endTime: {
            dateTime: request.endDate,
            timeZone: clientTimezone || 'UTC'
          },
          availabilityViewInterval: intervalMinutes
        })
      })

      if (!freeBusyResponse.ok) {
        return { success: false, error: `Failed to get availability: ${freeBusyResponse.statusText}` }
      }

      const freeBusyData = await freeBusyResponse.json()

      // Transform free/busy data
      const availability = emailsToCheck.map((email, index) => {
        const schedule = freeBusyData.value?.[index] || {}
        const busyTimes = schedule.busyTimes || []

        return {
          email,
          availability: busyTimes.map((period: {
            start?: { dateTime?: string } | string
            end?: { dateTime?: string } | string
            status?: string
          }) => ({
            start: (typeof period.start === 'object' ? period.start?.dateTime : period.start) || '',
            end: (typeof period.end === 'object' ? period.end?.dateTime : period.end) || '',
            status: (period.status || 'busy') as 'free' | 'busy' | 'tentative' | 'outOfOffice'
          }))
        }
      })

      console.log(`✅ FINAL OPTIMIZED: Retrieved availability for ${emailsToCheck.length} emails`)
      return {
        success: true,
        availability
      }

    } catch (error) {
      console.error('Error in final optimized getAvailabilityForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  /**
   * Find available time slots with enhanced optimization
   */
  static async findAvailableSlotsForClient(
    clientId: number,
    requestedStartTime: string,
    requestedEndTime: string,
    durationMinutes: number = 60,
    maxSuggestions: number = 3,
    overrideOfficeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
    overrideTimezone?: string
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
      console.log(`🚀 FINAL OPTIMIZED: Finding available slots for client ${clientId}`)
      
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          hasConflict: false,
          error: 'No calendar connection found or client not configured properly.',
        }
      }

      const { connection, timezone, agentOfficeHours, agentTimezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          hasConflict: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Use override office hours if provided (from specific agent), otherwise use cached
      const finalOfficeHours = overrideOfficeHours !== undefined ? overrideOfficeHours : agentOfficeHours
      const finalTimezone = overrideTimezone || agentTimezone || timezone

      console.log(`Using office hours: ${finalOfficeHours ? 'Specific agent hours' : 'No restrictions'}`)

      // Use optimized conflict detection
      const slotCheck = await OptimizedConflictDetection.findAvailableSlots(
        connection, 
        requestedStartTime, 
        requestedEndTime, 
        timezone, 
        {
          durationMinutes, 
          maxSuggestions,
          officeHours: finalOfficeHours,
          agentTimezone: finalTimezone,
          searchWindowHours: 0 // Set to 0 to limit to same day only
        }
      )

      return {
        success: true,
        hasConflict: slotCheck.hasConflict,
        availableSlots: slotCheck.availableSlots?.map(slot => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          startFormatted: slot.startFormatted,
          endFormatted: slot.endFormatted,
          confidence: slot.confidence
        })),
        conflictDetails: slotCheck.conflictDetails,
      }
    } catch (error) {
      console.error('Error in final optimized findAvailableSlotsForClient:', error)
      return {
        success: false,
        hasConflict: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Search calendar events with enhanced optimization
   */
  static async searchCalendarEventsForClient(
    clientId: number,
    searchQuery: string,
    options: {
      startDate?: string
      endDate?: string
      calendarId?: string
    } = {}
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    try {
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      // Use enhanced Graph API for search with caching
      const cacheKey = `search-${connection.id}-${searchQuery}-${options.startDate}-${options.endDate}`
      
      const eventsResponse = await AdvancedCacheService.getGraphEvents(
        cacheKey,
        async () => {
          // Build search filter (currently not used as we do client-side filtering)
          // let filter = `contains(subject,'${searchQuery}')`
          // if (options.startDate && options.endDate) {
          //   filter += ` and start/dateTime ge '${options.startDate}' and end/dateTime le '${options.endDate}'`
          // }

          return await EnhancedGraphApiService.getEventsOptimized(connection, {
            calendarId: options.calendarId || 'primary',
            fieldSet: 'STANDARD',
            timeZone: timezone,
            maxResults: 50,
            useCache: false // Don't double-cache search results
          })
        },
        60 // 1 minute TTL for search results
      )

      if (!eventsResponse.success) {
        return {
          success: false,
          error: eventsResponse.error
        }
      }

      // Filter events by search query (client-side filtering for more precise results)
      const events = (eventsResponse.events || []).filter(event => 
        event.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.body?.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.location?.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
      )

      const formattedEvents = formatGraphEventsAsString(events)
      return {
        success: true,
        events,
        formattedEvents,
      }
    } catch (error) {
      console.error('Error in final optimized searchCalendarEventsForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Force cleanup of all caches and resources (for maintenance)
   */
  static async forceCleanup(): Promise<void> {
    AdvancedCacheService.forceCleanup()
    console.log('🧹 Cache cleanup completed')
  }
}

export default FinalOptimizedCalendarOperations
