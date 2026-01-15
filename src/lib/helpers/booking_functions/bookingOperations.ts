/**
 * Booking Operations Service Layer
 * Handles customer appointment booking with agent calendar integration
 */

import { CalendarService } from "../calendar_functions/calendar-service";
import type { CreateEventRequest } from "../calendar_functions/providers/types";
import {
  getAgentWithCalendarByUUID,
  getAgentsForClient,
  validateAgentHasCalendar,
  getCustomerWithFuzzySearch,
  getContactWithFuzzySearch,
  isWithinOfficeHours,
} from "../utils";
import { DateTime } from "luxon";
import type {
  BookCustomerAppointmentRequest,
  BookingOperationResponse,
  FindBookingSlotsRequest,
  BookingSlot,
  ListAgentsRequest,
  AgentSummary,
  CancelCustomerAppointmentRequest,
  RescheduleCustomerAppointmentRequest,
  BookingValidation,
  Customer,
  AgentWithCalendar,
} from "@/types";

export class BookingOperations {
  /**
   * Book a customer appointment with an agent
   * Validates agent, customer, calendar connection, and creates the event
   */
  static async bookCustomerAppointment(
    request: BookCustomerAppointmentRequest
  ): Promise<BookingOperationResponse> {
    console.log("[BookingOperations] Starting customer appointment booking");
    console.table(request);

    try {
      // Step 1: Validate agent and calendar
      console.log(`Validating agent: ${request.agentId}`);
      const validation = await validateAgentHasCalendar(
        request.agentId,
        request.clientId
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Step 2: Get full agent details with calendar
      const agent = await getAgentWithCalendarByUUID(
        request.agentId,
        request.clientId
      );

      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${request.agentId}`,
        };
      }

      console.log(`Agent validated: ${agent.name}`);

      // Step 3: Search for customer/contact in database
      console.log(`Searching for customer/contact: "${request.customerName}"`);
      let customer: Customer | null = null;
      let customerEmail = request.customerEmail;
      let customerPhoneNumber = request.customerPhoneNumber;
      let customerDisplayName = request.customerName;
      let searchSource: "customer" | "contact" | "manual" = "manual";

      // First, try searching in customers database
      try {
        const customerResults = await getCustomerWithFuzzySearch(
          request.customerName,
          request.clientId.toString()
        );

        if (customerResults && customerResults.length > 0) {
          const bestMatch = customerResults[0];
          customer = bestMatch.item as unknown as Customer;

          console.log(`Found in customers:`, {
            score: bestMatch.score,
            name: customer.full_name,
            email: customer.email,
            company: customer.company,
          });

          
          // Use customer email and phone if available and not overridden
          if (customer.email && !request.customerEmail) {
            customerEmail = customer.email;
            customerDisplayName = customer.full_name;
            searchSource = "customer";
          }
          if (customer.phone && !request.customerPhoneNumber) {
            customerPhoneNumber = customer.phone;
          }
        }
      } catch (error) {
        console.error("Error searching customers:", error);
      }

      // If not found in customers, try searching in contacts
      if (!customerEmail && !request.customerEmail) {
        try {
          const contactResults = await getContactWithFuzzySearch(
            request.customerName,
            request.clientId.toString()
          );

          if (contactResults && contactResults.length > 0) {
            const bestMatch = contactResults[0];
            const contact = bestMatch.item as {
              id: number;
              name?: string;
              first_name?: string;
              last_name?: string;
              email?: string;
              phone_number?: string;
              company?: string;
            };

            console.log(`Found in contacts:`, {
              score: bestMatch.score,
              name: contact.name,
              email: contact.email,
              company: contact.company,
            });

            // Use contact email and phone if available
            if (contact.email) {
              customerEmail = contact.email;
              customerDisplayName = contact.name || 
                `${contact.first_name || ""} ${contact.last_name || ""}`.trim() ||
                request.customerName;
              searchSource = "contact";
            }
            if (contact.phone_number && !request.customerPhoneNumber) {
              customerPhoneNumber = contact.phone_number;
            }
          } else {
            console.log(`Not found in contacts: "${request.customerName}"`);
          }
        } catch (error) {
          console.error("Error searching contacts:", error);
        }
      }

      // Validate that we have either email or phone number for communication
      if (!customerEmail && !customerPhoneNumber) {
        return {
          success: false,
          error: `"${request.customerName}" not found in customers or contacts. Please provide either customerEmail or customerPhoneNumber to book the appointment.`,
        };
      }

      if (customerEmail) {
        console.log(`Using email: ${customerEmail} (source: ${searchSource})`);
      }
      if (customerPhoneNumber) {
        console.log(`Using phone: ${customerPhoneNumber} (source: ${searchSource})`);
      }

      // Step 4: Validate time is not in the past
      const now = new Date();
      const requestedStart = new Date(request.startDateTime);
      const minimumAdvanceMinutes = 15;
      const minimumBookingTime = new Date(
        now.getTime() + minimumAdvanceMinutes * 60 * 1000
      );

      if (requestedStart <= minimumBookingTime) {
        const timeDifference = Math.floor(
          (requestedStart.getTime() - now.getTime()) / (1000 * 60)
        );
        const errorMessage =
          timeDifference <= 0
            ? `INVALID TIME: Cannot book in the past.\n\nEarliest available: ${minimumBookingTime.toLocaleString()}`
            : `TOO SOON: Minimum ${minimumAdvanceMinutes} minutes advance required.\n\nEarliest available: ${minimumBookingTime.toLocaleString()}`;

        return {
          success: false,
          error: errorMessage,
        };
      }

      console.log(`Booking time is valid`);

      // Step 5: Check office hours if agent has profile
      const profile = Array.isArray(agent.profiles)
        ? agent.profiles[0]
        : agent.profiles;

      if (profile && profile.office_hours) {
        const officeHoursCheck = isWithinOfficeHours(
          request.startDateTime,
          profile.office_hours as Record<
            string,
            { start: string; end: string; enabled: boolean }
          >,
          profile.timezone || "Australia/Melbourne"
        );

        if (!officeHoursCheck.isWithin) {
          return {
            success: false,
            error: `OUTSIDE OFFICE HOURS\n\n${officeHoursCheck.reason}\n\nAgent: ${agent.name}`,
          };
        }

        console.log(`Requested time is within office hours`);
      }

      // Step 6: Create calendar event using unified CalendarService
      // Generate a simple default description if none provided
      const defaultDescription = request.description || 
        `Scheduled appointment with ${customerDisplayName}`;

      // Default subject to customer name if not provided
      const eventSubject = request.subject || customerDisplayName || 'Appointment';

      console.log(`Creating calendar event via ${validation.calendarProvider}`);

      // Get client timezone
      const clientData = await import('../cache/advancedCacheService').then(m => 
        m.AdvancedCacheService.getClientCalendarData(request.clientId)
      );
      const timeZone = clientData?.timezone || 'Australia/Melbourne';

      // Use unified CalendarService (supports both Microsoft and Google)
      // Email is optional - we can book with just phone number and send SMS
      const calendarServiceRequest: CreateEventRequest = {
        subject: eventSubject,
        startDateTime: request.startDateTime,
        endDateTime: request.endDateTime,
        timeZone,
        description: defaultDescription,
        location: request.location,
        attendeeEmail: customerEmail || '', // Optional - can be empty if we have phone number
        attendeeName: customerDisplayName,
        isOnlineMeeting: request.isOnlineMeeting,
      };

      const result = await CalendarService.createEvent(
        request.clientId,
        calendarServiceRequest,
        request.agentId // Pass agentId to use agent's assigned calendar
      );

      if (!result.success) {
        // Map available slots if present (from conflict detection)
        const conflictSlots: BookingSlot[] | undefined = result.availableSlots
          ? result.availableSlots.map((slot) => ({
              start: slot.start,
              end: slot.end,
              startFormatted: slot.startFormatted,
              endFormatted: slot.endFormatted,
              isWithinOfficeHours: true,
              agentName: agent.name,
              agentEmail:
                (
                  agent.calendar_assignment?.calendar_connections as unknown as {
                    email?: string;
                  }
                )?.email || "",
            }))
          : undefined;

        return {
          success: false,
          error: result.error,
          availableSlots: conflictSlots,
          conflictDetails: result.error,
        };
      }

      console.log(`Appointment booked successfully: ${result.eventId}`);

      // Map CalendarEvent to BookingOperationResponse format
      const bookingEvent = result.event ? {
        id: result.event.id,
        subject: result.event.subject,
        start: result.event.start,
        end: result.event.end,
        location: result.event.location ? {
          displayName: result.event.location,
        } : undefined,
        attendees: result.event.attendees?.map(a => ({
          emailAddress: {
            name: a.name,
            address: a.email,
          },
        })),
        onlineMeeting: result.event.onlineMeetingUrl ? {
          joinUrl: result.event.onlineMeetingUrl,
        } : undefined,
      } : undefined;

      // Send SMS with booking link if phone number is available
      if (customerPhoneNumber && result.event) {
        try {
          // Prioritize meeting link (onlineMeetingUrl) over calendar link (webLink)
          const bookingLink = result.event.onlineMeetingUrl || result.event.webLink;
          
          // Debug logging
          console.log('Event details for SMS:', {
            hasOnlineMeetingUrl: !!result.event.onlineMeetingUrl,
            onlineMeetingUrl: result.event.onlineMeetingUrl,
            hasWebLink: !!result.event.webLink,
            webLink: result.event.webLink,
            bookingLink,
          });
          
          if (bookingLink) {
            const telnyxApiKey = process.env.TELNYX_API_KEY;
            if (telnyxApiKey) {
              const { sendSMS } = await import('lead-ai-npm-modules');
              const formattedDate = new Date(request.startDateTime).toLocaleString();
              const linkType = result.event.onlineMeetingUrl ? 'Join meeting' : 'View details';
              const message = `Your appointment has been booked!\n\nDate: ${formattedDate}\n\n${linkType}: ${bookingLink} \n\n\nPowered by: LeadAI`;
              await sendSMS(customerPhoneNumber, message, telnyxApiKey);
              console.log(`SMS sent successfully to ${customerPhoneNumber} with ${result.event.onlineMeetingUrl ? 'meeting link' : 'calendar link'}`);
            } else {
              console.warn('TELNYX_API_KEY not found in environment variables. SMS not sent.');
            }
          } else {
            console.warn('No booking link available. SMS not sent.', {
              eventId: result.event.id,
              hasOnlineMeetingUrl: !!result.event.onlineMeetingUrl,
              hasWebLink: !!result.event.webLink,
            });
          }
        } catch (smsError) {
          // Log error but don't fail the booking
          console.error('Error sending SMS:', smsError);
        }
      }

      return {
        success: true,
        event: bookingEvent,
        eventId: result.eventId,
        customer: customer || undefined,
        agent: agent as unknown as AgentWithCalendar,
      };
    } catch (error) {
      console.error("❌ Error booking customer appointment:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred while booking appointment",
      };
    }
  }

  /**
   * Find available booking slots for an agent
   */
  static async findAvailableSlots(
    request: FindBookingSlotsRequest
  ): Promise<BookingOperationResponse> {
    console.log("[BookingOperations] Finding available booking slots");
    console.table(request);

    try {
      // Validate agent and calendar
      const validation = await validateAgentHasCalendar(
        request.agentId,
        request.clientId
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      const agent = await getAgentWithCalendarByUUID(
        request.agentId,
        request.clientId
      );

      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${request.agentId}`,
        };
      }

      // Parse preferred date (natural language support)
      let startDateTime: string;
      let endDateTime: string;

      // Get agent's office hours for better date parsing
      const profile = Array.isArray(agent.profiles)
        ? agent.profiles[0]
        : agent.profiles;
      const agentTimezone = profile?.timezone || "Australia/Melbourne";

      // Parse dates in the agent's timezone (not UTC)
      // This ensures 9 AM means 9 AM in the agent's timezone, not UTC
      let targetDate: DateTime;
      
      if (request.preferredDate.toLowerCase() === "today") {
        targetDate = DateTime.now().setZone(agentTimezone);
      } else if (request.preferredDate.toLowerCase() === "tomorrow") {
        targetDate = DateTime.now().setZone(agentTimezone).plus({ days: 1 });
      } else {
        // Parse as date string (YYYY-MM-DD) in agent's timezone
        targetDate = DateTime.fromISO(request.preferredDate, { zone: agentTimezone });
        
        // If parsing failed, try as a date-only string
        if (!targetDate.isValid) {
          targetDate = DateTime.fromFormat(request.preferredDate, 'yyyy-MM-dd', { zone: agentTimezone });
        }
      }
      
      // Set to business day hours (9 AM - 6 PM) in agent's timezone
      const startDT = targetDate.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
      const endDT = targetDate.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
      
      // Convert to ISO string (will include timezone offset)
      startDateTime = startDT.toISO()!;
      endDateTime = endDT.toISO()!;

      console.log(`Searching time window: ${startDateTime} to ${endDateTime} (${agentTimezone})`);

      // Log office hours for debugging
      if (profile?.office_hours) {
        console.log(`Office hours for ${agent.name}:`, profile.office_hours);
      } else {
        console.log(`No office hours configured for ${agent.name}`);
      }

      // Use unified CalendarService to find slots (supports both Microsoft and Google)
      const result = await CalendarService.findAvailableSlots(
        request.clientId,
        startDateTime,
        endDateTime,
        {
          durationMinutes: request.durationMinutes || 30,
          maxSuggestions: request.maxSuggestions || 3,
          officeHours: profile?.office_hours as Record<string, { start: string; end: string; enabled: boolean }> || null,
          agentTimezone,
        },
        request.agentId // Pass agentId to use agent's assigned calendar
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      // Enhance slots with agent info
      const agentCalendarConnection = agent.calendar_assignment
        ?.calendar_connections as unknown as { email?: string };
      const enhancedSlots: BookingSlot[] = result.availableSlots
        ? result.availableSlots.map((slot) => ({
            start: slot.start,
            end: slot.end,
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            isWithinOfficeHours: true, // Already filtered by office hours
            agentName: agent.name,
            agentEmail: agentCalendarConnection?.email || "",
          }))
        : [];

      return {
        success: true,
        availableSlots: enhancedSlots,
        agent: agent as unknown as AgentWithCalendar,
      };
    } catch (error) {
      console.error("❌ Error finding available slots:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred while finding slots",
      };
    }
  }

