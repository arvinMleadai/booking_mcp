import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import { DateTime } from "luxon";
import type { AgentWithCalendar } from "@/types";

// Create a single Supabase client instance to reuse across all functions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
    // Get agent by UUID (UUID is unique, so no need to filter by client_id in query)
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
        assigned_email_id
      `
      )
      .eq("uuid", agentUUID)
      .is("deleted_at", null)
      .single();

    if (agentError || !agent) {
      console.error("Agent not found:", agentError);
      return null;
    }

    // Validate client_id matches for security (but don't use it in query since UUID is unique)
    if (agent.client_id !== clientId) {
      console.error(`Agent ${agentUUID} belongs to client ${agent.client_id}, not ${clientId}`);
      return null;
    }

    // Fetch profile separately since there's no foreign key relationship
    let profileData: { id: number; name: string; office_hours: any; timezone: string } | undefined;
    if (agent.profile_id) {
      const { data: profile, error: profileError } = await supabase
       .schema("public")
        .from("profiles")
        .select("id, name, office_hours, timezone")
        .eq("id", agent.profile_id)
        .single();
      
      if (!profileError && profile) {
        profileData = profile;
        console.log(`✅ Fetched profile for agent ${agent.name}:`, profile.name);
      } else if (profileError) {
        console.warn(`⚠️ Profile not found for profile_id: ${agent.profile_id}`, profileError);
      }
    }

    // Get calendar assignment for this agent
    const { data: assignment, error: assignmentError } = await supabase
      .schema("public")
      .from("agent_calendar_assignments")
      .select("id, agent_id, calendar_id")
      .eq("agent_id", agentUUID)
      .is("deleted_at", null)
      .single();

    if (assignmentError) {
      console.warn("No calendar assignment found for agent:", agentUUID);
      return {
        ...agent,
        profiles: profileData,
        calendar_assignment: null,
      } as unknown as AgentWithCalendar;
    }

    // Get calendar connection from lead_dialer schema with full token details
    const { data: calendarConnection, error: calendarError } = await supabase
      .schema("lead_dialer")
      .from("calendar_connections")
      .select("id, client_id, provider_id, provider_name, email, display_name, is_connected, access_token, refresh_token, expires_at")
      .eq("id", assignment.calendar_id)
      .single();

    if (calendarError) {
      console.warn("Calendar connection not found:", calendarError);
      return {
        ...agent,
        profiles: profileData,
        calendar_assignment: {
          ...assignment,
          calendar_connections: null,
        },
      } as unknown as AgentWithCalendar;
    }

    // Validate token provider matches calendar provider
    if (calendarConnection.access_token) {
      const tokenParts = calendarConnection.access_token.split('.');
      const isGoogleToken = calendarConnection.access_token.startsWith('ya29.') || calendarConnection.access_token.startsWith('1//');
      
      if (calendarConnection.provider_name === 'microsoft' && isGoogleToken) {
        console.error(`❌ TOKEN PROVIDER MISMATCH for agent ${agentUUID}: Calendar is Microsoft but token is Google`);
        console.error(`Token preview: ${calendarConnection.access_token.substring(0, 50)}...`);
        return {
          ...agent,
          profiles: profileData,
          calendar_assignment: {
            ...assignment,
            calendar_connections: null,
          },
        } as unknown as AgentWithCalendar;
      }
      
      if (calendarConnection.provider_name === 'google' && !isGoogleToken) {
        console.error(`❌ TOKEN PROVIDER MISMATCH for agent ${agentUUID}: Calendar is Google but token is Microsoft`);
        return {
          ...agent,
          profiles: profileData,
          calendar_assignment: {
            ...assignment,
            calendar_connections: null,
          },
        } as unknown as AgentWithCalendar;
      }
    }

    return {
      ...agent,
      profiles: profileData,
      calendar_assignment: {
        ...assignment,
        calendar_connections: calendarConnection,
      },
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
        profile_id
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

    // Fetch profiles separately for all agents that have profile_id
    const profileIds = agents
      .map((a) => a.profile_id)
      .filter((id): id is number => id !== null && id !== undefined);
    
    let profilesMap: Record<number, { id: number; name: string; timezone?: string; office_hours?: any }> = {};
    
    if (profileIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .schema("public")
        .from("profiles")
        .select("id, name, timezone, office_hours")
        .in("id", profileIds);
      
      if (!profilesError && profiles) {
        profilesMap = profiles.reduce((acc, profile) => {
          acc[profile.id] = profile;
          return acc;
        }, {} as Record<number, typeof profiles[0]>);
      } else if (profilesError) {
        console.warn("Error fetching profiles:", profilesError);
      }
    }

    // Get calendar assignments for all agents
    const { data: assignments, error: assignmentsError } = await supabase
      .schema("public")
      .from("agent_calendar_assignments")
      .select("agent_id, calendar_id")
      .in(
        "agent_id",
        agents.map((a) => a.uuid)
      )
      .is("deleted_at", null);

    if (assignmentsError) {
      console.warn("Error fetching calendar assignments:", assignmentsError);
    }

    // Get calendar connections separately (they're in lead_dialer schema)
    let calendarConnections: Array<{
      id: string;
      provider_name: string;
      email: string;
      is_connected: boolean;
    }> = [];

    if (assignments && assignments.length > 0) {
      const calendarIds = assignments.map((a) => a.calendar_id);
      const { data: calendars, error: calendarsError } = await supabase
        .schema("lead_dialer")
        .from("calendar_connections")
        .select("id, provider_name, email, is_connected")
        .in("id", calendarIds);

      if (calendarsError) {
        console.warn("Error fetching calendar connections:", calendarsError);
      } else {
        calendarConnections = calendars || [];
      }
    }

    // Map agents with calendar info and profiles
    const agentsWithCalendar = agents.map((agent) => {
      const assignment = assignments?.find((a) => a.agent_id === agent.uuid);
      const calendarConnection = assignment
        ? calendarConnections.find((c) => c.id === assignment.calendar_id)
        : undefined;
      
      // Get profile data from the profiles map
      const profile = agent.profile_id ? profilesMap[agent.profile_id] : undefined;

      return {
        uuid: agent.uuid,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        isDedicated: agent.is_dedicated,
        hasCalendar: !!assignment && !!calendarConnection?.is_connected,
        calendarProvider: calendarConnection?.provider_name as
          | "microsoft"
          | "google"
          | undefined,
        calendarEmail: calendarConnection?.email,
        profileName: profile?.name,
        timezone: profile?.timezone,
      };
    });

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

  // First choice: explicit calendar connection override (e.g., pipeline/board calendar)
  if (calendarConnectionId) {
    const { getCalendarConnectionById } = await import(
      "./calendar_functions/graphDatabase"
    );
    const connection = await getCalendarConnectionById(
      calendarConnectionId,
      clientId
    );

    if (connection?.is_connected) {
      return {
        isValid: true,
        calendarProvider: connection.provider_name as "microsoft" | "google",
      };
    }
  }

  // Fallback: agent-specific calendar assignment (if connected)
  const agentCalendarConnection = agent.calendar_assignment
    ?.calendar_connections as unknown as
    | {
        id: string;
        provider_name: string;
        is_connected: boolean;
      }
    | undefined;

  if (agentCalendarConnection?.is_connected) {
    return {
      isValid: true,
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
