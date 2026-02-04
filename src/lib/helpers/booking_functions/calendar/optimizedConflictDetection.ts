// Optimized conflict detection with smart algorithms and caching
import type { GraphCalendarConnection } from '@/types'
import { AdvancedCacheService } from '../../cache/advancedCacheService'
import { isWithinOfficeHours } from '../../utils'
import { DateTime } from 'luxon'
import { CalendarService } from './calendar-service'

interface TimeSlot {
  start: Date
  end: Date
}

interface BusyPeriod extends TimeSlot {
  id: string
  type: 'event' | 'busy'
}

interface ConflictResult {
  hasConflict: boolean
  conflictDetails?: string
  conflictingEvents?: BusyPeriod[]
}

interface AvailableSlot extends TimeSlot {
  startFormatted: string
  endFormatted: string
  confidence: number // 0-1, how good this slot is
}

/**
 * Optimized conflict detection service with smart algorithms
 */
export class OptimizedConflictDetection {
  
  // Search windows - using full day to avoid timezone issues
  private static readonly SEARCH_WINDOWS = {
    CONFLICT_CHECK: 24 * 60 * 60 * 1000,   // Full day to avoid timezone conversion issues
    SLOT_SEARCH: 4 * 60 * 60 * 1000,       // 4 hours before/after for slot finding
    EXTENDED_SEARCH: 8 * 60 * 60 * 1000    // 8 hours for extended search
  }

