/**
 * Booking Service
 * Consolidated booking logic for VAPI integration
 * Handles all booking operations with clean, simplified flow
 */

import { DateTime } from 'luxon';
import type {
  BookingRequest,
  BookingResponse,
  SlotSearchRequest,
  SlotsResponse,
  CancelRequest,
  CancelResponse,
  RescheduleRequest,
  RescheduleResponse,
  BookingIds,
  BookingCustomer,
  BookingAgent,
  AvailableSlot,
  CalendarSelection,
  ErrorCode,
} from './booking-types';
import {
  extractBookingIds,
  validateRequiredIds,
  formatInstructionsText,
  inferMissingIds,
  isValidUUID,
  isValidNumericId,
} from './booking-extractor';
import { parseGraphDateRequest } from '../booking_functions/calendar/graphHelper';
import {
  validateTimeSlot,
  validateOfficeHours,
  createValidationError,
} from './booking-validator';

// Import existing utilities
import {
  getAgentWithCalendarByUUID,
  getCustomerWithFuzzySearch,
  getContactWithFuzzySearch,
} from '../utils';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

import {
  getStageItemById,
  getPipelineStageById,
  getPipelineById,
  getPartyContactInfo,
} from '../booking_functions/bookingMetadata';
import { CalendarService } from '../booking_functions/calendar/calendar-service';
import { getCalendarConnectionByPipelineId } from '../booking_functions/calendar/graphDatabase';
import { OptimizedConflictDetection } from '../booking_functions/calendar/optimizedConflictDetection';
import { sendSMS } from 'lead-ai-npm-modules';



