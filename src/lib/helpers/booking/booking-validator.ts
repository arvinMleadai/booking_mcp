/**
 * Booking Validation Logic
 * Validates booking requests, time slots, and business rules
 */

import { DateTime } from 'luxon';
import type { BookingTimeSlot, ErrorCode } from './booking-types';

export interface ValidationError {
  valid: false;
  error: string;
  code: ErrorCode;
  details?: Record<string, any>;
}

export interface ValidationSuccess {
  valid: true;
}

export type ValidationResult = ValidationSuccess | ValidationError;

/**
 * Validate booking time slot
 * Checks: future time, minimum advance notice, end after start
 * 
 * @param slot - Time slot to validate
 * @param minimumAdvanceMinutes - Minimum minutes in advance (default: 15)
 * @returns Validation result
 */
export function validateTimeSlot(
  slot: BookingTimeSlot,
  minimumAdvanceMinutes: number = 15
): ValidationResult {
  const now = DateTime.now();
  const start = DateTime.fromISO(slot.startDateTime);
  const end = DateTime.fromISO(slot.endDateTime);

  // Check valid ISO format
  if (!start.isValid) {
    return {
      valid: false,
      error: `Invalid start time format: ${slot.startDateTime}`,
      code: 'INVALID_TIME' as ErrorCode,
    };
  }

  if (!end.isValid) {
    return {
      valid: false,
      error: `Invalid end time format: ${slot.endDateTime}`,
      code: 'INVALID_TIME' as ErrorCode,
    };
  }

  // Check end is after start
  if (end <= start) {
    return {
      valid: false,
      error: 'End time must be after start time',
      code: 'INVALID_TIME' as ErrorCode,
      details: { start: slot.startDateTime, end: slot.endDateTime },
    };
  }

  // Check minimum advance notice
  const minimumTime = now.plus({ minutes: minimumAdvanceMinutes });
  if (start < minimumTime) {
    const minutesFromNow = Math.floor(start.diff(now, 'minutes').minutes);
    return {
      valid: false,
      error: minutesFromNow < 0
        ? `Cannot book in the past. Current time: ${now.toISO()}`
        : `Minimum ${minimumAdvanceMinutes} minutes advance required. Requested: ${minutesFromNow} minutes from now`,
      code: minutesFromNow < 0 ? 'PAST_TIME' as ErrorCode : 'INVALID_TIME' as ErrorCode,
      details: {
        now: now.toISO(),
        requested: start.toISO(),
        minimumAdvance: minimumAdvanceMinutes,
      },
    };
  }

  return { valid: true };
}

/**
 * Check if time is within office hours
 * 
 * @param dateTime - DateTime to check
 * @param officeHours - Office hours configuration
 * @param timezone - Timezone for office hours
 * @returns Validation result
 */
export function validateOfficeHours(
  dateTime: string,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string
): ValidationResult {
  const dt = DateTime.fromISO(dateTime, { zone: timezone });

  if (!dt.isValid) {
    return {
      valid: false,
      error: `Invalid datetime: ${dateTime}`,
      code: 'INVALID_TIME' as ErrorCode,
    };
  }

  // Get day of week (lowercase: monday, tuesday, etc.)
  const dayOfWeek = dt.toFormat('EEEE').toLowerCase();
  const hours = officeHours[dayOfWeek];

  if (!hours || !hours.enabled) {
    return {
      valid: false,
      error: `Office is closed on ${dayOfWeek}`,
      code: 'OUTSIDE_HOURS' as ErrorCode,
      details: { day: dayOfWeek, requested: dateTime },
    };
  }

  // Parse office hours
  const [startHour, startMinute] = hours.start.split(':').map(Number);
  const [endHour, endMinute] = hours.end.split(':').map(Number);

  const officeStart = dt.set({ hour: startHour, minute: startMinute, second: 0 });
  const officeEnd = dt.set({ hour: endHour, minute: endMinute, second: 0 });

  if (dt < officeStart || dt > officeEnd) {
    return {
      valid: false,
      error: `Requested time ${dt.toFormat('HH:mm')} is outside office hours (${hours.start} - ${hours.end})`,
      code: 'OUTSIDE_HOURS' as ErrorCode,
      details: {
        requested: dt.toFormat('HH:mm'),
        officeStart: hours.start,
        officeEnd: hours.end,
      },
    };
  }

  return { valid: true };
}

/**
 * Validate email format
 * 
 * @param email - Email to validate
 * @returns True if valid email
 */
export function isValidEmail(email: string | undefined): boolean {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 * 
 * @param phone - Phone number to validate
 * @returns True if valid phone format
 */
export function isValidPhoneNumber(phone: string | undefined): boolean {
  if (!phone) return false;
  // Basic validation: at least 10 digits
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length >= 10;
}

/**
 * Create validation error response
 * 
 * @param error - Error message
 * @param code - Error code
 * @param details - Additional details
 * @returns Validation error object
 */
export function createValidationError(
  error: string,
  code: ErrorCode,
  details?: Record<string, any>
): ValidationError {
  return {
    valid: false,
    error,
    code,
    details,
  };
}
