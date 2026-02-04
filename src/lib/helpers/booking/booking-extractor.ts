/**
 * Booking ID Extraction
 * Simplified regex-based extraction for structured VAPI payloads
 */

import type { BookingIds } from './booking-types';

/**
 * Extract booking IDs from instruction text using regex patterns
 * Optimized for VAPI payload format
 * 
 * @param instructionsText - Structured text containing booking IDs
 * @returns Extracted booking IDs
 * 
 * @example
 * const ids = extractBookingIds(`
 *   Agent ID is e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2
 *   Client ID is 10000002
 *   Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142
 *   Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a
 *   Deal id is 14588
 *   Timezone is Africa/Casablanca
 * `);
 */
export function extractBookingIds(instructionsText: string): BookingIds {
  if (!instructionsText || instructionsText.trim().length === 0) {
    return {};
  }
  console.log('1. Instructions Text:', instructionsText);
  const config: BookingIds = {};

  // 0. Try to parse as JSON first (LLM sometimes sends JSON string)
  // Robust parsing: find the substring from first '{' to last '}'
  const jsonMatch = instructionsText.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      console.log('2. Instructions Text:', instructionsText);
      console.debug('✅ [extractBookingIds] Parsed JSON input:', parsed);
      
      // Map parsed fields to config
      if (parsed.agentId) config.agentId = parsed.agentId;
      if (parsed.clientId) config.clientId = typeof parsed.clientId === 'string' ? parseInt(parsed.clientId) : parsed.clientId;
      if (parsed.boardId) config.boardId = parsed.boardId;
      if (parsed.stageId) config.stageId = parsed.stageId;
      if (parsed.dealId) config.dealId = typeof parsed.dealId === 'string' ? parseInt(parsed.dealId) : parsed.dealId;
      if (parsed.timezone) config.timezone = parsed.timezone;

      return config;
    } catch (e) {
      console.warn('⚠️ [extractBookingIds] JSON parse failed, no fallback to regex:', e);
    }
  }

  // No fallback regex support - strictly JSON only per user request.
  // If JSON was not found or parsing failed, return the (potentially empty) config.
  return config;
}

/**
 * Validate that required booking IDs are present
 * 
 * @param ids - Extracted booking IDs
 * @returns Validation result with missing IDs if any
 */
export function validateRequiredIds(
  ids: BookingIds
): { valid: boolean; missing: string[] } {
  const required = ['clientId', 'agentId', 'boardId', 'stageId', 'dealId'] as const;
  const missing: string[] = [];

  for (const field of required) {
    if (!ids[field]) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Format instruction text for consistent extraction
 * Useful for testing and debugging
 * 
 * @param ids - Booking IDs to format
 * @returns Formatted instruction text
 */
export function formatInstructionsText(ids: Required<BookingIds>): string {
  console.log('3. Instructions Text:', ids);
  return `Agent ID is ${ids.agentId}
Client ID is ${ids.clientId}
Board Id is ${ids.boardId}
Stage Id is ${ids.stageId}
Deal id is ${ids.dealId}
Timezone is ${ids.timezone}`;
}

/**
 * Parse and validate UUID format
 * 
 * @param value - String to validate
 * @returns True if valid UUID format
 */
export function isValidUUID(value: string | undefined): boolean {
  if (!value) return false;
  const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validate numeric ID
 * 
 * @param value - Value to validate
 * @returns True if valid positive integer
 */
export function isValidNumericId(value: number | undefined): boolean {
  if (value === undefined || value === null) return false;
  return Number.isInteger(value) && value > 0;
}
