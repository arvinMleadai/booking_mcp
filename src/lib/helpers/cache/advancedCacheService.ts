// Advanced caching service with LRU eviction and memory management
import type { GraphCalendarConnection } from '@/types'

interface CacheEntry<T> {
  data: T
  expires: number
  key: string
  size: number // Estimated size in bytes
  lastAccessed: number
  accessCount: number
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

interface CacheStats {
  size: number
  keys: string[]
  memoryUsageMB: number
  hitRate: number
  evictionCount: number
  totalRequests: number
  totalHits: number
}

/**
 * Advanced LRU cache with memory management and performance monitoring
 */
class AdvancedMemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private cleanupInterval!: NodeJS.Timeout
  private memoryCheckInterval!: NodeJS.Timeout
  
  // Configuration
  private readonly maxMemoryMB: number = 100
  private readonly maxEntries: number = 1000
  private readonly cleanupIntervalMs: number = 5 * 60 * 1000 // 5 minutes
  private readonly memoryCheckIntervalMs: number = 5 * 60 * 1000 // 5 minutes (reduced frequency)
  
  // Statistics
  private stats = {
    totalRequests: 0,
    totalHits: 0,
    evictionCount: 0,
    memoryPressureEvents: 0
  }

  constructor() {
    this.setupCleanupIntervals()
    this.setupGracefulShutdown()
  }

