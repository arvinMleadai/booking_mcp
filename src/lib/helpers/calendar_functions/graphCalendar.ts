// Microsoft Graph calendar operations for MCP tools
import type {
  GraphEvent,
  GraphCalendar,
  GraphCalendarConnection,
  CreateGraphEventRequest,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
  AvailabilityResponse,
  AvailabilitySlot,
} from '@/types'
import {
  getCalendarConnectionByClientId,
  getCalendarConnectionSummary,
} from './graphDatabase'
import {
  getGraphEvents,
  createGraphEvent,
  updateGraphEvent,
  deleteGraphEvent,
  getGraphCalendars,
  getFreeBusyInfo,
  parseGraphDateRequest,
  formatGraphEventsAsString,
} from './graphHelper'
import { getClientTimezone } from './getClientTimeZone'
import { isWithinOfficeHours } from '../utils'

/**
 * Find available time slots near the requested time
 */
async function findAvailableSlots(
  connection: GraphCalendarConnection,
  requestedStartTime: string,
  requestedEndTime: string,
  timeZone: string,
  durationMinutes: number = 60,
  maxSuggestions: number = 3,
  officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
  agentTimezone?: string
): Promise<{
  hasConflict: boolean
  availableSlots?: Array<{
    start: string
    end: string
    startMelbourne: string
    endMelbourne: string
  }>
  conflictDetails?: string
}> {
  try {
    console.log(`🔍 Finding available slots near ${requestedStartTime} to ${requestedEndTime}`)
    
    const requestedStart = new Date(requestedStartTime)
    const requestedEnd = new Date(requestedEndTime)
    
    // Check if requested time has conflicts first
    const conflictCheck = await checkForConflicts(connection, requestedStartTime, requestedEndTime, timeZone)
    
    if (!conflictCheck.hasConflict) {
      console.log(`✅ Requested time slot is available`)
      return { hasConflict: false }
    }
    
    console.log(`⚠️ Requested time has conflicts, finding alternatives...`)
    
    // Search for available slots in a wider window (6 hours before and after)
    const searchStart = new Date(requestedStart.getTime() - 6 * 60 * 60 * 1000)
    const searchEnd = new Date(requestedEnd.getTime() + 6 * 60 * 60 * 1000)
    
    console.log(`🔍 Searching for alternatives from ${searchStart.toISOString()} to ${searchEnd.toISOString()}`)
    
    const eventsResponse = await getGraphEvents(connection, {
      startDateTime: searchStart.toISOString(),
      endDateTime: searchEnd.toISOString(),
      timeZone,
    })

    if (!eventsResponse.success || !eventsResponse.events) {
      return { 
        hasConflict: true, 
        conflictDetails: conflictCheck.conflictDetails,
        availableSlots: []
      }
    }

    // Get all busy periods and sort by start time
    const busyPeriods = eventsResponse.events
      .filter(event => !event.isCancelled)
      .map(event => {
        let eventStart: Date
        let eventEnd: Date
        
        if (event.start.timeZone === 'AUS Eastern Standard Time') {
          const startStr = event.start.dateTime.includes('T') ? event.start.dateTime : `${event.start.dateTime}T00:00:00`
          const endStr = event.end.dateTime.includes('T') ? event.end.dateTime : `${event.end.dateTime}T00:00:00`
          eventStart = new Date(`${startStr}+10:00`)
          eventEnd = new Date(`${endStr}+10:00`)
        } else {
          eventStart = new Date(event.start.dateTime)
          eventEnd = new Date(event.end.dateTime)
        }
        
        return { start: eventStart, end: eventEnd }
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    console.log(`📅 Found ${busyPeriods.length} busy periods to avoid`)

    // Find available slots
    const availableSlots: Array<{
      start: string
      end: string
      startMelbourne: string
      endMelbourne: string
    }> = []

    // Helper function to check if a time slot conflicts with busy periods
    const hasConflictWithBusy = (slotStart: Date, slotEnd: Date): boolean => {
      return busyPeriods.some(busy => 
        slotStart < busy.end && slotEnd > busy.start
      )
    }

    // Helper function to format time for Melbourne display
    const formatMelbourneTime = (date: Date): string => {
      return date.toLocaleString('en-AU', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    }

    // Search for slots in 30-minute increments
    const increment = 30 * 60 * 1000 // 30 minutes in milliseconds
    let currentTime = new Date(searchStart.getTime())
    
    while (currentTime < searchEnd && availableSlots.length < maxSuggestions) {
      const slotEnd = new Date(currentTime.getTime() + durationMinutes * 60 * 1000)
      
      // Check if slot is within office hours (if provided) or default business hours
      let isWithinHours = true;
      let hoursReason = '';
      
      if (officeHours) {
        // Use agent's office hours
        const officeHoursCheck = isWithinOfficeHours(
          currentTime.toISOString(), 
          officeHours, 
          agentTimezone || timeZone
        );
        isWithinHours = officeHoursCheck.isWithin;
        hoursReason = officeHoursCheck.reason || '';
      } else {
        // Fallback to default business hours (9 AM - 6 PM Melbourne time)
        const melbourneHour = parseInt(currentTime.toLocaleString('en-AU', {
          timeZone: 'Australia/Melbourne',
          hour: '2-digit',
          hour12: false
        }));
        isWithinHours = melbourneHour >= 9 && melbourneHour < 18;
        hoursReason = isWithinHours ? '' : 'Outside default business hours (9 AM - 6 PM)';
      }
      
      // Check if slot is not in the past (with 15-minute buffer)
      const now = new Date()
      const minimumSlotTime = new Date(now.getTime() + 15 * 60 * 1000) // 15 minutes from now
      const isNotInPast = currentTime >= minimumSlotTime
      
      if (isWithinHours && isNotInPast) {
        if (!hasConflictWithBusy(currentTime, slotEnd)) {
          availableSlots.push({
            start: currentTime.toISOString(),
            end: slotEnd.toISOString(),
            startMelbourne: formatMelbourneTime(currentTime),
            endMelbourne: formatMelbourneTime(slotEnd)
          })
          
          console.log(`✅ Found available slot: ${formatMelbourneTime(currentTime)} - ${formatMelbourneTime(slotEnd)}`)
        }
      } else {
        if (!isWithinHours) {
          console.log(`⏭️ Skipping slot ${formatMelbourneTime(currentTime)}: ${hoursReason}`)
        } else if (!isNotInPast) {
          console.log(`⏭️ Skipping slot ${formatMelbourneTime(currentTime)}: Too soon (less than 15 minutes from now)`)
        }
      }
      
      currentTime = new Date(currentTime.getTime() + increment)
    }

    // Sort by proximity to requested time
    availableSlots.sort((a, b) => {
      const aDistance = Math.abs(new Date(a.start).getTime() - requestedStart.getTime())
      const bDistance = Math.abs(new Date(b.start).getTime() - requestedStart.getTime())
      return aDistance - bDistance
    })

    console.log(`💡 Found ${availableSlots.length} available alternative slots`)

    return {
      hasConflict: true,
      conflictDetails: conflictCheck.conflictDetails,
      availableSlots: availableSlots.slice(0, maxSuggestions)
    }
  } catch (error) {
    console.error('❌ Error finding available slots:', error)
    return { 
      hasConflict: true, 
      conflictDetails: 'Error finding available slots'
    }
  }
}

/**
 * Check for scheduling conflicts before creating an event
 */
async function checkForConflicts(
  connection: GraphCalendarConnection,
  startDateTime: string,
  endDateTime: string,
  timeZone: string
): Promise<{ hasConflict: boolean; conflictDetails?: string }> {
  try {
    console.log(`🔍 CONFLICT DETECTION START`)
    console.log(`🔍 New event request: ${startDateTime} to ${endDateTime}`)
    console.log(`🔍 Timezone: ${timeZone}`)
    
    // Parse the input times properly - ensure they're treated as being in the specified timezone
    let newStart: Date
    let newEnd: Date
    
    // Check if the datetime strings already include timezone info
    if (startDateTime.includes('+') || startDateTime.includes('Z')) {
      // Already has timezone info, parse directly
      newStart = new Date(startDateTime)
      newEnd = new Date(endDateTime)
      console.log(`🔍 Input times already have timezone info`)
    } else {
      // No timezone in string, assume it's in the client's timezone
      // For Melbourne (UTC+10), we need to add the offset
      if (timeZone === 'Australia/Melbourne') {
        newStart = new Date(`${startDateTime}+10:00`)
        newEnd = new Date(`${endDateTime}+10:00`)
        console.log(`🔍 Parsed input times as Melbourne timezone (+10:00)`)
      } else {
        // For other timezones, parse as-is and hope for the best
        newStart = new Date(startDateTime)
        newEnd = new Date(endDateTime)
        console.log(`🔍 Parsed input times as-is (timezone: ${timeZone})`)
      }
    }
    
    console.log(`🔍 Parsed new event times (UTC):`)
    console.log(`🔍 - Start: ${newStart.toISOString()} (Melbourne: ${newStart.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})})`)
    console.log(`🔍 - End: ${newEnd.toISOString()} (Melbourne: ${newEnd.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})})`)
    
    // Expand the search window to catch nearby events (in UTC)
    const searchStart = new Date(newStart.getTime() - 2 * 60 * 60 * 1000) // 2 hours before
    const searchEnd = new Date(newEnd.getTime() + 2 * 60 * 60 * 1000) // 2 hours after
    
    console.log(`🔍 Searching for existing events in expanded window:`)
    console.log(`🔍 - Search Start: ${searchStart.toISOString()}`)
    console.log(`🔍 - Search End: ${searchEnd.toISOString()}`)
    
    // Get events in the expanded time range
    const eventsResponse = await getGraphEvents(connection, {
      startDateTime: searchStart.toISOString(),
      endDateTime: searchEnd.toISOString(),
      timeZone,
    })

    if (!eventsResponse.success || !eventsResponse.events) {
      console.log(`❌ No events found or error getting events:`, eventsResponse.error)
      return { hasConflict: false }
    }

    console.log(`🔍 Found ${eventsResponse.events.length} existing events to check against`)
    
    // Log all existing events for debugging
    eventsResponse.events.forEach((event, index) => {
      console.log(`📅 Event ${index + 1}: "${event.subject}"`)
      console.log(`   Raw times: ${event.start.dateTime} to ${event.end.dateTime}`)
      console.log(`   Timezone: ${event.start.timeZone}`)
      console.log(`   Cancelled: ${event.isCancelled}`)
    })
    
    const conflictingEvents = eventsResponse.events.filter(event => {
      // Skip cancelled events
      if (event.isCancelled) {
        console.log(`⏭️ Skipping cancelled event: ${event.subject}`)
        return false
      }
      
      console.log(`\n🔍 Analyzing event: "${event.subject}"`)
      console.log(`   Raw start: ${event.start.dateTime}`)
      console.log(`   Raw end: ${event.end.dateTime}`)
      console.log(`   Timezone: ${event.start.timeZone}`)
      
      // Parse existing event times - Microsoft Graph should return times in UTC when we use calendarView
      // But let's handle different timezone scenarios
      let eventStart: Date
      let eventEnd: Date
      
      // Try to parse the datetime strings directly first
      const startStr = event.start.dateTime.includes('T') ? event.start.dateTime : `${event.start.dateTime}T00:00:00`
      const endStr = event.end.dateTime.includes('T') ? event.end.dateTime : `${event.end.dateTime}T00:00:00`
      
      // Check if the datetime string already includes timezone info
      if (startStr.includes('+') || startStr.includes('Z')) {
        // Already has timezone info, parse directly
        eventStart = new Date(startStr)
        eventEnd = new Date(endStr)
        console.log(`   ✅ Parsed with timezone info`)
      } else if (event.start.timeZone && event.start.timeZone !== 'tzone://Microsoft/Custom') {
        // No timezone in string, but timezone provided in metadata
        if (event.start.timeZone === 'AUS Eastern Standard Time') {
          // Assume the time is in Melbourne timezone, convert to UTC
          eventStart = new Date(`${startStr}+10:00`)
          eventEnd = new Date(`${endStr}+10:00`)
          console.log(`   ✅ Parsed as Melbourne time (+10:00)`)
        } else {
          // For other timezones, try parsing as-is (might be UTC already)
          eventStart = new Date(startStr)
          eventEnd = new Date(endStr)
          console.log(`   ⚠️ Parsed as-is (assuming UTC)`)
        }
      } else {
        // No timezone info, assume UTC
        eventStart = new Date(startStr)
        eventEnd = new Date(endStr)
        console.log(`   ⚠️ No timezone info, assuming UTC`)
      }
      
      console.log(`   Parsed start (UTC): ${eventStart.toISOString()}`)
      console.log(`   Parsed end (UTC): ${eventEnd.toISOString()}`)
      console.log(`   Parsed start (Melbourne): ${eventStart.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})}`)
      console.log(`   Parsed end (Melbourne): ${eventEnd.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})}`)
      
      // Check for overlap: Two events overlap if one starts before the other ends
      // Event A overlaps Event B if: A.start < B.end AND A.end > B.start
      const hasOverlap = newStart < eventEnd && newEnd > eventStart
      
      // Check for exact time match (within 1 minute tolerance)
      const exactStartMatch = Math.abs(eventStart.getTime() - newStart.getTime()) < 60000
      const exactEndMatch = Math.abs(eventEnd.getTime() - newEnd.getTime()) < 60000
      const exactMatch = exactStartMatch && exactEndMatch
      
      console.log(`\n🔍 CONFLICT ANALYSIS:`)
      console.log(`   New event:     ${newStart.toISOString()} - ${newEnd.toISOString()}`)
      console.log(`   Existing event: ${eventStart.toISOString()} - ${eventEnd.toISOString()}`)
      console.log(`   Overlap check: newStart(${newStart.toISOString()}) < eventEnd(${eventEnd.toISOString()}) = ${newStart < eventEnd}`)
      console.log(`   Overlap check: newEnd(${newEnd.toISOString()}) > eventStart(${eventStart.toISOString()}) = ${newEnd > eventStart}`)
      console.log(`   Has overlap: ${hasOverlap}`)
      console.log(`   Exact match: ${exactMatch}`)
      console.log(`   RESULT: ${hasOverlap || exactMatch ? '❌ CONFLICT DETECTED!' : '✅ NO CONFLICT'}`)
      
      return hasOverlap || exactMatch
    })

    console.log(`\n🔍 FINAL CONFLICT SUMMARY:`)
    console.log(`   Total events checked: ${eventsResponse.events.length}`)
    console.log(`   Conflicting events: ${conflictingEvents.length}`)
    
    if (conflictingEvents.length > 0) {
      console.log(`\n❌ CONFLICTS DETECTED:`)
      conflictingEvents.forEach((event, index) => {
        console.log(`   ${index + 1}. "${event.subject}"`)
        console.log(`      Time: ${event.start.dateTime} - ${event.end.dateTime}`)
        console.log(`      Timezone: ${event.start.timeZone}`)
      })
      
      const conflictDetails = conflictingEvents.map(event => 
        `"${event.subject}" (${new Date(event.start.dateTime).toLocaleString()} - ${new Date(event.end.dateTime).toLocaleString()})`
      ).join(', ')
      
      return { 
        hasConflict: true, 
        conflictDetails: `Conflicts with existing event(s): ${conflictDetails}` 
      }
    }

    console.log(`✅ NO CONFLICTS FOUND - Time slot is available for booking`)
    return { hasConflict: false }
  } catch (error) {
    console.error('❌ Error checking for conflicts:', error)
    // Don't block event creation if conflict check fails
    return { hasConflict: false }
  }
}


/**
 * Get calendar events for a client using Microsoft Graph
 */
export async function getCalendarEventsForClient(
  clientId: number,
  request: GetGraphEventsRequest
): Promise<{
  success: boolean
  events?: GraphEvent[]
  formattedEvents?: string
  error?: string
}> {
  try {
    console.log(`Getting calendar events for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    console.log(`🌍 Using client timezone: ${clientTimezone} for client ${clientId}`)

    // Parse date request if provided
    let startDateTime: string | undefined
    let endDateTime: string | undefined
    
    if (request.dateRequest) {
      const dateRange = parseGraphDateRequest(request.dateRequest, clientTimezone)
      startDateTime = dateRange.start
      endDateTime = dateRange.end

      console.log("Start Date: ", startDateTime)
      console.log("End Date : ", endDateTime)
    } else if (request.startDate && request.endDate) {
      startDateTime = request.startDate
      endDateTime = request.endDate
    }
   
    const eventsResponse = await getGraphEvents(connection, {
      calendarId: request.calendarId || 'primary',
      startDateTime,
      endDateTime,
      timeZone: clientTimezone
    })

    if (!eventsResponse.success) {
      return {
        success: false,
        error: eventsResponse.error,
      }
    }

    const events = eventsResponse.events || []
    const formattedEvents = formatGraphEventsAsString(events)

    return {
      success: true,
      events,
      formattedEvents,
    }
  } catch (error) {
    console.error('Error getting calendar events for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a calendar event for a client using Microsoft Graph
 */
export async function createCalendarEventForClient(
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
    startMelbourne: string
    endMelbourne: string
  }>
}> {
  try {
    console.log(`Creating calendar event for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    // Get agent office hours for this calendar connection
    const { getAgentByCalendarConnection } = await import('../utils')
    const agentAssignment = await getAgentByCalendarConnection(connection.id)
    
    let agentOfficeHours: Record<string, { start: string; end: string; enabled: boolean }> | null = null
    let agentTimezone = clientTimezone
    
    if (agentAssignment && agentAssignment.agents) {
      const agent = agentAssignment.agents as unknown as {
        uuid: string;
        name: string;
        profiles: {
          id: number;
          name: string;
          office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
          timezone: string;
        } | {
          id: number;
          name: string;
          office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
          timezone: string;
        }[];
      };
      const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles
      if (profile) {
        agentOfficeHours = profile.office_hours
        agentTimezone = profile.timezone || clientTimezone
        
        console.log(`👤 Using office hours for agent: ${agent.name}`)
        console.log(`🏢 Office hours:`, agentOfficeHours)
        console.log(`🌍 Agent timezone: ${agentTimezone}`)
      }
    } else {
      console.log(`⚠️ No agent assignment found, using default business hours`)
    }

    // Prepare event data
    const eventData: CreateGraphEventRequest = {
      subject: request.subject,
      start: {
        dateTime: request.startDateTime,
        timeZone: clientTimezone,
      },
      end: {
        dateTime: request.endDateTime,
        timeZone: clientTimezone,
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

    console.log(`📧 Microsoft Graph will automatically send notifications to:`)
    console.log(`📧 - Organizer: ${connection.email} (${connection.display_name || 'No name'})`)
    console.log(`📧 - Attendee: ${request.attendeeEmail} (${request.attendeeName || 'No name'})`)

    // Check for conflicts and find available slots if needed
    console.log(`🔍 Checking for conflicts for new event: ${request.startDateTime} to ${request.endDateTime}`)
    const slotCheck = await findAvailableSlots(
      connection, 
      request.startDateTime, 
      request.endDateTime, 
      clientTimezone,
      60, // duration minutes
      3,  // max suggestions
      agentOfficeHours,
      agentTimezone
    )
    
    if (slotCheck.hasConflict) {
      console.log(`❌ CONFLICT DETECTED - Suggesting alternative slots`)
      
      let errorMessage = `Scheduling conflict detected: ${slotCheck.conflictDetails}`
      
      if (slotCheck.availableSlots && slotCheck.availableSlots.length > 0) {
        errorMessage += `\n\nSuggested available time slots:\n`
        slotCheck.availableSlots.forEach((slot, index) => {
          errorMessage += `${index + 1}. ${slot.startMelbourne} - ${slot.endMelbourne}\n`
        })
        errorMessage += `\nPlease choose one of these available slots or suggest a different time.`
      } else {
        errorMessage += `\n\nNo alternative slots found within business hours (9 AM - 6 PM). Please suggest a different time.`
      }
      
      return {
        success: false,
        error: errorMessage,
        availableSlots: slotCheck.availableSlots
      }
    }
    console.log(`✅ No conflicts - Proceeding with event creation`)

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

    console.log(`🔍 DEBUG: request.isOnlineMeeting = ${request.isOnlineMeeting}`)
    
    if (request.isOnlineMeeting) {
      console.log(`💻 TEAMS MEETING REQUESTED - Setting up Teams meeting`)
      eventData.isOnlineMeeting = true
      eventData.onlineMeetingProvider = 'teamsForBusiness'
      
      // Add Teams meeting information to the body if not already present
      const teamsInfo = '\n\n--- Microsoft Teams Meeting ---\nJoin the meeting from your calendar or use the Teams app.\n'
      if (eventData.body) {
        eventData.body.content += teamsInfo
      } else {
        eventData.body = {
          contentType: 'html',
          content: `<p>Meeting details:</p>${teamsInfo.replace(/\n/g, '<br>')}`
        }
      }
    } else {
      console.log(`📝 REGULAR MEETING - No Teams meeting requested`)
    }

    // Create event in Microsoft Graph
    const eventResponse = await createGraphEvent(
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

    // Microsoft Graph automatically sends email invitations to attendees
    console.log(`📧 Microsoft Graph will automatically send email invitations to attendees`)

    return {
      success: true,
      event: eventResponse.event,
      eventId: eventResponse.event?.id,
    }
  } catch (error) {
    console.error('Error creating calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Update a calendar event for a client using Microsoft Graph
 */
export async function updateCalendarEventForClient(
  clientId: number,
  eventId: string,
  updates: Partial<CreateGraphEventMCPRequest>
): Promise<{
  success: boolean
  event?: GraphEvent
  error?: string
}> {
  try {
    console.log(`Updating calendar event ${eventId} for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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
      // Get client's timezone from database
      const clientTimezone = await getClientTimezone(clientId)
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

    // Update event in Microsoft Graph
    const eventResponse = await updateGraphEvent(
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

    return {
      success: true,
      event: eventResponse.event,
    }
  } catch (error) {
    console.error('Error updating calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a calendar event for a client using Microsoft Graph
 */
export async function deleteCalendarEventForClient(
  clientId: number,
  eventId: string,
  calendarId?: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`Deleting calendar event ${eventId} for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Delete event from Microsoft Graph
    const deleteResponse = await deleteGraphEvent(
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

    // Invalidate cache after successful deletion
    try {
      const { AdvancedCacheService } = await import('../cache/advancedCacheService')
      await AdvancedCacheService.invalidateConnection(connection.id)
      console.log(`🗑️ Cache invalidated for connection ${connection.id} after event deletion`)
    } catch (cacheError) {
      console.warn('Failed to invalidate cache after event deletion:', cacheError)
      // Don't fail the deletion if cache invalidation fails
    }

    return {
      success: true,
    }
  } catch (error) {
    console.error('Error deleting calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get calendars for a client using Microsoft Graph
 */
export async function getCalendarsForClient(clientId: number): Promise<{
  success: boolean
  calendars?: GraphCalendar[]
  error?: string
}> {
  try {
    console.log(`Getting calendars for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get calendars from Microsoft Graph
    const calendarsResponse = await getGraphCalendars(connection)

    if (!calendarsResponse.success) {
      return {
        success: false,
        error: calendarsResponse.error,
      }
    }

    return {
      success: true,
      calendars: calendarsResponse.calendars,
    }
  } catch (error) {
    console.error('Error getting calendars for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get availability/free-busy information for a client
 */
export async function getAvailabilityForClient(
  clientId: number,
  request: GetAvailabilityRequest
): Promise<AvailabilityResponse> {
  try {
    console.log(`Getting availability for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Use connection email if no emails provided
    const emails = request.emails || [connection.email]
    
    // Get free/busy information from Microsoft Graph
    const freeBusyResponse = await getFreeBusyInfo(
      connection,
      emails,
      request.startDate,
      request.endDate,
      request.intervalInMinutes || 60
    )

    if (!freeBusyResponse.success) {
      return {
        success: false,
        error: freeBusyResponse.error,
      }
    }

    // Convert Graph response to our format
    const availability: Record<string, AvailabilitySlot[]> = {}
    
    if (freeBusyResponse.data?.schedules) {
      Object.entries(freeBusyResponse.data.schedules).forEach(([email, schedule]) => {
        const slots: AvailabilitySlot[] = []
        
        if (schedule.busyTimes) {
          schedule.busyTimes.forEach(busyTime => {
            slots.push({
              start: busyTime.start.dateTime,
              end: busyTime.end.dateTime,
              status: 'busy',
            })
          })
        }
        
        availability[email] = slots
      })
    }

    return {
      success: true,
      availability,
    }
  } catch (error) {
    console.error('Error getting availability for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if client has connected calendars
 */
export async function checkClientCalendarConnection(clientId: number): Promise<{
  has_active_connections: boolean
  total_connections: number
  connected_connections: number
  microsoft_connections: number
  google_connections: number
  primary_connection?: {
    email: string
    provider_name: string
    display_name: string
  }
} | null> {
  try {
    console.log(`Checking calendar connection for client ${clientId}`)
    
    const summary = await getCalendarConnectionSummary(clientId)
    return summary
  } catch (error) {
    console.error('Error checking client calendar connection:', error)
    return null
  }
}

/**
 * Find available time slots for a client
 */
export async function findAvailableSlotsForClient(
  clientId: number,
  requestedStartTime: string,
  requestedEndTime: string,
  durationMinutes: number = 60,
  maxSuggestions: number = 5
): Promise<{
  success: boolean
  hasConflict: boolean
  availableSlots?: Array<{
    start: string
    end: string
    startMelbourne: string
    endMelbourne: string
  }>
  conflictDetails?: string
  error?: string
}> {
  try {
    console.log(`Finding available slots for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
    if (!connection) {
      return {
        success: false,
        hasConflict: false,
        error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
      }
    }

    
    if (!connection.is_connected) {
      return {
        success: false,
        hasConflict: false,
        error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
      }
    }

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        hasConflict: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    // Get agent office hours for this calendar connection
    const { getAgentByCalendarConnection } = await import('../utils')
    const agentAssignment = await getAgentByCalendarConnection(connection.id)
    
    let agentOfficeHours: Record<string, { start: string; end: string; enabled: boolean }> | null = null
    let agentTimezone = clientTimezone
    
    if (agentAssignment && agentAssignment.agents) {
      const agent = agentAssignment.agents as unknown as {
        uuid: string;
        name: string;
        profiles: {
          id: number;
          name: string;
          office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
          timezone: string;
        } | {
          id: number;
          name: string;
          office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
          timezone: string;
        }[];
      };
      const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles
      if (profile) {
        agentOfficeHours = profile.office_hours
        agentTimezone = profile.timezone || clientTimezone
        
        console.log(`👤 Using office hours for agent: ${agent.name}`)
      }
    }

    // Find available slots
    const slotCheck = await findAvailableSlots(
      connection, 
      requestedStartTime, 
      requestedEndTime, 
      clientTimezone, 
      durationMinutes, 
      maxSuggestions,
      agentOfficeHours,
      agentTimezone
    )

    return {
      success: true,
      hasConflict: slotCheck.hasConflict,
      availableSlots: slotCheck.availableSlots,
      conflictDetails: slotCheck.conflictDetails,
    }
  } catch (error) {
    console.error('Error finding available slots for client:', error)
    return {
      success: false,
      hasConflict: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Search calendar events for a client
 */
export async function searchCalendarEventsForClient(
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
    console.log(`Searching calendar events for client ${clientId} with query: ${searchQuery}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
    if (!connection) {
      return {
        success: false,
        error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
      }
    }

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    if (!connection.is_connected) {
      return {
        success: false,
        error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
      }
    }

    // Build search filter
    let filter = `contains(subject,'${searchQuery}')`
    
    if (options.startDate && options.endDate) {
      filter += ` and start/dateTime ge '${options.startDate}' and end/dateTime le '${options.endDate}'`
    }

    // Get events from Microsoft Graph with search filter
    const eventsResponse = await getGraphEvents(connection, {
      calendarId: options.calendarId || 'primary',
      filter,
      timeZone: clientTimezone,
      top: 50,
    })

    if (!eventsResponse.success) {
      return {
        success: false,
        error: eventsResponse.error,
      }
    }

    const events = eventsResponse.events || []
    const formattedEvents = formatGraphEventsAsString(events)

    return {
      success: true,
      events,
      formattedEvents,
    }
  } catch (error) {
    console.error('Error searching calendar events for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
