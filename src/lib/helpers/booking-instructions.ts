/**
 * Booking Instructions Extraction Utilities
 * 
 * Extracts booking IDs from instruction text using regex patterns and LLM API
 */

/**
 * Booking configuration extracted from instructions
 */
export interface BookingConfig {
  boardId?: string;
  stageId?: string;
  dealId?: number | string;
  agentId?: string;
  clientId?: number | string;
  timezone?: string;
}

/**
 * Extract booking IDs from instruction text using regex patterns
 */
export function extractBookingIds(instructions: string): BookingConfig {
  const config: BookingConfig = {};

  // Pattern variations for boardId
  // Handles: "Board Id:", "Board Id is", "Board ID:", "boardId:", etc.
  const boardIdPatterns = [
    /Board\s+Id\s+is\s+([a-f0-9-]{36})/i,
    /Board\s+ID\s+is\s+([a-f0-9-]{36})/i,
    /Board\s+Id:\s*([a-f0-9-]{36})/i,
    /Board\s+ID:\s*([a-f0-9-]{36})/i,
    /boardId:\s*([a-f0-9-]{36})/i,
    /board_id:\s*([a-f0-9-]{36})/i,
    /Board\s+Id\s+=\s*([a-f0-9-]{36})/i,
  ];

  // Pattern variations for stageId
  // Handles: "Stage Id:", "Stage Id is", "Stage ID:", "stageId:", etc.
  const stageIdPatterns = [
    /Stage\s+Id\s+is\s+([a-f0-9-]{36})/i,
    /Stage\s+ID\s+is\s+([a-f0-9-]{36})/i,
    /Stage\s+Id:\s*([a-f0-9-]{36})/i,
    /Stage\s+ID:\s*([a-f0-9-]{36})/i,
    /stageId:\s*([a-f0-9-]{36})/i,
    /stage_id:\s*([a-f0-9-]{36})/i,
    /Stage\s+Id\s+=\s*([a-f0-9-]{36})/i,
  ];

  // Pattern variations for dealId
  // Handles: "Deal id:", "Deal id is", "Deal ID:", "dealId:", etc.
  const dealIdPatterns = [
    /Deal\s+id\s+is\s+(\d+)/i,
    /Deal\s+ID\s+is\s+(\d+)/i,
    /Deal\s+id:\s*(\d+)/i,
    /Deal\s+ID:\s*(\d+)/i,
    /dealId:\s*(\d+)/i,
    /deal_id:\s*(\d+)/i,
    /Deal\s+id\s+=\s*(\d+)/i,
  ];

  // Pattern variations for agentId
  // Handles: "Agent ID:", "Agent ID is", "agentId:", etc.
  const agentIdPatterns = [
    /Agent\s+ID\s+is\s+([a-f0-9-]{36})/i,
    /Agent\s+Id\s+is\s+([a-f0-9-]{36})/i,
    /Agent\s+ID:\s*([a-f0-9-]{36})/i,
    /Agent\s+Id:\s*([a-f0-9-]{36})/i,
    /agentId:\s*([a-f0-9-]{36})/i,
    /agent_id:\s*([a-f0-9-]{36})/i,
  ];

  // Pattern variations for clientId
  // Handles: "Client ID:", "Client ID is", "clientId:", etc.
  const clientIdPatterns = [
    /Client\s+ID\s+is\s+(\d+)/i,
    /Client\s+Id\s+is\s+(\d+)/i,
    /Client\s+ID:\s*(\d+)/i,
    /Client\s+Id:\s*(\d+)/i,
    /clientId:\s*(\d+)/i,
    /client_id:\s*(\d+)/i,
  ];

  // Pattern variations for timezone
  // Handles: "Timezone:", "Timezone is", "Time Zone:", etc.
  const timezonePatterns = [
    /Timezone\s+is\s+([A-Za-z_\/]+)/i,
    /timezone\s+is\s+([A-Za-z_\/]+)/i,
    /Timezone:\s*([A-Za-z_\/]+)/i,
    /timezone:\s*([A-Za-z_\/]+)/i,
    /Time\s+Zone:\s*([A-Za-z_\/]+)/i,
  ];

  // Extract boardId
  for (const pattern of boardIdPatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.boardId = match[1];
      break;
    }
  }

  // Extract stageId
  for (const pattern of stageIdPatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.stageId = match[1];
      break;
    }
  }

  // Extract dealId
  for (const pattern of dealIdPatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.dealId = parseInt(match[1], 10);
      break;
    }
  }

  // Extract agentId
  for (const pattern of agentIdPatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.agentId = match[1];
      break;
    }
  }

  // Extract clientId
  for (const pattern of clientIdPatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.clientId = parseInt(match[1], 10);
      break;
    }
  }

  // Extract timezone
  for (const pattern of timezonePatterns) {
    const match = instructions.match(pattern);
    if (match) {
      config.timezone = match[1];
      break;
    }
  }

  return config;
}

