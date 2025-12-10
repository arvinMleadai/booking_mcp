import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
// All calendar operations now use FinalOptimizedCalendarOperations
import { FinalOptimizedCalendarOperations } from "@/lib/helpers/calendar_functions/finalOptimizedCalendarOperations";
import { AdvancedCacheService } from "@/lib/helpers/cache/advancedCacheService";
import {
  getCustomerWithFuzzySearch, 
  getAgentByCalendarConnection, 
  isWithinOfficeHours 
} from "@/lib/helpers/utils";
import type {
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
} from "@/types";

const handler = createMcpHandler(
  (server) => {
    //GetCalendarEvents
    server.tool(
      "GetCalendarEvents",
      "Retrieve calendar events for a client. Automatically handles timezone conversion based on client settings.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        dateRequest: z
          .string()
          .optional()
          .describe(
            "Natural language date: 'today', 'tomorrow', 'this week', 'next monday', 'upcoming'"
          ),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
        startDate: z
          .string()
          .optional()
          .describe("Start date: '2025-10-06T09:00:00' (use instead of dateRequest for specific dates)"),
        endDate: z
          .string()
          .optional()
          .describe("End date: '2025-10-06T17:00:00' (use with startDate for date range)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            dateRequest,
            calendarId,
            startDate,
            endDate,
          } = input;
          
          console.log("get calendar events (Microsoft Graph)");
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

          const request: GetGraphEventsRequest = {
            clientId: numericClientId,
            dateRequest,
            calendarId,
            startDate,
            endDate,
          };
          console.log("Request: ", request)

          const result = await FinalOptimizedCalendarOperations.getCalendarEventsForClient(numericClientId, request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **EVENTS ERROR**: ${result.error}`,
                },
              ],
            };
          }

            return {
              content: [
                {
                  type: "text",
                  text: result.formattedEvents || '📅 No events found',
                },
              ],
            };
        } catch (error) {
          console.error("Error in GetCalendarEvents:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving calendar events: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //CreateCalendarEvent
    server.tool(
      "CreateCalendarEvent",
      "Book a new calendar appointment. Automatically checks for conflicts, validates office hours, and sends email invitations. Searches customer database if name is provided.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        subject: z.string().describe("Meeting title (e.g., 'Sales Call with John Smith')"),
        startDateTime: z
          .string()
          .describe("Start time: '2025-10-06T13:00:00' (must be at least 15 minutes in future)"),
        endDateTime: z
          .string()
          .describe("End time: '2025-10-06T14:00:00' (must be after start time)"),
        customerName: z
          .string()
          .optional()
          .describe("Customer name to search in database: 'John Smith' (finds email automatically)"),
        attendeeEmail: z
          .string()
          .email()
          .optional()
          .describe("Attendee email: 'john@company.com' (required if customer not found in database)"),
        attendeeName: z
          .string()
          .optional()
          .describe("Attendee display name: 'John Smith' (auto-filled from customer database)"),
        description: z
          .string()
          .optional()
          .describe("Meeting description or notes (optional)"),
        location: z
          .string()
          .optional()
          .describe("Meeting location: 'Conference Room A' or address (optional)"),
        isOnlineMeeting: z
          .boolean()
          .optional()
          .default(true)
          .describe("Create Teams meeting: true/false (default: true)"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            subject,
            startDateTime,
            endDateTime,
            customerName,
            attendeeEmail,
            attendeeName,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          } = input;
          
          console.log("create calendar event (Microsoft Graph)");
          console.table(input);
          console.log(`🔍 DEBUG MCP: isOnlineMeeting parameter = ${isOnlineMeeting}`);
          
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

          // Customer lookup logic
          let finalAttendeeEmail = attendeeEmail;
          let finalAttendeeName = attendeeName;
          let customerFound = false;

          // If customerName is provided, search in customer database first
          if (customerName) {
            console.log(`🔍 Searching for customer: "${customerName}" for client ${numericClientId}`);
            
            try {
              const customerResults = await getCustomerWithFuzzySearch(customerName, numericClientId.toString());
              
              if (customerResults && customerResults.length > 0) {
                const bestMatch = customerResults[0];
                const customer = bestMatch.item;
                
                console.log(`✅ Found customer match:`, {
                  score: bestMatch.score,
                  customer: {
                    id: customer.id,
                    full_name: customer.full_name,
                    email: customer.email,
                    company: customer.company
                  }
                });

                if (customer.email) {
                  finalAttendeeEmail = customer.email;
                  finalAttendeeName = customer.full_name || attendeeName;
                  customerFound = true;
                  
                  console.log(`📧 Using customer email: ${finalAttendeeEmail} (${finalAttendeeName})`);
          } else {
                  console.log(`⚠️ Customer found but no email address available`);
                }
              } else {
                console.log(`❌ No customer found matching: "${customerName}"`);
              }
            } catch (error) {
              console.error('Error searching for customer:', error);
            }
          }

          // Validate that we have an email address
          if (!finalAttendeeEmail) {
            let errorMessage = "Error: ";
            if (customerName && !customerFound) {
              errorMessage += `Customer "${customerName}" not found in database. Please provide attendeeEmail manually, or check the customer name spelling.`;
            } else if (customerName && customerFound) {
              errorMessage += `Customer "${customerName}" found but has no email address. Please provide attendeeEmail manually.`;
            } else {
              errorMessage += "Either customerName (to search database) or attendeeEmail is required.";
          }

          return {
            content: [
              {
                type: "text",
                  text: errorMessage,
              },
            ],
          };
        }

          // Validate that the booking is not in the past
          console.log(`🕐 Validating booking time is not in the past...`)
          
          const now = new Date()
          const requestedStart = new Date(startDateTime)
          const minimumAdvanceMinutes = 15 // Minimum 15 minutes in advance
          const minimumBookingTime = new Date(now.getTime() + minimumAdvanceMinutes * 60 * 1000)
          
          console.log(`🕐 Current time: ${now.toISOString()}`)
          console.log(`🕐 Requested start: ${requestedStart.toISOString()}`)
          console.log(`🕐 Minimum booking time: ${minimumBookingTime.toISOString()} (${minimumAdvanceMinutes} min advance)`)
          
          const timeDifference = Math.floor((requestedStart.getTime() - now.getTime()) / (1000 * 60))
          
          if (requestedStart <= minimumBookingTime) {
            const errorMessage = timeDifference <= 0 
              ? `❌ **INVALID TIME**: Cannot book in the past\n\n⏰ Earliest available: ${minimumBookingTime.toLocaleString()}`
              : `❌ **TOO SOON**: Minimum ${minimumAdvanceMinutes} minutes advance required\n\n⏰ Earliest available: ${minimumBookingTime.toLocaleString()}`
            
            return {
              content: [
                {
                  type: "text",
                  text: errorMessage,
                },
              ],
            }
          }
          
          console.log(`✅ Booking time is valid (${timeDifference} minutes in the future)`)

          // Get calendar connection to find assigned agent and office hours
          console.log(`🏢 Checking office hours for calendar booking...`);
          
          // We need to get the calendar connection ID first
          const { getCalendarConnectionByClientId } = await import("@/lib/helpers/calendar_functions");
          const connection = await getCalendarConnectionByClientId(numericClientId);
          
          if (!connection) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: No calendar connection found for this client. Please connect a Microsoft calendar first.",
                },
              ],
            };
          }

          // Get agent assigned to this calendar connection
          const agentAssignment = await getAgentByCalendarConnection(connection.id);
          
          if (agentAssignment && agentAssignment.agents) {
            const agent = agentAssignment.agents as unknown as {
              uuid: string;
              name: string;
              profiles: {
                id: number;
                name: string;
                office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
                timezone: string;
              } | {
                id: number;
                name: string;
                office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
                timezone: string;
              }[];
            };
            
            const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles;
            if (profile) {
              // Check if the requested time is within office hours
              const officeHoursCheck = isWithinOfficeHours(
                startDateTime, 
                profile.office_hours, 
                profile.timezone || 'Australia/Melbourne'
              );
              
              if (!officeHoursCheck.isWithin) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `❌ **OUTSIDE OFFICE HOURS**\n\n${officeHoursCheck.reason}\n\n👤 Agent: ${agent.name}`,
                    },
                  ],
                };
              }
              
              console.log(`✅ Requested time is within office hours for agent ${agent.name}`);
            }
          } else {
            console.log(`⚠️ No agent assignment found for calendar connection. Proceeding without office hours validation.`);
          }

          const request: CreateGraphEventMCPRequest = {
            clientId: numericClientId,
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail: finalAttendeeEmail,
            attendeeName: finalAttendeeName,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          };

          console.log(`🔍 DEBUG MCP: Request object being passed:`, JSON.stringify(request, null, 2));

          const result = await FinalOptimizedCalendarOperations.createCalendarEventForClient(numericClientId, request);

          if (!result.success) {
            // Check if it's a conflict with suggested slots
            if (result.availableSlots && result.availableSlots.length > 0) {
              let conflictText = `**SCHEDULING CONFLICT**\n\n`;
              conflictText += `**Alternative Slots:**\n`;
              result.availableSlots.forEach((slot, index) => {
                conflictText += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`;
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
                  text: `❌ **BOOKING FAILED**\n\n${result.error}`,
                },
              ],
            };
          }

          let responseText = `✅ **BOOKING CONFIRMED**\n\n`;
          responseText += `**${result.event?.subject}**\n`;
          responseText += `📅 ${new Date(result.event?.start.dateTime || startDateTime).toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' })}\n`;
          responseText += `🕐 ${new Date(result.event?.start.dateTime || startDateTime).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })} - ${new Date(result.event?.end.dateTime || endDateTime).toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit' })}\n`;
          responseText += `👤 ${finalAttendeeName || finalAttendeeEmail}\n`;
          
          if (result.event?.location?.displayName) {
            responseText += `📍 ${result.event.location.displayName}\n`;
          }

          if (result.event?.onlineMeeting?.joinUrl) {
            responseText += `💻 Teams Meeting: ${result.event.onlineMeeting.joinUrl}\n`;
          }
          
          responseText += `\n🆔 ${result.eventId}`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in CreateCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error creating calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //UpdateCalendarEvent
    server.tool(
      "UpdateCalendarEvent",
      "Modify an existing calendar appointment. Automatically sends update notifications to attendees.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        eventId: z.string().describe("Event ID to update (e.g., 'AAMkAGQ5ZjU...')"),
        subject: z.string().optional().describe("New meeting title (optional)"),
        startDateTime: z
          .string()
          .optional()
          .describe("New start time: '2025-10-06T13:00:00' (optional)"),
        endDateTime: z
          .string()
          .optional()
          .describe("New end time: '2025-10-06T14:00:00' (optional)"),
        attendeeEmail: z
          .string()
          .email()
          .optional()
          .describe("New attendee email: 'jane@company.com' (optional)"),
        attendeeName: z
          .string()
          .optional()
          .describe("New attendee name: 'Jane Doe' (optional)"),
        description: z
          .string()
          .optional()
          .describe("New meeting description (optional)"),
        location: z
          .string()
          .optional()
          .describe("New location: 'Conference Room B' (optional)"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            eventId,
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            calendarId,
          } = input;
          
          console.log("update calendar event (Microsoft Graph)");
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

          // If updating time, validate office hours and past time first
          if (startDateTime && endDateTime) {
            console.log(`🔍 Validating update time: ${startDateTime} to ${endDateTime}`)
            
            // Check if trying to schedule in the past
            const now = new Date()
            const requestedStart = new Date(startDateTime)
            const minimumTime = new Date(now.getTime() + 15 * 60 * 1000) // 15 minutes from now
            
            if (requestedStart < minimumTime) {
              console.log(`❌ PAST TIME VIOLATION: Trying to schedule in the past`)
            return {
              content: [
                {
                  type: "text",
                    text: `**UPDATE BLOCKED - PAST TIME**\n\n**Error**: Cannot schedule appointments in the past or less than 15 minutes from now.\n\n**Requested Time**: ${requestedStart.toLocaleString('en-US')}\n**Current Time**: ${now.toLocaleString('en-US')}\n\nPlease choose a future time.`,
                },
              ],
            };
          }

            // Get agent assigned to this calendar connection
            const connection = await AdvancedCacheService.getClientCalendarData(numericClientId);
            
            if (connection && connection.agentOfficeHours) {
              const officeHoursCheck = isWithinOfficeHours(
                startDateTime, 
                connection.agentOfficeHours, 
                connection.agentTimezone || 'Australia/Melbourne'
              );
              
              if (!officeHoursCheck.isWithin) {
                console.log(`❌ OFFICE HOURS VIOLATION: ${officeHoursCheck.reason}`)
            return {
              content: [
                {
                  type: "text",
                      text: `**UPDATE BLOCKED - OUTSIDE OFFICE HOURS**\n\n**Reason**: ${officeHoursCheck.reason || 'The requested time is outside business hours'}\n\n**Requested Time**: ${requestedStart.toLocaleString('en-US')} - ${new Date(endDateTime).toLocaleString('en-US')}\n\nPlease choose a time within office hours.`,
                },
              ],
            };
          }

              console.log(`✅ OFFICE HOURS CHECK: Update time is within office hours`)
            }
          }

          const updates: Partial<CreateGraphEventMCPRequest> = {
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            calendarId,
          };

          const result = await FinalOptimizedCalendarOperations.updateCalendarEventForClient(numericClientId, eventId, updates);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `**Event Update Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Event ID**: ${eventId}`,
                },
              ],
            };
          }

          let responseText = `**CALENDAR EVENT UPDATED SUCCESSFULLY!**\n\n`;
          responseText += `**Updated Event Details:**\n`;
          responseText += `- **Event ID**: ${eventId}\n`;
          responseText += `- **Subject**: ${result.event?.subject}\n`;
          
          if (result.event?.start.dateTime) {
            responseText += `- **Start Time**: ${new Date(result.event.start.dateTime).toLocaleString("en-US")}\n`;
          }
          
          if (result.event?.end.dateTime) {
            responseText += `- **End Time**: ${new Date(result.event.end.dateTime).toLocaleString("en-US")}\n`;
          }
          
          responseText += `- **Client ID**: ${numericClientId}\n`;

          if (result.event?.location?.displayName) {
            responseText += `- **Location**: ${result.event.location.displayName}\n`;
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
          console.error("Error in UpdateCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error updating calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
//DeleteCalendarEvent
    server.tool(
      "DeleteCalendarEvent",
      "Cancel a calendar appointment. Automatically sends cancellation notifications to attendees.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        eventId: z.string().describe("Event ID to cancel (e.g., 'AAMkAGQ5ZjU...')"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        try {
          const { clientId, eventId, calendarId } = input;
          
          console.log("delete calendar event (Microsoft Graph)");
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

          const result = await FinalOptimizedCalendarOperations.deleteCalendarEventForClient(numericClientId, eventId, calendarId);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `**Event Deletion Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Event ID**: ${eventId}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `**APPOINTMENT CANCELLED SUCCESSFULLY**\n\n✅ **Event Deleted**: ${eventId}\n📧 **Cancellation notifications sent** to all attendees\n👤 **Client ID**: ${numericClientId}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error in DeleteCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error deleting calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //BulkDeleteCalendarEvents
    server.tool(
      "BulkDeleteCalendarEvents",
      "Cancel multiple calendar appointments based on criteria (date, time range, or search terms)",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        dateRequest: z
          .string()
          .optional()
          .describe("Natural language date: 'today', 'tomorrow', 'this week', 'next monday' (optional)"),
        startDate: z
          .string()
          .optional()
          .describe("Start date: '2025-10-06T09:00:00' (use instead of dateRequest for specific dates)"),
        endDate: z
          .string()
          .optional()
          .describe("End date: '2025-10-06T17:00:00' (use with startDate for date range)"),
        searchQuery: z
          .string()
          .optional()
          .describe("Search text to match in event titles: 'Meeting with' or 'Jonathan' (optional)"),
        confirmDeletion: z
          .boolean()
          .default(false)
          .describe("Confirm bulk deletion: true to proceed, false to preview only (default: false)"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        const { clientId, dateRequest, startDate, endDate, searchQuery, confirmDeletion, calendarId } = input;

        console.log("bulk delete calendar events (Microsoft Graph)");
        console.table(input);

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

        try {
          // First, get events based on criteria
          let eventsToDelete: Array<{
            id: string
            subject?: string
            start?: { dateTime?: string } | string
            end?: { dateTime?: string } | string
            location?: { displayName?: string }
            attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>
            organizer?: { emailAddress?: { name?: string; address?: string } }
            body?: { content?: string }
          }> = [];

          if (dateRequest || (startDate && endDate)) {
            // Get events by date range
            const getEventsRequest = {
              clientId: numericClientId,
              dateRequest,
              startDate,
              endDate,
              calendarId
            };

            const eventsResult = await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
              numericClientId, 
              getEventsRequest
            );

            if (eventsResult.success && eventsResult.events) {
              eventsToDelete = eventsResult.events;
            }
          }

          // Filter by search query if provided
          if (searchQuery && eventsToDelete.length > 0) {
            const searchLower = searchQuery.toLowerCase();
            eventsToDelete = eventsToDelete.filter(event => 
              event.subject?.toLowerCase().includes(searchLower) ||
              event.body?.content?.toLowerCase().includes(searchLower) ||
              event.location?.displayName?.toLowerCase().includes(searchLower)
            );
          } else if (searchQuery && eventsToDelete.length === 0) {
            // If only search query provided, search all events
            const searchResult = await FinalOptimizedCalendarOperations.searchCalendarEventsForClient(
              numericClientId,
              searchQuery,
              { calendarId }
            );

            if (searchResult.success && searchResult.events) {
              eventsToDelete = searchResult.events;
            }
          }

          if (eventsToDelete.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `**No Events Found**\n\nNo appointments found matching your criteria:\n${dateRequest ? `- Date: ${dateRequest}\n` : ''}${startDate && endDate ? `- Date Range: ${startDate} to ${endDate}\n` : ''}${searchQuery ? `- Search: "${searchQuery}"\n` : ''}`,
                },
              ],
            };
          }

          // Preview mode (default)
          if (!confirmDeletion) {
            let previewText = `**📋 Bulk Deletion Preview**\n\n`;
            previewText += `Found **${eventsToDelete.length}** appointment(s) to cancel:\n\n`;

            eventsToDelete.forEach((event, index) => {
              const startTime = new Date(
                typeof event.start === 'string' ? event.start : event.start?.dateTime || ''
              ).toLocaleString("en-US");
              const endTime = new Date(
                typeof event.end === 'string' ? event.end : event.end?.dateTime || ''
              ).toLocaleString("en-US");
              
              previewText += `**${index + 1}. ${event.subject || 'Untitled Event'}**\n`;
              previewText += `   📅 ${startTime} - ${endTime}\n`;
              if (event.location?.displayName) {
                previewText += `   📍 ${event.location.displayName}\n`;
              }
              if (event.attendees && event.attendees.length > 1) {
                const attendeeNames = event.attendees
                  .filter((a) => a.emailAddress?.name !== event.organizer?.emailAddress?.name)
                  .map((a) => a.emailAddress?.name || a.emailAddress?.address)
                  .join(', ');
                if (attendeeNames) {
                  previewText += `   👥 ${attendeeNames}\n`;
                }
              }
              previewText += `   🆔 ID: \`${event.id}\`\n\n`;
            });

            previewText += `⚠️ **To proceed with cancellation, set \`confirmDeletion: true\`**\n`;
            previewText += `This will permanently cancel all ${eventsToDelete.length} appointment(s) and notify attendees.`;

            return {
              content: [
                {
                  type: "text",
                  text: previewText,
                },
              ],
            };
          }

          // Confirmation mode - actually delete the events
          let successCount = 0;
          let failureCount = 0;
          const results: Array<{
            event: {
              id: string
              subject?: string
              start?: { dateTime?: string } | string
              end?: { dateTime?: string } | string
            }
            success: boolean
            error?: string
          }> = [];

          for (const event of eventsToDelete) {
            try {
              const deleteResult = await FinalOptimizedCalendarOperations.deleteCalendarEventForClient(
                numericClientId, 
                event.id, 
                calendarId
              );

              results.push({
                event,
                success: deleteResult.success,
                error: deleteResult.error
              });

              if (deleteResult.success) {
                successCount++;
              } else {
                failureCount++;
              }

              // Add small delay between deletions to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
              failureCount++;
              results.push({
                event,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }

          // Generate results summary
          let resultText = `**✅ Bulk Cancellation Complete**\n\n`;
          resultText += `**Summary:**\n`;
          resultText += `- ✅ Successfully canceled: ${successCount}\n`;
          resultText += `- ❌ Failed to cancel: ${failureCount}\n`;
          resultText += `- 📊 Total processed: ${eventsToDelete.length}\n\n`;

          if (successCount > 0) {
            resultText += `**✅ Successfully Canceled (${successCount}):**\n`;
            results
              .filter(r => r.success)
              .forEach((result, index) => {
                const startTime = new Date(
                  typeof result.event.start === 'string' ? result.event.start : result.event.start?.dateTime || ''
                ).toLocaleString("en-US");
                resultText += `${index + 1}. ${result.event.subject || 'Untitled'} - ${startTime}\n`;
              });
            resultText += `\n`;
          }

          if (failureCount > 0) {
            resultText += `**❌ Failed to Cancel (${failureCount}):**\n`;
            results
              .filter(r => !r.success)
              .forEach((result, index) => {
                const startTime = new Date(
                  typeof result.event.start === 'string' ? result.event.start : result.event.start?.dateTime || ''
                ).toLocaleString("en-US");
                resultText += `${index + 1}. ${result.event.subject || 'Untitled'} - ${startTime}\n`;
                resultText += `   Error: ${result.error}\n`;
              });
          }

          resultText += `\n📧 Attendees have been automatically notified of the cancellations.`;

          return {
            content: [
              {
                type: "text",
                text: resultText,
              },
            ],
          };

        } catch (error) {
          console.error("Error in bulk delete calendar events:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Bulk Deletion Failed**\n\n**Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}\n\n**Client ID**: ${numericClientId}`,
              },
            ],
          };
        }
      }
    );

    //SearchCalendarEvents
    server.tool(
      "SearchCalendarEvents",
      "Find calendar events by searching meeting titles. Useful for locating specific appointments.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        searchQuery: z
          .string()
          .describe("Search text: 'John Smith' or 'Sales Meeting' (searches meeting titles)"),
        startDate: z
          .string()
          .optional()
          .describe("Search from date: '2025-10-01T00:00:00' (optional)"),
        endDate: z
          .string()
          .optional()
          .describe("Search until date: '2025-10-31T23:59:59' (optional)"),
        calendarId: z
          .string()
          .optional()
          .describe("Calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            searchQuery,
            startDate,
            endDate,
            calendarId,
          } = input;
          
          console.log("search calendar events (Microsoft Graph)");
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

          const result = await FinalOptimizedCalendarOperations.searchCalendarEventsForClient(
            numericClientId,
            searchQuery,
            { startDate, endDate, calendarId }
          );

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching calendar events: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Calendar Event Search Results** (Client ID: ${numericClientId})\n\n`;
          responseText += `**Search Query**: "${searchQuery}"\n`;
          
          if (startDate && endDate) {
            responseText += `**Date Range**: ${startDate} to ${endDate}\n`;
          }
          
          responseText += `\n${result.formattedEvents}`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in SearchCalendarEvents:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching calendar events: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //GetCalendars
    server.tool(
      "GetCalendars",
      "List all available calendars for a client. Shows primary and secondary calendars.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
      },
      async (input) => {
        try {
          const { clientId } = input;
          
          console.log("get calendars (Microsoft Graph)");
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

          const result = await FinalOptimizedCalendarOperations.getCalendarsForClient(numericClientId);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error retrieving calendars: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Microsoft Calendars for Client ${numericClientId}**\n\n`;

          if (!result.calendars || result.calendars.length === 0) {
            responseText += `No calendars found.`;
          } else {
            responseText += `Found ${result.calendars.length} calendar(s):\n\n`;

            result.calendars.forEach((calendar, index) => {
              responseText += `**${index + 1}. ${calendar.name}**\n`;
              responseText += `- **ID**: \`${calendar.id}\`\n`;
              responseText += `- **Default**: ${calendar.isDefault ? "✅ Yes" : "❌ No"}\n`;
              responseText += `- **Can Edit**: ${calendar.canEdit ? "✅ Yes" : "❌ No"}\n`;
              
              responseText += `- **Owner**: ${calendar.owner}\n`;
              
              responseText += `\n`;
            });
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
          console.error("Error in GetCalendars:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving calendars: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //CheckCalendarConnection
    server.tool(
      "CheckCalendarConnection",
      "Verify if a client has Microsoft calendar connected. Shows connection status and details.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
      },
      async (input) => {
        try {
          const { clientId } = input;
          
          console.log("check calendar connection (Microsoft Graph)");
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

          const summary = await FinalOptimizedCalendarOperations.checkClientCalendarConnection(numericClientId);

          if (!summary) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Could not retrieve calendar connection information for client ${numericClientId}`,
                },
              ],
            };
          }

          let responseText = `**Calendar Connection Status for Client ${numericClientId}**\n\n`;

          if (summary.connected) {
            responseText += `**Status**: ✅ Connected\n`;
            
            if (summary.connectionDetails) {
              const details = summary.connectionDetails;
              responseText += `**User Email**: ${details.userEmail}\n`;
              responseText += `**User Name**: ${details.userName}\n`;
              responseText += `**Connected At**: ${new Date(details.connectedAt).toLocaleDateString()}\n`;
              
              if (details.lastSync) {
                responseText += `**Last Sync**: ${new Date(details.lastSync).toLocaleDateString()}\n`;
              }
              
              if (details.calendarsCount !== undefined) {
                responseText += `**Available Calendars**: ${details.calendarsCount}\n`;
              }
            }
            
            responseText += `\nThis client can access calendar events through Microsoft Graph.`;
          } else {
            responseText += `**Status**: ❌ Not connected\n`;
            if (summary.error) {
              responseText += `**Error**: ${summary.error}\n`;
            }
            responseText += `\nThis client needs to connect their Microsoft calendar before accessing events.`;
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
          console.error("❌ Error in CheckCalendarConnection:", error);
          return {
            content: [
              {
                type: "text",
                text: `❌ Error checking calendar connection: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //GetAvailability
    server.tool(
      "GetAvailability",
      "Check when people are free or busy. Shows detailed availability information for scheduling.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        startDate: z
          .string()
          .describe("Check from: '2025-10-06T09:00:00'"),
        endDate: z
          .string()
          .describe("Check until: '2025-10-06T17:00:00'"),
        emails: z
          .array(z.string().email())
          .optional()
          .describe("Email addresses to check: ['john@company.com'] (optional, uses client email if not provided)"),
        intervalInMinutes: z
          .number()
          .optional()
          .describe("Time slot intervals: 15, 30, 60 minutes (default: 60)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            startDate,
            endDate,
            emails,
            intervalInMinutes,
          } = input;
          
          console.log("get availability (Microsoft Graph)");
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

          const request: GetAvailabilityRequest = {
            clientId: numericClientId,
            startDate,
            endDate,
            emails,
            intervalInMinutes,
          };

          // Use legacy function for availability (not yet optimized)
          const result = await FinalOptimizedCalendarOperations.getAvailabilityForClient(numericClientId, request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error retrieving availability: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Availability Information for Client ${numericClientId}**\n\n`;
          responseText += `**Date Range**: ${new Date(startDate).toLocaleDateString("en-US")} - ${new Date(endDate).toLocaleDateString("en-US")}\n\n`;

          if (!result.availability || result.availability.length === 0) {
            responseText += `**No busy times found** - All requested time slots appear to be available.`;
          } else {
            responseText += `**Busy Times Found:**\n\n`;

            result.availability.forEach((person) => {
              responseText += `**👤 ${person.email}:**\n`;
              
              if (person.availability.length === 0) {
                responseText += ` No busy times - Available for the entire period\n`;
              } else {
                person.availability.forEach((slot, index) => {
                  const startTime = new Date(slot.start).toLocaleString("en-US");
                  const endTime = new Date(slot.end).toLocaleString("en-US");
                  responseText += `   ${index + 1}. **${slot.status.toUpperCase()}**: ${startTime} - ${endTime}\n`;
                });
              }
              
                      responseText += `\n`;
                    });
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
          console.error("Error in GetAvailability:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving availability: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //FindAvailableSlots
    server.tool(
      "FindAvailableSlots",
      "Check availability and suggest alternative time slots. Considers existing appointments and office hours.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000001)"),
        requestedStartTime: z
          .string()
          .describe("Preferred start time: '2025-10-06T13:00:00'"),
        requestedEndTime: z
          .string()
          .describe("Preferred end time: '2025-10-06T14:00:00'"),
        durationMinutes: z
          .number()
          .optional()
          .default(60)
          .describe("Meeting duration in minutes: 30, 60, 90 (default: 60)"),
        maxSuggestions: z
          .number()
          .optional()
          .default(5)
          .describe("Number of alternative slots to suggest: 3-10 (default: 5)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            requestedStartTime,
            requestedEndTime,
            durationMinutes,
            maxSuggestions,
          } = input;
          
          console.log("find available slots (Microsoft Graph)");
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

          const result = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
            numericClientId,
            requestedStartTime,
            requestedEndTime,
            durationMinutes || 60,
            maxSuggestions || 5
          );

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error finding available slots: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Available Time Slots for Client ${numericClientId}**\n\n`;
          responseText += `**Requested Time**: ${new Date(requestedStartTime).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} - ${new Date(requestedEndTime).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} (Melbourne Time)\n\n`;

          if (!result.hasConflict) {
            responseText += `**✅ REQUESTED TIME IS AVAILABLE!**\n\n`;
            responseText += `The requested time slot is free and can be booked immediately.\n`;
            responseText += `You can proceed with creating the calendar event at this time.`;
            } else {
            responseText += `**❌ REQUESTED TIME HAS CONFLICTS**\n\n`;
            
            if (result.conflictDetails) {
              responseText += `**Conflict Details**: ${result.conflictDetails}\n\n`;
            }

            if (result.availableSlots && result.availableSlots.length > 0) {
              responseText += `**💡 SUGGESTED ALTERNATIVE SLOTS** (within business hours 9 AM - 6 PM):\n\n`;
              
              result.availableSlots.forEach((slot, index) => {
                responseText += `**${index + 1}.** ${slot.startFormatted} - ${slot.endFormatted}\n`;
              });
              
              responseText += `\n**Next Steps**: Choose one of the suggested time slots above and create a new calendar event with that time.`;
            } else {
              responseText += `**⚠️ NO ALTERNATIVE SLOTS FOUND**\n\n`;
              responseText += `No available slots found within business hours (9 AM - 6 PM Melbourne time).\n`;
              responseText += `Please try a different date or time range.`;
            }
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
          console.error("Error in FindAvailableSlots:", error);
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
  },
  {},
  { basePath: "/api/calendar" }
);

export { handler as GET, handler as POST, handler as DELETE };
