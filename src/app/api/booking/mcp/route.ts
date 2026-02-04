import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import { BookingService } from '@/lib/helpers/booking/booking-service';
import { extractBookingIds } from '@/lib/helpers/booking/booking-extractor';
import { getAgentsForClient } from '@/lib/helpers/utils';
import { getCalendarConnectionByPipelineId } from '@/lib/helpers/booking_functions/calendar/graphDatabase';


const handler = createMcpHandler((server) => {
  // ============================================
  // Tool 1: List Agents
  // ============================================
  server.tool(
    'ListAgents',
    'List all available agents with their calendar connection status',
    {
      instructionsText: z
        .string()
        .describe('Booking instructions containing clientId, agentIdand optional boardId'),
    },
    async (args) => {
      try {
        console.log('📋 [ListAgents] Called');

        // Extract IDs
        const ids = extractBookingIds(args.instructionsText);

        if (!ids.clientId) {
          return {
            content: [
              {
                type: 'text',
                text: 'Error: clientId not found in instructions. Please provide clientId in the instructions text.',
              },
            ],
          };
        }

        // Get agents
        const result = await getAgentsForClient(ids.clientId, {
          includeDedicated: true,
          withCalendarOnly: false,
        });

        if (!result || result.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'No agents found',
                  clientId: ids.clientId,
                }),
              },
            ],
          };
        }

        // Get board calendar if boardId provided
        let boardCalendar = null;
        if (ids.boardId) {
          const connection = await getCalendarConnectionByPipelineId(
            ids.boardId,
            ids.clientId
          );
          if (connection) {
            boardCalendar = {
              provider: connection.provider_name,
              email: connection.email,
            };
          }
        }

        // Format response
        const agents = result.map((agent) => ({
          uuid: agent.uuid,
          name: agent.name,
          title: agent.title,
          calendar: agent.hasCalendar && agent.calendarProvider && agent.calendarEmail
            ? {
                provider: agent.calendarProvider,
                email: agent.calendarEmail,
                source: 'agent',
              }
            : boardCalendar
            ? {
                provider: boardCalendar.provider,
                email: boardCalendar.email,
                source: 'board',
              }
            : null,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agents,
                clientId: ids.clientId,
                totalAgents: agents.length,
              }),
            },
          ],
        };
      } catch (error) {
        console.error('❌ [ListAgents] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
              }),
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 2: Book Appointment
  // ============================================
  server.tool(
    'BookAppointment',
    'Book a customer appointment with automatic conflict detection and slot suggestions',
    {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions from VAPI containing all IDs (optional if IDs provided explicitly)'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.number().optional().describe('Deal ID'),
      timezone: z.string().optional().describe('Timezone'),
      startDateTime: z
        .string()
        .describe('Start time in ISO 8601 format (e.g., 2025-12-06T13:00:00)'),
      endDateTime: z
        .string()
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

        const result = await BookingService.bookAppointment({
          instructionsText: args.instructionsText,
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('❌ [BookAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
              }),
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 3: Find Available Slots
  // ============================================
  server.tool(
    'FindAvailableSlots',
    'Find available time slots for booking with an agent',
    {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions from VAPI containing all IDs (optional if IDs provided explicitly)'),
      agentId: z.string().optional().describe('Agent UUID'),
      clientId: z.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID'),
      stageId: z.string().optional().describe('Stage UUID'),
      dealId: z.number().optional().describe('Deal ID'),
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
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('❌ [FindAvailableSlots] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
              }),
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 4: Cancel Appointment
  // ============================================
  server.tool(
    'CancelAppointment',
    'Cancel an existing customer appointment',
    {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions from VAPI containing all IDs (optional if IDs provided explicitly)'),
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('❌ [CancelAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
              }),
            },
          ],
        };
      }
    }
  );

  // ============================================
  // Tool 5: Reschedule Appointment
  // ============================================
  server.tool(
    'RescheduleAppointment',
    'Reschedule an existing customer appointment to a new time',
    {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions from VAPI containing all IDs (optional if IDs provided explicitly)'),
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('❌ [RescheduleAppointment] Error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                code: 'UNKNOWN_ERROR',
              }),
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
