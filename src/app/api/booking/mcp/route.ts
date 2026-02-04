import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { BookingOperations } from "@/lib/helpers/booking_functions";
import { extractBookingIdsWithLLM, type ExtractBookingIdsResult } from "@/lib/helpers/booking-instructions";
import type {
  BookCustomerAppointmentRequest,
  FindBookingSlotsRequest,
  ListAgentsRequest,
  CancelCustomerAppointmentRequest,
  RescheduleCustomerAppointmentRequest,
} from "@/types";

/**
 * Helper function to extract and merge booking IDs from instructionsText
 * Returns extracted IDs that can be used to fill in missing parameters
 */
async function extractAndMergeBookingIds(
  instructionsText: string | undefined,
  providedIds: {
    boardId?: string;
    stageId?: string;
    dealId?: number | string;
    agentId?: string;
    clientId?: number | string;
  }
): Promise<{
  boardId?: string;
  stageId?: string;
  dealId?: number;
  agentId?: string;
  clientId?: number;
  extractionResult?: ExtractBookingIdsResult;
}> {
  console.log("📥 [extractAndMergeBookingIds] Called with:");
  console.log("  - instructionsText type:", typeof instructionsText);
  console.log("  - instructionsText is undefined:", instructionsText === undefined);
  console.log("  - instructionsText is null:", instructionsText === null);
  console.log("  - instructionsText length:", instructionsText?.length ?? 0);
  console.log("  - instructionsText value (first 200 chars):", instructionsText?.substring(0, 200) ?? "N/A");
  console.log("  - providedIds:", {
    boardId: providedIds.boardId,
    stageId: providedIds.stageId,
    dealId: providedIds.dealId,
    agentId: providedIds.agentId,
    clientId: providedIds.clientId,
  });

  const result = {
    boardId: providedIds.boardId,
    stageId: providedIds.stageId,
    dealId: providedIds.dealId ? (typeof providedIds.dealId === 'number' ? providedIds.dealId : parseInt(String(providedIds.dealId), 10)) : undefined,
    agentId: providedIds.agentId,
    clientId: providedIds.clientId ? (typeof providedIds.clientId === 'number' ? providedIds.clientId : parseInt(String(providedIds.clientId), 10)) : undefined,
    extractionResult: undefined as ExtractBookingIdsResult | undefined,
  };

  console.log("📊 [extractAndMergeBookingIds] Initial result state:", {
    boardId: result.boardId,
    stageId: result.stageId,
    dealId: result.dealId,
    agentId: result.agentId,
    clientId: result.clientId,
  });

  // Extract from instructionsText if provided and any IDs are missing
  const shouldExtract = instructionsText && (!result.boardId || !result.stageId || !result.dealId || !result.agentId || !result.clientId);
  console.log("🔍 [extractAndMergeBookingIds] Should extract?", shouldExtract);
  console.log("  - instructionsText exists:", !!instructionsText);
  console.log("  - Missing IDs:", {
    boardId: !result.boardId,
    stageId: !result.stageId,
    dealId: !result.dealId,
    agentId: !result.agentId,
    clientId: !result.clientId,
  });

  if (shouldExtract) {
    console.log("🔍 [extractAndMergeBookingIds] Calling extractBookingIdsWithLLM with instructionsText...");
    console.log("  - Full instructionsText:", instructionsText);
    const extractionResult = await extractBookingIdsWithLLM(instructionsText!);
    result.extractionResult = extractionResult;
    console.log("📋 [extractAndMergeBookingIds] Extraction result:", {
      success: extractionResult.success,
      method: extractionResult.method,
      error: extractionResult.error,
      config: extractionResult.config,
    });
    
    if (extractionResult.success) {
      const extracted = extractionResult.config;
      
      // Merge extracted IDs with provided ones (provided takes precedence)
      if (!result.boardId && extracted.boardId) {
        result.boardId = extracted.boardId;
        console.log(`✅ Extracted boardId: ${result.boardId}`);
      }
      if (!result.stageId && extracted.stageId) {
        result.stageId = extracted.stageId;
        console.log(`✅ Extracted stageId: ${result.stageId}`);
      }
      if (!result.dealId && extracted.dealId) {
        result.dealId = typeof extracted.dealId === 'number' ? extracted.dealId : parseInt(String(extracted.dealId), 10);
        if (!isNaN(result.dealId)) {
          console.log(`✅ Extracted dealId: ${result.dealId}`);
        }
      }
      if (!result.agentId && extracted.agentId) {
        result.agentId = extracted.agentId;
        console.log(`✅ Extracted agentId: ${result.agentId}`);
      }
      if (!result.clientId && extracted.clientId) {
        result.clientId = typeof extracted.clientId === 'number' ? extracted.clientId : parseInt(String(extracted.clientId), 10);
        if (!isNaN(result.clientId)) {
          console.log(`✅ Extracted clientId: ${result.clientId}`);
        }
      }
    }
  }

  return result;
}

