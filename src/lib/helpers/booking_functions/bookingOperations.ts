/**
 * Booking Operations Service Layer
 * Handles customer appointment booking with agent calendar integration
 */

import { FinalOptimizedCalendarOperations } from "../calendar_functions/finalOptimizedCalendarOperations";
import {
  getAgentWithCalendarByUUID,
  getAgentsForClient,
  validateAgentHasCalendar,
  getCustomerWithFuzzySearch,
  getContactWithFuzzySearch,
  isWithinOfficeHours,
} from "../utils";
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

          // Use customer email if available and not overridden
          if (customer.email && !request.customerEmail) {
            customerEmail = customer.email;
            customerDisplayName = customer.full_name;
            searchSource = "customer";
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
              company?: string;
            };

            console.log(`Found in contacts:`, {
              score: bestMatch.score,
              name: contact.name,
              email: contact.email,
              company: contact.company,
            });

            // Use contact email if available
            if (contact.email) {
              customerEmail = contact.email;
              customerDisplayName = contact.name || 
                `${contact.first_name || ""} ${contact.last_name || ""}`.trim() ||
                request.customerName;
              searchSource = "contact";
            }
          } else {
            console.log(`Not found in contacts: "${request.customerName}"`);
          }
        } catch (error) {
          console.error("Error searching contacts:", error);
        }
      }

      // Validate email is available
      if (!customerEmail) {
        return {
          success: false,
          error: `"${request.customerName}" not found in customers or contacts. Please provide customerEmail parameter to book manually.`,
        };
      }

      console.log(`Using email: ${customerEmail} (source: ${searchSource})`);

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

      // Step 6: Create calendar event using the optimized operations
      // Generate a simple default description if none provided
      const defaultDescription = request.description || 
        `Scheduled appointment with ${customerDisplayName}`;

      const calendarRequest = {
        clientId: request.clientId,
        subject: request.subject,
        startDateTime: request.startDateTime,
        endDateTime: request.endDateTime,
        attendeeEmail: customerEmail,
        attendeeName: customerDisplayName,
        description: defaultDescription,
        location: request.location,
        isOnlineMeeting: request.isOnlineMeeting,
        calendarId: request.calendarId, // undefined = use agent's primary calendar
      };

      console.log(`Creating calendar event via ${validation.calendarProvider}`);

      const result =
        await FinalOptimizedCalendarOperations.createCalendarEventForClient(
          request.clientId,
          calendarRequest
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

      return {
        success: true,
        event: result.event,
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

      // Simple date parsing (extend with chrono-node if needed)
      const today = new Date();
      if (request.preferredDate.toLowerCase() === "today") {
        startDateTime = new Date(today.setHours(9, 0, 0, 0)).toISOString();
        endDateTime = new Date(today.setHours(17, 0, 0, 0)).toISOString();
      } else if (request.preferredDate.toLowerCase() === "tomorrow") {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        startDateTime = new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString();
        endDateTime = new Date(tomorrow.setHours(17, 0, 0, 0)).toISOString();
      } else {
        // Parse as date string (YYYY-MM-DD or ISO format)
        const targetDate = new Date(request.preferredDate);
        
        // Set to business day hours (9 AM - 6 PM)
        startDateTime = new Date(targetDate.setHours(9, 0, 0, 0)).toISOString();
        endDateTime = new Date(targetDate.setHours(18, 0, 0, 0)).toISOString();
      }

      console.log(`Searching time window: ${startDateTime} to ${endDateTime} (${agentTimezone})`);

      // Log office hours for debugging
      if (profile?.office_hours) {
        console.log(`Office hours for ${agent.name}:`, profile.office_hours);
      } else {
        console.log(`No office hours configured for ${agent.name}`);
      }

      // Use calendar operations to find slots with agent-specific office hours
      const result =
        await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
          request.clientId,
          startDateTime,
          endDateTime,
          request.durationMinutes || 60,
          request.maxSuggestions || 3,  // Default to 3 suggestions
          profile?.office_hours as Record<string, { start: string; end: string; enabled: boolean }> || null,
          agentTimezone
        );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      // Enhance slots with agent info
      const calendarConnection = agent.calendar_assignment
        ?.calendar_connections as unknown as { email?: string };
      const enhancedSlots: BookingSlot[] = result.availableSlots
        ? result.availableSlots.map((slot) => ({
            start: slot.start,
            end: slot.end,
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            isWithinOfficeHours: true, // Already filtered by office hours
            agentName: agent.name,
            agentEmail: calendarConnection?.email || "",
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

      // Delete the event using calendar operations
      const result =
        await FinalOptimizedCalendarOperations.deleteCalendarEventForClient(
          request.clientId,
          request.eventId,
          request.calendarId
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

      // Update the event using calendar operations
      const updates = {
        startDateTime: request.newStartDateTime,
        endDateTime: request.newEndDateTime,
        calendarId: request.calendarId,
      };

      const result =
        await FinalOptimizedCalendarOperations.updateCalendarEventForClient(
          request.clientId,
          request.eventId,
          updates
        );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      console.log(`Appointment rescheduled successfully`);

      return {
        success: true,
        event: result.event,
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

      // Validate customer/contact
      let customer: Customer | null = null;
      let foundEmail = false;

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
          } else {
            errors.push("Customer found but has no email address");
          }
        }

        // If not found in customers, try contacts
        if (!foundEmail && !request.customerEmail) {
          const contactResults = await getContactWithFuzzySearch(
            request.customerName,
            request.clientId.toString()
          );

          if (contactResults && contactResults.length > 0) {
            const contact = contactResults[0].item as { email?: string };
            if (contact.email) {
              foundEmail = true;
            }
          }
        }

        // Check if we have email from any source
        if (!foundEmail && !request.customerEmail) {
          errors.push("Customer/contact not found and no email provided");
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

