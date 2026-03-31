import { NextResponse } from 'next/server'
import { createClient } from '@/lib/helpers/server'

type FetchStats = {
  total: number
  supabase: number
  byPath: Record<string, number>
}

function createFetchCounter (input: { supabaseUrl: string }): {
  stats: FetchStats
  install: () => void
  uninstall: () => void
} {
  const stats: FetchStats = { total: 0, supabase: 0, byPath: {} }
  const originalFetch = globalThis.fetch

  function getUrlPathKey (url: string): string {
    try {
      const parsed = new URL(url)
      return parsed.pathname
    } catch {
      return url
    }
  }

  async function wrappedFetch (inputArg: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    stats.total += 1
    const url = typeof inputArg === 'string'
      ? inputArg
      : inputArg instanceof URL
        ? inputArg.toString()
        : inputArg.url

    if (url.startsWith(input.supabaseUrl)) {
      stats.supabase += 1
      const pathKey = getUrlPathKey(url)
      stats.byPath[pathKey] = (stats.byPath[pathKey] ?? 0) + 1
    }

    return originalFetch(inputArg as any, init)
  }

  return {
    stats,
    install: () => {
      globalThis.fetch = wrappedFetch as any
    },
    uninstall: () => {
      globalThis.fetch = originalFetch
    }
  }
}