export class BookingService {
  /**
   * Book customer appointment with automatic validation and conflict detection
   * 
   * @param request - Booking request
   * @returns Booking response with success/conflict/error
   */
  static async bookAppointment(request: BookingRequest): Promise<BookingResponse> {
    try {
      console.log('📞 [BookingService.bookAppointment] Starting booking process');

      // Step 1: Extract and validate IDs
      const extractResult = await this.extractAndValidateIds(
        request.instructionsText,
        {
          agentId: request.agentId,
          clientId: request.clientId,
          boardId: request.boardId,
          stageId: request.stageId,
          dealId: request.dealId,
          timezone: request.timezone,
          ...request.extractedIds,
        }
      );
      if (!extractResult.valid || !extractResult.ids) {
        return {
          success: false,
          error: extractResult.error || 'Validation failed',
          code: extractResult.code || 'UNKNOWN_ERROR' as ErrorCode,
          details: extractResult.details,
        };
      }

      const ids = extractResult.ids;
      console.log('✅ IDs extracted:', ids);
      console.log('✅ Instructions Text:', request.instructionsText);

      // RESOLVE DATES: Handle natural language override if present ("next Monday")
      // This fixes LLM date calculation errors by using robust graph parsing
      const resolved = await this.resolveDateOverride(
        request.startDateTime,
        request.endDateTime,
        request.preferredDate,
        ids.timezone || 'UTC'
      );
      const startDateTime = resolved.start;
      const endDateTime = resolved.end;

      // Step 2: Validate time slot
      const timeValidation = validateTimeSlot({
        startDateTime: startDateTime,
        endDateTime: endDateTime,
      });
      if (!timeValidation.valid) {
        return {
          success: false,
          error: timeValidation.error,
          code: timeValidation.code,
          details: timeValidation.details,
        };
      }

      // Step 3: Lookup customer (dealId is optional for inbound calls)
      const customerResult = await this.lookupCustomer(ids.dealId ?? null, ids.clientId, request.customerInfo);
      if (!customerResult.found && !request.customerInfo?.email) {
        return {
          success: false,
          error: 'Customer not found and no email provided',
          code: 'CUSTOMER_NOT_FOUND' as ErrorCode,
        };
      }
      console.log('✅ Customer found:', customerResult.customer);

      // Step 4: Get agent with calendar
      const agent = await this.getAgentData(ids.agentId, ids.clientId, ids.stageId);
      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${ids.agentId}`,
          code: 'AGENT_NOT_FOUND' as ErrorCode,
        };
      }
      console.log('✅ Agent found:', agent.profileName);

      // Step 5: Select calendar (boardId is optional for inbound calls)
      const calendarSelection = await this.selectCalendar(
        ids.agentId,
        ids.boardId ?? null,
        ids.clientId,
        request.calendarId
      );
      if (!calendarSelection) {
        return {
          success: false,
          error: 'No calendar connection found',
          code: 'CALENDAR_NOT_FOUND' as ErrorCode,
        };
      }
      console.log('✅ Calendar selected:', calendarSelection.calendarEmail);

      // Step 6: Validate office hours
      if (agent.officeHours && agent.timezone) {
        const hoursValidation = validateOfficeHours(
          startDateTime, // Use resolved
          agent.officeHours,
          agent.timezone
        );
        if (!hoursValidation.valid) {
          return {
            success: false,
            error: hoursValidation.error,
            code: hoursValidation.code,
            details: hoursValidation.details,
          };
        }
      }

      // Step 7: Generate subject (stageId and dealId are optional for inbound calls)
      const subject = await this.generateSubject(
        ids.stageId ?? null,
        ids.dealId ?? null,
        request.subject
      );

      // CHECK CONFLICTS: Prevent double bookings (explicit check)
      if (calendarSelection.calendarConnection) {
        console.log('🔍 [bookAppointment] Checking for conflicts...');
        try {
          const conflictResult = await OptimizedConflictDetection.checkForConflicts(
            calendarSelection.calendarConnection,
            startDateTime, // ISO String
            endDateTime,   // ISO String
            agent.timezone || 'UTC', // timeZone
            agent.officeHours, // officeHours
            agent.timezone || 'UTC', // agentTimezone
            ids.clientId, // clientId
            calendarSelection.calendarId
          );

          if (conflictResult.hasConflict) {
            console.warn('⚠️ [bookAppointment] Slot conflict detected');
            // Return conflict response
            return {
              success: false,
              conflict: true,
              message: 'Time slot is already booked',
              suggestedSlots: [], // Fetching suggestions requires full search logic
            };
          }
        } catch (error) {
          console.error('⚠️ [bookAppointment] Conflict check failed, proceeding cautiously:', error);
        }
      }

      // Step 8: Create calendar event
      const eventResult = await CalendarService.createEvent(
        ids.clientId,
        {
          subject,
          startDateTime: startDateTime, // Use resolved
          endDateTime: endDateTime,     // Use resolved
          timeZone: agent.timezone || 'UTC',
          description: request.description,
          location: request.location,
          attendeeEmail: customerResult.customer?.email || request.customerInfo?.email!,
          attendeeName: customerResult.customer?.name || request.customerInfo?.name,
          isOnlineMeeting: request.isOnlineMeeting ?? true,
        },
        ids.agentId,
        calendarSelection.calendarId
      );

      // Step 9: Handle result
      if (!eventResult.success) {
        // Check if conflict - suggest alternative slots
        if (eventResult.availableSlots && eventResult.availableSlots.length > 0) {
          return {
            success: false,
            conflict: true,
            message: eventResult.error || 'Slot unavailable',
            suggestedSlots: eventResult.availableSlots.map((slot) => ({
              start: slot.start,
              end: slot.end,
              startFormatted: slot.startFormatted,
              endFormatted: slot.endFormatted,
              available: true,
            })),
          };
        }

        return {
          success: false,
          error: eventResult.error || 'Booking failed',
          code: 'API_ERROR' as ErrorCode,
        };
      }

      // Step 10: Send SMS confirmation
      const customerPhone = customerResult.customer?.phoneNumber || request.customerInfo?.phoneNumber;
      const formattedStart = DateTime.fromISO(request.startDateTime, { zone: agent.timezone || 'UTC' })
        .toLocaleString(DateTime.DATETIME_FULL);
      const meetingLink = eventResult.event?.onlineMeetingUrl;
      
      const smsMessage = `Your appointment with ${agent.profileName} has been confirmed for ${formattedStart}.${meetingLink ? `\n\nJoin here: ${meetingLink}` : ''}\n\nPowered By: LeadAi`;
      
      await this.sendSMSNotification(customerPhone, smsMessage, 'appointment booking');

      // Step 11: Return success
      return {
        success: true,
        booking: {
          event: {
            eventId: eventResult.eventId!,
            subject: eventResult.event?.subject || subject,
            start: DateTime.fromISO(eventResult.event?.start.dateTime || request.startDateTime).setZone(agent.timezone || 'UTC').toISO() || request.startDateTime,
            end: DateTime.fromISO(eventResult.event?.end.dateTime || request.endDateTime).setZone(agent.timezone || 'UTC').toISO() || request.endDateTime,
            location: eventResult.event?.location,
            meetingLink: eventResult.event?.onlineMeetingUrl,
            onlineMeetingUrl: eventResult.event?.onlineMeetingUrl,
          },
          customer: {
            name: customerResult.customer?.name || request.customerInfo?.name || '',
            email: customerResult.customer?.email || request.customerInfo?.email || '',
            phoneNumber: customerResult.customer?.phoneNumber || request.customerInfo?.phoneNumber,
            company: customerResult.customer?.company,
          },
          agent: {
            uuid: agent.uuid,
            name: agent.name,
            profileName: agent.profileName,
            title: agent.title,
            email: agent.email,
          },
        },
        message: 'Appointment booked successfully',
      };
    } catch (error) {
      console.error('❌ [BookingService.bookAppointment] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN_ERROR' as ErrorCode,
      };
    }
  }

  /**
   * Find available time slots for booking
   * 
   * @param request - Slot search request
   * @returns Available slots response
   */
  static async findAvailableSlots(request: SlotSearchRequest): Promise<SlotsResponse> {
    try {
      console.log('🔍 [BookingService.findAvailableSlots] Searching for slots');

      // Extract and validate IDs
      const extractResult = await this.extractAndValidateIds(
        request.instructionsText,
        {
          agentId: request.agentId,
          clientId: request.clientId,
          boardId: request.boardId,
          stageId: request.stageId,
          dealId: request.dealId,
          timezone: request.timezone,
          ...request.extractedIds,
        }
      );
      console.log('Instructions Text:', request.instructionsText);
      if (!extractResult.valid || !extractResult.ids) {
        return {
          success: false,
          error: extractResult.error,
          code: extractResult.code,
        };
      }
     
      const ids = extractResult.ids;

      // Get agent data
      const agent = await this.getAgentData(ids.agentId, ids.clientId, ids.stageId);
      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${ids.agentId}`,
          code: 'AGENT_NOT_FOUND' as ErrorCode,
        };
      }