const handler = createMcpHandler(
  (server) => {
    // ListAgents - List all agents with calendar assignments
    server.registerTool(
      "ListAgents",
      {
        description: "List all available agents for a client. Returns agent names and their calendar information. If an agent has no calendar connection, shows the board calendar (if boardId is provided). Can extract boardId, clientId, and agentId from instructionsText if provided.",
        inputSchema: {
          clientId: z
            .union([z.number(), z.string().transform(Number)])
            .optional()
            .describe("Client ID number (e.g., 10000002). Can be extracted from instructionsText if provided."),
          boardId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Optional board/pipeline UUID. If provided, agents without calendar connections will use this board's calendar. Can be extracted from instructionsText if provided."
            ),
          instructionsText: z
            .string()
            .optional()
            .describe(
              "Full booking instructions text. If provided, will automatically extract boardId, clientId, and agentId from it. Example: 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\\nClient ID is 10000002\\nAgent ID is e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2'"
            ),
        },
      },
      async (args) => {
        try {
          const { clientId, boardId, instructionsText } = args;

          console.log("list agents (Booking MCP)");
          console.table(args);

          // Extract IDs from instructionsText if provided
          let extractedClientId = clientId;
          let extractedBoardId = boardId;
          
          if (instructionsText) {
            console.log("🔍 Extracting IDs from instructionsText...");
            const extractionResult = await extractBookingIdsWithLLM(instructionsText);
            
            if (extractionResult.success) {
              const extracted = extractionResult.config;
              
              // Use extracted boardId if not explicitly provided
              if (!extractedBoardId && extracted.boardId) {
                extractedBoardId = extracted.boardId;
                console.log(`✅ Extracted boardId: ${extractedBoardId}`);
              }
              
              // Use extracted clientId if not explicitly provided
              if (!extractedClientId && extracted.clientId) {
                extractedClientId = typeof extracted.clientId === 'number' 
                  ? extracted.clientId 
                  : parseInt(String(extracted.clientId), 10);
                if (!isNaN(extractedClientId)) {
                  console.log(`✅ Extracted clientId: ${extractedClientId}`);
                }
              }
            }
          }
          
          // Use extracted or provided values
          const finalClientId = extractedClientId;
          const finalBoardId = extractedBoardId;

          // Convert and validate clientId
          const numericClientId =
            typeof finalClientId === "string" ? parseInt(finalClientId, 10) : finalClientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number. Provide clientId directly or pass instructionsText to extract it automatically.",
                },
              ],
            };
          }

          // Get all agents (no filters)
          const request: ListAgentsRequest = {
            clientId: numericClientId,
            includeDedicated: true, // Include all agents
            withCalendarOnly: false, // Don't filter by calendar
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
                  text: `NO AGENTS FOUND\n\nClient ID: ${numericClientId}`,
                },
              ],
            };
          }

          // Get board calendar if boardId is provided
          let boardCalendar: { provider?: string; email?: string } | null = null;
          if (finalBoardId) {
            const { getCalendarConnectionByPipelineId } = await import(
              "@/lib/helpers/calendar_functions/graphDatabase"
            );
            const boardCalendarConnection = await getCalendarConnectionByPipelineId(
              finalBoardId,
              numericClientId
            );
            if (boardCalendarConnection) {
              boardCalendar = {
                provider: boardCalendarConnection.provider_name,
                email: boardCalendarConnection.email,
              };
            }
          }

          let responseText = `AVAILABLE AGENTS (Client: ${numericClientId})\n\n`;
          responseText += `${result.agents.length} agent(s) found:\n\n`;

          result.agents.forEach((agent, index) => {
            responseText += `${index + 1}. ${agent.name}\n`;

            // Show calendar info: agent calendar if available, otherwise board calendar
            if (agent.hasCalendar && agent.calendarEmail) {
              responseText += `   Calendar: ${agent.calendarProvider?.toUpperCase() || "Unknown"} (${agent.calendarEmail})\n`;
            } else if (boardCalendar && boardCalendar.email) {
              responseText += `   Calendar: ${boardCalendar.provider?.toUpperCase() || "Unknown"} (${boardCalendar.email}) [Board Calendar]\n`;
            } else {
              responseText += `   Calendar: Not Connected\n`;
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
    server.registerTool(
      "BookCustomerAppointment",
      {
        description: `Book a customer appointment with an agent. Automatically searches customer database, checks calendar conflicts, validates office hours, and sends meeting invitations. Supports both Microsoft and Google calendars.`,
        inputSchema: {
          clientId: z
            .union([z.number(), z.string().transform(Number)])
            .describe("Client ID number (e.g., 10000002)"),
          agentId: z
            .string()
            .uuid()
            .describe(
              "Agent UUID from ListAgents tool (e.g., '550e8400-e29b-41d4-a716-446655440000')"
            ),
            boardId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Pipeline/board UUID. Required if present in booking instructions. Format: UUID string (e.g., 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142'). Uses pipeline's calendar when agent has no calendar."
            ),
          stageId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Pipeline stage UUID. Required if present in booking instructions. Format: UUID string (e.g., 'afac5248-59e5-41f4-b06c-01ea68d6af6a'). Used to generate appointment subject."
            ),
          dealId: z
            .union([z.number(), z.string().transform(Number)])
            .optional()
            .describe(
              "Deal ID (stage_items.id). Required if present in booking instructions. Format: number (e.g., 14588). Automatically fetches customer name/email/phone from deal database."
            ),
          customerName: z
            .string()
            .optional()
            .describe(
              "Customer name: 'John Smith' (optional if dealId is provided - will be fetched from deal's party_id automatically)"
            ),
          customerEmail: z
            .string()
            .email()
            .optional()
            .describe(
              "Customer email: 'john@company.com' (optional if dealId is provided - will be fetched from deal's party_id automatically)"
            ),
          customerPhoneNumber: z
            .string()
            .optional()
            .describe(
              "Customer phone number: '+1234567890' (optional if dealId is provided - will be fetched from deal's party_id automatically)"
            ),
          subject: z
            .string()
            .optional()
            .default("")
            .describe(
              "Meeting title (optional). If stageId/dealId is provided, subject will be generated from stage/deal metadata."
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
              "Calendar connection ID override (optional). Uses this calendar connection instead of the agent/pipeline selection."
            ),
          instructionsText: z
            .string()
            .optional()
            .describe(
              "Full booking instructions text. If boardId, stageId, or dealId are missing, pass this parameter and the system will automatically extract all IDs. Example: 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\\nStage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\\nDeal id is 14588'"
            ),
        },
      },
      async (args) => {
        try {
          const {
            clientId,
            agentId,
            boardId,
            stageId,
            dealId,
            customerName,
            customerEmail,
            customerPhoneNumber,
            subject,
            startDateTime,
            endDateTime,
            description,
            location,
            isOnlineMeeting,
            calendarId,
            instructionsText,
          } = args;

          console.log("📞 [BookCustomerAppointment] Tool called");
          console.log("📥 [BookCustomerAppointment] Raw args received:");
          console.log("  - All args keys:", Object.keys(args));
          console.log("  - instructionsText in args:", 'instructionsText' in args);
          console.log("  - instructionsText value:", instructionsText);
          console.log("  - instructionsText type:", typeof instructionsText);
          console.log("  - instructionsText length:", instructionsText?.length ?? 0);
          if (instructionsText) {
            console.log("  - instructionsText preview (first 500 chars):", instructionsText.substring(0, 500));
          }
          console.table(args);
          console.log("🔍 Raw args for debugging:", {
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            boardIdType: typeof args.boardId,
            stageIdType: typeof args.stageId,
            dealIdType: typeof args.dealId,
            instructionsText: args.instructionsText ? `Present (${args.instructionsText.length} chars)` : 'Missing',
          });

          // Extract and merge IDs from instructionsText if provided
          console.log("🔄 [BookCustomerAppointment] Calling extractAndMergeBookingIds...");
          const extractedIds = await extractAndMergeBookingIds(instructionsText, {
            boardId,
            stageId,
            dealId,
            agentId,
            clientId,
          });
          console.log("✅ [BookCustomerAppointment] Extraction complete:", {
            extractedBoardId: extractedIds.boardId,
            extractedStageId: extractedIds.stageId,
            extractedDealId: extractedIds.dealId,
            extractedAgentId: extractedIds.agentId,
            extractedClientId: extractedIds.clientId,
          });

          const extractedBoardId = extractedIds.boardId;
          const extractedStageId = extractedIds.stageId;
          const extractedDealId = extractedIds.dealId;
          const extractedAgentId = extractedIds.agentId;
          const extractedClientId = extractedIds.clientId;

          // Validate that required IDs are present after extraction attempt
          if (!extractedBoardId || !extractedStageId || !extractedDealId) {
            const missingIds = [];
            if (!extractedBoardId) missingIds.push("boardId");
            if (!extractedStageId) missingIds.push("stageId");
            if (!extractedDealId) missingIds.push("dealId");

            console.error("❌ BLOCKED: Missing required IDs after extraction attempt.");
            
            return {
              content: [
                {
                  type: "text",
                  text: `❌ MISSING REQUIRED IDs: ${missingIds.join(", ")}\n\nThis tool requires boardId, stageId, and dealId.\n\nTO FIX:\n1. Pass the instructionsText parameter with your full booking instructions - IDs will be extracted automatically\n2. OR extract the IDs manually from your booking instructions and pass them as parameters\n\nExample instructions format:\n- Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\n- Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\n- Deal id is 14588`,
                },
              ],
            };
          }


          // Convert and validate clientId (use extracted if original was missing)
          const clientIdToUse = extractedClientId !== undefined && extractedClientId !== null ? extractedClientId : clientId;
          const numericClientId =
            typeof clientIdToUse === "string" ? parseInt(clientIdToUse, 10) : clientIdToUse;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number. Pass instructionsText parameter to automatically extract clientId, or provide clientId directly.",
                },
              ],
            };
          }

          // Convert dealId to number if it's a string
          // Use extracted value if original was missing
          const dealIdToUse = extractedDealId !== undefined && extractedDealId !== null ? extractedDealId : dealId;
          const numericDealId = dealIdToUse !== undefined 
            ? (typeof dealIdToUse === "number" ? dealIdToUse : (typeof dealIdToUse === "string" ? parseInt(dealIdToUse, 10) : undefined))
            : undefined;

          // Validate dealId is a valid number if provided
          if (dealId !== undefined && (isNaN(numericDealId as number) || numericDealId === undefined)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: dealId must be a valid number, received: ${dealId}`,
                },
              ],
            };
          }

          // Normalize boardId and stageId (handle empty strings, null, etc.)
          // Use extracted values if original was missing
          let normalizedBoardId: string | undefined = undefined;
          const boardIdToUse = extractedBoardId || boardId;
          if (boardIdToUse && typeof boardIdToUse === "string") {
            const trimmed = boardIdToUse.trim();
            if (trimmed !== "") {
              normalizedBoardId = trimmed;
            }
          }

          let normalizedStageId: string | undefined = undefined;
          const stageIdToUse = extractedStageId || stageId;
          if (stageIdToUse && typeof stageIdToUse === "string") {
            const trimmed = stageIdToUse.trim();
            if (trimmed !== "") {
              normalizedStageId = trimmed;
            }
          }

          const request: BookCustomerAppointmentRequest = {
            clientId: extractedClientId || numericClientId,
            agentId: extractedAgentId || agentId, 
            boardId: extractedBoardId || normalizedBoardId,
            stageId: extractedStageId || normalizedStageId,
            dealId: extractedDealId || numericDealId,
            customerName,
            customerEmail,
            customerPhoneNumber,
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
            // Use profile name for customer-facing text, not agent name
            const profileName = (Array.isArray(result.agent.profiles) ? result.agent.profiles[0]?.name : result.agent.profiles?.name) || result.agent.name;
            responseText += `\nAgent: ${profileName} - ${result.agent.title}\n`;
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
    server.registerTool(
      "FindAvailableBookingSlots",
      {
        description: `Find available time slots for booking with an agent. Checks agent's calendar and office hours to suggest optimal meeting times.`,
        inputSchema: {
          clientId: z
            .union([z.number(), z.string().transform(Number)])
            .describe("Client ID number (e.g., 10000002)"),
          agentId: z
            .string()
            .uuid()
            .describe("Agent UUID from ListAgents tool"),
          boardId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Pipeline/board UUID. Required if present in booking instructions. Format: UUID string (e.g., 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142'). Uses pipeline's calendar when agent has no calendar."
            ),
          stageId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "Pipeline stage UUID. Required if present in booking instructions. Format: UUID string (e.g., 'afac5248-59e5-41f4-b06c-01ea68d6af6a'). Used for calendar selection."
            ),
          dealId: z
            .union([z.number(), z.string().transform(Number)])
            .optional()
            .describe(
              "Deal ID (stage_items.id). Required if present in booking instructions. Format: number (e.g., 14588). Automatically fetches customer details."
            ),
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
          calendarId: z
            .string()
            .optional()
            .describe(
              "Calendar connection ID override (optional). Uses this calendar connection instead of the agent/pipeline selection."
            ),
          instructionsText: z
            .string()
            .optional()
            .describe(
              "Full booking instructions text. If boardId, stageId, or dealId are missing, pass this parameter and the system will automatically extract all IDs. Example: 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\\nStage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\\nDeal id is 14588'"
            ),
        },
      },
      async (args) => {
        try {
          const {
            clientId,
            agentId,
            boardId,
            stageId,
            dealId,
            preferredDate,
            durationMinutes,
            maxSuggestions,
            calendarId,
            instructionsText,
          } = args;

          console.log("📞 [FindAvailableBookingSlots] Tool called");
          console.log("📥 [FindAvailableBookingSlots] Raw args received:");
          console.log("  - All args keys:", Object.keys(args));
          console.log("  - instructionsText in args:", 'instructionsText' in args);
          console.log("  - instructionsText value:", instructionsText);
          console.log("  - instructionsText type:", typeof instructionsText);
          console.log("  - instructionsText length:", instructionsText?.length ?? 0);
          if (instructionsText) {
            console.log("  - instructionsText preview (first 500 chars):", instructionsText.substring(0, 500));
          }
          console.table(args);
          console.log("🔍 Raw args for FindAvailableBookingSlots:", {
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            boardIdType: typeof args.boardId,
            stageIdType: typeof args.stageId,
            dealIdType: typeof args.dealId,
            instructionsText: args.instructionsText ? `Present (${args.instructionsText.length} chars)` : 'Missing',
          });

          // Extract and merge IDs from instructionsText if provided
          console.log("🔄 [FindAvailableBookingSlots] Calling extractAndMergeBookingIds...");
          const extractedIdsForSlots = await extractAndMergeBookingIds(instructionsText, {
            boardId,
            stageId,
            dealId,
            agentId,
            clientId,
          });
          console.log("✅ [FindAvailableBookingSlots] Extraction complete:", {
            extractedBoardId: extractedIdsForSlots.boardId,
            extractedStageId: extractedIdsForSlots.stageId,
            extractedDealId: extractedIdsForSlots.dealId,
            extractedAgentId: extractedIdsForSlots.agentId,
            extractedClientId: extractedIdsForSlots.clientId,
          });

          const extractedBoardIdForSlots = extractedIdsForSlots.boardId;
          const extractedStageIdForSlots = extractedIdsForSlots.stageId;
          const extractedDealIdForSlots = extractedIdsForSlots.dealId;
          const extractedAgentIdForSlots = extractedIdsForSlots.agentId;
          const extractedClientIdForSlots = extractedIdsForSlots.clientId;

          // Validate that required IDs are present after extraction attempt
          if (!extractedBoardIdForSlots || !extractedStageIdForSlots || !extractedDealIdForSlots) {
            const missingIds = [];
            if (!extractedBoardIdForSlots) missingIds.push("boardId");
            if (!extractedStageIdForSlots) missingIds.push("stageId");
            if (!extractedDealIdForSlots) missingIds.push("dealId");

            console.error("❌ BLOCKED: Missing required IDs after extraction attempt.");
            
            return {
              content: [
                {
                  type: "text",
                  text: `❌ MISSING REQUIRED IDs: ${missingIds.join(", ")}\n\nThis tool requires boardId, stageId, and dealId.\n\nTO FIX:\n1. Pass the instructionsText parameter with your full booking instructions - IDs will be extracted automatically\n2. OR extract the IDs manually from your booking instructions and pass them as parameters\n\nExample instructions format:\n- Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\n- Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\n- Deal id is 14588`,
                },
              ],
            };
          }


          // Convert and validate clientId (use extracted if original was missing)
          const clientIdToUseForSlots = extractedClientIdForSlots !== undefined && extractedClientIdForSlots !== null ? extractedClientIdForSlots : clientId;
          const numericClientId =
            typeof clientIdToUseForSlots === "string" ? parseInt(clientIdToUseForSlots, 10) : clientIdToUseForSlots;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: clientId is required and must be a valid number. Pass instructionsText parameter to automatically extract clientId, or provide clientId directly.",
                },
              ],
            };
          }

          // Convert dealId to number if it's a string
          // Use extracted value if original was missing
          const dealIdToUseForSlots = extractedDealIdForSlots !== undefined ? extractedDealIdForSlots : dealId;
          let numericDealIdForSlots: number | undefined = undefined;
          if (dealIdToUseForSlots !== undefined && dealIdToUseForSlots !== null) {
            if (typeof dealIdToUseForSlots === "number") {
              numericDealIdForSlots = dealIdToUseForSlots;
            } else {
              // Handle string case (shouldn't happen after Zod transform, but safe to handle)
              const dealIdStr = String(dealIdToUseForSlots);
              const trimmed = dealIdStr.trim();
              if (trimmed !== "") {
                const parsed = parseInt(trimmed, 10);
                if (!isNaN(parsed)) {
                  numericDealIdForSlots = parsed;
                }
              }
            }
          }

          // Normalize boardId and stageId (handle empty strings, null, etc.)
          // Use extracted values if original was missing
          let normalizedBoardIdForSlots: string | undefined = undefined;
          const boardIdToUseForSlots = extractedBoardIdForSlots || boardId;
          if (boardIdToUseForSlots && typeof boardIdToUseForSlots === "string") {
            const trimmed = boardIdToUseForSlots.trim();
            if (trimmed !== "") {
              normalizedBoardIdForSlots = trimmed;
            }
          }

          let normalizedStageIdForSlots: string | undefined = undefined;
          const stageIdToUseForSlots = extractedStageIdForSlots || stageId;
          if (stageIdToUseForSlots && typeof stageIdToUseForSlots === "string") {
            const trimmed = stageIdToUseForSlots.trim();
            if (trimmed !== "") {
              normalizedStageIdForSlots = trimmed;
            }
          }

          const request: FindBookingSlotsRequest = {
            clientId: numericClientId,
            agentId: extractedAgentIdForSlots || agentId, // Use extracted agentId if available
            boardId: normalizedBoardIdForSlots,
            stageId: normalizedStageIdForSlots,
            dealId: numericDealIdForSlots,
            preferredDate,
            durationMinutes,
            maxSuggestions,
            calendarId,
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
          // Use profile name for customer-facing text, not agent name
          const profileName = result.agent?.profiles ? (Array.isArray(result.agent.profiles) ? result.agent.profiles[0]?.name : result.agent.profiles?.name) : result.agent?.name;
          responseText += `Agent: ${profileName || result.agent?.name}\n`;
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
    server.registerTool(
      "CancelCustomerAppointment",
      {
        description: "Cancel a customer appointment. Automatically sends cancellation notifications to all attendees.",
        inputSchema: {
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
      },
      async (args) => {
        try {
          const { clientId, agentId, eventId, calendarId, notifyCustomer } =
            args;

          console.log("cancel customer appointment (Booking MCP)");
          console.table(args);

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
    server.registerTool(
      "RescheduleCustomerAppointment",
      {
        description: "Reschedule a customer appointment to a new time. Validates new time slot and sends update notifications.",
        inputSchema: {
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
      },
      async (args) => {
        try {
          const {
            clientId,
            agentId,
            eventId,
            newStartDateTime,
            newEndDateTime,
            calendarId,
            notifyCustomer,
          } = args;

          console.log("reschedule customer appointment (Booking MCP)");
          console.table(args);

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
            // Use profile name for customer-facing text, not agent name
            const profileName = (Array.isArray(result.agent.profiles) ? result.agent.profiles[0]?.name : result.agent.profiles?.name) || result.agent.name;
            responseText += `\n\nAgent: ${profileName}`;
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

