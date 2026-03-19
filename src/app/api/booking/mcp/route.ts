import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import { BookingService } from '@/lib/helpers/booking/booking-service';
import { getAgentsForClient } from '@/lib/helpers/utils';
import { getCalendarConnectionByPipelineId } from '@/lib/helpers/booking_functions/calendar/graphDatabase';
import { BookingMcpResponseSchemas } from '@/lib/mcp/booking-mcp/booking-mcp-response-schemas';
import { createJsonResponse } from '@/lib/mcp/booking-mcp/create-json-response';
import { createToolError } from '@/lib/mcp/booking-mcp/create-tool-error';
import { createValidatedResponse } from '@/lib/mcp/booking-mcp/create-validated-response';
import { getLogSafeSummary } from '@/lib/mcp/booking-mcp/get-log-safe-summary';
import { getSafeErrorMessage } from '@/lib/mcp/booking-mcp/get-safe-error-message';
import { resolveBookingMcpIds } from '@/lib/mcp/booking-mcp/resolve-booking-mcp-ids';

type McpTextContent = { type: 'text'; text: string }
type McpResponse = { content: McpTextContent[] }


const handler = createMcpHandler((server) => {
  const registerToolAlias = <TArgs extends Record<string, z.ZodTypeAny>>(
    input: {
      currentName: string
      legacyName: string
      description: string
      args: TArgs
      handler: (args: z.infer<z.ZodObject<TArgs>>) => Promise<McpResponse>
    }
  ): void => {
    server.tool(input.currentName, input.description, input.args, input.handler as any)
    server.tool(input.legacyName, `${input.description} (legacy alias)`, input.args, input.handler as any)
  }

  // ============================================
  // Tool 1: List Agents
  // ============================================
  registerToolAlias({
    currentName: 'agents-list.v1',
    legacyName: 'ListAgents',
    description: 'List all available agents with their calendar connection status',
    args: {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions containing clientId and optional boardId (legacy input)'),
      clientId: z.coerce.number().optional().describe('Client ID'),
      boardId: z.string().optional().describe('Board UUID (optional)')
    },
    handler: async (args) => {
      try {
        console.log('📋 [agents-list.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            clientId: args.clientId,
            boardId: args.boardId
          },
          requiredKeys: ['clientId']
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const ids = resolvedIds.ids
        const clientId: number = ids.clientId as number

        // Get agents
        const result = await getAgentsForClient(clientId, {
          includeDedicated: true,
          withCalendarOnly: false,
        })

        if (!result || result.length === 0) {
          return createToolError({
            code: 'NOT_FOUND',
            error: 'No agents found',
            details: { clientId: ids.clientId }
          })
        }

        // Get board calendar if boardId provided
        let boardCalendar = null;
        if (ids.boardId) {
          const connection = await getCalendarConnectionByPipelineId(
            ids.boardId,
            clientId
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

        return createJsonResponse({
          success: true,
          agents,
          clientId,
          totalAgents: agents.length
        })
      } catch (error) {
        console.error('❌ [agents-list.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })

  // ============================================
  // Tool 2: Book Appointment
  // ============================================
  
  registerToolAlias({
    currentName: 'booking-create.v1',
    legacyName: 'BookAppointment',
    description: 'Book a customer appointment with automatic conflict detection and slot suggestions',
    args: {
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
    handler: async (args) => {
      try {
        console.log('📞 [booking-create.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            timezone: args.timezone
          }
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const instructionsText: string = resolvedIds.instructionsText

        if (!instructionsText.trim()) {
          return createToolError({
            code: 'MISSING_INSTRUCTIONS',
            error: 'Missing booking instructions. Provide `instructionsText` or the explicit ID fields (clientId, agentId, boardId, stageId, dealId, timezone).'
          })
        }

        if (!args.startDateTime || !args.endDateTime) {
          return createToolError({
            code: 'MISSING_TIME_RANGE',
            error: 'Missing startDateTime/endDateTime. booking-create.v1 requires an ISO startDateTime and endDateTime (use a slot returned by slots-find.v1).',
            details: {
              received: {
                startDateTime: args.startDateTime ?? null,
                endDateTime: args.endDateTime ?? null
              }
            }
          })
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

        console.log('✅ [booking-create.v1] Result:', JSON.stringify(getLogSafeSummary(result)))

        return createValidatedResponse(BookingMcpResponseSchemas.booking, result)
      } catch (error) {
        console.error('❌ [booking-create.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })

  // ============================================
  // Tool 3: Find Available Slots
  // ============================================
  registerToolAlias({
    currentName: 'slots-find.v1',
    legacyName: 'FindAvailableSlots',
    description: 'Find available time slots for booking with an agent',
    args: {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions containing IDs in JSON format (legacy input). If omitted, IDs will be built from explicit fields.'),
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
    handler: async (args) => {
      try {
        console.log('🔍 [slots-find.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            timezone: args.timezone
          }
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const instructionsText: string = resolvedIds.instructionsText

        const result = await BookingService.findAvailableSlots({
          instructionsText,
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

        
        console.log('✅ [slots-find.v1] Result:', JSON.stringify(getLogSafeSummary(result)))

        return createValidatedResponse(BookingMcpResponseSchemas.slots, result)
      } catch (error) {
        console.error('❌ [slots-find.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })

  // ============================================
  // Tool 4: Cancel Appointment
  // ============================================
  registerToolAlias({
    currentName: 'booking-cancel.v1',
    legacyName: 'CancelAppointment',
    description: 'Cancel an existing customer appointment',
    args: {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions containing IDs in JSON format (legacy input). If omitted, IDs will be built from explicit fields.'),
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
    handler: async (args) => {
      try {
        console.log('🗑️ [booking-cancel.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            timezone: args.timezone
          }
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const instructionsText: string = resolvedIds.instructionsText

        const result = await BookingService.cancelAppointment({
          instructionsText,
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

        console.log('✅ [booking-cancel.v1] Result:', JSON.stringify(getLogSafeSummary(result)))

        return createValidatedResponse(BookingMcpResponseSchemas.cancel, result)
      } catch (error) {
        console.error('❌ [booking-cancel.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })

  // ============================================
  // Tool 5: Reschedule Appointment
  // ============================================
  registerToolAlias({
    currentName: 'booking-reschedule.v1',
    legacyName: 'RescheduleAppointment',
    description: 'Reschedule an existing customer appointment to a new time',
    args: {
      instructionsText: z
        .string()
        .optional()
        .describe('Booking instructions containing IDs in JSON format (legacy input). If omitted, IDs will be built from explicit fields.'),
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
    handler: async (args) => {
      try {
        console.log('📅 [booking-reschedule.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            timezone: args.timezone
          }
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const instructionsText: string = resolvedIds.instructionsText

        const result = await BookingService.rescheduleAppointment({
          instructionsText,
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

        console.log('✅ [booking-reschedule.v1] Result:', JSON.stringify(getLogSafeSummary(result)))

        return createValidatedResponse(BookingMcpResponseSchemas.reschedule, result)
      } catch (error) {
        console.error('❌ [booking-reschedule.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })
  // ============================================
  // Tool 6: Calculate Date
  // ============================================
  registerToolAlias({
    currentName: 'date-calculate.v1',
    legacyName: 'CalculateDate',
    description: 'Calculate a specific date based on natural language query. Use as source of truth.',
    args: {
      query: z.string().describe('Natural language date query (e.g., "next Monday", "tomorrow")'),
      timezone: z.string().describe('Client timezone (e.g., "Australia/Perth")'),
    },
    handler: async (args) => {
      try {
        console.log('📅 [date-calculate.v1] Called')
        const result = await BookingService.calculateDate(args.query, args.timezone)
        console.log('✅ [date-calculate.v1] Result:', JSON.stringify(getLogSafeSummary(result)))
        return createValidatedResponse(BookingMcpResponseSchemas.calculateDate, result)
      } catch (error) {
        console.error('❌ [date-calculate.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  })

  // ============================================
  // Inbound / Receptionist Tools (minimal IDs)
  // ============================================
  server.tool(
    'inbound-agents-list.v1',
    'List agents for inbound calls (requires clientId; boardId/dealId/stageId not needed)',
    {
      instructionsText: z.string().optional().describe('Legacy JSON blob (optional)'),
      clientId: z.coerce.number().optional().describe('Client ID (required)'),
      boardId: z.string().optional().describe('Optional board UUID (for board calendar fallback)')
    },
    async (args) => {
      try {
        console.log('📋 [inbound-agents-list.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            clientId: args.clientId,
            boardId: args.boardId
          },
          requiredKeys: ['clientId']
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const ids = resolvedIds.ids
        const clientId: number = ids.clientId as number

        const result = await getAgentsForClient(clientId, {
          includeDedicated: true,
          withCalendarOnly: true
        })

        if (!result || result.length === 0) {
          return createToolError({
            code: 'NOT_FOUND',
            error: 'No agents with calendars found',
            details: { clientId }
          })
        }

        let boardCalendar = null
        if (ids.boardId) {
          const connection = await getCalendarConnectionByPipelineId(ids.boardId, clientId)
          if (connection) {
            boardCalendar = {
              provider: connection.provider_name,
              email: connection.email
            }
          }
        }

        const agents = result.map((agent) => ({
          uuid: agent.uuid,
          name: agent.name,
          title: agent.title,
          calendar: agent.hasCalendar && agent.calendarProvider && agent.calendarEmail
            ? {
                provider: agent.calendarProvider,
                email: agent.calendarEmail,
                source: 'agent'
              }
            : boardCalendar
              ? {
                  provider: boardCalendar.provider,
                  email: boardCalendar.email,
                  source: 'board'
                }
              : null
        }))

        return createJsonResponse({
          success: true,
          agents,
          clientId,
          totalAgents: agents.length
        })
      } catch (error) {
        console.error('❌ [inbound-agents-list.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  )

  server.tool(
    'inbound-slots-find.v1',
    'Find available slots for inbound calls (requires clientId, agentId, timezone; no boardId/dealId/stageId)',
    {
      instructionsText: z.string().optional().describe('Legacy JSON blob (optional)'),
      agentId: z.string().optional().describe('Agent UUID (required)'),
      clientId: z.coerce.number().optional().describe('Client ID (required)'),
      timezone: z.string().optional().describe('Timezone (required, e.g., Australia/Perth)'),
      preferredDate: z.string().describe('Preferred date: "today", "tomorrow", "2025-12-06", or ISO format'),
      durationMinutes: z.number().optional().default(60).describe('Meeting duration in minutes (default: 60)'),
      maxSuggestions: z.number().optional().default(3).describe('Maximum number of slot suggestions (default: 3)'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)'),
      customerName: z.string().optional().describe('Caller name for inbound contact lookup (optional)')
    },
    async (args) => {
      try {
        console.log('🔍 [inbound-slots-find.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            timezone: args.timezone
          },
          requiredKeys: ['clientId', 'agentId', 'timezone']
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const result = await BookingService.findAvailableSlots({
          instructionsText: resolvedIds.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          timezone: args.timezone,
          preferredDate: args.preferredDate,
          durationMinutes: args.durationMinutes,
          maxSuggestions: args.maxSuggestions,
          calendarId: args.calendarId,
          customerName: args.customerName
        })

        console.log('✅ [inbound-slots-find.v1] Result:', JSON.stringify(getLogSafeSummary(result)))
        return createValidatedResponse(BookingMcpResponseSchemas.slots, result)
      } catch (error) {
        console.error('❌ [inbound-slots-find.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  )

  server.tool(
    'inbound-booking-create.v1',
    'Book an appointment for inbound calls (requires clientId, agentId, timezone, start/end; no boardId/dealId/stageId)',
    {
      instructionsText: z.string().optional().describe('Legacy JSON blob (optional)'),
      agentId: z.string().optional().describe('Agent UUID (required)'),
      clientId: z.coerce.number().optional().describe('Client ID (required)'),
      timezone: z.string().optional().describe('Timezone (required, e.g., Australia/Perth)'),
      startDateTime: z.string().describe('Start time in ISO 8601 format'),
      endDateTime: z.string().describe('End time in ISO 8601 format'),
      customerName: z.string().optional().describe('Customer name'),
      customerEmail: z.string().email().optional().describe('Customer email'),
      customerPhoneNumber: z.string().optional().describe('Customer phone'),
      subject: z.string().optional().describe('Meeting subject (optional)'),
      description: z.string().optional().describe('Meeting description (optional)'),
      location: z.string().optional().describe('Meeting location (optional)'),
      isOnlineMeeting: z.boolean().optional().default(true).describe('Create online meeting link (default: true)'),
      calendarId: z.string().optional().describe('Calendar ID override (optional)')
    },
    async (args) => {
      try {
        console.log('📞 [inbound-booking-create.v1] Called')

        const resolvedIds = resolveBookingMcpIds({
          instructionsText: args.instructionsText,
          explicitIds: {
            agentId: args.agentId,
            clientId: args.clientId,
            timezone: args.timezone
          },
          requiredKeys: ['clientId', 'agentId', 'timezone']
        })

        if (!resolvedIds.ok) {
          return createToolError(resolvedIds.error)
        }

        const result = await BookingService.bookAppointment({
          instructionsText: resolvedIds.instructionsText,
          agentId: args.agentId,
          clientId: args.clientId,
          timezone: args.timezone,
          startDateTime: args.startDateTime,
          endDateTime: args.endDateTime,
          customerInfo: {
            name: args.customerName,
            email: args.customerEmail,
            phoneNumber: args.customerPhoneNumber
          },
          subject: args.subject,
          description: args.description,
          location: args.location,
          isOnlineMeeting: args.isOnlineMeeting,
          calendarId: args.calendarId
        })

        console.log('✅ [inbound-booking-create.v1] Result:', JSON.stringify(getLogSafeSummary(result)))
        return createValidatedResponse(BookingMcpResponseSchemas.booking, result)
      } catch (error) {
        console.error('❌ [inbound-booking-create.v1] Error:', getSafeErrorMessage(error))
        return createToolError({
          code: 'UNKNOWN_ERROR',
          error: getSafeErrorMessage(error)
        })
      }
    }
  )
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
