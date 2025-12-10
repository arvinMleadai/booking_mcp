// Optimized conflict detection with smart algorithms and caching
import type { GraphCalendarConnection } from '@/types'
import { AdvancedCacheService } from '../cache/advancedCacheService'
import { EnhancedGraphApiService } from './enhancedGraphApiService'
import { isWithinOfficeHours } from '../utils'

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
    agentTimezone?: string
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
          
          const events = await EnhancedGraphApiService.getEventsOptimized(
            connection,
            {
              startDateTime: dayStart.toISOString(),
              endDateTime: dayEnd.toISOString(),
              timeZone,
              fieldSet: 'MINIMAL'
            }
          )
          
          if (!events.success || !events.events) {
            console.log(`⚠️ No events found or error fetching events`)
            return []
          }
          
          console.log(`📊 Found ${events.events.length} events for conflict checking`)
          
          return events.events.map(event => ({
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
    } = {}
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
      
      if (!conflictCheck.hasConflict) {
        return {
          hasConflict: false,
          availableSlots: []
        }
      }

      // Get busy periods for slot finding
      const searchWindow = searchWindowHours * 60 * 60 * 1000
      const searchStart = new Date(requestedStart.getTime() - searchWindow)
      const searchEnd = new Date(requestedEnd.getTime() + searchWindow)
      
      console.log(`🔍 Searching ${searchWindowHours}h window for alternatives`)
      
      const busyPeriods = await EnhancedGraphApiService.getEventsOptimized(
        connection,
        {
          startDateTime: searchStart.toISOString(),
          endDateTime: searchEnd.toISOString(),
          timeZone,
          fieldSet: 'MINIMAL'
        }
      )

      if (!busyPeriods.success || !busyPeriods.events) {
        return {
          hasConflict: false,
          availableSlots: []
        }
      }

      // Convert to sorted busy periods
      const sortedBusyPeriods = busyPeriods.events
        .map(event => ({
          id: event.id,
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime),
          type: 'event' as const
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime())

      // Find available slots using optimized algorithm
      const availableSlots = this.findOptimalSlots(
        requestedStart,
        requestedEnd,
        sortedBusyPeriods,
        durationMinutes,
        maxSuggestions,
        officeHours,
        agentTimezone
      )

      console.log(`💡 Found ${availableSlots.length} optimized alternative slots`)

      return {
        hasConflict: true,
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
    
    // Smart slot generation - limit to same day only for better UX
    // Get start and end of the requested day
    const dayStart = new Date(requestedStart)
    dayStart.setHours(0, 0, 0, 0)
    
    const dayEnd = new Date(requestedStart)
    dayEnd.setHours(23, 59, 59, 999)
    
    // Use day boundaries for search window (don't cross to other days)
    const searchStart = dayStart
    const searchEnd = dayEnd
    
    console.log(`📅 Limiting slot search to same day: ${searchStart.toISOString()} to ${searchEnd.toISOString()}`)
    
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

    // Get the requested day for comparison
    const requestedDay = requestedStart.toISOString().split('T')[0]

    for (const candidate of candidates) {
      if (slots.length >= maxSuggestions) break
      
      // Skip if not on the same day as requested
      const candidateDay = candidate.start.toISOString().split('T')[0]
      if (candidateDay !== requestedDay) {
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
}

export default OptimizedConflictDetection
