// High-performance caching service for calendar operations
import type { GraphCalendarConnection } from '@/types'

interface CacheEntry<T> {
  data: T
  expires: number
  key: string
}

interface OfficeHours {
  [key: string]: { start: string; end: string; enabled: boolean }
}

interface ClientCalendarData {
  connection: GraphCalendarConnection
  timezone: string
  agentOfficeHours?: OfficeHours
  agentTimezone?: string
  agentName?: string
}

/**
 * In-memory cache service with TTL support
 * For production, this should be replaced with Redis
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data as T
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const expires = Date.now() + (ttlSeconds * 1000)
    this.cache.set(key, { data, expires, key })
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async deletePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace('*', '.*'))
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key)
      }
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now > entry.expires) {
        this.cache.delete(key)
      }
    }
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.cache.clear()
  }
}

// Singleton cache instance
const cache = new MemoryCache()

/**
 * Cache service for calendar operations with optimized TTL values
 */
export class CacheService {
  // Cache TTL values (in seconds)
  private static readonly TTL = {
    CALENDAR_CONNECTION: 15 * 60,    // 15 minutes
    CLIENT_TIMEZONE: 60 * 60,       // 1 hour
    AGENT_OFFICE_HOURS: 30 * 60,    // 30 minutes
    CLIENT_CALENDAR_DATA: 15 * 60,  // 15 minutes
    BUSY_PERIODS: 5 * 60,           // 5 minutes
    TOKEN_REFRESH: 50 * 60,         // 50 minutes (tokens expire in 60)
    GRAPH_EVENTS: 2 * 60,           // 2 minutes
  }

  /**
   * Get cached calendar connection or fetch from database
   */
  static async getCalendarConnection(clientId: number): Promise<GraphCalendarConnection | null> {
    const cacheKey = `connection:${clientId}`
    
    let connection = await cache.get<GraphCalendarConnection>(cacheKey)
    if (connection) {
      console.log(`🚀 Cache HIT: Calendar connection for client ${clientId}`)
      return connection
    }

    console.log(`💾 Cache MISS: Fetching calendar connection for client ${clientId}`)
    
    // Import here to avoid circular dependencies
    const { getCalendarConnectionByClientId } = await import('../calendar_functions/graphDatabase')
    connection = await getCalendarConnectionByClientId(clientId)
    
    if (connection) {
      await cache.set(cacheKey, connection, this.TTL.CALENDAR_CONNECTION)
    }
    
    return connection
  }

  /**
   * Get cached client timezone or fetch from database
   */
  static async getClientTimezone(clientId: number): Promise<string | null> {
    const cacheKey = `timezone:${clientId}`
    
    let timezone = await cache.get<string>(cacheKey)
    if (timezone) {
      console.log(`🚀 Cache HIT: Client timezone for client ${clientId}`)
      return timezone
    }

    console.log(`💾 Cache MISS: Fetching client timezone for client ${clientId}`)
    
    const { getClientTimezone } = await import('../calendar_functions/getClientTimeZone')
    timezone = await getClientTimezone(clientId)
    
    if (timezone) {
      await cache.set(cacheKey, timezone, this.TTL.CLIENT_TIMEZONE)
    }
    
    return timezone
  }

  /**
   * Get comprehensive client calendar data in a single cached operation
   */
  static async getClientCalendarData(clientId: number): Promise<ClientCalendarData | null> {
    const cacheKey = `client-data:${clientId}`
    
    let clientData = await cache.get<ClientCalendarData>(cacheKey)
    if (clientData) {
      console.log(`🚀 Cache HIT: Complete client data for client ${clientId}`)
      return clientData
    }

    console.log(`💾 Cache MISS: Fetching complete client data for client ${clientId}`)
    
    try {
      // Fetch all data in parallel
      const [connection, timezone] = await Promise.all([
        this.getCalendarConnection(clientId),
        this.getClientTimezone(clientId)
      ])

      if (!connection || !timezone) {
        return null
      }

      // Get agent data if available
      let agentOfficeHours: OfficeHours | undefined
      let agentTimezone: string | undefined
      let agentName: string | undefined

      try {
        const { getAgentByCalendarConnection } = await import('../utils')
        const agentAssignment = await getAgentByCalendarConnection(connection.id)
        
        if (agentAssignment?.agents) {
          const agent = agentAssignment.agents as unknown as {
            uuid: string
            name: string
            profiles: {
              office_hours: OfficeHours
              timezone: string
            } | {
              office_hours: OfficeHours
              timezone: string
            }[]
          }
          
          const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles
          if (profile) {
            agentOfficeHours = profile.office_hours
            agentTimezone = profile.timezone
            agentName = agent.name
          }
        }
      } catch (error) {
        console.log(`⚠️ Could not fetch agent data for client ${clientId}:`, error)
      }

      clientData = {
        connection,
        timezone,
        agentOfficeHours,
        agentTimezone,
        agentName
      }

      await cache.set(cacheKey, clientData, this.TTL.CLIENT_CALENDAR_DATA)
      return clientData
      
    } catch (error) {
      console.error(`❌ Error fetching client calendar data for ${clientId}:`, error)
      return null
    }
  }

  /**
   * Cache busy periods for conflict detection
   */
  static async getBusyPeriods(
    connectionId: string, 
    date: string,
    fetcher: () => Promise<Array<{ start: Date; end: Date }>>
  ): Promise<Array<{ start: Date; end: Date }>> {
    const cacheKey = `busy-periods:${connectionId}:${date}`
    
    let busyPeriods = await cache.get<Array<{ start: Date; end: Date }>>(cacheKey)
    if (busyPeriods) {
      console.log(`🚀 Cache HIT: Busy periods for ${connectionId} on ${date}`)
      return busyPeriods
    }

    console.log(`💾 Cache MISS: Fetching busy periods for ${connectionId} on ${date}`)
    
    busyPeriods = await fetcher()
    await cache.set(cacheKey, busyPeriods, this.TTL.BUSY_PERIODS)
    
    return busyPeriods
  }

  /**
   * Cache Microsoft Graph API responses
   */
  static async getGraphEvents<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    ttl: number = this.TTL.GRAPH_EVENTS
  ): Promise<T> {
    let events = await cache.get<T>(cacheKey)
    if (events) {
      console.log(`🚀 Cache HIT: Graph events ${cacheKey}`)
      return events
    }

    console.log(`💾 Cache MISS: Fetching Graph events ${cacheKey}`)
    
    events = await fetcher()
    await cache.set(cacheKey, events, ttl)
    
    return events
  }

  /**
   * Invalidate all cache entries for a client
   */
  static async invalidateClient(clientId: number): Promise<void> {
    console.log(`🗑️ Invalidating cache for client ${clientId}`)
    
    await Promise.all([
      cache.delete(`connection:${clientId}`),
      cache.delete(`timezone:${clientId}`),
      cache.delete(`client-data:${clientId}`),
      cache.deletePattern(`busy-periods:*:${clientId}:*`)
    ])
  }

  /**
   * Invalidate calendar connection cache (e.g., after token refresh)
   */
  static async invalidateConnection(connectionId: string): Promise<void> {
    console.log(`🗑️ Invalidating cache for connection ${connectionId}`)
    
    await cache.deletePattern(`busy-periods:${connectionId}:*`)
  }

  /**
   * Get cache statistics for monitoring
   */
  static getCacheStats(): { size: number; keys: string[] } {
    return cache.getStats()
  }

  /**
   * Clear all cache (for testing/debugging)
   */
  static async clearAll(): Promise<void> {
    cache.destroy()
  }
}

export default CacheService
