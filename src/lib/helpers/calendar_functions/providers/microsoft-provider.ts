// Microsoft Graph Calendar Provider
import type {
  CalendarProvider,
  CalendarEvent,
  Calendar,
  CreateEventRequest,
  UpdateEventRequest,
  GetEventsRequest,
  GetAvailabilityRequest,
  AvailabilitySlot,
} from './types'
import type { GraphCalendarConnection } from '@/types'
import { makeGraphRequest, refreshGraphToken, parseGraphDateRequest } from '../graphHelper'
import { updateCalendarConnectionTokens } from '../graphDatabase'
import { DateTime } from 'luxon'

/**
 * Microsoft Graph Calendar Provider
 */
export class MicrosoftCalendarProvider implements CalendarProvider {
  readonly name = 'microsoft'

  canHandle(connection: GraphCalendarConnection): boolean {
    return connection.provider_name === 'microsoft' || connection.provider_name === 'office365'
  }

  /**
   * Refresh token if needed (internal method)
   * Uses existing refresh_token from the authenticated connection
   */
  async refreshToken(connection: GraphCalendarConnection): Promise<{
    access_token: string
    refresh_token?: string
    expires_at: string
  } | null> {
    try {
      // Use existing refresh_token to get new access_token
      // No authentication needed - calendar is already authenticated
      const tokenData = await refreshGraphToken(connection)
      if (!tokenData) return null

      // Update database with new tokens
      await updateCalendarConnectionTokens(connection.id, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || connection.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      })

      return {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      }
    } catch (error) {
      console.error('Error refreshing Microsoft token:', error)
      return null
    }
  }

  async getCalendars(connection: GraphCalendarConnection): Promise<{
    success: boolean
    calendars?: Calendar[]
    error?: string
  }> {
    try {
      const response = await makeGraphRequest(connection, '/me/calendars')
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to fetch calendars',
        }
      }

      const data = await response.json()
      const calendars: Calendar[] = (data.value || []).map((cal: {
        id: string
        name: string
        isDefaultCalendar?: boolean
        canEdit?: boolean
        color?: string
      }) => ({
        id: cal.id,
        name: cal.name,
        isPrimary: cal.isDefaultCalendar,
        canEdit: cal.canEdit,
        color: cal.color,
      }))

      return {
        success: true,
        calendars,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getEvents(
    connection: GraphCalendarConnection,
    request: GetEventsRequest
  ): Promise<{
    success: boolean
    events?: CalendarEvent[]
    error?: string
  }> {
    try {
      const {
        calendarId = 'primary',
        startDateTime,
        endDateTime,
        timeZone,
        maxResults = 100,
      } = request

      let endpoint = calendarId === 'primary' 
        ? '/me/events' 
        : `/me/calendars/${calendarId}/events`

      const params = new URLSearchParams()
      
      if (startDateTime && endDateTime) {
        endpoint = endpoint.replace('/events', '/calendarView')
        params.append('startDateTime', startDateTime)
        params.append('endDateTime', endDateTime)
      }
      
      params.append('$orderby', 'start/dateTime')
      params.append('$select', 'id,subject,body,start,end,location,attendees,organizer,isAllDay,isCancelled,onlineMeeting,webLink,createdDateTime,lastModifiedDateTime')
      params.append('$top', maxResults.toString())

      if (params.toString()) {
        endpoint += `?${params.toString()}`
      }

      const response = await makeGraphRequest(connection, endpoint, {}, timeZone)
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to fetch events',
        }
      }

      const data = await response.json()
      const events: CalendarEvent[] = (data.value || []).map((event: {
        id: string
        subject: string
        body?: { content?: string }
        start: { dateTime: string; timeZone: string }
        end: { dateTime: string; timeZone: string }
        location?: { displayName?: string }
        attendees?: Array<{
          emailAddress: { address: string; name?: string }
          status?: { response?: string }
        }>
        organizer?: { emailAddress: { address: string; name?: string } }
        isAllDay?: boolean
        isCancelled?: boolean
        onlineMeeting?: { joinUrl?: string }
        webLink?: string
        createdDateTime?: string
        lastModifiedDateTime?: string
      }) => ({
        id: event.id,
        subject: event.subject || 'Untitled',
        description: event.body?.content,
        start: {
          dateTime: event.start.dateTime,
          timeZone: event.start.timeZone,
        },
        end: {
          dateTime: event.end.dateTime,
          timeZone: event.end.timeZone,
        },
        location: event.location?.displayName,
        attendees: event.attendees?.map(a => ({
          email: a.emailAddress.address,
          name: a.emailAddress.name,
          response: this.mapResponseStatus(a.status?.response),
        })),
        organizer: event.organizer ? {
          email: event.organizer.emailAddress.address,
          name: event.organizer.emailAddress.name,
        } : undefined,
        isAllDay: event.isAllDay,
        isCancelled: event.isCancelled,
        onlineMeetingUrl: event.onlineMeeting?.joinUrl,
        webLink: event.webLink,
        created: event.createdDateTime,
        updated: event.lastModifiedDateTime,
      }))

      return {
        success: true,
        events,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async createEvent(
    connection: GraphCalendarConnection,
    request: CreateEventRequest
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    error?: string
  }> {
    try {
      const endpoint = '/me/events'
      
      const eventData: {
        subject: string
        body?: { contentType: string; content: string }
        start: { dateTime: string; timeZone: string }
        end: { dateTime: string; timeZone: string }
        location?: { displayName: string }
        attendees: Array<{
          type: string
          emailAddress: { name?: string; address: string }
          status?: { response: string; time: string }
        }>
        isOnlineMeeting?: boolean
        onlineMeetingProvider?: string
        responseRequested: boolean
      } = {
        subject: request.subject,
        start: {
          dateTime: request.startDateTime,
          timeZone: request.timeZone,
        },
        end: {
          dateTime: request.endDateTime,
          timeZone: request.timeZone,
        },
        attendees: [
          {
            type: 'required',
            emailAddress: {
              name: connection.display_name || connection.email,
              address: connection.email,
            },
            status: {
              response: 'organizer',
              time: new Date().toISOString(),
            },
          },
          // Only add attendee if email is provided
          ...(request.attendeeEmail ? [{
            type: 'required' as const,
            emailAddress: {
              name: request.attendeeName,
              address: request.attendeeEmail,
            },
            status: {
              response: 'none' as const,
              time: new Date().toISOString(),
            },
          }] : []),
        ],
        responseRequested: true,
      }

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
      }

      const response = await makeGraphRequest(connection, endpoint, {
        method: 'POST',
        body: JSON.stringify(eventData),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to create event',
        }
      }

      const event = await response.json()
      return {
        success: true,
        event: this.mapGraphEventToCalendarEvent(event),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async updateEvent(
    connection: GraphCalendarConnection,
    eventId: string,
    request: UpdateEventRequest
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    error?: string
  }> {
    try {
      const endpoint = `/me/events/${eventId}?sendNotifications=true`
      
      const updateData: {
        subject?: string
        body?: { contentType: string; content: string }
        start?: { dateTime: string; timeZone: string }
        end?: { dateTime: string; timeZone: string }
        location?: { displayName: string }
        attendees?: Array<{
          type: string
          emailAddress: { name?: string; address: string }
        }>
      } = {}

      if (request.subject) updateData.subject = request.subject
      if (request.description) {
        updateData.body = {
          contentType: 'text',
          content: request.description,
        }
      }
      if (request.location) {
        updateData.location = {
          displayName: request.location,
        }
      }
      if (request.startDateTime && request.endDateTime && request.timeZone) {
        updateData.start = {
          dateTime: request.startDateTime,
          timeZone: request.timeZone,
        }
        updateData.end = {
          dateTime: request.endDateTime,
          timeZone: request.timeZone,
        }
      }
      if (request.attendeeEmail) {
        updateData.attendees = [{
          type: 'required',
          emailAddress: {
            name: request.attendeeName,
            address: request.attendeeEmail,
          },
        }]
      }

      const response = await makeGraphRequest(connection, endpoint, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to update event',
        }
      }

      const event = await response.json()
      return {
        success: true,
        event: this.mapGraphEventToCalendarEvent(event),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async deleteEvent(
    connection: GraphCalendarConnection,
    eventId: string,
    calendarId?: string
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const endpoint = calendarId === 'primary' || !calendarId
        ? `/me/events/${eventId}?sendNotifications=true`
        : `/me/calendars/${calendarId}/events/${eventId}?sendNotifications=true`

      const response = await makeGraphRequest(connection, endpoint, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to delete event',
        }
      }

      return {
        success: true,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getAvailability(
    connection: GraphCalendarConnection,
    request: GetAvailabilityRequest
  ): Promise<{
    success: boolean
    availability?: Array<{
      email: string
      slots: AvailabilitySlot[]
    }>
    error?: string
  }> {
    try {
      const endpoint = '/me/calendar/getSchedule'
      
      const requestBody = {
        schedules: request.emails,
        startTime: {
          dateTime: request.startDateTime,
          timeZone: request.timeZone,
        },
        endTime: {
          dateTime: request.endDateTime,
          timeZone: request.timeZone,
        },
        availabilityViewInterval: request.intervalInMinutes || 60,
      }

      const response = await makeGraphRequest(connection, endpoint, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
        return {
          success: false,
          error: error.error?.message || 'Failed to get availability',
        }
      }

      const data = await response.json()
      const availability = (data.value || []).map((schedule: {
        scheduleId: string
        availabilityView?: string
        scheduleItems?: Array<{
          start?: { dateTime?: string }
          end?: { dateTime?: string }
          status?: string
        }>
      }) => ({
        email: schedule.scheduleId,
        slots: (schedule.scheduleItems || []).map((item: {
          start?: { dateTime?: string }
          end?: { dateTime?: string }
          status?: string
        }) => ({
          start: item.start?.dateTime || '',
          end: item.end?.dateTime || '',
          status: this.mapAvailabilityStatus(item.status || 'busy'),
        })),
      }))

      return {
        success: true,
        availability,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async checkConnection(connection: GraphCalendarConnection): Promise<{
    success: boolean
    connected: boolean
    error?: string
  }> {
    try {
      const response = await makeGraphRequest(connection, '/me')
      
      return {
        success: true,
        connected: response.ok,
        error: response.ok ? undefined : `Connection test failed: ${response.statusText}`,
      }
    } catch (error) {
      return {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Helper methods
  private mapGraphEventToCalendarEvent(event: {
    id: string
    subject: string
    body?: { content?: string }
    start: { dateTime: string; timeZone: string }
    end: { dateTime: string; timeZone: string }
    location?: { displayName?: string }
    attendees?: Array<{
      emailAddress: { address: string; name?: string }
      status?: { response?: string }
    }>
    organizer?: { emailAddress: { address: string; name?: string } }
    isAllDay?: boolean
    isCancelled?: boolean
    onlineMeeting?: { joinUrl?: string }
    webLink?: string
    createdDateTime?: string
    lastModifiedDateTime?: string
  }): CalendarEvent {
    return {
      id: event.id,
      subject: event.subject || 'Untitled',
      description: event.body?.content,
      start: {
        dateTime: event.start.dateTime,
        timeZone: event.start.timeZone,
      },
      end: {
        dateTime: event.end.dateTime,
        timeZone: event.end.timeZone,
      },
      location: event.location?.displayName,
      attendees: event.attendees?.map(a => ({
        email: a.emailAddress.address,
        name: a.emailAddress.name,
        response: this.mapResponseStatus(a.status?.response),
      })),
      organizer: event.organizer ? {
        email: event.organizer.emailAddress.address,
        name: event.organizer.emailAddress.name,
      } : undefined,
      isAllDay: event.isAllDay,
      isCancelled: event.isCancelled,
      onlineMeetingUrl: event.onlineMeeting?.joinUrl,
      webLink: event.webLink,
      created: event.createdDateTime,
      updated: event.lastModifiedDateTime,
    }
  }

  private mapResponseStatus(status?: string): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
    switch (status) {
      case 'accepted':
        return 'accepted'
      case 'declined':
        return 'declined'
      case 'tentativelyAccepted':
        return 'tentative'
      default:
        return 'needsAction'
    }
  }

  private mapAvailabilityStatus(status: string): 'free' | 'busy' | 'tentative' | 'outOfOffice' {
    switch (status?.toLowerCase()) {
      case 'free':
        return 'free'
      case 'tentative':
        return 'tentative'
      case 'oof':
      case 'outofoffice':
        return 'outOfOffice'
      default:
        return 'busy'
    }
  }
}

