// Unified calendar types that work across all providers
import type { GraphCalendarConnection } from '@/types'

/**
 * Provider-agnostic calendar event
 */
export interface CalendarEvent {
  id: string
  subject: string
  description?: string
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: string
  attendees?: Array<{
    email: string
    name?: string
    response?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  }>
  organizer?: {
    email: string
    name?: string
  }
  isAllDay?: boolean
  isCancelled?: boolean
  onlineMeetingUrl?: string
  webLink?: string
  created?: string
  updated?: string
}

/**
 * Provider-agnostic calendar
 */
export interface Calendar {
  id: string
  name: string
  isPrimary?: boolean
  canEdit?: boolean
  color?: string
}

/**
 * Availability slot
 */
export interface AvailabilitySlot {
  start: string
  end: string
  status: 'free' | 'busy' | 'tentative' | 'outOfOffice'
}

/**
 * Create event request
 */
export interface CreateEventRequest {
  subject: string
  startDateTime: string
  endDateTime: string
  timeZone: string
  description?: string
  location?: string
  attendeeEmail: string
  attendeeName?: string
  isOnlineMeeting?: boolean
}

/**
 * Update event request
 */
export interface UpdateEventRequest {
  subject?: string
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
  description?: string
  location?: string
  attendeeEmail?: string
  attendeeName?: string
}

/**
 * Get events request
 */
export interface GetEventsRequest {
  calendarId?: string
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
  maxResults?: number
}

/**
 * Get availability request
 */
export interface GetAvailabilityRequest {
  emails: string[]
  startDateTime: string
  endDateTime: string
  timeZone: string
  intervalInMinutes?: number
}

/**
 * Calendar provider interface - all providers must implement this
 */
export interface CalendarProvider {
  /**
   * Provider name (e.g., 'microsoft', 'google')
   */
  readonly name: string

  /**
   * Check if this provider can handle the given connection
   */
  canHandle(connection: GraphCalendarConnection): boolean

  /**
   * Refresh access token (internal - called automatically when needed)
   * Calendars are already authenticated, this just refreshes expired tokens
   */
  refreshToken?(connection: GraphCalendarConnection): Promise<{
    access_token: string
    refresh_token?: string
    expires_at: string
  } | null>

  /**
   * Get list of calendars
   */
  getCalendars(connection: GraphCalendarConnection): Promise<{
    success: boolean
    calendars?: Calendar[]
    error?: string
  }>

  /**
   * Get calendar events
   */
  getEvents(
    connection: GraphCalendarConnection,
    request: GetEventsRequest
  ): Promise<{
    success: boolean
    events?: CalendarEvent[]
    error?: string
  }>

  /**
   * Create calendar event
   */
  createEvent(
    connection: GraphCalendarConnection,
    request: CreateEventRequest
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    error?: string
  }>

  /**
   * Update calendar event
   */
  updateEvent(
    connection: GraphCalendarConnection,
    eventId: string,
    request: UpdateEventRequest
  ): Promise<{
    success: boolean
    event?: CalendarEvent
    error?: string
  }>

  /**
   * Delete calendar event
   */
  deleteEvent(
    connection: GraphCalendarConnection,
    eventId: string,
    calendarId?: string
  ): Promise<{
    success: boolean
    error?: string
  }>

  /**
   * Get availability/free-busy information
   */
  getAvailability(
    connection: GraphCalendarConnection,
    request: GetAvailabilityRequest
  ): Promise<{
    success: boolean
    availability?: Array<{
      email: string
      slots: AvailabilitySlot[]
    }>
    error?: string
  }>

  /**
   * Check connection status
   */
  checkConnection(connection: GraphCalendarConnection): Promise<{
    success: boolean
    connected: boolean
    error?: string
  }>
}

