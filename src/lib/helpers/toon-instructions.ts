/**
 * TOON Format Utilities for Booking Instructions
 * 
 * Converts booking instructions to TOON format for better LLM extraction
 * See: https://github.com/toon-format/toon
 */

import { encode } from '@toon-format/toon';

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
 * Convert booking config to TOON format using the TOON library
 */
export function formatBookingConfigAsToon(config: BookingConfig): string {
  // Filter out undefined values
  const filteredConfig = Object.fromEntries(
    Object.entries(config).filter(([_, value]) => value !== undefined)
  );

  if (Object.keys(filteredConfig).length === 0) {
    return '';
  }

  // Use TOON library to encode the config
  // TOON works best with a flat object structure
  try {
    const toonOutput = encode(filteredConfig);
    return toonOutput;
  } catch (error) {
    console.warn('TOON encoding failed, falling back to manual format:', error);
    // Fallback to manual format if encoding fails
    const fields = Object.keys(filteredConfig);
    const values = Object.values(filteredConfig).map(v => 
      typeof v === 'string' ? v : String(v)
    );
    return `bookingConfig{${fields.join(',')}}:\n  ${values.join(',')}`;
  }
}

/**
 * Extract and format booking instructions as TOON
 * This is the main function to use
 */
export function extractAndFormatAsToon(instructions: string): {
  config: BookingConfig;
  toonFormat: string;
} {
  const config = extractBookingIds(instructions);
  const toonFormat = formatBookingConfigAsToon(config);

  return { config, toonFormat };
}

/**
 * Generate TOON example for tool descriptions
 */
export function generateToonExample(): string {
  return `bookingConfig{boardId,stageId,dealId,agentId,clientId,timezone}:
  b44305a9-9a2f-408c-b2d0-2a0b73fc3142,afac5248-59e5-41f4-b06c-01ea68d6af6a,14588,e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2,10000002,Africa/Casablanca`;
}

