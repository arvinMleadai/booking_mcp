// Microsoft Graph API types for calendar operations

export interface GraphCalendarConnection {
  id: string
  client_id: number
  user_id: string
  provider_id: string
  provider_name: string
  provider_user_id: string
  email: string
  display_name: string
  access_token: string
  refresh_token?: string
  token_type: string
  expires_at: string
  calendars: GraphCalendar[]
  is_connected: boolean
  last_sync_at?: string
  sync_status: 'pending' | 'syncing' | 'completed' | 'error'
  sync_error?: string
  provider_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GraphCalendar {
  id: string
  name: string
  color?: string
  isDefaultCalendar?: boolean
  canEdit?: boolean
  canShare?: boolean
  canViewPrivateItems?: boolean
  owner?: {
    name?: string
    address?: string
  }
}

export interface GraphEvent {
  id: string
  subject: string
  body?: {
    contentType: 'text' | 'html'
    content: string
  }
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: {
    displayName?: string
    address?: {
      street?: string
      city?: string
      state?: string
      countryOrRegion?: string
      postalCode?: string
    }
  }
  attendees?: GraphAttendee[]
  organizer?: {
    emailAddress: {
      name?: string
      address: string
    }
  }
  isAllDay?: boolean
  isCancelled?: boolean
  importance?: 'low' | 'normal' | 'high'
  sensitivity?: 'normal' | 'personal' | 'private' | 'confidential'
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'
  responseStatus?: {
    response: 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded'
    time?: string
  }
  recurrence?: {
    pattern: {
      type: 'daily' | 'weekly' | 'absoluteMonthly' | 'relativeMonthly' | 'absoluteYearly' | 'relativeYearly'
      interval: number
      month?: number
      dayOfMonth?: number
      daysOfWeek?: string[]
      firstDayOfWeek?: string
      index?: 'first' | 'second' | 'third' | 'fourth' | 'last'
    }
    range: {
      type: 'endDate' | 'noEnd' | 'numbered'
      startDate: string
      endDate?: string
      numberOfOccurrences?: number
    }
  }
  onlineMeeting?: {
    joinUrl?: string
    conferenceId?: string
    tollNumber?: string
    tollFreeNumbers?: string[]
  }
  createdDateTime?: string
  lastModifiedDateTime?: string
  webLink?: string
}

export interface GraphAttendee {
  type?: 'required' | 'optional' | 'resource'
  status?: {
    response: 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded'
    time?: string
  }
  emailAddress: {
    name?: string
    address: string
  }
}

export interface GraphFreeBusyResponse {
  schedules: Record<string, {
    freeBusyViewType: string
    availabilityView: string[]
    workingHours?: {
      daysOfWeek: string[]
      startTime: string
      endTime: string
      timeZone: {
        name: string
      }
    }
    busyTimes?: {
      start: {
        dateTime: string
        timeZone: string
      }
      end: {
        dateTime: string
        timeZone: string
      }
    }[]
  }>
}

export interface CreateGraphEventRequest {
  subject: string
  body?: {
    contentType: 'text' | 'html'
    content: string
  }
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: {
    displayName: string
  }
  organizer?: {
    emailAddress: {
      name?: string
      address: string
    }
  }
  attendees?: {
    type?: 'required' | 'optional'
    emailAddress: {
      name?: string
      address: string
    }
    status?: {
      response: 'none' | 'organizer' | 'tentativelyAccepted' | 'accepted' | 'declined' | 'notResponded'
      time: string
    }
  }[]
  isOnlineMeeting?: boolean
  onlineMeetingProvider?: 'teamsForBusiness' | 'skypeForBusiness' | 'skypeForConsumer'
  responseRequested?: boolean
}

export type UpdateGraphEventRequest = Partial<CreateGraphEventRequest>

export interface GraphEventResponse {
  success: boolean
  event?: GraphEvent
  error?: string
  details?: unknown
}

export interface GraphEventsListResponse {
  success: boolean
  events?: GraphEvent[]
  error?: string
  details?: unknown
  nextLink?: string
}

export interface GraphCalendarListResponse {
  success: boolean
  calendars?: GraphCalendar[]
  error?: string
  details?: unknown
}

export interface GraphTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

export interface GraphErrorResponse {
  error: {
    code: string
    message: string
    innerError?: {
      code?: string
      message?: string
      'request-id'?: string
      date?: string
    }
  }
}

// Calendar connection management types
export interface CalendarProvider {
  id: string
  name: string
  display_name: string
  auth_url: string
  token_url: string
  scopes: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OAuthState {
  id: string
  state: string
  client_id: number
  user_id: string
  provider_name: string
  redirect_uri?: string
  expires_at: string
  metadata: Record<string, unknown>
  created_at: string
}

// MCP tool request/response types
export interface GetGraphEventsRequest {
  clientId: number
  dateRequest?: string
  calendarId?: string
  startDate?: string
  endDate?: string
}

export interface CreateGraphEventMCPRequest {
  clientId: number
  subject: string
  startDateTime: string
  endDateTime: string
  attendeeEmail: string
  attendeeName?: string
  description?: string
  location?: string
  isOnlineMeeting?: boolean
  calendarId?: string
}

export interface GetAvailabilityRequest {
  clientId: number
  startDate: string
  endDate: string
  emails?: string[]
  intervalInMinutes?: number
}

export interface AvailabilitySlot {
  start: string
  end: string
  status: 'free' | 'busy' | 'tentative' | 'oof' | 'workingElsewhere' | 'unknown'
}

export interface AvailabilityResponse {
  success: boolean
  availability?: Record<string, AvailabilitySlot[]>
  error?: string
  details?: unknown
}
