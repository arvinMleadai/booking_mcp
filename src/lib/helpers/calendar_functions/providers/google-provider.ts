// Google Calendar Provider
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
import { google } from 'googleapis'
import { updateCalendarConnectionTokens } from '../graphDatabase'
import { GoogleRateLimiter } from '../googleRateLimiter'

/**
 * Google Calendar Provider
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google'

  canHandle(connection: GraphCalendarConnection): boolean {
    return connection.provider_name === 'google'
  }

  /**
   * Helper to wrap API calls with rate limiting
   */
  private async withRateLimit<T>(
    connection: GraphCalendarConnection,
    operation: () => Promise<T>
  ): Promise<T> {
    const rateLimiter = GoogleRateLimiter.getInstance(connection.id)
    await rateLimiter.waitForSlot()
    
    try {
      return await operation()
    } catch (error) {
      rateLimiter.recordResponse(error)
      throw error
    }
  }

  /**
   * Get authenticated OAuth2 client using existing tokens from connection
   * No authentication flow needed - calendars are already authenticated
   * Just use the access_token and refresh_token from the connection
   */
  private getOAuth2Client(connection: GraphCalendarConnection) {
    // OAuth2 client is just used to make authenticated API calls
    // We don't need redirect URI since we're not doing OAuth flow
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )

    // Use existing tokens from the already-authenticated connection
    oauth2Client.setCredentials({
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
      expiry_date: new Date(connection.expires_at).getTime(),
    })

    // Auto-refresh token when it expires and save to database
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await updateCalendarConnectionTokens(connection.id, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || connection.refresh_token,
          expires_at: tokens.expiry_date 
            ? new Date(tokens.expiry_date).toISOString()
            : new Date(Date.now() + 3600 * 1000).toISOString(),
        })
      }
    })

    return oauth2Client
  }

  /**
   * Refresh token if needed (internal method)
   * Google OAuth2 client handles token refresh automatically via token event listener
   */
  async refreshToken(connection: GraphCalendarConnection): Promise<{
    access_token: string
    refresh_token?: string
    expires_at: string
  } | null> {
    try {
      const oauth2Client = this.getOAuth2Client(connection)
      
      // Check if token needs refresh
      const expiresAt = new Date(connection.expires_at).getTime()
      const now = Date.now()
      
      // Only refresh if token expires within 5 minutes
      if (expiresAt > now + 5 * 60 * 1000) {
        // Token is still valid, return current token
        return {
          access_token: connection.access_token,
          refresh_token: connection.refresh_token,
          expires_at: connection.expires_at,
        }
      }
      
      // Token needs refresh - OAuth2 client will auto-refresh and trigger token event
      const { credentials } = await oauth2Client.refreshAccessToken()
      
      if (!credentials.access_token) {
        return null
      }

      const newExpiresAt = credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString()

      // Token event listener already updated the database, but return the new token
      return {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || undefined,
        expires_at: newExpiresAt,
      }
    } catch (error) {
      console.error('Error refreshing Google token:', error)
      return null
    }
  }

  async getCalendars(connection: GraphCalendarConnection): Promise<{
    success: boolean
    calendars?: Calendar[]
    error?: string
  }> {
    try {
      const response = await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.calendarList.list()
      })
      
      if (!response.data.items) {
        return {
          success: true,
          calendars: [],
        }
      }

      const calendars: Calendar[] = response.data.items.map((cal) => ({
        id: cal.id || '',
        name: cal.summary || 'Untitled',
        isPrimary: cal.primary || false,
        canEdit: cal.accessRole === 'owner' || cal.accessRole === 'writer',
        color: cal.backgroundColor || undefined,
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
        maxResults = 100,
      } = request

      const params: {
        calendarId: string
        timeMin?: string
        timeMax?: string
        maxResults?: number
        singleEvents?: boolean
        orderBy?: string
      } = {
        calendarId,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      }

      if (startDateTime) {
        params.timeMin = startDateTime
      }
      if (endDateTime) {
        params.timeMax = endDateTime
      }

      const response = await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.events.list(params)
      })

      if (!response.data.items) {
        return {
          success: true,
          events: [],
        }
      }

      const events: CalendarEvent[] = response.data.items
        .filter(event => event.status !== 'cancelled')
        .map((event) => ({
          id: event.id || '',
          subject: event.summary || 'Untitled',
          description: event.description || undefined,
          start: {
            dateTime: event.start?.dateTime || event.start?.date || '',
            timeZone: event.start?.timeZone || 'UTC',
          },
          end: {
            dateTime: event.end?.dateTime || event.end?.date || '',
            timeZone: event.end?.timeZone || 'UTC',
          },
          location: event.location || undefined,
          attendees: event.attendees?.map(a => ({
            email: a.email || '',
            name: a.displayName || undefined,
            response: this.mapResponseStatus(a.responseStatus),
          })),
          organizer: event.organizer ? {
            email: event.organizer.email || '',
            name: event.organizer.displayName || undefined,
          } : undefined,
          isAllDay: !event.start?.dateTime,
          isCancelled: event.status === 'cancelled',
          // Prioritize conferenceData entryPoints (new Google Meet links) over hangoutLink (deprecated)
          onlineMeetingUrl: (event as any).conferenceData?.entryPoints?.[0]?.uri || event.hangoutLink || undefined,
          webLink: event.htmlLink || undefined,
          created: event.created || undefined,
          updated: event.updated || undefined,
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
      const oauth2Client = this.getOAuth2Client(connection)
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

      const eventData: {
        summary: string
        description?: string
        start: { dateTime: string; timeZone: string }
        end: { dateTime: string; timeZone: string }
        location?: string
        attendees: Array<{ email: string; displayName?: string }>
        conferenceData?: {
          createRequest: {
            requestId: string
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
        sendUpdates?: 'all'
      } = {
        summary: request.subject,
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
            email: connection.email,
            displayName: connection.display_name,
          },
          // Only add attendee if email is provided
          ...(request.attendeeEmail ? [{
            email: request.attendeeEmail,
            displayName: request.attendeeName,
          }] : []),
        ],
        // Only send updates if we have an attendee email
        ...(request.attendeeEmail ? { sendUpdates: 'all' as const } : {}),
      }

      if (request.description) {
        eventData.description = request.description
      }

      if (request.location) {
        eventData.location = request.location
      }

      if (request.isOnlineMeeting) {
        eventData.conferenceData = {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        }
      }

      const response = await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.events.insert({
          calendarId: 'primary',
          requestBody: eventData,
          conferenceDataVersion: 1, // Required to get conferenceData in response
        })
      })

      if (!response.data) {
        return {
          success: false,
          error: 'Failed to create event',
        }
      }

      const event = response.data
      
      // Debug logging for conference data
      if (request.isOnlineMeeting) {
        console.log('Google Calendar event created with conferenceData:', {
          hasConferenceData: !!event.conferenceData,
          conferenceData: event.conferenceData,
          entryPoints: event.conferenceData?.entryPoints,
          hangoutLink: event.hangoutLink,
        })
      }
      
      return {
        success: true,
        event: this.mapGoogleEventToCalendarEvent(event),
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
      const oauth2Client = this.getOAuth2Client(connection)
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

      // First get the existing event
      const existingEvent = await calendar.events.get({
        calendarId: 'primary',
        eventId,
      })

      if (!existingEvent.data) {
        return {
          success: false,
          error: 'Event not found',
        }
      }

      const updateData: {
        summary?: string
        description?: string
        start?: { dateTime: string; timeZone: string }
        end?: { dateTime: string; timeZone: string }
        location?: string
        attendees?: Array<{ email: string; displayName?: string }>
        sendUpdates?: 'all'
      } = {}

      if (request.subject) updateData.summary = request.subject
      if (request.description) updateData.description = request.description
      if (request.location) updateData.location = request.location
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
        updateData.attendees = [
          {
            email: connection.email,
            displayName: connection.display_name,
          },
          {
            email: request.attendeeEmail,
            displayName: request.attendeeName,
          },
        ]
        updateData.sendUpdates = 'all'
      }

      const response = await calendar.events.update({
        calendarId: 'primary',
        eventId,
        requestBody: {
          ...existingEvent.data,
          ...updateData,
        },
      })

      if (!response.data) {
        return {
          success: false,
          error: 'Failed to update event',
        }
      }

      return {
        success: true,
        event: this.mapGoogleEventToCalendarEvent(response.data),
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
      const oauth2Client = this.getOAuth2Client(connection)
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

      await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.events.delete({
          calendarId: calendarId || 'primary',
          eventId,
          sendUpdates: 'all',
        })
      })

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
      const oauth2Client = this.getOAuth2Client(connection)
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

      const freebusyResponse = await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.freebusy.query({
          requestBody: {
            timeMin: request.startDateTime,
            timeMax: request.endDateTime,
            items: request.emails.map(email => ({ id: email })),
          },
        })
      })

      if (!freebusyResponse.data.calendars) {
        return {
          success: false,
          error: 'Failed to get availability',
        }
      }

      const availability = Object.entries(freebusyResponse.data.calendars).map(([email, calendarData]) => ({
        email,
        slots: (calendarData.busy || []).map((busy) => ({
          start: busy.start || '',
          end: busy.end || '',
          status: 'busy' as const,
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
      const oauth2Client = this.getOAuth2Client(connection)
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

      await this.withRateLimit(connection, async () => {
        const oauth2Client = this.getOAuth2Client(connection)
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
        return await calendar.calendarList.list({ maxResults: 1 })
      })

      return {
        success: true,
        connected: true,
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
  private mapGoogleEventToCalendarEvent(event: {
    id?: string | null
    summary?: string | null
    description?: string | null
    start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null
    end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null
    location?: string | null
    attendees?: Array<{
      email?: string | null
      displayName?: string | null
      responseStatus?: string | null
    }> | null
    organizer?: { email?: string | null; displayName?: string | null } | null
    status?: string | null
    hangoutLink?: string | null
    conferenceData?: {
      entryPoints?: Array<{
        entryPointType?: string | null
        uri?: string | null
      }> | null
    } | null
    htmlLink?: string | null
    created?: string | null
    updated?: string | null
  }): CalendarEvent {
    return {
      id: event.id || '',
      subject: event.summary || 'Untitled',
      description: event.description || undefined,
      start: {
        dateTime: event.start?.dateTime || event.start?.date || '',
        timeZone: event.start?.timeZone || 'UTC',
      },
      end: {
        dateTime: event.end?.dateTime || event.end?.date || '',
        timeZone: event.end?.timeZone || 'UTC',
      },
      location: event.location || undefined,
      attendees: event.attendees?.map(a => ({
        email: a.email || '',
        name: a.displayName || undefined,
        response: this.mapResponseStatus(a.responseStatus),
      })),
      organizer: event.organizer ? {
        email: event.organizer.email || '',
        name: event.organizer.displayName || undefined,
      } : undefined,
      isAllDay: !event.start?.dateTime,
      isCancelled: event.status === 'cancelled',
      // Prioritize conferenceData entryPoints (new Google Meet links) over hangoutLink (deprecated)
      onlineMeetingUrl: event.conferenceData?.entryPoints?.[0]?.uri || event.hangoutLink || undefined,
      webLink: event.htmlLink || undefined,
      created: event.created || undefined,
      updated: event.updated || undefined,
    }
  }

  private mapResponseStatus(status?: string | null): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
    switch (status) {
      case 'accepted':
        return 'accepted'
      case 'declined':
        return 'declined'
      case 'tentative':
        return 'tentative'
      default:
        return 'needsAction'
    }
  }
}