async function legacyGetAgentWithCalendarByUUID (input: {
  agentId: string
  clientId: number
}): Promise<unknown> {
  const supabase = createClient()

  const { data: agent, error: agentError } = await supabase
    .schema('public')
    .from('agents')
    .select('uuid, client_id, name, title, description, is_dedicated, profile_id, assigned_email_id')
    .eq('uuid', input.agentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (agentError || !agent) return null
  if (agent.client_id !== input.clientId) return null

  const { data: profile } = agent.profile_id
    ? await supabase
        .schema('public')
        .from('profiles')
        .select('id, name, office_hours, timezone')
        .eq('id', agent.profile_id)
        .maybeSingle()
    : { data: null }

  const { data: assignment } = await supabase
    .schema('public')
    .from('agent_calendar_assignments')
    .select('id, agent_id, calendar_id')
    .eq('agent_id', input.agentId)
    .is('deleted_at', null)
    .maybeSingle()

  const { data: connection } = assignment?.calendar_id
    ? await supabase
        .schema('lead_dialer')
        .from('calendar_connections')
        .select('id, provider_name, email, display_name, is_connected, expires_at')
        .eq('id', assignment.calendar_id)
        .maybeSingle()
    : { data: null }

  return {
    ...agent,
    profiles: profile,
    calendar_assignment: assignment
      ? {
          ...assignment,
          calendar_connections: connection
        }
      : null
  }
}

async function optimizedNestedGetAgentWithCalendarByUUID (input: {
  agentId: string
  clientId: number
}): Promise<{ data: unknown | null, error: string | null }> {
  const supabase = createClient()

  const { data: agent, error } = await supabase
    .schema('public')
    .from('agents')
    .select(`
      uuid,
      client_id,
      name,
      description,
      title,
      is_dedicated,
      profile_id,
      assigned_email_id,
      agent_calendar_assignments (
        id,
        agent_id,
        calendar_id
      )
    `)
    .eq('uuid', input.agentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !agent) {
    return { data: null, error: error?.message ?? null }
  }
  if ((agent as any).client_id !== input.clientId) {
    return { data: null, error: 'CLIENT_MISMATCH' }
  }

  const profileId = (agent as any).profile_id as number | null | undefined
  const { data: profile } = profileId
    ? await supabase
        .schema('public')
        .from('profiles')
        .select('id, name, office_hours, timezone')
        .eq('id', profileId)
        .maybeSingle()
    : { data: null }

  const assignment = Array.isArray((agent as any).agent_calendar_assignments)
    ? (agent as any).agent_calendar_assignments[0]
    : null

  const calendarId = assignment?.calendar_id as string | undefined
  const { data: connection } = calendarId
    ? await supabase
        .schema('lead_dialer')
        .from('calendar_connections')
        .select('id, provider_name, email, display_name, is_connected, expires_at')
        .eq('id', calendarId)
        .maybeSingle()
    : { data: null }

  return { data: { ...agent, profiles: profile, calendar_connection: connection }, error: null }
}

async function legacyGetAgentsForClient (input: {
  clientId: number
  includeDedicated?: boolean
  withCalendarOnly?: boolean
}): Promise<unknown[]> {
  const supabase = createClient()

  let query = supabase
    .schema('public')
    .from('agents')
    .select('uuid, name, title, description, is_dedicated, profile_id')
    .eq('client_id', input.clientId)
    .is('deleted_at', null)

  if (input.includeDedicated === false) {
    query = query.eq('is_dedicated', false)
  }

  const { data: agents, error: agentsError } = await query
  if (agentsError || !agents) return []

  const profileIds = agents
    .map((a) => a.profile_id)
    .filter((id): id is number => id !== null && id !== undefined)

  const { data: profiles } = profileIds.length > 0
    ? await supabase
        .schema('public')
        .from('profiles')
        .select('id, name, timezone, office_hours')
        .in('id', profileIds)
    : { data: [] }

  const profilesMap = (profiles ?? []).reduce<Record<number, { id: number; name: string; timezone: string | null }>>((acc, p) => {
    acc[p.id] = { id: p.id, name: p.name, timezone: (p as any).timezone ?? null }
    return acc
  }, {})

  const { data: assignments } = await supabase
    .schema('public')
    .from('agent_calendar_assignments')
    .select('agent_id, calendar_id')
    .in('agent_id', agents.map((a) => a.uuid))
    .is('deleted_at', null)

  const calendarIds = (assignments ?? []).map((a) => a.calendar_id)

  const { data: connections } = calendarIds.length > 0
    ? await supabase
        .schema('lead_dialer')
        .from('calendar_connections')
        .select('id, provider_name, email, is_connected')
        .in('id', calendarIds)
    : { data: [] }

  const connectionMap = (connections ?? []).reduce<Record<string, { provider_name: string; email: string; is_connected: boolean | null }>>((acc, c) => {
    acc[c.id] = { provider_name: c.provider_name, email: c.email, is_connected: c.is_connected }
    return acc
  }, {})

  const mapped = agents.map((agent) => {
    const assignment = (assignments ?? []).find((a) => a.agent_id === agent.uuid)
    const connection = assignment ? connectionMap[assignment.calendar_id] : undefined
    const profile = agent.profile_id ? profilesMap[agent.profile_id] : undefined

    return {
      uuid: agent.uuid,
      name: agent.name,
      title: agent.title,
      description: agent.description,
      isDedicated: agent.is_dedicated,
      hasCalendar: Boolean(connection?.is_connected),
      calendarProvider: connection?.provider_name,
      calendarEmail: connection?.email,
      profileName: profile?.name,
      timezone: profile?.timezone ?? undefined
    }
  })

  if (input.withCalendarOnly) {
    return mapped.filter((a) => a.hasCalendar)
  }
  return mapped
}

async function optimizedNestedGetAgentsForClient (input: {
  clientId: number
  includeDedicated?: boolean
  withCalendarOnly?: boolean
}): Promise<{ data: unknown[], error: string | null }> {
  const supabase = createClient()

  let query = supabase
    .schema('public')
    .from('agents')
    .select(`
      uuid,
      name,
      title,
      description,
      is_dedicated,
      profile_id,
      agent_calendar_assignments (
        agent_id,
        calendar_id
      )
    `)
    .eq('client_id', input.clientId)
    .is('deleted_at', null)

  if (input.includeDedicated === false) {
    query = query.eq('is_dedicated', false)
  }

  const { data, error } = await query
  if (error || !data) return { data: [], error: error?.message ?? null }

  const profileIds = (data as any[])
    .map((a) => a.profile_id)
    .filter((id): id is number => typeof id === 'number')

  const { data: profiles } = profileIds.length > 0
    ? await supabase
        .schema('public')
        .from('profiles')
        .select('id, name, timezone')
        .in('id', profileIds)
    : { data: [] }

  const profilesMap = (profiles ?? []).reduce<Record<number, { id: number; name: string; timezone: string | null }>>((acc, p) => {
    acc[p.id] = { id: p.id, name: p.name, timezone: (p as any).timezone ?? null }
    return acc
  }, {})

  const calendarIds = (data as any[])
    .flatMap((a) => Array.isArray(a.agent_calendar_assignments) ? a.agent_calendar_assignments : [])
    .map((a) => a.calendar_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const { data: calendars } = calendarIds.length > 0
    ? await supabase
        .schema('lead_dialer')
        .from('calendar_connections')
        .select('id, provider_name, email, is_connected')
        .in('id', calendarIds)
    : { data: [] }

  const calendarMap = (calendars ?? []).reduce<Record<string, { provider_name: string; email: string; is_connected: boolean | null }>>((acc, c) => {
    acc[c.id] = { provider_name: c.provider_name, email: c.email, is_connected: c.is_connected }
    return acc
  }, {})

  const mapped = (data as any[]).map((agent) => {
    const assignment = Array.isArray(agent.agent_calendar_assignments) ? agent.agent_calendar_assignments[0] : null
    const connection = assignment?.calendar_id ? calendarMap[assignment.calendar_id] : undefined
    const profile = typeof agent.profile_id === 'number' ? profilesMap[agent.profile_id] : undefined
    return {
      uuid: agent.uuid,
      name: agent.name,
      title: agent.title,
      isDedicated: agent.is_dedicated,
      hasCalendar: Boolean(connection?.is_connected),
      calendarProvider: connection?.provider_name,
      calendarEmail: connection?.email,
      profileName: profile?.name,
      timezone: profile?.timezone ?? undefined
    }
  })

  if (input.withCalendarOnly) {
    return { data: mapped.filter((a) => a.hasCalendar), error: null }
  }

  return { data: mapped, error: null }
}

export async function GET (request: Request): Promise<Response> {
  const url = new URL(request.url)
  const clientIdRaw = url.searchParams.get('clientId')
  const agentId = url.searchParams.get('agentId')

  const clientId = clientIdRaw ? Number(clientIdRaw) : NaN
  if (!agentId || !clientIdRaw || Number.isNaN(clientId)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing required query params. Provide ?clientId=<number>&agentId=<uuid>',
        example: '/api/dev/measure?clientId=10000002&agentId=<uuid>'
      },
      { status: 400 }
    )
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_URL is not set' }, { status: 500 })
  }

  const counter = createFetchCounter({ supabaseUrl })
  const results: Record<string, unknown> = {}

  counter.install()
  try {
    const startLegacyAgent = Date.now()
    const legacyAgent = await legacyGetAgentWithCalendarByUUID({ agentId, clientId })
    const endLegacyAgent = Date.now()
    results.legacyGetAgentWithCalendarByUUID = {
      ms: endLegacyAgent - startLegacyAgent,
      fetch: { ...counter.stats },
      hasResult: Boolean(legacyAgent)
    }

    counter.stats.total = 0
    counter.stats.supabase = 0
    counter.stats.byPath = {}

    const startOptimizedAgent = Date.now()
    const optimizedAgent = await optimizedNestedGetAgentWithCalendarByUUID({ agentId, clientId })
    const endOptimizedAgent = Date.now()
    results.optimizedGetAgentWithCalendarByUUID = {
      ms: endOptimizedAgent - startOptimizedAgent,
      fetch: { ...counter.stats },
      hasResult: Boolean(optimizedAgent.data),
      error: optimizedAgent.error
    }

    counter.stats.total = 0
    counter.stats.supabase = 0
    counter.stats.byPath = {}

    const startLegacyList = Date.now()
    const legacyList = await legacyGetAgentsForClient({ clientId, includeDedicated: true, withCalendarOnly: false })
    const endLegacyList = Date.now()
    results.legacyGetAgentsForClient = {
      ms: endLegacyList - startLegacyList,
      fetch: { ...counter.stats },
      count: Array.isArray(legacyList) ? legacyList.length : 0
    }

    counter.stats.total = 0
    counter.stats.supabase = 0
    counter.stats.byPath = {}

    const startOptimizedList = Date.now()
    const optimizedList = await optimizedNestedGetAgentsForClient({ clientId, includeDedicated: true, withCalendarOnly: false })
    const endOptimizedList = Date.now()
    results.optimizedGetAgentsForClient = {
      ms: endOptimizedList - startOptimizedList,
      fetch: { ...counter.stats },
      count: Array.isArray(optimizedList.data) ? optimizedList.data.length : 0,
      error: optimizedList.error
    }
  } finally {
    counter.uninstall()
  }

  return NextResponse.json({ ok: true, input: { clientId, agentId }, results })
}