  private setupCleanupIntervals(): void {
    // Regular cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, this.cleanupIntervalMs)

    // Memory pressure monitoring
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryPressure()
    }, this.memoryCheckIntervalMs)
  }

  private setupGracefulShutdown(): void {
    const shutdown = () => {
      console.log('🧹 Gracefully shutting down cache service...')
      this.destroy()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('beforeExit', () => this.destroy())
  }

  async get<T>(key: string): Promise<T | null> {
    this.stats.totalRequests++
    
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      return null
    }
    
    // Update LRU tracking
    entry.lastAccessed = Date.now()
    entry.accessCount++
    this.stats.totalHits++
    
    return entry.data as T
  }

  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    const expires = Date.now() + (ttlSeconds * 1000)
    const size = this.estimateSize(data)
    
    const entry: CacheEntry<T> = {
      data,
      expires,
      key,
      size,
      lastAccessed: Date.now(),
      accessCount: 1
    }

    // Check if we need to evict before adding
    await this.ensureCapacity(size)
    
    this.cache.set(key, entry)
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async deletePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern.replace('*', '.*'))
    const keysToDelete: string[] = []
    
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        keysToDelete.push(key)
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key))
  }

  private async ensureCapacity(newEntrySize: number): Promise<void> {
    // Check entry count limit
    if (this.cache.size >= this.maxEntries) {
      await this.evictLRU(Math.ceil(this.maxEntries * 0.1)) // Evict 10%
    }

    // Check memory limit
    const currentMemoryMB = this.getCurrentMemoryUsageMB()
    const newEntryMB = newEntrySize / (1024 * 1024)
    
    if (currentMemoryMB + newEntryMB > this.maxMemoryMB) {
      const targetEvictionMB = (currentMemoryMB + newEntryMB) - (this.maxMemoryMB * 0.8) // Target 80% of limit
      await this.evictByMemoryPressure(targetEvictionMB)
    }
  }

  private async evictLRU(count: number): Promise<void> {
    const entries = Array.from(this.cache.entries())
      .map(([, entry]) => entry)
      .sort((a, b) => {
        // Sort by access frequency and recency (LRU + LFU hybrid)
        const aScore = a.accessCount * 0.3 + (Date.now() - a.lastAccessed) * 0.7
        const bScore = b.accessCount * 0.3 + (Date.now() - b.lastAccessed) * 0.7
        return bScore - aScore // Higher score = more likely to evict
      })

    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.cache.delete(entries[i].key)
      this.stats.evictionCount++
    }

    console.log(`🗑️ Evicted ${Math.min(count, entries.length)} LRU entries`)
  }

  private async evictByMemoryPressure(targetMB: number): Promise<void> {
    this.stats.memoryPressureEvents++
    
    const entries = Array.from(this.cache.entries())
      .map(([, entry]) => entry)
      .sort((a, b) => b.size - a.size) // Evict largest entries first

    let evictedMB = 0
    let evictedCount = 0

    for (const entry of entries) {
      if (evictedMB >= targetMB) break
      
      this.cache.delete(entry.key)
      evictedMB += entry.size / (1024 * 1024)
      evictedCount++
      this.stats.evictionCount++
    }

    console.log(`🧠 Memory pressure: Evicted ${evictedCount} entries (${evictedMB.toFixed(2)}MB)`)
  }

  private cleanup(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, entry] of this.cache) {
      if (now > entry.expires) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    // Only log significant cleanups to reduce noise
    if (cleanedCount > 10) {
      console.log(`Cache cleaned: ${cleanedCount} expired entries removed`)
    }
  }

  private checkMemoryPressure(): void {
    const memUsage = process.memoryUsage()
    const heapUsedMB = memUsage.heapUsed / (1024 * 1024)
    
    // If Node.js heap usage is critically high, trigger aggressive cleanup
    // Increased threshold for Next.js apps which typically use 700-900MB
    if (heapUsedMB > 1024) { // 1GB threshold for production apps
      console.log(`High memory usage detected: ${heapUsedMB.toFixed(2)}MB`)
      this.forceCleanup()
    }
  }

  private forceCleanup(): void {
    const beforeSize = this.cache.size
    
    // Remove expired entries
    this.cleanup()
    
    // If still too large, evict 25% of entries
    if (this.cache.size > this.maxEntries * 0.75) {
      this.evictLRU(Math.ceil(this.cache.size * 0.25))
    }
    
    const afterSize = this.cache.size
    const cleaned = beforeSize - afterSize
    
    // Only log if significant cleanup occurred
    if (cleaned > 10) {
      console.log(`Cache cleanup: ${beforeSize} → ${afterSize} entries (freed ${cleaned})`)
    }
  }

  private estimateSize(data: unknown): number {
    try {
      // Rough estimation of object size in bytes
      const jsonString = JSON.stringify(data)
      return jsonString.length * 2 // UTF-16 encoding approximation
    } catch {
      return 1024 // Default 1KB if can't serialize
    }
  }

  private getCurrentMemoryUsageMB(): number {
    let totalSize = 0
    for (const [, entry] of this.cache) {
      totalSize += entry.size
    }
    return totalSize / (1024 * 1024)
  }

  getStats(): CacheStats {
    const hitRate = this.stats.totalRequests > 0 
      ? (this.stats.totalHits / this.stats.totalRequests) * 100 
      : 0

    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      memoryUsageMB: this.getCurrentMemoryUsageMB(),
      hitRate,
      evictionCount: this.stats.evictionCount,
      totalRequests: this.stats.totalRequests,
      totalHits: this.stats.totalHits
    }
  }


  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval)
    }
    this.cache.clear()
    console.log('🗑️ Cache service destroyed and cleaned up')
  }
}

// Enhanced singleton cache instance
const advancedCache = new AdvancedMemoryCache()

/**
 * Enhanced cache service with advanced memory management
 */
export class AdvancedCacheService {
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
    
    let connection = await advancedCache.get<GraphCalendarConnection>(cacheKey)
    if (connection) {
      console.log(`🚀 Cache HIT: Calendar connection for client ${clientId}`)
      return connection
    }

    console.log(`💾 Cache MISS: Fetching calendar connection for client ${clientId}`)
    
    // Import here to avoid circular dependencies
    const { getCalendarConnectionByClientId } = await import('../calendar_functions/graphDatabase')
    connection = await getCalendarConnectionByClientId(clientId)
    
    if (connection) {
      await advancedCache.set(cacheKey, connection, this.TTL.CALENDAR_CONNECTION)
    }
    