  /**
   * Get all agents for a client with calendar information
   */
  static async listAgents(
    request: ListAgentsRequest
  ): Promise<{ success: boolean; agents?: AgentSummary[]; error?: string }> {
    console.log("📋 [BookingOperations] Listing agents for client");
    console.table(request);

    try {
      const agents = await getAgentsForClient(request.clientId, {
        includeDedicated: request.includeDedicated,
        withCalendarOnly: request.withCalendarOnly,
      });

      console.log(`Found ${agents.length} agents`);

      return {
        success: true,
        agents,
      };
    } catch (error) {
      console.error("❌ Error listing agents:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred while listing agents",
      };
    }
  }

  /**
   * Cancel a customer appointment
   */
  static async cancelAppointment(
    request: CancelCustomerAppointmentRequest
  ): Promise<BookingOperationResponse> {
    console.log("🗑️ [BookingOperations] Cancelling customer appointment");
    console.table(request);

    try {
      // Validate agent and calendar
      const validation = await validateAgentHasCalendar(
        request.agentId,
        request.clientId
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Validate that agent has Microsoft calendar
      const agent = await getAgentWithCalendarByUUID(
        request.agentId,
        request.clientId
      );

      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${request.agentId}`,
        };
      }

      const calendarConnection = agent.calendar_assignment?.calendar_connections as unknown as {
        provider_name?: string;
      };
      
      if (calendarConnection?.provider_name !== 'microsoft') {
        return {
          success: false,
          error: `Agent "${agent.name}" has a ${calendarConnection?.provider_name || 'unknown'} calendar assigned, but Microsoft calendar is required. Please assign a Microsoft calendar to this agent.`,
        };
      }

      // Delete the event using unified CalendarService (supports both Microsoft and Google)
      const result = await CalendarService.deleteEvent(
        request.clientId,
        request.eventId,
        request.calendarId,
        request.agentId // Pass agentId to use agent's assigned calendar
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      console.log(`Appointment cancelled successfully`);

      return {
        success: true,
        eventId: request.eventId,
      };
    } catch (error) {
      console.error("❌ Error cancelling appointment:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred while cancelling appointment",
      };
    }
  }

  /**
   * Reschedule a customer appointment
   */
  static async rescheduleAppointment(
    request: RescheduleCustomerAppointmentRequest
  ): Promise<BookingOperationResponse> {
    console.log("🔄 [BookingOperations] Rescheduling customer appointment");
    console.table(request);

    try {
      // Validate agent and calendar
      const validation = await validateAgentHasCalendar(
        request.agentId,
        request.clientId
      );

      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      const agent = await getAgentWithCalendarByUUID(
        request.agentId,
        request.clientId
      );

      if (!agent) {
        return {
          success: false,
          error: `Agent not found: ${request.agentId}`,
        };
      }

      // Validate new time is not in the past
      const now = new Date();
      const newStart = new Date(request.newStartDateTime);
      const minimumTime = new Date(now.getTime() + 15 * 60 * 1000);

      if (newStart < minimumTime) {
        return {
          success: false,
          error: `INVALID TIME: Cannot reschedule to the past or less than 15 minutes from now.\n\nEarliest available: ${minimumTime.toLocaleString()}`,
        };
      }

      // Check office hours
      const profile = Array.isArray(agent.profiles)
        ? agent.profiles[0]
        : agent.profiles;

      if (profile && profile.office_hours) {
        const officeHoursCheck = isWithinOfficeHours(
          request.newStartDateTime,
          profile.office_hours as Record<
            string,
            { start: string; end: string; enabled: boolean }
          >,
          profile.timezone || "Australia/Melbourne"
        );

        if (!officeHoursCheck.isWithin) {
          return {
            success: false,
            error: `OUTSIDE OFFICE HOURS\n\n${officeHoursCheck.reason}`,
          };
        }
      }

      // Get client timezone
      const clientData = await import('../cache/advancedCacheService').then(m => 
        m.AdvancedCacheService.getClientCalendarData(request.clientId)
      );
      const timeZone = clientData?.timezone || 'Australia/Melbourne';

      // Update the event using unified CalendarService (supports both Microsoft and Google)
      const result = await CalendarService.updateEvent(
        request.clientId,
        request.eventId,
        {
          startDateTime: request.newStartDateTime,
          endDateTime: request.newEndDateTime,
          timeZone,
        },
        request.agentId // Pass agentId to use agent's assigned calendar
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      console.log(`Appointment rescheduled successfully`);

      // Map CalendarEvent to BookingOperationResponse format
      const bookingEvent = result.event ? {
        id: result.event.id,
        subject: result.event.subject,
        start: result.event.start,
        end: result.event.end,
        location: result.event.location ? {
          displayName: result.event.location,
        } : undefined,
        attendees: result.event.attendees?.map(a => ({
          emailAddress: {
            name: a.name,
            address: a.email,
          },
        })),
        onlineMeeting: result.event.onlineMeetingUrl ? {
          joinUrl: result.event.onlineMeetingUrl,
        } : undefined,
      } : undefined;

      return {
        success: true,
        event: bookingEvent,
        eventId: request.eventId,
        agent: agent as unknown as AgentWithCalendar,
      };
    } catch (error) {
      console.error("❌ Error rescheduling appointment:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error occurred while rescheduling appointment",
      };
    }
  }

  /**
   * Validate a booking request before creating it
   * Useful for pre-flight checks
   */
  static async validateBooking(
    request: BookCustomerAppointmentRequest
  ): Promise<BookingValidation> {
    console.log("[BookingOperations] Validating booking request");

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate agent
      const validation = await validateAgentHasCalendar(
        request.agentId,
        request.clientId
      );

      if (!validation.isValid) {
        errors.push(validation.error || "Agent validation failed");
      }

      const agent = await getAgentWithCalendarByUUID(
        request.agentId,
        request.clientId
      );

      // Validate customer/contact - require either email or phone number
      let customer: Customer | null = null;
      let foundEmail = false;
      let foundPhone = false;

      try {
        // Try customers first
        const customerResults = await getCustomerWithFuzzySearch(
          request.customerName,
          request.clientId.toString()
        );

        if (customerResults && customerResults.length > 0) {
          customer = customerResults[0].item as unknown as Customer;
          if (customer.email || request.customerEmail) {
            foundEmail = true;
          }
          if (customer.phone || request.customerPhoneNumber) {
            foundPhone = true;
          }
        }

        // If not found in customers, try contacts
        if ((!foundEmail && !request.customerEmail) || (!foundPhone && !request.customerPhoneNumber)) {
          const contactResults = await getContactWithFuzzySearch(
            request.customerName,
            request.clientId.toString()
          );

          if (contactResults && contactResults.length > 0) {
            const contact = contactResults[0].item as { email?: string; phone_number?: string };
            if (contact.email) {
              foundEmail = true;
            }
            if (contact.phone_number) {
              foundPhone = true;
            }
          }
        }

        // Check if we have email or phone from any source
        if (!foundEmail && !request.customerEmail && !foundPhone && !request.customerPhoneNumber) {
          errors.push("Customer/contact not found and no email or phone number provided");
        }
      } catch (error) {
        console.log(error)
        warnings.push("Could not search customer/contact database");
      }

      // Validate time
      const now = new Date();
      const requestedStart = new Date(request.startDateTime);
      const minimumTime = new Date(now.getTime() + 15 * 60 * 1000);

      if (requestedStart < minimumTime) {
        errors.push("Cannot book in the past or less than 15 minutes from now");
      }

      // Check office hours
      if (agent) {
        const profile = Array.isArray(agent.profiles)
          ? agent.profiles[0]
          : agent.profiles;

        if (profile && profile.office_hours) {
          const officeHoursCheck = isWithinOfficeHours(
            request.startDateTime,
            profile.office_hours as Record<
              string,
              { start: string; end: string; enabled: boolean }
            >,
            profile.timezone || "Australia/Melbourne"
          );

          if (!officeHoursCheck.isWithin) {
            errors.push(officeHoursCheck.reason || "Outside office hours");
          }
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        agent: agent as unknown as AgentWithCalendar,
        customer: customer || undefined,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [
          error instanceof Error
            ? error.message
            : "Unknown validation error occurred",
        ],
        warnings,
      };
    }
  }
}