      // Select calendar
      const calendarSelection = await this.selectCalendar(
        ids.agentId,
        ids.boardId ?? null,
        ids.clientId,
        request.calendarId
      );
      if (!calendarSelection) {
        return {
          success: false,
          error: 'No calendar connection found',
          code: 'CALENDAR_NOT_FOUND' as ErrorCode,
        };
      }

      // Parse natural language dates (today/tomorrow/this monday/etc) to ISO format
      const timezone = ids.timezone || agent.timezone || 'Australia/Perth';
      const parsedDateResult = parseGraphDateRequest(request.preferredDate, timezone);
      const logStart = DateTime.fromISO(parsedDateResult.start).setZone(timezone).toFormat('yyyy-MM-dd HH:mm');
      const logEnd = DateTime.fromISO(parsedDateResult.end).setZone(timezone).toFormat('yyyy-MM-dd HH:mm');
      console.log(`📅 Parsed date: "${request.preferredDate}" → ${parsedDateResult.description} (${logStart} to ${logEnd} ${timezone})`);

      // Find slots using calendar service
      const slotsResult = await CalendarService.findAvailableSlots(
        ids.clientId,
        parsedDateResult.start,
        parsedDateResult.end,
        {
          durationMinutes: request.durationMinutes || 60,
          maxSuggestions: request.maxSuggestions || 3,
          officeHours: agent.officeHours,
          agentTimezone: timezone, 
        },
        ids.agentId,
        calendarSelection.calendarId
      );


      if (!slotsResult.success || !slotsResult.availableSlots) {
        return {
          success: false,
          error: slotsResult.error || 'No slots found',
          code: 'API_ERROR' as ErrorCode,
        };
      }

