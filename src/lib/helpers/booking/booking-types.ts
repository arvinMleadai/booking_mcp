/**
 * Booking Type Definitions
 * Clean, simplified types for VAPI integration
 */

// ============================================
// Input Types
// ============================================

export interface BookingIds {
  boardId?: string;
  stageId?: string;
  dealId?: number;
  agentId?: string;
  clientId?: number;
  timezone?: string;
}

export interface CustomerInfo {
  name?: string;
  email?: string;
  phoneNumber?: string;
}

export interface BookingTimeSlot {
  startDateTime: string;
  endDateTime: string;
}

export interface BookingRequest {
  // Required
  instructionsText: string;
  startDateTime: string;
  endDateTime: string;

  // Optional - will be extracted from instructionsText
  extractedIds?: BookingIds;

  // Optional - customer details
  customerInfo?: CustomerInfo;

  // Optional - meeting details
  subject?: string;
  description?: string;
  location?: string;
  isOnlineMeeting?: boolean;

  // Optional - overrides
  calendarId?: string;
}

export interface SlotSearchRequest {
  instructionsText: string;
  preferredDate: string;
  durationMinutes?: number;
  maxSuggestions?: number;
  calendarId?: string;
}

export interface RescheduleRequest {
  instructionsText: string;
  eventId: string;
  newStartDateTime: string;
  newEndDateTime: string;
  calendarId?: string;
  notifyCustomer?: boolean;
}

export interface CancelRequest {
  instructionsText: string;
  eventId: string;
  calendarId?: string;
  notifyCustomer?: boolean;
}

// ============================================
// Output Types
// ============================================

export interface BookingCustomer {
  name: string;
  email: string;
  phoneNumber?: string;
  company?: string;
}

export interface BookingAgent {
  uuid: string;
  name: string;
  profileName: string;
  title: string;
  email?: string;
}

export interface BookingEvent {
  eventId: string;
  subject: string;
  start: string;
  end: string;
  location?: string;
  meetingLink?: string;
  onlineMeetingUrl?: string;
}

export interface AvailableSlot {
  start: string;
  end: string;
  startFormatted: string;
  endFormatted: string;
  available: boolean;
  agentName?: string;
  agentEmail?: string;
}

export interface BookingSuccessResponse {
  success: true;
  booking: {
    event: BookingEvent;
    customer: BookingCustomer;
    agent: BookingAgent;
  };
  message?: string;
}

export interface BookingConflictResponse {
  success: false;
  conflict: true;
  message: string;
  suggestedSlots: AvailableSlot[];
}

export interface BookingErrorResponse {
  success: false;
  conflict?: false;
  error: string;
  code: ErrorCode;
  details?: Record<string, any>;
}

export type BookingResponse =
  | BookingSuccessResponse
  | BookingConflictResponse
  | BookingErrorResponse;

export interface SlotsResponse {
  success: boolean;
  slots?: AvailableSlot[];
  agent?: BookingAgent;
  error?: string;
  code?: ErrorCode;
}

export interface CancelResponse {
  success: boolean;
  eventId?: string;
  message?: string;
  error?: string;
  code?: ErrorCode;
}

export interface RescheduleResponse {
  success: boolean;
  event?: BookingEvent;
  message?: string;
  error?: string;
  code?: ErrorCode;
}

// ============================================
// Error Codes
// ============================================

export enum ErrorCode {
  // Validation errors
  INVALID_TIME = "INVALID_TIME",
  PAST_TIME = "PAST_TIME",
  MISSING_IDS = "MISSING_IDS",
  INVALID_IDS = "INVALID_IDS",
  
  // Business logic errors
  OUTSIDE_HOURS = "OUTSIDE_HOURS",
  SLOT_CONFLICT = "SLOT_CONFLICT",
  CUSTOMER_NOT_FOUND = "CUSTOMER_NOT_FOUND",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  CALENDAR_NOT_FOUND = "CALENDAR_NOT_FOUND",
  
  // API errors
  API_ERROR = "API_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  CALENDAR_API_ERROR = "CALENDAR_API_ERROR",
  
  // General errors
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

// ============================================
// Internal Types (for service methods)
// ============================================

export interface ValidatedBookingData {
  ids: Required<Pick<BookingIds, 'clientId' | 'agentId' | 'boardId' | 'stageId' | 'dealId'>>;
  timeSlot: BookingTimeSlot;
  customerInfo?: CustomerInfo;
  subject?: string;
  description?: string;
  location?: string;
  isOnlineMeeting: boolean;
  calendarId?: string;
}

export interface CalendarSelection {
  calendarId: string;
  calendarEmail: string;
  provider: 'MICROSOFT' | 'GOOGLE';
  source: 'explicit' | 'pipeline' | 'agent';
}

export interface CustomerLookupResult {
  found: boolean;
  customer?: BookingCustomer;
  source?: 'deal' | 'customers' | 'contacts' | 'manual';
}
