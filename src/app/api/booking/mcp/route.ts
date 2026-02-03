import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { BookingOperations } from "@/lib/helpers/booking_functions";
import { extractBookingIds } from "@/lib/helpers/toon-instructions";
import type {
  BookCustomerAppointmentRequest,
  FindBookingSlotsRequest,
  ListAgentsRequest,
  CancelCustomerAppointmentRequest,
  RescheduleCustomerAppointmentRequest,
} from "@/types";

const handler = createMcpHandler(
  (server) => {
    // ExtractBookingIds - Helper tool that uses LLM API to extract IDs from booking instructions
    server.registerTool(
      "ExtractBookingIds",
      {
        description: `Extract boardId, stageId, dealId, agentId, clientId, and timezone from booking instructions text using AI extraction.

⚠️ IMPORTANT: Use this tool FIRST before calling BookCustomerAppointment or FindAvailableBookingSlots if you cannot extract IDs directly from your instructions context.

Simply pass the instructionsText parameter with the full booking instructions section. The tool will use a powerful LLM to extract all IDs automatically.`,
        inputSchema: {
          instructionsText: z
            .string()
            .describe(
              "The full booking instructions text containing IDs. This should be the section starting with '#***Booking Instructions***' from your context. Include the entire instructions section. The tool will automatically extract all IDs from this text."
            ),
        },
      },
      async (args) => {
        try {
          const { instructionsText } = args;

          console.log("🔍 Using LLM API to extract booking IDs from instructions...");
          console.log("📝 Instructions text length:", instructionsText?.length || 0);

          if (!instructionsText || instructionsText.trim().length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ NO INSTRUCTIONS PROVIDED\n\nPlease provide the instructionsText parameter with the full booking instructions section.`,
                },
              ],
            };
          }

          // Get API key from environment (support both Groq and OpenAI)
          const groqApiKey = process.env.GROQ_API_KEY;
          const openaiApiKey = process.env.OPENAI_API_KEY;
          const apiKey = groqApiKey || openaiApiKey;
          const apiUrl = groqApiKey 
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
          const model = groqApiKey 
            ? 'llama-3.1-70b-versatile' // Groq model
            : 'gpt-4o-mini'; // OpenAI model

          if (!apiKey) {
            console.error("❌ No API key found. Set GROQ_API_KEY or OPENAI_API_KEY environment variable.");
            // Fallback to regex extraction if no API key
            console.log("🔄 Falling back to regex extraction...");
            const extracted = extractBookingIds(instructionsText);
            
            if (!extracted.boardId && !extracted.stageId && !extracted.dealId) {
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ NO IDs FOUND\n\nCould not extract boardId, stageId, or dealId from the instructions.\n\nMake sure the instructions contain lines like:\n- Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\n- Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\n- Deal id is 14588\n\nNote: Set GROQ_API_KEY or OPENAI_API_KEY environment variable for better extraction.`,
                  },
                ],
              };
            }

            let responseText = `✅ EXTRACTED BOOKING IDs (regex fallback)\n\n`;
            if (extracted.boardId) responseText += `boardId: ${extracted.boardId}\n`;
            if (extracted.stageId) responseText += `stageId: ${extracted.stageId}\n`;
            if (extracted.dealId) responseText += `dealId: ${extracted.dealId}\n`;
            if (extracted.agentId) responseText += `agentId: ${extracted.agentId}\n`;
            if (extracted.clientId) responseText += `clientId: ${extracted.clientId}\n`;
            if (extracted.timezone) responseText += `timezone: ${extracted.timezone}\n`;
            responseText += `\n✅ Use these extracted IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.`;

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          }

          // Create LLM extraction prompt
          const extractionPrompt = {
            model: model,
            messages: [
              {
                role: 'system',
                content: `Extract booking IDs from the provided instructions text. Look for these specific patterns and extract the values:

REQUIRED IDs to extract:
- boardId: Look for "Board Id is <UUID>" or "Board Id: <UUID>" → extract the UUID (36 characters with hyphens)
- stageId: Look for "Stage Id is <UUID>" or "Stage Id: <UUID>" → extract the UUID (36 characters with hyphens)
- dealId: Look for "Deal id is <number>" or "Deal id: <number>" → extract the number

OPTIONAL IDs to extract:
- agentId: Look for "Agent ID is <UUID>" or "Agent ID: <UUID>" → extract the UUID
- clientId: Look for "Client ID is <number>" or "Client ID: <number>" → extract the number
- timezone: Look for "Timezone is <timezone>" or "Timezone: <timezone>" → extract the timezone string (IANA format)

Rules:
- UUIDs must be exactly 36 characters with hyphens (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
- Numbers should be extracted as integers
- If a value is not found, use null or omit it
- Be precise and extract exactly what follows "is" or ":" after the label

Respond ONLY with valid JSON in this exact format:
{
  "boardId": "uuid-string or null",
  "stageId": "uuid-string or null",
  "dealId": number or null,
  "agentId": "uuid-string or null",
  "clientId": number or null,
  "timezone": "string or null"
}`
              },
              {
                role: 'user',
                content: `Extract booking IDs from these instructions:\n\n${instructionsText}`
              }
            ],
            response_format: {
              type: 'json_object'
            },
            temperature: 0.1, // Low temperature for precise extraction
          };

          // Call LLM API
          const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(extractionPrompt)
          });

          if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error("❌ LLM API error:", apiResponse.status, errorText);
            
            // Fallback to regex extraction
            console.log("🔄 Falling back to regex extraction...");
            const extracted = extractBookingIds(instructionsText);
            
            if (!extracted.boardId && !extracted.stageId && !extracted.dealId) {
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ EXTRACTION FAILED\n\nLLM API call failed (${apiResponse.status}). Could not extract IDs using fallback method either.\n\nError: ${errorText}\n\nPlease check your API key and try again.`,
                  },
                ],
              };
            }

            let responseText = `✅ EXTRACTED BOOKING IDs (regex fallback)\n\n`;
            if (extracted.boardId) responseText += `boardId: ${extracted.boardId}\n`;
            if (extracted.stageId) responseText += `stageId: ${extracted.stageId}\n`;
            if (extracted.dealId) responseText += `dealId: ${extracted.dealId}\n`;
            if (extracted.agentId) responseText += `agentId: ${extracted.agentId}\n`;
            if (extracted.clientId) responseText += `clientId: ${extracted.clientId}\n`;
            if (extracted.timezone) responseText += `timezone: ${extracted.timezone}\n`;
            responseText += `\n✅ Use these extracted IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.`;

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          }

          const apiData = await apiResponse.json();
          const extractedJson = JSON.parse(apiData.choices[0].message.content);

          console.log("📋 LLM extracted values:", extractedJson);

          // Validate that at least critical IDs are present
          if (!extractedJson.boardId && !extractedJson.stageId && !extractedJson.dealId) {
            // Fallback to regex extraction
            console.log("🔄 LLM didn't extract critical IDs, falling back to regex...");
            const extracted = extractBookingIds(instructionsText);
            
            if (!extracted.boardId && !extracted.stageId && !extracted.dealId) {
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ NO IDs EXTRACTED\n\nThe LLM could not extract boardId, stageId, or dealId from the instructions.\n\nPlease ensure the instructions contain lines like:\n- Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\n- Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\n- Deal id is 14588`,
                  },
                ],
              };
            }

            let responseText = `✅ EXTRACTED BOOKING IDs (regex fallback)\n\n`;
            if (extracted.boardId) responseText += `boardId: ${extracted.boardId}\n`;
            if (extracted.stageId) responseText += `stageId: ${extracted.stageId}\n`;
            if (extracted.dealId) responseText += `dealId: ${extracted.dealId}\n`;
            if (extracted.agentId) responseText += `agentId: ${extracted.agentId}\n`;
            if (extracted.clientId) responseText += `clientId: ${extracted.clientId}\n`;
            if (extracted.timezone) responseText += `timezone: ${extracted.timezone}\n`;
            responseText += `\n✅ Use these extracted IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.`;

            return {
              content: [
                {
                  type: "text",
                  text: responseText,
                },
              ],
            };
          }

          // Validate UUID formats
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          
          if (extractedJson.boardId && extractedJson.boardId !== 'null' && !uuidPattern.test(extractedJson.boardId)) {
            console.warn("⚠️ Invalid boardId format from LLM:", extractedJson.boardId);
            extractedJson.boardId = null;
          }
          if (extractedJson.stageId && extractedJson.stageId !== 'null' && !uuidPattern.test(extractedJson.stageId)) {
            console.warn("⚠️ Invalid stageId format from LLM:", extractedJson.stageId);
            extractedJson.stageId = null;
          }
          if (extractedJson.agentId && extractedJson.agentId !== 'null' && !uuidPattern.test(extractedJson.agentId)) {
            console.warn("⚠️ Invalid agentId format from LLM:", extractedJson.agentId);
            extractedJson.agentId = null;
          }

          // Build success response
          let responseText = `✅ EXTRACTED BOOKING IDs\n\n`;
          
          if (extractedJson.boardId && extractedJson.boardId !== 'null') {
            responseText += `boardId: ${extractedJson.boardId}\n`;
          }
          if (extractedJson.stageId && extractedJson.stageId !== 'null') {
            responseText += `stageId: ${extractedJson.stageId}\n`;
          }
          if (extractedJson.dealId && extractedJson.dealId !== null && extractedJson.dealId !== 'null') {
            responseText += `dealId: ${extractedJson.dealId}\n`;
          }
          if (extractedJson.agentId && extractedJson.agentId !== 'null') {
            responseText += `agentId: ${extractedJson.agentId}\n`;
          }
          if (extractedJson.clientId && extractedJson.clientId !== null && extractedJson.clientId !== 'null') {
            responseText += `clientId: ${extractedJson.clientId}\n`;
          }
          if (extractedJson.timezone && extractedJson.timezone !== 'null') {
            responseText += `timezone: ${extractedJson.timezone}\n`;
          }

          responseText += `\n✅ Use these extracted IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.`;

          console.log("✅ Successfully extracted IDs via LLM:", extractedJson);

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in ExtractBookingIds:", error);
          
          // Fallback to regex extraction on error
          try {
            console.log("🔄 Error occurred, falling back to regex extraction...");
            const extracted = extractBookingIds(args.instructionsText || '');
            
            if (extracted.boardId || extracted.stageId || extracted.dealId) {
              let responseText = `✅ EXTRACTED BOOKING IDs (regex fallback after error)\n\n`;
              if (extracted.boardId) responseText += `boardId: ${extracted.boardId}\n`;
              if (extracted.stageId) responseText += `stageId: ${extracted.stageId}\n`;
              if (extracted.dealId) responseText += `dealId: ${extracted.dealId}\n`;
              if (extracted.agentId) responseText += `agentId: ${extracted.agentId}\n`;
              if (extracted.clientId) responseText += `clientId: ${extracted.clientId}\n`;
              if (extracted.timezone) responseText += `timezone: ${extracted.timezone}\n`;
              responseText += `\n✅ Use these extracted IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.`;

              return {
                content: [
                  {
                    type: "text",
                    text: responseText,
                  },
                ],
              };
            }
          } catch (fallbackError) {
            console.error("Fallback extraction also failed:", fallbackError);
          }

          return {
            content: [
              {
                type: "text",
                text: `Error extracting IDs: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    // ListAgents - List all agents with calendar assignments
    server.registerTool(
      "ListAgents",
      {
        description: "List all available agents for a client. Shows which agents have calendar connections for booking appointments.",
        inputSchema: {
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
      },
      async (args) => {
        try {
          const { clientId, includeDedicated, withCalendarOnly } = args;

          console.log("list agents (Booking MCP)");
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
    server.registerTool(
      "BookCustomerAppointment",
      {
        description: `Book a customer appointment with an agent. CRITICAL: You MUST extract boardId, stageId, and dealId from the booking instructions section in your context.

EXTRACTION STEPS:
1. Look for the "***Booking Instructions***" section in your context
2. Find these lines:
   - "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142" → extract boardId='b44305a9-9a2f-408c-b2d0-2a0b73fc3142'
   - "Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a" → extract stageId='afac5248-59e5-41f4-b06c-01ea68d6af6a'
   - "Deal id is 14588" → extract dealId=14588
3. Pass these extracted IDs to this tool

ALTERNATIVE: If you cannot extract IDs, pass the instructionsText parameter with the full booking instructions text - IDs will be extracted automatically.

Automatically searches customer database, checks calendar conflicts, validates office hours, and sends meeting invitations. Supports both Microsoft and Google calendars.`,
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
              "REQUIRED IF IN INSTRUCTIONS: Pipeline/board UUID. MUST extract from booking instructions if present. Look for: 'Board Id:', 'Board ID:', 'boardId', 'Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Format: UUID string. Example: 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Uses pipeline's calendar when agent has no calendar. SCAN ALL INSTRUCTIONS BEFORE CALLING."
            ),
          stageId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "REQUIRED IF IN INSTRUCTIONS: Pipeline stage UUID. MUST extract from booking instructions if present. Look for: 'Stage Id:', 'Stage ID:', 'stageId', 'Stage Id: afac5248-59e5-41f4-b06c-01ea68d6af6a'. Format: UUID string. Example: 'afac5248-59e5-41f4-b06c-01ea68d6af6a'. Used to generate appointment subject. SCAN ALL INSTRUCTIONS BEFORE CALLING."
            ),
          dealId: z
            .union([z.number(), z.string().transform(Number)])
            .optional()
            .describe(
              "REQUIRED IF IN INSTRUCTIONS: Deal ID (stage_items.id). MUST extract from booking instructions if present. Look for: 'Deal id:', 'Deal ID:', 'dealId', 'Deal id: 14588'. Format: number. Example: 14588 or '14588'. Automatically fetches customer name/email/phone from deal database. SCAN ALL INSTRUCTIONS BEFORE CALLING."
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
              "⚠️ REQUIRED IF boardId/stageId/dealId ARE MISSING: Pass the full booking instructions text here. The system will automatically extract boardId, stageId, and dealId from it. Look for the section starting with '#***Booking Instructions***' in your context and pass that entire section. Example format: 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\\nStage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\\nDeal id is 14588'"
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
          } = args;
          
          // Access instructionsText safely (it's optional in the schema)
          const instructionsText = 'instructionsText' in args ? (args as any).instructionsText : undefined;

          console.log("book customer appointment (Booking MCP)");
          console.table(args);
          console.log("🔍 Raw args for debugging:", {
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            boardIdType: typeof args.boardId,
            stageIdType: typeof args.stageId,
            dealIdType: typeof args.dealId,
          });

          // Fallback: Extract IDs from instructionsText if provided and IDs are missing
          let extractedBoardId = boardId;
          let extractedStageId = stageId;
          let extractedDealId = dealId;

          if (instructionsText && (!boardId || !stageId || !dealId)) {
            console.log("🔍 Extracting missing IDs from provided instructions text...");
            try {
              const extracted = extractBookingIds(instructionsText);
              
              if (!extractedBoardId && extracted.boardId) {
                extractedBoardId = extracted.boardId;
                console.log(`✅ Extracted boardId from instructions: ${extractedBoardId}`);
              }
              if (!extractedStageId && extracted.stageId) {
                extractedStageId = extracted.stageId;
                console.log(`✅ Extracted stageId from instructions: ${extractedStageId}`);
              }
              if (!extractedDealId && extracted.dealId) {
                extractedDealId = typeof extracted.dealId === 'number' ? extracted.dealId : parseInt(String(extracted.dealId), 10);
                if (!isNaN(extractedDealId)) {
                  console.log(`✅ Extracted dealId from instructions: ${extractedDealId}`);
                } else {
                  extractedDealId = dealId; // Reset if parsing failed
                }
              }
            } catch (error) {
              console.warn("⚠️ Failed to extract IDs from instructions text:", error);
            }
          }

          // Warn if still missing after extraction attempt
          if (!extractedBoardId || !extractedStageId || !extractedDealId) {
            console.warn("⚠️ Missing IDs - These should be extracted from booking instructions:");
            if (!extractedBoardId) console.warn("  - boardId not found (look for 'Board Id is' or 'Board Id:' in instructions)");
            if (!extractedStageId) console.warn("  - stageId not found (look for 'Stage Id is' or 'Stage Id:' in instructions)");
            if (!extractedDealId) console.warn("  - dealId not found (look for 'Deal id is' or 'Deal id:' in instructions)");
          }

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
            clientId: numericClientId,
            agentId,
            boardId: normalizedBoardId,
            stageId: normalizedStageId,
            dealId: numericDealId,
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
        description: `Find available time slots for booking with an agent. CRITICAL: You MUST extract boardId, stageId, and dealId from the booking instructions section in your context.

EXTRACTION STEPS:
1. Look for the "***Booking Instructions***" section in your context
2. Find these lines:
   - "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142" → extract boardId='b44305a9-9a2f-408c-b2d0-2a0b73fc3142'
   - "Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a" → extract stageId='afac5248-59e5-41f4-b06c-01ea68d6af6a'
   - "Deal id is 14588" → extract dealId=14588
3. Pass these extracted IDs to this tool

ALTERNATIVE: If you cannot extract IDs, pass the instructionsText parameter with the full booking instructions text - IDs will be extracted automatically.

Checks agent's calendar and office hours to suggest optimal meeting times.`,
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
              "REQUIRED IF IN INSTRUCTIONS: Pipeline/board UUID. MUST extract from booking instructions if present. Look for: 'Board Id:', 'Board ID:', 'boardId', 'Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Format: UUID string. Example: 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Uses pipeline's calendar when agent has no calendar. SCAN ALL INSTRUCTIONS BEFORE CALLING."
            ),
          stageId: z
            .string()
            .uuid()
            .optional()
            .describe(
              "REQUIRED IF IN INSTRUCTIONS: Pipeline stage UUID. MUST extract from booking instructions if present. Look for: 'Stage Id:', 'Stage ID:', 'stageId', 'Stage Id: afac5248-59e5-41f4-b06c-01ea68d6af6a'. Format: UUID string. Example: 'afac5248-59e5-41f4-b06c-01ea68d6af6a'. Used for calendar selection. SCAN ALL INSTRUCTIONS BEFORE CALLING."
            ),
          dealId: z
            .union([z.number(), z.string().transform(Number)])
            .optional()
            .describe(
              "REQUIRED IF IN INSTRUCTIONS: Deal ID (stage_items.id). MUST extract from booking instructions if present. Look for: 'Deal id:', 'Deal ID:', 'dealId', 'Deal id: 14588'. Format: number. Example: 14588 or '14588'. Automatically fetches customer details. SCAN ALL INSTRUCTIONS BEFORE CALLING."
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
              "OPTIONAL: If boardId/stageId/dealId are missing, pass the booking instructions text here and they will be extracted automatically. Look for lines like 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142' or 'Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a'."
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
          } = args;
          
          // Access instructionsText safely (it's optional in the schema)
          const instructionsText = 'instructionsText' in args ? (args as any).instructionsText : undefined;

          console.log("find available booking slots (Booking MCP)");
          console.table(args);
          console.log("🔍 Raw args for FindAvailableBookingSlots:", {
            boardId: args.boardId,
            stageId: args.stageId,
            dealId: args.dealId,
            boardIdType: typeof args.boardId,
            stageIdType: typeof args.stageId,
            dealIdType: typeof args.dealId,
          });

          // Fallback: Extract IDs from instructionsText if provided and IDs are missing
          let extractedBoardIdForSlots = boardId;
          let extractedStageIdForSlots = stageId;
          let extractedDealIdForSlots = dealId;

          if (instructionsText && (!boardId || !stageId || !dealId)) {
            console.log("🔍 Extracting missing IDs from provided instructions text...");
            try {
              const extracted = extractBookingIds(instructionsText);
              
              if (!extractedBoardIdForSlots && extracted.boardId) {
                extractedBoardIdForSlots = extracted.boardId;
                console.log(`✅ Extracted boardId from instructions: ${extractedBoardIdForSlots}`);
              }
              if (!extractedStageIdForSlots && extracted.stageId) {
                extractedStageIdForSlots = extracted.stageId;
                console.log(`✅ Extracted stageId from instructions: ${extractedStageIdForSlots}`);
              }
              if (!extractedDealIdForSlots && extracted.dealId) {
                const parsed = typeof extracted.dealId === 'number' ? extracted.dealId : parseInt(String(extracted.dealId), 10);
                if (!isNaN(parsed)) {
                  extractedDealIdForSlots = parsed;
                  console.log(`✅ Extracted dealId from instructions: ${extractedDealIdForSlots}`);
                }
              }
            } catch (error) {
              console.warn("⚠️ Failed to extract IDs from instructions text:", error);
            }
          }

          // Warn if still missing after extraction attempt
          if (!extractedBoardIdForSlots || !extractedStageIdForSlots || !extractedDealIdForSlots) {
            console.warn("⚠️ Missing IDs - These should be extracted from booking instructions:");
            if (!extractedBoardIdForSlots) console.warn("  - boardId not found (look for 'Board Id is' or 'Board Id:' in instructions)");
            if (!extractedStageIdForSlots) console.warn("  - stageId not found (look for 'Stage Id is' or 'Stage Id:' in instructions)");
            if (!extractedDealIdForSlots) console.warn("  - dealId not found (look for 'Deal id is' or 'Deal id:' in instructions)");
          }

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
            agentId,
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

