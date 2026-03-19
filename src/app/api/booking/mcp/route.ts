import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import { BookingService } from '@/lib/helpers/booking/booking-service';
import { extractBookingIds } from '@/lib/helpers/booking/booking-extractor';
import { getAgentWithCalendarByUUID } from '@/lib/helpers/utils';
import { getCalendarConnectionByPipelineId } from '@/lib/helpers/booking_functions/calendar/graphDatabase';


const handler = createMcpHandler((server) => {
  // ============================================
  // Tool 1: List Agents (current agent only – use agentId from instructionsText)
  // ============================================
  server.tool(
    'ListAgents',
    'Get the current agent from booking instructions (instructionsText must include agentId and clientId). Returns only that agent with calendar status. If the agent has no calendar, provide boardId in instructionsText – the board/pipeline calendar will be used for availability. Use the agentId from the prompt – do not list all agents.',
    {
      instructionsText: z
        .string()
        .describe('Booking instructions: clientId and agentId (required). boardId (optional but recommended when agent has no calendar – then board calendar is used). Optional: stageId, dealId, timezone'),
    },
    async (args) => {
      try {
        console.log('📋 [ListAgents] Called');

        const ids = extractBookingIds(args.instructionsText);

        if (!ids.clientId) {
          return {
            content: [
              {
                type: 'text',
                text: `<json>${JSON.stringify({
                  success: false,
                  error: 'clientId not found in instructions. Provide clientId in instructionsText.',
                  code: 'MISSING_IDS',
                  customerFacingMessage: "I couldn't verify the booking details. Please try again.",
                })}</json>`,
              },
            ],
          };
        }

        if (!ids.agentId) {
          return {
            content: [
              {
                type: 'text',
                text: `<json>${JSON.stringify({
                  success: false,
                  error: 'agentId not found in instructions. ListAgents returns the current agent only – include agentId in instructionsText.',
                  code: 'MISSING_IDS',
                  customerFacingMessage: "I couldn't identify the current agent. Please check the booking instructions.",
                })}</json>`,
              },
            ],
          };
        }

        const agent = await getAgentWithCalendarByUUID(ids.agentId, ids.clientId);

        if (!agent) {
          return {
            content: [
              {
                type: 'text',
                text: `<json>${JSON.stringify({
                  success: false,
                  error: 'Agent not found or does not belong to this client',
                  clientId: ids.clientId,
                  agentId: ids.agentId,
                  code: 'AGENT_NOT_FOUND',
                  customerFacingMessage: "I couldn't find that agent. Please check the booking details.",
                })}</json>`,
              },
            ],
          };
        }

        const conn = agent.calendar_assignment?.calendar_connections as { provider_name?: string; email?: string } | null | undefined;
        const hasCalendar = !!conn?.email;
        const calendarProvider = conn?.provider_name;
        const calendarEmail = conn?.email;

        let boardCalendar: { provider: string; email: string } | null = null;
        if (ids.boardId) {
          const connection = await getCalendarConnectionByPipelineId(ids.boardId, ids.clientId);
          if (connection) {
            boardCalendar = {
              provider: connection.provider_name,
              email: connection.email,
            };
          }
        }

        const calendar = hasCalendar && calendarProvider && calendarEmail
          ? { provider: calendarProvider, email: calendarEmail, source: 'agent' as const }
          : boardCalendar
            ? { provider: boardCalendar.provider, email: boardCalendar.email, source: 'board' as const }
            : null;

        const agentPayload = {
          uuid: agent.uuid,
          name: agent.name,
          title: agent.title ?? '',
          calendar,
          /** When agent has no calendar, boardId is used; calendar.source is 'board' in that case. */
          calendarSource: calendar?.source ?? null,
        };

        const profileName = (agent as { profiles?: { name?: string } }).profiles?.name ?? agent.name;
        const customerFacingMessage = calendar
          ? `I can check availability for ${profileName} when you're ready.`
          : `I'm sorry, I can't check availability for ${profileName} right now.`;

        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: true,
                agents: [agentPayload],
                clientId: ids.clientId,
                agentId: ids.agentId,
                totalAgents: 1,
                customerFacingMessage,
              })}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [ListAgents] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Something went wrong. Please try again.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 2: Get Booking Context (chunked flow – say "checking calendar" then call FindAvailableSlots)
  // ============================================
  server.tool(
    'GetBookingContext',
    'Resolve booking context (agent + calendar) so you can tell the customer what you are checking. Call this first, then say the customerFacingMessage to the customer, then call FindAvailableSlots. Returns agent name and a short phrase to say.',
    {
      instructionsText: z
        .string()
        .describe('Booking instructions containing clientId, agentId, and optional boardId, stageId, dealId, timezone'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.coerce.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.coerce.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
    },
    async (args) => {
      try {
        console.log('📋 [GetBookingContext] Called');
        const result = await BookingService.resolveBookingContext({
          instructionsText: args.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          boardId: args.boardId,
          stageId: args.stageId,
          dealId: args.dealId,
          timezone: args.timezone,
          calendarId: args.calendarId,
        });
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(result)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [GetBookingContext] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Something went wrong. Please try again.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 3: Book Appointment (main booking tool)
  // ============================================
  
  server.tool(
    'BookAppointment',
    'Book a customer appointment with automatic conflict detection and slot suggestions',
    {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions containing all IDs in JSON format. If omitted, IDs will be built from the explicit fields (clientId/agentId/boardId/stageId/dealId/timezone).'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.coerce.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.coerce.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      startDateTime: z
        .string()
        .optional()
        .describe('Start time in ISO 8601 format (e.g., 2025-12-06T13:00:00)'),
      endDateTime: z
        .string()
        .optional()
        .describe('End time in ISO 8601 format (e.g., 2025-12-06T14:00:00)'),
      customerName: z.string().optional().describe('Customer name (optional)'),
      customerEmail: z.string().email().optional().describe('Customer email (optional)'),
      customerPhoneNumber: z.string().optional().describe('Customer phone (optional)'),
      subject: z.string().optional().describe('Meeting subject (optional)'),
      description: z.string().optional().describe('Meeting description (optional)'),
      location: z.string().optional().describe('Meeting location (optional)'),
      isOnlineMeeting: z
        .boolean()
        .optional()
        .default(true)
        .describe('Create online meeting link (default: true)'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
    },
    async (args) => {
      try {
        console.log('📞 [BookAppointment] Called');

        const hasInstructionsText: boolean =
          typeof args.instructionsText === 'string' && args.instructionsText.trim().length > 0

        const builtInstructionsText: string | undefined = hasInstructionsText
          ? args.instructionsText
          : JSON.stringify({
              clientId: args.clientId,
              agentId: args.agentId,
              dealId: args.dealId,
              boardId: args.boardId,
              stageId: args.stageId,
              timezone: args.timezone,
            })

        const instructionsText: string = builtInstructionsText ?? ''

        if (!instructionsText.trim()) {
          return {
            content: [
              {
                type: 'text',
                text: `<json>${JSON.stringify({
                  success: false,
                  code: 'MISSING_INSTRUCTIONS',
                  error:
                    'Missing booking instructions. Provide instructionsText or the explicit ID fields (clientId, agentId, boardId, stageId, dealId, timezone).',
                })}</json>`,
              },
            ],
          }
        }

        if (!args.startDateTime || !args.endDateTime) {
          return {
            content: [
              {
                type: 'text',
                text: `<json>${JSON.stringify({
                  success: false,
                  code: 'MISSING_TIME_RANGE',
                  error:
                    'Missing startDateTime/endDateTime. BookAppointment requires an ISO startDateTime and endDateTime (use a slot returned by FindAvailableSlots).',
                  received: {
                    startDateTime: args.startDateTime ?? null,
                    endDateTime: args.endDateTime ?? null,
                  },
                })}</json>`,
              },
            ],
          }
        }

        const result = await BookingService.bookAppointment({
          instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          boardId: args.boardId,
          stageId: args.stageId,
          dealId: args.dealId,
          timezone: args.timezone,
          startDateTime: args.startDateTime,
          endDateTime: args.endDateTime,
          customerInfo: {
            name: args.customerName,
            email: args.customerEmail,
            phoneNumber: args.customerPhoneNumber,
          },
          subject: args.subject,
          description: args.description,
          location: args.location,
          isOnlineMeeting: args.isOnlineMeeting,
          calendarId: args.calendarId,
        });

        console.log('✅ [BookAppointment] Result:', JSON.stringify(result, null, 2));

        const bookingPayload =
          'success' in result && result.success && result.booking
            ? {
                ...result,
                customerFacingMessage: `Your appointment is confirmed. You'll receive a confirmation by SMS shortly.`,
              }
            : 'conflict' in result && result.conflict
              ? {
                  ...result,
                  customerFacingMessage:
                    "That time is no longer available. I can suggest other times if you'd like.",
                }
              : { ...result };

        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(bookingPayload)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [BookAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Booking didn't go through. Please try again or pick another time.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 4: Find Available Slots
  // ============================================
  server.tool(
    'FindAvailableSlots',
    'Find available time slots for booking with an agent',
    {
      instructionsText: z
        .string()
        .describe('REQUIRED: Booking instructions containing all IDs in JSON format. Example: {"clientId":"52","agentId":"uuid","boardId":"uuid","stageId":"uuid","dealId":"123","timezone":"Australia/Perth"}'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.coerce.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.coerce.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      preferredDate: z
        .string()
        .describe(
          'Preferred date: "today", "tomorrow", "2025-12-06", or ISO format'
        ),
      durationMinutes: z
        .number()
        .optional()
        .default(60)
        .describe('Meeting duration in minutes (default: 60)'),
      maxSuggestions: z
        .number()
        .optional()
        .default(3)
        .describe('Maximum number of slot suggestions (default: 3)'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
      customerName: z.string().optional().describe('Caller\'s name for inbound contact lookup via fuzzy search (e.g., the caller\'s name from the conversation)'),
    },
    async (args) => {
      try {
        console.log('🔍 [FindAvailableSlots] Called');

        const result = await BookingService.findAvailableSlots({
          instructionsText: args.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          boardId: args.boardId,
          stageId: args.stageId,
          dealId: args.dealId,
          timezone: args.timezone,
          preferredDate: args.preferredDate,
          durationMinutes: args.durationMinutes,
          maxSuggestions: args.maxSuggestions,
          calendarId: args.calendarId,
          customerName: args.customerName,
        });

        
        console.log('✅ [FindAvailableSlots] Result:', JSON.stringify(result, null, 2));

        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(result)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [FindAvailableSlots] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Something went wrong while checking availability. Please try again.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 5: Cancel Appointment
  // ============================================
  server.tool(
    'CancelAppointment',
    'Cancel an existing customer appointment',
    {
      instructionsText: z
        .string()
        .describe('REQUIRED: Booking instructions containing all IDs in JSON format. Example: {"clientId":"52","agentId":"uuid","boardId":"uuid","stageId":"uuid","dealId":"123","timezone":"Australia/Perth"}'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      eventId: z.string().describe('Event ID to cancel'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
      notifyCustomer: z
        .boolean()
        .optional()
        .default(true)
        .describe('Send cancellation notification (default: true)'),
    },
    async (args) => {
      try {
        console.log('🗑️ [CancelAppointment] Called');

        const result = await BookingService.cancelAppointment({
          instructionsText: args.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          boardId: args.boardId,
          stageId: args.stageId,
          dealId: args.dealId,
          timezone: args.timezone,
          eventId: args.eventId,
          calendarId: args.calendarId,
          notifyCustomer: args.notifyCustomer,
        });

        console.log('✅ [CancelAppointment] Result:', JSON.stringify(result, null, 2));

        const cancelPayload = {
          ...result,
          customerFacingMessage: result.success
            ? "Your appointment has been cancelled. Let me know if you'd like to reschedule."
            : "I couldn't cancel that appointment. Please try again or contact support.",
        };

        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(cancelPayload)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [CancelAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Something went wrong. Please try again.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 6: Reschedule Appointment
  // ============================================
  server.tool(
    'RescheduleAppointment',
    'Reschedule an existing customer appointment to a new time',
    {
      instructionsText: z
        .string()
        .describe('REQUIRED: Booking instructions containing all IDs in JSON format. Example: {"clientId":"52","agentId":"uuid","boardId":"uuid","stageId":"uuid","dealId":"123","timezone":"Australia/Perth"}'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      eventId: z.string().describe('Event ID to reschedule'),
      newStartDateTime: z
        .string()
        .describe('New start time in ISO 8601 format'),
      newEndDateTime: z
        .string()
        .describe('New end time in ISO 8601 format'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
      notifyCustomer: z
        .boolean()
        .optional()
        .default(true)
        .describe('Send update notification (default: true)'),
    },
    async (args) => {
      try {
        console.log('📅 [RescheduleAppointment] Called');

        const result = await BookingService.rescheduleAppointment({
          instructionsText: args.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          boardId: args.boardId,
          stageId: args.stageId,
          dealId: args.dealId,
          timezone: args.timezone,
          eventId: args.eventId,
          newStartDateTime: args.newStartDateTime,
          newEndDateTime: args.newEndDateTime,
          calendarId: args.calendarId,
          notifyCustomer: args.notifyCustomer,
        });

        console.log('✅ [RescheduleAppointment] Result:', JSON.stringify(result, null, 2));

        const reschedulePayload = {
          ...result,
          customerFacingMessage: result.success
            ? "Your appointment has been rescheduled. You'll get an updated confirmation by SMS."
            : "I couldn't reschedule that. Please try again or pick another time.",
        };

        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(reschedulePayload)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [RescheduleAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "Something went wrong. Please try again.",
              })}</json>`,
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 7: Calculate Date
  // ============================================
  server.tool(
    'CalculateDate',
    'Calculate a specific date based on natural language query. Use as source of truth.',
    {
      query: z.string().describe('Natural language date query (e.g., "next Monday", "tomorrow")'),
      timezone: z.string().describe('Client timezone (e.g., "Australia/Perth")'),
    },
    async (args) => {
      try {
        console.log('📅 [CalculateDate] Called');
        const result = await BookingService.calculateDate(args.query, args.timezone);
        const payload = {
          ...result,
          customerFacingMessage: `That would be ${result.date}.`,
        };
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify(payload)}</json>`,
            },
          ],
        };
      } catch (error) {
        console.error('❌ [CalculateDate] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: `<json>${JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
                customerFacingMessage: "I couldn't work out that date. Can you say it again, for example 'next Monday'?",
              })}</json>`,
            },
          ],
        };
      }
    }
  );
},
{
  serverInfo: {
    name: 'booking-mcp-server',
    version: '0.1.0',
  }
},
{
  basePath: '/api/booking',
});

// Export Next.js API routes
export { handler as GET, handler as POST, handler as DELETE };
