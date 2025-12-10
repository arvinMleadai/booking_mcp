// Booking MCP types for customer appointment booking

/**
 * Agent database entity
 */
export interface Agent {
  uuid: string
  client_id: number
  name: string
  description?: string
  user_instruction: Record<string, unknown>
  title: string
  is_dedicated: boolean
  profile_id?: number
  inbound_script_id?: number
  outbound_script_id?: number
  callback_script_id?: number
  inbound_script_content?: string
  outbound_script_content?: string
  callback_script_content?: string
  assigned_email_id?: number
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * Agent with related profile data
 */
export interface AgentWithProfile extends Agent {
  profiles?: {
    id: number
    name: string
    office_hours: Record<string, { start: string; end: string; enabled: boolean }>
    timezone: string
  }
}

/**
 * Agent calendar assignment entity
 */
export interface AgentCalendarAssignment {
  id: number
  agent_id: string
  calendar_id: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * Agent with calendar connection details
 */
export interface AgentWithCalendar extends AgentWithProfile {
  calendar_assignment?: AgentCalendarAssignment & {
    calendar_connections?: {
      id: string
      client_id: number
      provider_id: string
      provider_name: 'microsoft' | 'google'
      email: string
      display_name: string
      is_connected: boolean
    }
  }
}

/**
 * Customer entity (from customers table)
 */
export interface Customer {
  id: number
  client_id: number
  full_name: string
  email?: string
  phone?: string
  company?: string
  created_at: string
  updated_at: string
}

/**
 * Contact entity (from contacts table)
 */
export interface Contact {
  id: number
  client_id: number
  name?: string
  first_name?: string
  middle_name?: string
  last_name?: string
  phone_number: string
  email?: string
  company?: string
  custom_fields?: Record<string, unknown>
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * Request to book a customer appointment via MCP
 */
export interface BookCustomerAppointmentRequest {
  clientId: number
  agentId: string // Agent UUID
  customerName: string // Will search in customer database
  customerEmail?: string // Optional, will be fetched from customer if not provided
  subject: string
  startDateTime: string // ISO 8601 format
  endDateTime: string // ISO 8601 format
  description?: string
  location?: string
  isOnlineMeeting?: boolean
  calendarId?: string // Optional, uses agent's assigned calendar if not specified
}

/**
 * Request to find available booking slots
 */
export interface FindBookingSlotsRequest {
  clientId: number
  agentId: string
  preferredDate: string // Natural language: "today", "tomorrow", "next monday"
  durationMinutes?: number // Default: 60
  maxSuggestions?: number // Default: 5
}

/**
 * Available booking slot
 */
export interface BookingSlot {
  start: string // ISO 8601
  end: string // ISO 8601
  startFormatted: string // Human-readable
  endFormatted: string // Human-readable
  isWithinOfficeHours: boolean
  agentName: string
  agentEmail: string
}

/**
 * Response for booking operations
 */
export interface BookingOperationResponse {
  success: boolean
  error?: string
  event?: {
    id: string
    subject: string
    start: { dateTime: string; timeZone: string }
    end: { dateTime: string; timeZone: string }
    location?: { displayName?: string }
    attendees?: Array<{ emailAddress: { name?: string; address: string } }>
    onlineMeeting?: { joinUrl?: string }
  }
  eventId?: string
  availableSlots?: BookingSlot[]
  conflictDetails?: string
  customer?: Customer
  agent?: AgentWithCalendar
}

/**
 * Request to get agent's calendar availability
 */
export interface GetAgentAvailabilityRequest {
  clientId: number
  agentId: string
  startDate: string
  endDate: string
  intervalInMinutes?: number
}

/**
 * Request to list all agents for a client
 */
export interface ListAgentsRequest {
  clientId: number
  includeDedicated?: boolean
  withCalendarOnly?: boolean
}

/**
 * Agent summary for listing
 */
export interface AgentSummary {
  uuid: string
  name: string
  title: string
  description?: string
  isDedicated: boolean
  hasCalendar: boolean
  calendarProvider?: 'microsoft' | 'google'
  calendarEmail?: string
  profileName?: string
  timezone?: string
}

/**
 * Request to cancel customer appointment
 */
export interface CancelCustomerAppointmentRequest {
  clientId: number
  agentId: string
  eventId: string
  calendarId?: string
  notifyCustomer?: boolean
}

/**
 * Request to reschedule customer appointment
 */
export interface RescheduleCustomerAppointmentRequest {
  clientId: number
  agentId: string
  eventId: string
  newStartDateTime: string
  newEndDateTime: string
  calendarId?: string
  notifyCustomer?: boolean
}

/**
 * Booking validation result
 */
export interface BookingValidation {
  isValid: boolean
  errors: string[]
  warnings: string[]
  agent?: AgentWithCalendar
  customer?: Customer
  hasConflict?: boolean
  conflictingEvents?: Array<{
    id: string
    subject: string
    start: string
    end: string
  }>
}