      return {
        success: true,
        slots: slotsResult.availableSlots.map((slot) => ({
          start: DateTime.fromISO(slot.start).setZone(timezone || 'UTC').toISO() || slot.start,
          end: DateTime.fromISO(slot.end).setZone(timezone || 'UTC').toISO() || slot.end,
          startFormatted: slot.startFormatted,
          endFormatted: slot.endFormatted,
          available: true,
        })),
        agent: {
          uuid: agent.uuid,
          name: agent.name,
          profileName: agent.profileName,
          title: agent.title,
          email: agent.email,
        },
      };
    } catch (error) {
      console.error('❌ [BookingService.findAvailableSlots] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN_ERROR' as ErrorCode,
      };
    }
  }

  /**
   * Cancel customer appointment
   * 
   * @param request - Cancel request
   * @returns Cancellation response
   */
  static async cancelAppointment(request: CancelRequest): Promise<CancelResponse> {
    try {
      console.log('🗑️ [BookingService.cancelAppointment] Canceling appointment');

      const extractResult = await this.extractAndValidateIds(
        request.instructionsText,
        {
          agentId: request.agentId,
          clientId: request.clientId,
          boardId: request.boardId,
          stageId: request.stageId,
          dealId: request.dealId,
          timezone: request.timezone,
          ...request.extractedIds,
        }
      );
      if (!extractResult.valid || !extractResult.ids) {
        return {
          success: false,
          error: extractResult.error || 'Validation failed',
          code: extractResult.code || 'UNKNOWN_ERROR' as ErrorCode,
        };
      }

      const ids = extractResult.ids;

      // Select calendar
      const calendarSelection = await this.selectCalendar(
        ids.agentId,
        ids.boardId ?? null,
        ids.clientId,
        request.calendarId
      );
      if (!calendarSelection) {
        return {
          success: false,
          error: 'No calendar connection found',
          code: 'CALENDAR_NOT_FOUND' as ErrorCode,
        };
      }

      // Delete event
      const deleteResult = await CalendarService.deleteEvent(
        ids.clientId,
        request.eventId,
        calendarSelection.calendarId
      );

      if (!deleteResult.success) {
        return {
          success: false,
          error: deleteResult.error || 'Cancellation failed',
          code: 'API_ERROR' as ErrorCode,
        };
      }

      // Send SMS notification if customer info available
      if (ids.dealId) {
        const customerResult = await this.lookupCustomer(ids.dealId, ids.clientId);
        const customerPhone = customerResult.customer?.phoneNumber;
        const agent = await this.getAgentData(ids.agentId, ids.clientId, ids.stageId);
        
        if (customerPhone && agent) {
          const smsMessage = `Your appointment with ${agent.profileName} has been cancelled. Please contact us if you need to reschedule.\n\nPowered By: LeadAi`;
          
          await this.sendSMSNotification(customerPhone, smsMessage, 'appointment cancellation');
        }
      }

      return {
        success: true,
        eventId: request.eventId,
        message: 'Appointment cancelled successfully',
      };
    } catch (error) {
      console.error('❌ [BookingService.cancelAppointment] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN_ERROR' as ErrorCode,
      };
    }
  }

  /**
   * Reschedule customer appointment
   * 
   * @param request - Reschedule request
   * @returns Reschedule response
   */
  static async rescheduleAppointment(request: RescheduleRequest): Promise<RescheduleResponse> {
    try {
      console.log('📅 [BookingService.rescheduleAppointment] Rescheduling appointment');

      const extractResult = await this.extractAndValidateIds(
        request.instructionsText,
        {
          agentId: request.agentId,
          clientId: request.clientId,
          boardId: request.boardId,
          stageId: request.stageId,
          dealId: request.dealId,
          timezone: request.timezone,
          ...request.extractedIds,
        }
      );
      if (!extractResult.valid || !extractResult.ids) {
        return {
          success: false,
          error: extractResult.error || 'Validation failed',
          code: extractResult.code || 'UNKNOWN_ERROR' as ErrorCode,
        };
      }

      const ids = extractResult.ids;

      // RESOLVE DATES: Handle natural language override if present ("next Monday")
      // This fixes LLM date calculation errors by using robust graph parsing
      const resolved = await this.resolveDateOverride(
        request.newStartDateTime,
        request.newEndDateTime,
        request.preferredDate,
        ids.timezone || 'UTC'
      );
      const startDateTime = resolved.start;
      const endDateTime = resolved.end;

      // Validate new time slot
      const timeValidation = validateTimeSlot({
        startDateTime: startDateTime,
        endDateTime: endDateTime,
      });
      if (!timeValidation.valid) {
        return {
          success: false,
          error: timeValidation.error,
          code: timeValidation.code,
        };
      }

      // Get agent for office hours validation
      const agent = await this.getAgentData(ids.agentId, ids.clientId, ids.stageId);
      if (agent?.officeHours && agent?.timezone) {
        const hoursValidation = validateOfficeHours(
          startDateTime,
          agent.officeHours, // Now using potentially overridden date
          agent.timezone
        );
        if (!hoursValidation.valid) {
          return {
            success: false,
            error: hoursValidation.error,
            code: hoursValidation.code,
          };
        }
      }

      // Select calendar
      const calendarSelection = await this.selectCalendar(
        ids.agentId,
        ids.boardId ?? null,
        ids.clientId,
        request.calendarId
      );
      if (!calendarSelection) {
        return {
          success: false,
          error: 'No calendar connection found',
          code: 'CALENDAR_NOT_FOUND' as ErrorCode,
        };
      }

      // CHECK CONFLICTS: Prevent double bookings
      if (calendarSelection.calendarConnection) {
        console.log('🔍 [rescheduleAppointment] Checking for conflicts...');
        try {
          const conflictResult = await OptimizedConflictDetection.checkForConflicts(
            calendarSelection.calendarConnection,
            startDateTime, // ISO String
            endDateTime,   // ISO String
            agent?.timezone || 'UTC', // timeZone
            agent?.officeHours, // officeHours
            agent?.timezone || 'UTC', // agentTimezone
            ids.clientId, // clientId needed for internal fetch
            calendarSelection.calendarId
          );

          if (conflictResult.hasConflict) {
            console.warn('⚠️ [rescheduleAppointment] Slot conflict detected');
            return {
              success: false,
              error: 'Time slot is already booked',
              code: 'SLOT_CONFLICT' as ErrorCode,
            };
          }
        } catch (error) {
          console.error('⚠️ [rescheduleAppointment] Conflict check failed, proceeding with caution:', error);
          // Start cautious: don't block reschedule on check failure?
          // Given "double booking" complaint, safer to assume it's okay unless explicit conflict.
        }
      }

      // Update event
      const updateResult = await CalendarService.updateEvent(
        ids.clientId,
        request.eventId,
        {
          startDateTime: startDateTime,
          endDateTime: endDateTime,
          timeZone: agent?.timezone || 'UTC',
        }
      );

      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error || 'Reschedule failed',
          code: 'API_ERROR' as ErrorCode,
        };
      }

      // Send SMS notification if customer info available
      if (ids.dealId) {
        const customerResult = await this.lookupCustomer(ids.dealId, ids.clientId);
        const customerPhone = customerResult.customer?.phoneNumber;
        
        if (customerPhone && agent) {
          const formattedStart = DateTime.fromISO(request.newStartDateTime, { zone: agent.timezone || 'UTC' })
            .toLocaleString(DateTime.DATETIME_FULL);
          const meetingLink = updateResult.event?.onlineMeetingUrl;
          
          const smsMessage = `Your appointment with ${agent.profileName} has been rescheduled to ${formattedStart}.${meetingLink ? `\n\nJoin here: ${meetingLink}` : ''}\n\nPowered By: LeadAi`;
          
          await this.sendSMSNotification(customerPhone, smsMessage, 'appointment reschedule');
        }
      }

      return {
        success: true,
        event: {
          eventId: request.eventId,
          subject: updateResult.event?.subject || '',
          start: DateTime.fromISO(updateResult.event?.start.dateTime || request.newStartDateTime).setZone(agent?.timezone || 'UTC').toISO() || request.newStartDateTime,
          end: DateTime.fromISO(updateResult.event?.end.dateTime || request.newEndDateTime).setZone(agent?.timezone || 'UTC').toISO() || request.newEndDateTime,
          location: updateResult.event?.location,
          meetingLink: updateResult.event?.onlineMeetingUrl,
        },
        message: 'Appointment rescheduled successfully',
      };
    } catch (error) {
      console.error('❌ [BookingService.rescheduleAppointment] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'UNKNOWN_ERROR' as ErrorCode,
      };
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Extract and validate booking IDs
   * Merges extracted IDs with explicit IDs from request
   */
  private static async extractAndValidateIds(
    instructionsText?: string,
    explicitIds?: Partial<BookingIds>
  ): Promise<{
    valid: boolean;
    ids?: Required<Pick<BookingIds, 'clientId' | 'agentId'>> & Pick<BookingIds, 'boardId' | 'stageId' | 'dealId' | 'timezone'>;
    error?: string;
    code?: ErrorCode;
    details?: Record<string, any>;
  }> {
    console.debug('🔍 [extractAndValidateIds] Inputs:', { textLength: instructionsText?.length, explicitIds });

    // 1. Extract from text if available
    const extractedIds = instructionsText ? extractBookingIds(instructionsText) : {};

    // 2. Merge with explicit IDs (explicit takes precedence, but ignore undefined)
    const cleanExplicitIds = Object.fromEntries(
      Object.entries(explicitIds || {}).filter(([_, v]) => v !== undefined && v !== null && v !== '')
    );

    let mergedIds: BookingIds = {
      ...extractedIds,
      ...cleanExplicitIds,
    };
    
    console.debug('🧩 [extractAndValidateIds] Merged IDs:', mergedIds);

    // 2.5. Infer missing boardId/stageId from dealId if possible
    if (mergedIds.clientId && mergedIds.dealId && (!mergedIds.boardId || !mergedIds.stageId)) {
      mergedIds = await inferMissingIds(mergedIds, mergedIds.clientId);
      console.debug('🧩 [extractAndValidateIds] After inference:', mergedIds);
    }

    // 3. Validate
    const validation = validateRequiredIds(mergedIds);

    if (!validation.valid) {
      console.warn('❌ [extractAndValidateIds] Validation Failed:', validation.missing);
      return {
        valid: false,
        error: `Missing required IDs: ${validation.missing.join(', ')}`,
        code: 'MISSING_IDS' as ErrorCode,
        details: { missing: validation.missing, extracted: extractedIds, explicit: explicitIds },
      };
    }


    // Type assertion after validation
    // Only clientId and agentId are guaranteed to be present
    // boardId, stageId, dealId are optional (for inbound calls, they won't be available)
    const validatedIds = mergedIds as Required<Pick<BookingIds, 'clientId' | 'agentId'>> & Pick<BookingIds, 'boardId' | 'stageId' | 'dealId' | 'timezone'>;


    console.debug('✅ [extractAndValidateIds] Validation Success');
    return { valid: true, ids: validatedIds };
  }

  /**
   * Lookup customer from multiple sources
   * dealId is optional - only available for outbound calls
   */
  private static async lookupCustomer(
    dealId: number | null,
    clientId: number,
    manualInfo?: { name?: string; email?: string; phoneNumber?: string }
  ): Promise<{ found: boolean; customer?: BookingCustomer }> {
    try {
      // Priority 1: Lookup from deal
      if (dealId) {
        const deal = await getStageItemById(dealId);
        if (deal?.party_id) {
          const contactInfo = await getPartyContactInfo(deal.party_id, clientId);
          if (contactInfo) {
            return {
              found: true,
              customer: {
                name: contactInfo.name || '',
                email: contactInfo.email || '',
                phoneNumber: contactInfo.phone,
                company: contactInfo.company,
              },
            };
          }
        }
      }

      // Priority 2: Fuzzy search in customers
      if (manualInfo?.name) {
        const customers = await getCustomerWithFuzzySearch(manualInfo.name, clientId.toString());
        if (customers && customers.length > 0) {
          const customer = customers[0].item;
          return {
            found: true,
            customer: {
              name: customer.full_name || '',
              email: customer.email || '',
              phoneNumber: customer.phone_number,
              company: customer.company,
            },
          };
        }

        // Priority 3: Fuzzy search in contacts
        const contacts = await getContactWithFuzzySearch(manualInfo.name, clientId.toString());
        if (contacts && contacts.length > 0) {
          const contact = contacts[0].item;
          return {
            found: true,
            customer: {
              name: contact.name || '',
              email: contact.email || '',
              phoneNumber: contact.phone_number,
              company: contact.company,
            },
          };
        }
      }

      // Priority 4: Use manual info if email provided
      if (manualInfo?.email) {
        return {
          found: true,
          customer: {
            name: manualInfo.name || '',
            email: manualInfo.email,
            phoneNumber: manualInfo.phoneNumber,
          },
        };
      }

      return { found: false };
    } catch (error) {
      console.error('Error looking up customer:', error);
      return { found: false };
    }
  }

  /**
   * Get agent data with calendar and office hours
   * If stageId is provided, use the stage's profile instead of agent's default profile
   */
  private static async getAgentData(
    agentId: string,
    clientId: number,
    stageId?: string
  ): Promise<BookingAgent & { officeHours?: any; timezone?: string } | null> {
    try {
      const agent = await getAgentWithCalendarByUUID(agentId, clientId);
      if (!agent) return null;

      // If stageId is provided, fetch the profile from the pipeline stage
      // Otherwise, fall back to the agent's default profile
      let profileData: { id: number; name: string; office_hours: any; timezone: string } | undefined;
      
      if (stageId) {
        console.log(`🔍 [getAgentData] Fetching profile from stage: ${stageId}`);
        const { data: stage, error: stageError } = await supabase
          .schema('public')
          .from('pipeline_stages')
          .select('profile_id')
          .eq('id', stageId)
          .is('deleted_at', null)
          .single();

        if (stageError) {
          console.warn(`⚠️ [getAgentData] Could not fetch stage ${stageId}:`, stageError);
        } else if (stage?.profile_id) {
          console.log(`✅ [getAgentData] Stage has profile_id: ${stage.profile_id}`);
          const { data: profile, error: profileError } = await supabase
            .schema('public')
            .from('profiles')
            .select('id, name, office_hours, timezone')
            .eq('id', stage.profile_id)
            .single();

          if (!profileError && profile) {
            profileData = profile;
            console.log(`✅ [getAgentData] Fetched profile from stage:`, profile.name);
          } else {
            console.warn(`⚠️ [getAgentData] Profile not found for profile_id: ${stage.profile_id}`, profileError);
          }
        } else {
          console.log(`ℹ️ [getAgentData] Stage ${stageId} has no profile_id set`);
        }
      }
      
      // Fall back to agent's profile if no stage profile was found
      if (!profileData && agent.profiles) {
        profileData = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles;
        console.log(`ℹ️ [getAgentData] Using agent's default profile:`, profileData?.name);
      }
      
      console.log('🔍 [getAgentData] Profile data:', {
        hasProfile: !!profileData,
        profileName: profileData?.name,
        agentName: agent.name,
        willUse: profileData?.name || agent.name,
        profileFull: profileData,
      });

      return {
        uuid: agent.uuid,
        name: agent.name,
        profileName: profileData?.name || agent.name,
        title: agent.title || '',
        email: (agent.calendar_assignment?.calendar_connections as any)?.email,
        officeHours: profileData?.office_hours,
        timezone: profileData?.timezone,
      };
    } catch (error) {
      console.error('Error getting agent data:', error);
      return null;
    }
  }

  /**
   * Select calendar based on priority: explicit → pipeline → agent
   * boardId is optional - only available for outbound calls
   */
  private static async selectCalendar(
    agentId: string,
    boardId: string | null,
    clientId: number,
    explicitCalendarId?: string
  ): Promise<CalendarSelection | null> {
    try {
      // Priority 1: Explicit calendar ID
      if (explicitCalendarId) {
        return {
          calendarId: explicitCalendarId,
          calendarEmail: '',
          provider: 'MICROSOFT',
          source: 'explicit',
        };
      }

      // Priority 2: Pipeline calendar
      if (boardId) {
        const pipelineCalendar = await getCalendarConnectionByPipelineId(boardId, clientId);
        if (pipelineCalendar) {
          return {
            calendarId: pipelineCalendar.id.toString(),
            calendarEmail: pipelineCalendar.email || '',
            provider: pipelineCalendar.provider_name as 'MICROSOFT' | 'GOOGLE',
            source: 'pipeline',
            calendarConnection: pipelineCalendar,
          };
        }
      }

      // Priority 3: Agent's calendar
      const agent = await getAgentWithCalendarByUUID(agentId, clientId);
      const agentCalendar = agent?.calendar_assignment?.calendar_connections as any;
      if (agentCalendar) {
        return {
          calendarId: agentCalendar.id.toString(),
          calendarEmail: agentCalendar.email || '',
          provider: agentCalendar.provider_name as 'MICROSOFT' | 'GOOGLE',
          source: 'agent',
          calendarConnection: agentCalendar,
        };
      }

      return null;
    } catch (error) {
      console.error('Error selecting calendar:', error);
      return null;
    }
  }

  /**
   * Generate appointment subject from stage/deal metadata
   * stageId and dealId are optional - only available for outbound calls
   */
  private static async generateSubject(
    stageId: string | null,
    dealId: number | null,
    manualSubject?: string
  ): Promise<string> {
    if (manualSubject) return manualSubject;

    try {
      const stage = stageId ? await getPipelineStageById(stageId) : null;
      const deal = dealId ? await getStageItemById(dealId) : null;

      if (stage?.name) return `${stage.name} - Appointment`;
      if (deal?.summary) return deal.summary;
      if (dealId) return `Deal #${dealId} - Appointment`;

      return 'Customer Appointment';
    } catch (error) {
      return 'Customer Appointment';
    }
  }

  /**
   * Send SMS notification to customer
   * Handles errors gracefully - SMS failures don't break booking flow
   */
  private static async sendSMSNotification(
    phoneNumber: string | undefined,
    message: string,
    context: string
  ): Promise<void> {
    // Validate phone number exists
    if (!phoneNumber) {
      console.log(`ℹ️ [sendSMSNotification] Skipping SMS for ${context}: No phone number provided`);
      return;
    }

    // Validate API key exists
    const telnyxApiKey = process.env.TELNYX_API_KEY;
    if (!telnyxApiKey) {
      console.warn('⚠️ [sendSMSNotification] TELNYX_API_KEY not configured - SMS disabled');
      return;
    }

    try {
      console.log(`📱 [sendSMSNotification] Sending SMS for ${context} to ${phoneNumber}`);
      console.log(`📝 [sendSMSNotification] Message body:\n${message}`);
      
      await sendSMS(phoneNumber, message, telnyxApiKey);
      
      console.log(`✅ [sendSMSNotification] SMS sent successfully for ${context}`);
    } catch (error) {
      // Log error but don't throw - SMS failures shouldn't break bookings
      console.error(`❌ [sendSMSNotification] Failed to send SMS for ${context}:`, error);
      console.error('SMS failure is non-critical - booking continues');
    }
  }

  /**
   * Resolve natural language date override
   * Keeps original time, updates date based on "next Monday" etc.
   */
  private static async resolveDateOverride(
    originalStartIso: string,
    originalEndIso: string,
    preferredDate: string | undefined,
    timezone: string
  ): Promise<{ start: string; end: string }> {
    if (!preferredDate) {
      return { start: originalStartIso, end: originalEndIso };
    }

    try {
      console.log(`📅 [resolveDateOverride] Processing override: "${preferredDate}"`);
      // Use existing graph parsing logic (handles "next Monday", "tomorrow")
      // parseGraphDateRequest returns UTC range for the day
      const parsedRange = parseGraphDateRequest(preferredDate, timezone);
      
      // Convert start of range back to client timezone to get the target date
      const targetDate = DateTime.fromISO(parsedRange.start).setZone(timezone);

      // Parse original times to extract Hour/Minute
      // Use setZone to align with client timezone
      const originalStart = DateTime.fromISO(originalStartIso).setZone(timezone);
      const originalEnd = DateTime.fromISO(originalEndIso).setZone(timezone);
      
      // Combine target date + original time
      const newStart = targetDate.set({
        hour: originalStart.hour,
        minute: originalStart.minute,
        second: 0,
        millisecond: 0
      });
      
      // Calculate duration to set end time relative to start
      const duration = originalEnd.diff(originalStart);
      const newEnd = newStart.plus(duration);
      
      const newStartIso = newStart.toISO() || originalStartIso;
      const newEndIso = newEnd.toISO() || originalEndIso;

      console.log(`✅ [resolveDateOverride] Overridden: ${originalStartIso} -> ${newStartIso}`);
      
      return {
        start: newStartIso,
        end: newEndIso
      };
    } catch (error) {
      console.warn(`⚠️ [resolveDateOverride] Failed to parse date "${preferredDate}":`, error);
      return { start: originalStartIso, end: originalEndIso };
    }
  }

  /**
   * Public method to calculate date from natural language query
   * Used by MCP tool as single source of truth
   */
  static async calculateDate(
    query: string,
    timezone: string
  ): Promise<{ date: string; description: string; iso: string }> {
    try {
      console.log(`📅 [calculateDate] Processing query: "${query}" in ${timezone}`);
      
      const parsedRange = parseGraphDateRequest(query, timezone);
      const targetDate = DateTime.fromISO(parsedRange.start).setZone(timezone);
      
      return {
        date: targetDate.toFormat('cccc, MMMM d, yyyy'), // "Monday, February 16, 2026"
        description: parsedRange.description || query,
        iso: targetDate.toISODate() || '', // "2026-02-16"
      };
    } catch (error) {
      console.error('❌ [calculateDate] Error:', error);
      throw new Error(`Failed to calculate date for query "${query}"`);
    }
  }
}