    return connection
  }

  /**
   * Get cached client timezone or fetch from database
   */
  static async getClientTimezone(clientId: number): Promise<string | null> {
    const cacheKey = `timezone:${clientId}`
    
    let timezone = await advancedCache.get<string>(cacheKey)
    if (timezone) {
      console.log(`🚀 Cache HIT: Client timezone for client ${clientId}`)
      return timezone
    }

    console.log(`💾 Cache MISS: Fetching client timezone for client ${clientId}`)
    
    const { getClientTimezone } = await import('../calendar_functions/getClientTimeZone')
    timezone = await getClientTimezone(clientId)
    
    if (timezone) {
      await advancedCache.set(cacheKey, timezone, this.TTL.CLIENT_TIMEZONE)
    }
    
    return timezone
  }

  /**
   * Get comprehensive client calendar data in a single cached operation
   */
  static async getClientCalendarData(clientId: number): Promise<ClientCalendarData | null> {
    const cacheKey = `client-data:${clientId}`
    
    let clientData = await advancedCache.get<ClientCalendarData>(cacheKey)
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
        console.log(`Could not fetch agent data for client ${clientId}:`, error)
      }

      clientData = {
        connection,
        timezone,
        agentOfficeHours,
        agentTimezone,
        agentName
      }

      await advancedCache.set(cacheKey, clientData, this.TTL.CLIENT_CALENDAR_DATA)
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
    
    let busyPeriods = await advancedCache.get<Array<{ start: Date; end: Date }>>(cacheKey)
    if (busyPeriods) {
      console.log(`🚀 Cache HIT: Busy periods for ${connectionId} on ${date}`)
      return busyPeriods
    }

    console.log(`💾 Cache MISS: Fetching busy periods for ${connectionId} on ${date}`)
    
    busyPeriods = await fetcher()
    await advancedCache.set(cacheKey, busyPeriods, this.TTL.BUSY_PERIODS)
    
    return busyPeriods
  }

  /**
   * Invalidate busy periods cache for a connection
   * Should be called after creating, updating, or deleting events
   */
  static async invalidateBusyPeriodsCache(connectionId: string, date?: string): Promise<void> {
    if (date) {
      // Invalidate specific date
      const cacheKey = `busy-periods:${connectionId}:${date}`
      await advancedCache.delete(cacheKey)
      console.log(`🗑️ Cache INVALIDATED: Busy periods for ${connectionId} on ${date}`)
    } else {
      // Invalidate all dates for this connection
      await advancedCache.deletePattern(`busy-periods:${connectionId}:*`)
      console.log(`🗑️ Cache INVALIDATED: All busy periods for ${connectionId}`)
    }
  }

  /**
   * Cache Microsoft Graph API responses
   */
  static async getGraphEvents<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    ttl: number = this.TTL.GRAPH_EVENTS
  ): Promise<T> {
    let events = await advancedCache.get<T>(cacheKey)
    if (events) {
      console.log(`🚀 Cache HIT: Graph events ${cacheKey}`)
      return events
    }

    console.log(`💾 Cache MISS: Fetching Graph events ${cacheKey}`)
    
    events = await fetcher()
    await advancedCache.set(cacheKey, events, ttl)
    
    return events
  }

  /**
   * Invalidate all cache entries for a client
   */
  static async invalidateClient(clientId: number): Promise<void> {
    console.log(`🗑️ Invalidating cache for client ${clientId}`)
    
    await Promise.all([
      advancedCache.delete(`connection:${clientId}`),
      advancedCache.delete(`timezone:${clientId}`),
      advancedCache.delete(`client-data:${clientId}`),
      advancedCache.deletePattern(`busy-periods:*:${clientId}:*`)
    ])
  }

  /**
   * Invalidate calendar connection cache (e.g., after token refresh)
   */
  static async invalidateConnection(connectionId: string): Promise<void> {
    console.log(`🗑️ Invalidating cache for connection ${connectionId}`)
    
    await advancedCache.deletePattern(`busy-periods:${connectionId}:*`)
  }

  /**
   * Get basic cache statistics (for maintenance)
   */
  static getCacheStats(): CacheStats {
    return advancedCache.getStats()
  }

  /**
   * Force cleanup for memory pressure
   */
  static forceCleanup(): void {
    advancedCache['forceCleanup']()
  }

  /**
   * Clear all cache (for testing/debugging)
   */
  static async clearAll(): Promise<void> {
    advancedCache.destroy()
  }
}

export default AdvancedCacheService
