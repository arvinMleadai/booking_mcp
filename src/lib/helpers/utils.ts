import 'server-only'
import { createClient } from "@/lib/helpers/server";
import Fuse from "fuse.js";
import { DateTime } from "luxon";
import type { AgentWithCalendar } from "@/types";

// Create a single Supabase client instance to reuse across all functions
const supabase = createClient();

/**
 * Search for a customer by name using fuzzy search in the customer database
 * Used for booking appointments when customer name is provided
 */
export const getCustomerWithFuzzySearch = async (
  name: string,
  clientId: string
) => {

  // TODO: replace created_by with client_id
  const { data: customers } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, phone_number, email, pipeline_stage_id, company")
    .eq("created_by", clientId);

  const fuse = new Fuse(customers || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.5, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(name);
};

/**
 * Search for a contact by name using fuzzy search in the contacts table
 * Used for booking appointments when contact is not in customer database
 */
export const getContactWithFuzzySearch = async (
  name: string,
  clientId: string
) => {
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, name, first_name, middle_name, last_name, phone_number, email, company")
    .eq("client_id", clientId)
    .is("deleted_at", null);

  if (error) {
    console.error("Error fetching contacts:", error);
    return [];
  }

  const fuse = new Fuse(contacts || [], {
    keys: [
      "name", // Main name field
      "first_name",
      "last_name",
    ],
    threshold: 0.4, // Slightly stricter than customer search (0 = exact, 1 = very fuzzy)
  });
  
  return fuse.search(name);
};

/**
 * Get agent assigned to a calendar connection
 */
export const getAgentByCalendarConnection = async (
  calendarConnectionId: string,
) => {
  const { data: assignment, error } = await supabase
    .schema("public")
    .from("agent_calendar_assignments")
    .select(
      `
      agent_id,
      calendar_id,
      agents!agent_id (
        uuid,
        name,
        profile_id,
        client_id
      )
    `
    )
    .eq("calendar_id", calendarConnectionId)
    .is("deleted_at", null)
    .single();

  if (error) {
    // PGRST116 = no rows found - expected when calendar isn't assigned to an agent yet
    if (error.code !== 'PGRST116') {
      console.error("Error getting agent by calendar connection:", error);
    }
    return null;
  }

  // Fetch profile separately since there's no foreign key relationship
  if (assignment?.agents && (assignment.agents as any).profile_id) {
    const agent = assignment.agents as any;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, office_hours, timezone")
      .eq("id", agent.profile_id)
      .single();
    
    if (!profileError && profile) {
      (agent as any).profiles = profile;
    }
  }

  return assignment;
};

/**
 * Check if a time slot is within office hours
 * Properly handles timezone conversion - if datetime has no timezone, treats it as agent's timezone
 */
export const isWithinOfficeHours = (
  dateTime: string,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string = "Australia/Melbourne"
): { isWithin: boolean; reason?: string } => {
  if (!officeHours) {
    return { isWithin: true }; // No office hours restriction
  }

  try {
    // Parse the datetime string
    // If it has no timezone indicator (no 'Z' or '+/-'), treat it as being in the agent's timezone
    let dt: DateTime;
    
    if (dateTime.includes('Z') || dateTime.includes('+') || dateTime.includes('-', 10)) {
      // Has timezone info, parse as-is
      dt = DateTime.fromISO(dateTime);
    } else {
      // No timezone info - treat as agent's local time
      // Parse as if it's in the agent's timezone
      dt = DateTime.fromISO(dateTime, { zone: timezone });
    }
    
    // If parsing failed, fall back to Date constructor
    if (!dt.isValid) {
      console.warn(`⚠️ Failed to parse datetime with Luxon: ${dateTime}, falling back to Date`);
      const date = new Date(dateTime);
      dt = DateTime.fromJSDate(date, { zone: timezone });
    }
    
    // Convert to agent's timezone if not already
    const dtInTimezone = dt.setZone(timezone);
    
    // Get day of week in lowercase (monday, tuesday, etc.)
    const dayOfWeek = dtInTimezone.toFormat('cccc').toLowerCase();
    
    // Get time string in HH:mm format
    const timeString = dtInTimezone.toFormat('HH:mm');
    
    console.log(`🔍 Office hours check: ${dateTime} → ${dtInTimezone.toISO()} (${timezone}) = ${dayOfWeek} ${timeString}`);

    // Convert office hours format - assuming it's like:
    // { "monday": { "start": "09:00", "end": "17:00", "enabled": true }, ... }
    const daySchedule = officeHours[dayOfWeek];

    if (!daySchedule || !daySchedule.enabled) {
      return {
        isWithin: false,
        reason: `Agent is not available on ${dayOfWeek}s`,
      };
    }

    const startTime = daySchedule.start;
    const endTime = daySchedule.end;

    if (timeString < startTime || timeString > endTime) {
      return {
        isWithin: false,
        reason: `Time ${timeString} is outside office hours (${startTime} - ${endTime}) on ${dayOfWeek}s`,
      };
    }

    return { isWithin: true };
  } catch (error) {
    console.error("Error checking office hours:", error);
    return { isWithin: true }; // Default to allowing if there's an error
  }
};

/**
 * Get agent by UUID with calendar assignment and connection details
 * Used for booking operations where we need full agent + calendar info
 */
export const getAgentWithCalendarByUUID = async (
  agentUUID: string,
  clientId: number
): Promise<AgentWithCalendar | null> => {
  try {
    type AgentRow = {
      uuid: string
      client_id: number
      name: string
      description: string | null
      title: string
      is_dedicated: boolean
      profile_id: number | null
      assigned_email_id: number | null
      agent_calendar_assignments?: Array<{
        id: number
        agent_id: string
        calendar_id: string
        calendar_connections?: {
          id: string
          provider_name: string
          email: string
          display_name: string
          is_connected: boolean | null
          expires_at: string
        } | null
      }> | null
    }

    const { data: agent, error: agentError } = await supabase
      .schema("public")
      .from("agents")
      .select(
        `
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
      `
      )
      .eq("uuid", agentUUID)
      .is("deleted_at", null)
      .single();

    if (agentError || !agent) {
      console.error("Agent not found:", agentError);
      return null;
    }

    const agentRow = agent as unknown as AgentRow
    if (agentRow.client_id !== clientId) {
      console.error(`Agent ${agentUUID} belongs to client ${agentRow.client_id}, not ${clientId}`);
      return null;
    }

    const profileData: { id: number; name: string; office_hours: unknown; timezone: string | null } | undefined =
      agentRow.profile_id
        ? (await supabase
            .schema('public')
            .from('profiles')
            .select('id, name, office_hours, timezone')
            .eq('id', agentRow.profile_id)
            .maybeSingle()).data ?? undefined
        : undefined

    const assignment = Array.isArray(agentRow.agent_calendar_assignments)
      ? agentRow.agent_calendar_assignments.find((a) => a && typeof a.calendar_id === 'string') ?? null
      : null
    const { data: calendarConnection } = assignment?.calendar_id
      ? await supabase
          .schema('lead_dialer')
          .from('calendar_connections')
          .select('id, provider_name, email, display_name, is_connected, expires_at')
          .eq('id', assignment.calendar_id)
          .maybeSingle()
      : { data: null }

    return {
      ...agentRow,
      profiles: profileData,
      calendar_assignment: assignment
        ? {
            id: assignment.id,
            agent_id: assignment.agent_id,
            calendar_id: assignment.calendar_id,
            calendar_connections: calendarConnection,
          }
        : null,
    } as unknown as AgentWithCalendar;
  } catch (error) {
    console.error("Error fetching agent with calendar:", error);
    return null;
  }
};

/**
 * Get all agents for a client with optional filters
 */
export const getAgentsForClient = async (
  clientId: number,
  options: {
    includeDedicated?: boolean;
    withCalendarOnly?: boolean;
  } = {}
) => {
  try {
    type AgentListRow = {
      uuid: string
      name: string
      title: string
      description: string | null
      is_dedicated: boolean
      profile_id: number | null
      agent_calendar_assignments?: Array<{
        calendar_id: string
        calendar_connections?: { id: string; provider_name: string; email: string; is_connected: boolean | null } | null
      }> | null
    }

    let query = supabase
      .schema("public")
      .from("agents")
      .select(
        `
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
      `
      )
      .eq("client_id", clientId)
      .is("deleted_at", null);

    // Filter by dedicated status if specified
    if (options.includeDedicated === false) {
      query = query.eq("is_dedicated", false);
    }

    const { data: agents, error: agentsError } = await query;

    if (agentsError || !agents) {
      console.error("Error fetching agents:", agentsError);
      return [];
    }

    const profileIds = (agents as unknown as AgentListRow[])
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
      acc[p.id] = { id: p.id, name: p.name, timezone: (p as unknown as { timezone: string | null }).timezone ?? null }
      return acc
    }, {})

    const calendarIds = (agents as unknown as AgentListRow[])
      .flatMap((agent) => Array.isArray(agent.agent_calendar_assignments) ? agent.agent_calendar_assignments : [])
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

    const agentsWithCalendar = (agents as unknown as AgentListRow[]).map((agent) => {
      const assignment = Array.isArray(agent.agent_calendar_assignments)
        ? agent.agent_calendar_assignments.find((a) => a && typeof a.calendar_id === 'string') ?? null
        : null
      const calendarConnection = assignment?.calendar_id ? calendarMap[assignment.calendar_id] : undefined
      const profile = agent.profile_id ? profilesMap[agent.profile_id] : undefined

      return {
        uuid: agent.uuid,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        isDedicated: agent.is_dedicated,
        hasCalendar: Boolean(calendarConnection?.is_connected),
        calendarProvider: calendarConnection?.provider_name as 'microsoft' | 'google' | undefined,
        calendarEmail: calendarConnection?.email,
        profileName: profile?.name,
        timezone: profile?.timezone ?? undefined,
      }
    })

    // Filter by calendar availability if specified
    if (options.withCalendarOnly) {
      return agentsWithCalendar.filter((a) => a.hasCalendar);
    }

    return agentsWithCalendar;
  } catch (error) {
    console.error("Error fetching agents for client:", error);
    return [];
  }
};