/**
 * Result of LLM-based extraction
 */
export interface ExtractBookingIdsResult {
  success: boolean;
  config: BookingConfig;
  method: 'llm' | 'regex' | 'none';
  error?: string;
}

/**
 * Extract booking IDs from instructions using LLM API with regex fallback
 * This is a reusable function that can be used across all MCP tools
 * 
 * @param instructionsText - The full booking instructions text containing IDs
 * @returns Promise<ExtractBookingIdsResult> - Structured result with extracted IDs
 */
export async function extractBookingIdsWithLLM(
  instructionsText: string
): Promise<ExtractBookingIdsResult> {
  console.log('📥 [extractBookingIdsWithLLM] Function called');
  console.log('  - instructionsText type:', typeof instructionsText);
  console.log('  - instructionsText is undefined:', instructionsText === undefined);
  console.log('  - instructionsText is null:', instructionsText === null);
  console.log('  - instructionsText length:', instructionsText?.length ?? 0);
  console.log('  - instructionsText trimmed length:', instructionsText?.trim().length ?? 0);
  console.log('  - instructionsText value (first 500 chars):', instructionsText?.substring(0, 500) ?? 'N/A');
  
  if (!instructionsText || instructionsText.trim().length === 0) {
    console.log('❌ [extractBookingIdsWithLLM] No instructions text provided - returning error');
    return {
      success: false,
      config: {},
      method: 'none',
      error: 'No instructions text provided',
    };
  }

  console.log('🔍 [extractBookingIdsWithLLM] Using LLM API to extract booking IDs from instructions...');
  console.log('📝 [extractBookingIdsWithLLM] Instructions text length:', instructionsText.length);
  console.log('📝 [extractBookingIdsWithLLM] Full instructions text:', instructionsText);

  // Get API key from environment (support both Groq and OpenAI)
  const groqApiKey = process.env.GROQ_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const apiKey = groqApiKey || openaiApiKey;
  const apiUrl = groqApiKey
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = groqApiKey
    ? (process.env.GROQ_MODEL || 'llama-3.1-8b-instant')
    : (process.env.OPENAI_MODEL || 'gpt-4o-mini');

  // Try LLM extraction if API key is available
  if (apiKey) {
    try {
      const extractionPrompt = {
        model: model,
        messages: [
          {
            role: 'system',
            content: `You are an expert at extracting booking IDs from instructions text. Extract ALL IDs that are present in the instructions.

CRITICAL IDs to extract (REQUIRED if present):
- boardId: Look for "Board Id is <UUID>" or "Board Id: <UUID>" → extract the UUID (36 characters with hyphens)
- stageId: Look for "Stage Id is <UUID>" or "Stage Id: <UUID>" → extract the UUID (36 characters with hyphens)
- dealId: Look for "Deal id is <number>" or "Deal id: <number>" → extract the number

IMPORTANT IDs to extract (ALSO REQUIRED if present):
- agentId: Look for "Agent ID is <UUID>" or "Agent ID: <UUID>" or "Agent Id is <UUID>" → extract the UUID
- clientId: Look for "Client ID is <number>" or "Client ID: <number>" or "Client Id is <number>" → extract the number
- timezone: Look for "Timezone is <timezone>" or "Timezone: <timezone>" or "timezone is <timezone>" → extract the timezone string (IANA format like "Africa/Casablanca")

Extraction Rules:
1. UUIDs must be exactly 36 characters with hyphens (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
2. Numbers should be extracted as integers (no decimals)
3. Timezone should be in IANA format (e.g., "Africa/Casablanca", "America/New_York")
4. Extract EXACTLY what follows "is" or ":" after the label - do not modify or truncate
5. If a value is not found in the instructions, use null (not undefined, not empty string)
6. Be thorough - these IDs are critical for booking operations

Example patterns to look for:
- "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142"
- "Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a"
- "Deal id is 14588"
- "Agent ID is e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2"
- "Client ID is 10000002"
- "Timezone is Africa/Casablanca"

Respond ONLY with valid JSON in this exact format (use null for missing values):
{
  "boardId": "uuid-string or null",
  "stageId": "uuid-string or null",
  "dealId": number or null,
  "agentId": "uuid-string or null",
  "clientId": number or null,
  "timezone": "string or null"
}`,
          },
          {
            role: 'user',
            content: `Extract ALL booking IDs from these instructions. Be thorough and extract every ID that is present:\n\n${instructionsText}`,
          },
        ],
        response_format: {
          type: 'json_object',
        },
        temperature: 0.1, // Low temperature for precise extraction
      };

      // Call LLM API
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(extractionPrompt),
      });

      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        const extractedJson = JSON.parse(apiData.choices[0].message.content);

        console.log('📋 LLM extracted values:', extractedJson);

        // Validate UUID formats
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        const config: BookingConfig = {};

        // Validate and extract boardId
        if (
          extractedJson.boardId &&
          extractedJson.boardId !== 'null' &&
          uuidPattern.test(extractedJson.boardId)
        ) {
          config.boardId = extractedJson.boardId;
        }

        // Validate and extract stageId
        if (
          extractedJson.stageId &&
          extractedJson.stageId !== 'null' &&
          uuidPattern.test(extractedJson.stageId)
        ) {
          config.stageId = extractedJson.stageId;
        }

        // Validate and extract dealId
        if (
          extractedJson.dealId !== null &&
          extractedJson.dealId !== 'null' &&
          extractedJson.dealId !== undefined
        ) {
          const dealIdNum =
            typeof extractedJson.dealId === 'number'
              ? extractedJson.dealId
              : parseInt(String(extractedJson.dealId), 10);
          if (!isNaN(dealIdNum)) {
            config.dealId = dealIdNum;
          }
        }

        // Validate and extract agentId
        if (
          extractedJson.agentId &&
          extractedJson.agentId !== 'null' &&
          uuidPattern.test(extractedJson.agentId)
        ) {
          config.agentId = extractedJson.agentId;
        }

        // Validate and extract clientId
        if (
          extractedJson.clientId !== null &&
          extractedJson.clientId !== 'null' &&
          extractedJson.clientId !== undefined
        ) {
          const clientIdNum =
            typeof extractedJson.clientId === 'number'
              ? extractedJson.clientId
              : parseInt(String(extractedJson.clientId), 10);
          if (!isNaN(clientIdNum)) {
            config.clientId = clientIdNum;
          }
        }

        // Validate and extract timezone
        if (
          extractedJson.timezone &&
          extractedJson.timezone !== 'null' &&
          typeof extractedJson.timezone === 'string'
        ) {
          config.timezone = extractedJson.timezone;
        }

        // Check if we got at least some IDs
        if (config.boardId || config.stageId || config.dealId) {
          console.log('✅ Successfully extracted IDs via LLM:', config);
          return {
            success: true,
            config,
            method: 'llm',
          };
        }
      } else {
        const errorText = await apiResponse.text();
        console.error('❌ LLM API error:', apiResponse.status, errorText);
      }
    } catch (error) {
      console.error('❌ LLM extraction error:', error);
    }
  } else {
    console.log('⚠️ No API key found. Falling back to regex extraction...');
  }

  // Fallback to regex extraction
  console.log('🔄 Falling back to regex extraction...');
  const regexConfig = extractBookingIds(instructionsText);

  if (regexConfig.boardId || regexConfig.stageId || regexConfig.dealId) {
    console.log('✅ Successfully extracted IDs via regex:', regexConfig);
    return {
      success: true,
      config: regexConfig,
      method: 'regex',
    };
  }

  return {
    success: false,
    config: {},
    method: 'none',
    error: 'Could not extract any IDs from instructions',
  };
}

