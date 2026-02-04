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

  const config: BookingIds = {};

  // UUID pattern (36 characters with hyphens)
  const uuidRegex = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

  // Debug logging
  console.log('📝 [extractBookingIds] Input text:', instructionsText);

  // Extract boardId
  const boardIdMatch = instructionsText.match(
    /Board\s+Id?\s+(?:is\s+)?[:=]?\s*([a-f0-9-]{36})/i
  );
  if (boardIdMatch && uuidRegex.test(boardIdMatch[1])) {
    config.boardId = boardIdMatch[1];
    console.debug('✅ [extractBookingIds] Found boardId:', config.boardId);
  } else {
    console.debug('❌ [extractBookingIds] boardId not found');
  }

  // Extract stageId
  const stageIdMatch = instructionsText.match(
    /Stage\s+Id?\s+(?:is\s+)?[:=]?\s*([a-f0-9-]{36})/i
  );
  if (stageIdMatch && uuidRegex.test(stageIdMatch[1])) {
    config.stageId = stageIdMatch[1];
    console.debug('✅ [extractBookingIds] Found stageId:', config.stageId);
  } else {
    console.debug('❌ [extractBookingIds] stageId not found');
  }

  // Extract dealId
  const dealIdMatch = instructionsText.match(
    /Deal\s+id?\s+(?:is\s+)?[:=]?\s*(\d+)/i
  );
  if (dealIdMatch) {
    config.dealId = parseInt(dealIdMatch[1], 10);
    console.debug('✅ [extractBookingIds] Found dealId:', config.dealId);
  } else {
    console.debug('❌ [extractBookingIds] dealId not found');
  }

  // Extract agentId
  const agentIdMatch = instructionsText.match(
    /Agent\s+Id?\s+(?:is\s+)?[:=]?\s*([a-f0-9-]{36})/i
  );
  if (agentIdMatch && uuidRegex.test(agentIdMatch[1])) {
    config.agentId = agentIdMatch[1];
    console.debug('✅ [extractBookingIds] Found agentId:', config.agentId);
  } else {
    console.debug('❌ [extractBookingIds] agentId not found');
  }

  // Extract clientId
  const clientIdMatch = instructionsText.match(
    /Client\s+Id?\s+(?:is\s+)?[:=]?\s*(\d+)/i
  );
  if (clientIdMatch) {
    config.clientId = parseInt(clientIdMatch[1], 10);
    console.debug('✅ [extractBookingIds] Found clientId:', config.clientId);
  } else {
    console.debug('❌ [extractBookingIds] clientId not found');
  }

  // Extract timezone
  const timezoneMatch = instructionsText.match(
    /Timezone?\s+(?:is\s+)?[:=]?\s*([A-Za-z_/]+)/i
  );
  if (timezoneMatch) {
    config.timezone = timezoneMatch[1];
    console.debug('✅ [extractBookingIds] Found timezone:', config.timezone);
  } else {
    console.debug('❌ [extractBookingIds] timezone not found');
  }

  console.log('📊 [extractBookingIds] Extraction result:', JSON.stringify(config, null, 2));

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
