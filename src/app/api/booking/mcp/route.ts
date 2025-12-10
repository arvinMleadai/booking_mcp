import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { BookingOperations } from "@/lib/helpers/booking_functions";
import type {
  BookCustomerAppointmentRequest,
  FindBookingSlotsRequest,
  ListAgentsRequest,
  CancelCustomerAppointmentRequest,
  RescheduleCustomerAppointmentRequest,
} from "@/types";

const handler = createMcpHandler(
  (server) => {
    // ListAgents - List all agents with calendar assignments
    server.tool(
      "ListAgents",
      "List all available agents for a client. Shows which agents have calendar connections for booking appointments.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        includeDedicated: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include dedicated agents: true/false (default: true)"),
        withCalendarOnly: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Show only agents with calendar connections: true/false (default: false)"
          ),
      },
      async (input) => {
        try {
          const { clientId, includeDedicated, withCalendarOnly } = input;

          console.log("list agents (Booking MCP)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number",
                },
              ],
            };
          }

          const request: ListAgentsRequest = {
            clientId: numericClientId,
            includeDedicated,
            withCalendarOnly,
          };

          const result = await BookingOperations.listAgents(request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `ERROR: ${result.error}`,
                },
              ],
            };
          }

          if (!result.agents || result.agents.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `NO AGENTS FOUND\n\nClient ID: ${numericClientId}${
                    withCalendarOnly
                      ? "\nFilter: Only agents with calendar connections"
                      : ""
                  }`,
                },
              ],
            };
          }

          let responseText = `AVAILABLE AGENTS (Client: ${numericClientId})\n\n`;
          responseText += `${result.agents.length} agent(s) found:\n\n`;

          result.agents.forEach((agent, index) => {
            responseText += `${index + 1}. ${agent.name}\n`;
            responseText += `   UUID: ${agent.uuid}\n`;
            responseText += `   Title: ${agent.title}\n`;

            if (agent.description) {
              responseText += `   Description: ${agent.description}\n`;
            }

            responseText += `   Type: ${
              agent.isDedicated ? "Dedicated" : "Shared"
            }\n`;
            responseText += `   Calendar: ${
              agent.hasCalendar ? "Connected" : "Not Connected"
            }\n`;

            if (agent.hasCalendar) {
              responseText += `   Provider: ${
                agent.calendarProvider?.toUpperCase() || "Unknown"
              } (${agent.calendarEmail})\n`;
            }

            if (agent.profileName) {
              responseText += `   Profile: ${agent.profileName}\n`;
            }

            if (agent.timezone) {
              responseText += `   Timezone: ${agent.timezone}\n`;
            }

            responseText += `\n`;
          });

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in ListAgents:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error listing agents: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    // BookCustomerAppointment - Book a new appointment for a customer
    server.tool(
      "BookCustomerAppointment",
      "Book a customer appointment with an agent. Automatically searches customer database, checks calendar conflicts, validates office hours, and sends meeting invitations. Supports both Microsoft and Google calendars.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .string()
          .uuid()
          .describe(
            "Agent UUID from ListAgents tool (e.g., '550e8400-e29b-41d4-a716-446655440000')"
          ),
        customerName: z
          .string()
          .describe(
            "Customer name to search in database: 'John Smith' (finds email and details automatically)"
          ),
        customerEmail: z
          .string()
          .email()
          .optional()
          .describe(
            "Customer email: 'john@company.com' (optional if customer exists in database)"
          ),
        subject: z
          .string()
          .describe(
            "Meeting title (e.g., 'Sales Call with John Smith' or 'Product Demo')"
          ),
        startDateTime: z
          .string()
          .describe(
            "Start time: '2025-12-06T13:00:00' (must be at least 15 minutes in future)"
          ),
        endDateTime: z
          .string()
          .describe(
            "End time: '2025-12-06T14:00:00' (must be after start time)"
          ),
        description: z
          .string()
          .optional()
          .describe("Meeting description or notes (optional)"),
        location: z
          .string()
          .optional()
          .describe(
            "Meeting location: 'Conference Room A' or address (optional)"
          ),
        isOnlineMeeting: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Create Teams/Meet meeting: true/false (default: true, depends on calendar provider)"
          ),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Calendar ID (optional, uses agent's assigned calendar if not specified)"
          ),
      },
      async (input) => {
        try {
          const {
            clientId,
            agentId,
            customerName,
            customerEmail,
            subject,
            startDateTime,
            endDateTime,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          } = input;

          console.log("book customer appointment (Booking MCP)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number",
                },
              ],
            };
          }

          const request: BookCustomerAppointmentRequest = {
            clientId: numericClientId,
            agentId,
            customerName,
            customerEmail,
            subject,
            startDateTime,
            endDateTime,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          };

          const result = await BookingOperations.bookCustomerAppointment(
            request
          );

          if (!result.success) {
            // Check if it's a conflict with suggested slots
            if (result.availableSlots && result.availableSlots.length > 0) {
              let conflictText = `SCHEDULING CONFLICT\n\n${result.error}\n\n`;
              conflictText += `Alternative Slots:\n`;
              result.availableSlots.forEach((slot, index) => {
                conflictText += `${index + 1}. ${slot.startFormatted} - ${
                  slot.endFormatted
                } (${slot.agentName})\n`;
              });

              return {
                content: [
                  {
                    type: "text",
                    text: conflictText,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `BOOKING FAILED\n\n${result.error}`,
                },
              ],
            };
          }

          const startDate = new Date(result.event?.start.dateTime || startDateTime);
          const endDate = new Date(result.event?.end.dateTime || endDateTime);
          
          let responseText = `APPOINTMENT BOOKED\n\n`;
          responseText += `Subject: ${result.event?.subject}\n`;
          responseText += `Date: ${startDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}\n`;
          responseText += `Time: ${startDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })} - ${endDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}\n\n`;

          if (result.customer) {
            responseText += `Customer: ${result.customer.full_name}`;
            if (result.customer.company) {
              responseText += ` (${result.customer.company})`;
            }
            responseText += `\nEmail: ${result.customer.email}\n`;
          } else {
            responseText += `Customer: ${customerName}\nEmail: ${customerEmail}\n`;
          }

          if (result.agent) {
            responseText += `\nAgent: ${result.agent.name} - ${result.agent.title}\n`;
          }

          if (result.event?.location?.displayName) {
            responseText += `\nLocation: ${result.event.location.displayName}\n`;
          }

          if (result.event?.onlineMeeting?.joinUrl) {
            responseText += `Meeting Link: ${result.event.onlineMeeting.joinUrl}\n`;
          }

          responseText += `\nEvent ID: ${result.eventId}`;
          responseText += `\nInvitations sent to all attendees.`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in BookCustomerAppointment:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error booking appointment: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    // FindAvailableBookingSlots - Find available time slots for an agent
    server.tool(
      "FindAvailableBookingSlots",
      "Find available time slots for booking with an agent. Checks agent's calendar and office hours to suggest optimal meeting times.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .string()
          .uuid()
          .describe("Agent UUID from ListAgents tool"),
        preferredDate: z
          .string()
          .describe(
            "Preferred date: 'today', 'tomorrow', '2025-12-06' or ISO format"
          ),
        durationMinutes: z
          .number()
          .optional()
          .default(60)
          .describe("Meeting duration in minutes: 30, 60, 90 (default: 60)"),
        maxSuggestions: z
          .number()
          .optional()
          .default(3)
          .describe(
            "Number of alternative slots to suggest: 1-5 (default: 3)"
          ),
      },
      async (input) => {
        try {
          const {
            clientId,
            agentId,
            preferredDate,
            durationMinutes,
            maxSuggestions,
          } = input;

          console.log("find available booking slots (Booking MCP)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number",
                },
              ],
            };
          }

          const request: FindBookingSlotsRequest = {
            clientId: numericClientId,
            agentId,
            preferredDate,
            durationMinutes,
            maxSuggestions,
          };

          const result = await BookingOperations.findAvailableSlots(request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `ERROR: ${result.error}`,
                },
              ],
            };
          }

          if (!result.availableSlots || result.availableSlots.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `NO AVAILABLE SLOTS\n\nNo time slots found for ${preferredDate}.\n\nSuggestions:\n- Try a different date\n- Reduce duration\n- Select another agent`,
                },
              ],
            };
          }

          let responseText = `AVAILABLE TIME SLOTS\n\n`;
          responseText += `Agent: ${result.agent?.name}\n`;
          responseText += `Date: ${preferredDate}\n`;
          responseText += `Duration: ${durationMinutes || 60} minutes\n\n`;

          result.availableSlots.forEach((slot, index) => {
            responseText += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`;
          });

          responseText += `\nUse BookCustomerAppointment with one of these slots.`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in FindAvailableBookingSlots:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error finding available slots: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    // CancelCustomerAppointment - Cancel an existing appointment
    server.tool(
      "CancelCustomerAppointment",
      "Cancel a customer appointment. Automatically sends cancellation notifications to all attendees.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .string()
          .uuid()
          .describe("Agent UUID who owns the calendar"),
        eventId: z
          .string()
          .describe("Event ID to cancel (from booking confirmation)"),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Calendar ID (optional, uses agent's assigned calendar if not specified)"
          ),
        notifyCustomer: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Send cancellation email: true/false (default: true, handled by calendar provider)"
          ),
      },
      async (input) => {
        try {
          const { clientId, agentId, eventId, calendarId, notifyCustomer } =
            input;

          console.log("cancel customer appointment (Booking MCP)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number",
                },
              ],
            };
          }

          const request: CancelCustomerAppointmentRequest = {
            clientId: numericClientId,
            agentId,
            eventId,
            calendarId,
            notifyCustomer,
          };

          const result = await BookingOperations.cancelAppointment(request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `CANCELLATION FAILED\n\n${result.error}\n\nEvent ID: ${eventId}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `APPOINTMENT CANCELLED\n\nEvent ID: ${eventId}\nCancellation notifications sent to all attendees.${
                  notifyCustomer ? "" : "\nCustomer notification skipped."
                }`,
              },
            ],
          };
        } catch (error) {
          console.error("Error in CancelCustomerAppointment:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error cancelling appointment: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    // RescheduleCustomerAppointment - Reschedule an existing appointment
    server.tool(
      "RescheduleCustomerAppointment",
      "Reschedule a customer appointment to a new time. Validates new time slot and sends update notifications.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .string()
          .uuid()
          .describe("Agent UUID who owns the calendar"),
        eventId: z
          .string()
          .describe("Event ID to reschedule (from booking confirmation)"),
        newStartDateTime: z
          .string()
          .describe("New start time: '2025-12-07T13:00:00'"),
        newEndDateTime: z
          .string()
          .describe("New end time: '2025-12-07T14:00:00'"),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Calendar ID (optional, uses agent's assigned calendar if not specified)"
          ),
        notifyCustomer: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Send update email: true/false (default: true, handled by calendar provider)"
          ),
      },
      async (input) => {
        try {
          const {
            clientId,
            agentId,
            eventId,
            newStartDateTime,
            newEndDateTime,
            calendarId,
            notifyCustomer,
          } = input;

          console.log("reschedule customer appointment (Booking MCP)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number",
                },
              ],
            };
          }

          const request: RescheduleCustomerAppointmentRequest = {
            clientId: numericClientId,
            agentId,
            eventId,
            newStartDateTime,
            newEndDateTime,
            calendarId,
            notifyCustomer,
          };

          const result = await BookingOperations.rescheduleAppointment(request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `RESCHEDULE FAILED\n\n${result.error}\n\nEvent ID: ${eventId}`,
                },
              ],
            };
          }

          const newStart = new Date(result.event?.start.dateTime || newStartDateTime);
          const newEnd = new Date(result.event?.end.dateTime || newEndDateTime);

          let responseText = `APPOINTMENT RESCHEDULED\n\n`;
          responseText += `Subject: ${result.event?.subject}\n`;
          responseText += `New Date: ${newStart.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}\n`;
          responseText += `New Time: ${newStart.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })} - ${newEnd.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}\n\n`;
          responseText += `Event ID: ${eventId}\n`;
          responseText += `Update notifications sent to all attendees.`;

          if (result.agent) {
            responseText += `\n\nAgent: ${result.agent.name}`;
          }

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in RescheduleCustomerAppointment:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error rescheduling appointment: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
  },
  {},
  { basePath: "/api/booking" }
);

export { handler as GET, handler as POST, handler as DELETE };