/**
 * Validate agent has a connected calendar
 * Optimized: Uses agentId directly since UUID is unique, then validates clientId for security
 */
export const validateAgentHasCalendar = async (
  agentUUID: string,
  clientId: number,
  calendarConnectionId?: string
): Promise<{
  isValid: boolean;
  error?: string;
  calendarId?: string;
  calendarProvider?: "microsoft" | "google";
}> => {
  // Get agent directly by UUID (more efficient than filtering by client_id first)
  const agent = await getAgentWithCalendarByUUID(agentUUID, clientId);

  if (!agent) {
    return {
      isValid: false,
      error: `Agent with UUID ${agentUUID} not found or doesn't belong to client ${clientId}`,
    };
  }

  // Priority 1: Explicit calendar connection override (board/pipeline calendar)
  // If calendarConnectionId is provided, ONLY use that - don't fall back to agent's calendar
  if (calendarConnectionId) {
    console.log(`🎯 Board calendar specified (${calendarConnectionId}), checking connection...`);
    const { getCalendarConnectionById } = await import(
      "./booking_functions/calendar/graphDatabase"
    );
    const connection = await getCalendarConnectionById(
      calendarConnectionId,
      clientId
    );

    if (!connection) {
      return {
        isValid: false,
        error: `Board calendar ${calendarConnectionId} not found for client ${clientId}`,
      };
    }

    if (!connection.is_connected) {
      return {
        isValid: false,
        error: `Board calendar is disconnected. Please reconnect the calendar (${connection.email || calendarConnectionId})`,
      };
    }

    console.log(`✅ Using board calendar: ${connection.email}`);
    return {
      isValid: true,
      calendarProvider: connection.provider_name as "microsoft" | "google",
    };
  }

  // Priority 2: Agent-specific calendar assignment (only if no board calendar specified)
  console.log(`📋 No board calendar specified, checking agent's assigned calendar...`);
  const agentCalendarConnection = agent.calendar_assignment?.calendar_connections as
    | { id: string; provider_name: string; is_connected: boolean | null }
    | null
    | undefined;

  if (agentCalendarConnection?.is_connected) {
    console.log(`✅ Using agent's assigned calendar`);
    return {
      isValid: true,
      calendarId: agentCalendarConnection.id,
      calendarProvider: agentCalendarConnection.provider_name as
        | "microsoft"
        | "google",
    };
  }

  // No usable calendar found
  if (!agent.calendar_assignment) {
    return {
      isValid: false,
      error: `Agent "${agent.name}" does not have a calendar assigned, and no pipeline/calendar override was provided.`,
    };
  }

  return {
    isValid: false,
    error: `Agent "${agent.name}" has a calendar assigned but it is not connected. Please reconnect the calendar.`,
  };
};