  /**
   * Fast conflict detection with optimized algorithm
   */
  static async checkForConflicts(
    connection: GraphCalendarConnection,
    startDateTime: string,
    endDateTime: string,
    timeZone: string,
    officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
    agentTimezone?: string,
    clientId?: number,
    calendarConnectionId?: string
  ): Promise<ConflictResult> {
    try {
      console.log(`🔍 OPTIMIZED: Checking conflicts for ${startDateTime} to ${endDateTime}`)
      
      const requestedStart = new Date(startDateTime)
      const requestedEnd = new Date(endDateTime)
      
      // FIRST: Check if requested time is within office hours
      if (officeHours) {
        const officeHoursCheck = isWithinOfficeHours(
          startDateTime,
          officeHours,
          agentTimezone || timeZone
        )
        
        if (!officeHoursCheck.isWithin) {
          console.log(`❌ OFFICE HOURS VIOLATION: ${officeHoursCheck.reason}`)
          return {
            hasConflict: true,
            conflictDetails: `Outside office hours: ${officeHoursCheck.reason || 'Not within business hours'}`
          }
        }
        
        console.log(`✅ OFFICE HOURS CHECK: Request is within office hours`)
      }
      
      // Create cache key for busy periods
      const dateKey = requestedStart.toISOString().split('T')[0]
      // const cacheKey = `${connection.id}-${dateKey}` // Reserved for future use
      
      // Get busy periods with caching
      // Note: We need clientId to use CalendarService, but we only have connection
      // For now, we'll fetch events directly using the provider pattern
      // This requires getting the connection's clientId or using a different approach
      const busyPeriods: BusyPeriod[] = await AdvancedCacheService.getBusyPeriods(
        connection.id,
        dateKey,
        async () => {
          // Fetch entire day to avoid timezone conversion issues
          // Get start of day (00:00) and end of day (23:59)
          const dayStart = new Date(requestedStart)
          dayStart.setHours(0, 0, 0, 0)
          
          const dayEnd = new Date(requestedStart)
          dayEnd.setHours(23, 59, 59, 999)
          
          console.log(`📅 Fetching events for entire day: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`)
          
          // Use CalendarService to support both Microsoft and Google
          // Get clientId from parameter or connection
          const connectionClientId = clientId || (connection as any).client_id || (connection as any).clientId
          
          if (!connectionClientId) {
            console.error(`❌ Cannot fetch events: No clientId found in connection or parameters`)
            return []
          }
          
          const eventsResult = await CalendarService.getEvents(
            connectionClientId,
            {
              startDateTime: dayStart.toISOString(),
              endDateTime: dayEnd.toISOString(),
              timeZone,
            },
            undefined,
            calendarConnectionId || connection.id
          )
          
          if (!eventsResult.success || !eventsResult.events) {
            console.log(`⚠️ No events found or error fetching events: ${eventsResult.error}`)
            return []
          }
          
          console.log(`📊 Found ${eventsResult.events.length} events for conflict checking`)
          
          return eventsResult.events.map(event => ({
            id: event.id,
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime),
            type: 'event' as const
          }))
        }
      ) as BusyPeriod[]

      // Fast overlap detection using sorted intervals
      console.log(`🔍 Checking ${busyPeriods.length} busy periods for conflicts`)
      console.log(`🎯 Requested slot: ${requestedStart.toISOString()} to ${requestedEnd.toISOString()}`)
      
      if (busyPeriods.length > 0) {
        console.log(`📋 Existing events:`)
        busyPeriods.forEach((period, index) => {
          console.log(`   ${index + 1}. ${period.start.toISOString()} to ${period.end.toISOString()}`)
        })
      }
      
      const conflictingEvents = this.findOverlappingEvents(
        { start: requestedStart, end: requestedEnd },
        busyPeriods
      )

      if (conflictingEvents.length > 0) {
        const conflictDetails = `Conflicts with ${conflictingEvents.length} existing event(s)`
        
        console.log(`❌ CONFLICT DETECTED: ${conflictingEvents.length} overlapping events`)
        conflictingEvents.forEach((event, index) => {
          console.log(`   Conflict ${index + 1}: ${event.start.toISOString()} to ${event.end.toISOString()}`)
        })
        
        return {
          hasConflict: true,
          conflictDetails,
          conflictingEvents
        }
      }

      console.log(`✅ NO CONFLICTS: Time slot is available`)
      return { hasConflict: false }

    } catch (error) {
      console.error('❌ Error in optimized conflict detection:', error)
      return { hasConflict: false } // Don't block on error
    }
  }

  /**
   * Optimized available slot finding with smart algorithms
   */
  static async findAvailableSlots(
    connection: GraphCalendarConnection,
    requestedStartTime: string,
    requestedEndTime: string,
    timeZone: string,
    options: {
      durationMinutes?: number
      maxSuggestions?: number
      officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null
      agentTimezone?: string
      searchWindowHours?: number
    } = {},
    clientId?: number,
    agentId?: string,
    calendarConnectionId?: string
  ): Promise<{
    hasConflict: boolean
    availableSlots: AvailableSlot[]
    conflictDetails?: string
  }> {
    const {
      durationMinutes = 60,
      maxSuggestions = 3,
      officeHours,
      agentTimezone = timeZone,
      searchWindowHours = 4
    } = options

    try {
      console.log(`🔍 OPTIMIZED: Finding available slots near ${requestedStartTime}`)
      console.log(`⏰ Office hours configured: ${officeHours ? 'YES' : 'NO'}`)
      console.log(`📊 Max suggestions: ${maxSuggestions}`)
      
      const requestedStart = new Date(requestedStartTime)
      const requestedEnd = new Date(requestedEndTime)
      
      // First check if requested time is available (including office hours validation)
      const conflictCheck = await this.checkForConflicts(
        connection,
        requestedStartTime,
        requestedEndTime,
        timeZone,
        officeHours,
        agentTimezone
      )
      
      // Determine search window for finding slots
      // If office hours are configured and violated, search the entire day within office hours
      // Otherwise, use the requested window (or configured search window if there's a conflict)
      let searchStart: Date
      let searchEnd: Date
      
      if (officeHours && conflictCheck.conflictDetails?.includes('Outside office hours')) {
        // Office hours violation: search entire day within office hours
        searchStart = new Date(requestedStart)
        searchStart.setHours(0, 0, 0, 0)
        
        searchEnd = new Date(requestedStart)
        searchEnd.setHours(23, 59, 59, 999)
        
        console.log(`🔍 Office hours violation detected - searching entire day for available slots within office hours`)
      } else if (conflictCheck.hasConflict) {
        // Regular conflict: use configured search window around requested time
        const searchWindow = searchWindowHours * 60 * 60 * 1000
        searchStart = new Date(requestedStart.getTime() - searchWindow)
        searchEnd = new Date(requestedEnd.getTime() + searchWindow)
        
        console.log(`🔍 Conflict detected - searching ${searchWindowHours}h window for alternatives`)
      } else {
        // No conflict: use the requested window to generate slots within it
        searchStart = requestedStart
        searchEnd = requestedEnd
        
        console.log(`✅ No conflicts in requested window - generating slots within ${requestedStart.toISOString()} to ${requestedEnd.toISOString()}`)
      }
      
      // Use CalendarService to support both Microsoft and Google
      const connectionClientId = clientId || (connection as any).client_id || (connection as any).clientId
      
      if (!connectionClientId) {
        console.error(`❌ Cannot fetch events: No clientId found in connection or parameters`)
        return {
          hasConflict: true,
          availableSlots: [],
          conflictDetails: 'Cannot fetch calendar events: Missing clientId'
        }
      }
      
      const eventsResult = await CalendarService.getEvents(
        connectionClientId,
        {
          startDateTime: searchStart.toISOString(),
          endDateTime: searchEnd.toISOString(),
          timeZone,
        },
        agentId,
        calendarConnectionId || connection.id
      )

      // Convert to sorted busy periods (empty array if no events)
      const sortedBusyPeriods = (eventsResult.events || [])
        .map(event => ({
          id: event.id,
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime),
          type: 'event' as const
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime())

      if (!eventsResult.success) {
        console.log(`⚠️ Error fetching events: ${eventsResult.error}`)
        // Still try to generate slots even if there was an error fetching events
      } else if (sortedBusyPeriods.length === 0) {
        console.log(`✅ No events found - calendar is completely free in search window`)
      }

      // Find available slots using optimized algorithm
      // This will generate slots even when there are no conflicts
      const availableSlots = this.findOptimalSlots(
        requestedStart,
        requestedEnd,
        sortedBusyPeriods,
        durationMinutes,
        maxSuggestions,
        officeHours,
        agentTimezone
      )

      console.log(`💡 Found ${availableSlots.length} available slots`)

      return {
        hasConflict: conflictCheck.hasConflict,
        availableSlots,
        conflictDetails: conflictCheck.conflictDetails
      }

    } catch (error) {
      console.error('❌ Error in optimized slot finding:', error)
      return {
        hasConflict: true,
        availableSlots: [],
        conflictDetails: 'Error finding available slots'
      }
    }
  }

  /**
   * Fast overlap detection using sorted intervals - O(n log n) complexity
   */
  private static findOverlappingEvents(
    targetSlot: TimeSlot,
    busyPeriods: BusyPeriod[]
  ): BusyPeriod[] {
    const overlapping: BusyPeriod[] = []
    
    // Binary search for potential overlaps (if we had many events)
    // For now, simple linear search since we limit the search window
    for (const period of busyPeriods) {
      if (this.hasOverlap(targetSlot, period)) {
        overlapping.push(period)
      }
    }
    
    return overlapping
  }

  /**
   * Check if two time slots overlap
   * Returns true if there is any overlap between the two slots
   */
  private static hasOverlap(slot1: TimeSlot, slot2: TimeSlot): boolean {
    const overlaps = slot1.start < slot2.end && slot1.end > slot2.start
    return overlaps
  }

  /**
   * Find optimal available slots using smart algorithm
   */
  private static findOptimalSlots(
    requestedStart: Date,
    requestedEnd: Date,
    busyPeriods: BusyPeriod[],
    durationMinutes: number,
    maxSuggestions: number,
    officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
    agentTimezone?: string
  ): AvailableSlot[] {
    const slots: AvailableSlot[] = []
    const slotDuration = durationMinutes * 60 * 1000
    const now = new Date()
    const minSlotTime = new Date(now.getTime() + 15 * 60 * 1000) // 15 min buffer
    
    // Use agent timezone for day boundaries (default to UTC if not provided)
    const tz = agentTimezone || ""
    
    // Get the requested day in the agent's timezone (not UTC)
    const requestedDayInTZ = this.getDateStringInTimezone(requestedStart, tz)
    
    // Get start and end of the requested day in the agent's timezone
    const { dayStart, dayEnd } = this.getDayBoundariesInTimezone(requestedStart, tz)
    
    // Use day boundaries for search window (don't cross to other days)
    const searchStart = dayStart
    const searchEnd = dayEnd
    
    console.log(`📅 Limiting slot search to same day (${tz}): ${searchStart.toISOString()} to ${searchEnd.toISOString()}`)
    console.log(`📅 Requested day in ${tz}: ${requestedDayInTZ}`)
    
    // Generate candidate slots with smart intervals
    const candidates = this.generateSmartCandidates(
      requestedStart,
      searchStart,
      searchEnd,
      slotDuration,
      30 // 30-minute intervals
    )

    let skippedPast = 0
    let skippedConflict = 0
    let skippedOfficeHours = 0
    let skippedDifferentDay = 0

    for (const candidate of candidates) {
      if (slots.length >= maxSuggestions) break
      
      // Skip if not on the same day as requested (compare in agent's timezone)
      const candidateDayInTZ = this.getDateStringInTimezone(candidate.start, tz)
      if (candidateDayInTZ !== requestedDayInTZ) {
        skippedDifferentDay++
        continue
      }
      
      // Skip if in the past
      if (candidate.start < minSlotTime) {
        skippedPast++
        continue
      }
      
      // Check if slot conflicts with busy periods
      if (this.slotHasConflict(candidate, busyPeriods)) {
        skippedConflict++
        continue
      }
      
      // Check office hours if provided
      if (officeHours) {
        const officeHoursCheck = isWithinOfficeHours(
          candidate.start.toISOString(),
          officeHours,
          agentTimezone || 'Australia/Melbourne'
        )
        if (!officeHoursCheck.isWithin) {
          skippedOfficeHours++
          continue
        }
      }

      // Calculate confidence score based on proximity to requested time
      const confidence = this.calculateSlotConfidence(candidate.start, requestedStart)
      
      slots.push({
        start: candidate.start,
        end: candidate.end,
        startFormatted: this.formatTimeForDisplay(candidate.start),
        endFormatted: this.formatTimeForDisplay(candidate.end),
        confidence
      })
    }

    console.log(`📊 Slot filtering: ${slots.length} available | Skipped: ${skippedDifferentDay} different day, ${skippedPast} past, ${skippedConflict} conflicts, ${skippedOfficeHours} outside office hours`)

    // Sort by confidence (best slots first)
    return slots.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Generate smart candidate slots focusing on preferred times
   */
  private static generateSmartCandidates(
    requestedStart: Date,
    searchStart: Date,
    searchEnd: Date,
    slotDuration: number,
    intervalMinutes: number
  ): TimeSlot[] {
    const candidates: TimeSlot[] = []
    const interval = intervalMinutes * 60 * 1000
    
    // Generate slots with preference for times close to requested time
    let currentTime = new Date(searchStart)
    
    while (currentTime < searchEnd && candidates.length < 50) { // Limit candidates
      const slotEnd = new Date(currentTime.getTime() + slotDuration)
      
      candidates.push({
        start: new Date(currentTime),
        end: slotEnd
      })
      
      currentTime = new Date(currentTime.getTime() + interval)
    }
    
    return candidates
  }

  /**
   * Check if a slot conflicts with any busy period
   */
  private static slotHasConflict(slot: TimeSlot, busyPeriods: BusyPeriod[]): boolean {
    return busyPeriods.some(period => this.hasOverlap(slot, period))
  }

  /**
   * Calculate confidence score for a slot based on proximity to requested time
   */
  private static calculateSlotConfidence(slotStart: Date, requestedStart: Date): number {
    const timeDiff = Math.abs(slotStart.getTime() - requestedStart.getTime())
    const maxDiff = 4 * 60 * 60 * 1000 // 4 hours
    
    // Confidence decreases with distance from requested time
    const proximityScore = Math.max(0, 1 - (timeDiff / maxDiff))
    
    // Bonus for business hours (9 AM - 6 PM)
    const hour = slotStart.getHours()
    const businessHoursBonus = (hour >= 9 && hour < 18) ? 0.2 : 0
    
    return Math.min(1, proximityScore + businessHoursBonus)
  }

  /**
   * Format time for display
   */
  private static formatTimeForDisplay(date: Date): string {
    return date.toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  /**
   * Get date string (YYYY-MM-DD) in a specific timezone
   */
  private static getDateStringInTimezone(date: Date, timezone: string): string {
    const dt = DateTime.fromJSDate(date, { zone: timezone })
    return dt.toFormat('yyyy-MM-dd')
  }

  /**
   * Get start and end of day boundaries in a specific timezone
   */
  private static getDayBoundariesInTimezone(date: Date, timezone: string): { dayStart: Date; dayEnd: Date } {
    // Convert to DateTime in the target timezone
    const dt = DateTime.fromJSDate(date, { zone: timezone })
    
    // Get start of day in the target timezone
    const dayStart = dt.startOf('day')
    
    // Get end of day in the target timezone
    const dayEnd = dt.endOf('day')
    
    // Convert back to JS Date (UTC)
    return {
      dayStart: dayStart.toJSDate(),
      dayEnd: dayEnd.toJSDate()
    }
  }
}

export default OptimizedConflictDetection
