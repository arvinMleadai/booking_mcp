import { createClient } from "@/lib/helpers/server";

export type PipelineInfo = {
  id: string;
  name: string;
  client_id: number;
  calendar_id: string | null;
};

export type PipelineStageInfo = {
  id: string;
  pipeline_id: string;
  name: string;
};

export type StageItemInfo = {
  id: number;
  pipeline_stage_id: string;
  party_id: number;
  summary: string | null;
};

export async function getPipelineById(
  pipelineId: string,
  clientId: number
): Promise<PipelineInfo | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("public")
    .from("pipelines")
    .select("id, name, client_id, calendar_id")
    .eq("id", pipelineId)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PipelineInfo;
}

export async function getPipelineStageById(
  stageId: string
): Promise<PipelineStageInfo | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("public")
    .from("pipeline_stages")
    .select("id, pipeline_id, name")
    .eq("id", stageId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PipelineStageInfo;
}

export async function getStageItemById(
  stageItemId: number
): Promise<StageItemInfo | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .schema("public")
    .from("stage_items")
    .select("id, pipeline_stage_id, party_id, summary")
    .eq("id", stageItemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as StageItemInfo;
}

export function buildBookingSubject(params: {
  customerDisplayName: string;
  stageName?: string | null;
  dealId?: number;
  dealSummary?: string | null;
  fallbackSubject?: string;
}): string {
  const { customerDisplayName, stageName, dealId, dealSummary, fallbackSubject } =
    params;

  // Priority 1: Use stage name as the primary subject (most important)
  if (stageName) {
    return stageName;
  }

  // Priority 2: Use deal summary if available (but no stage name)
  if (dealSummary) {
    try {
      // Try to parse JSON summary to get header
      const summaryObj = typeof dealSummary === 'string' ? JSON.parse(dealSummary) : dealSummary;
      if (summaryObj?.header) {
        return summaryObj.header;
      }
    } catch {
      // If not JSON, use as-is
    }
    return dealSummary;
  }

  // Priority 3: Use deal ID if available
  if (dealId) {
    return `Deal #${dealId}`;
  }

  // Priority 4: Use explicit subject from request
  if (fallbackSubject) {
    return fallbackSubject;
  }

  // Priority 5: Fallback to customer name or generic
  return customerDisplayName || "Appointment";
}

/**
 * Customer/Contact info from party_id lookup
 */
export type PartyContactInfo = {
  type: "customer" | "contact";
  id: number;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
};

/**
 * Get customer or contact information from party_id
 * 
 * Flow: party_id → parties.id → parties.contacts_id → contacts.id → contact info
 * 
 * The parties table links to contacts via contacts_id foreign key.
 * We need to first look up the party to get contacts_id, then fetch the contact.
 */
export async function getPartyContactInfo(
  partyId: number,
  clientId: number
): Promise<PartyContactInfo | null> {
  const supabase = createClient();

  console.log(`🔍 [getPartyContactInfo] Looking up party_id: ${partyId} for client: ${clientId}`);

  // Step 1: Look up the party to get contacts_id
  const { data: party, error: partyError } = await supabase
    .schema("public")
    .from("parties")
    .select("id, contacts_id, role_id")
    .eq("id", partyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (partyError) {
    console.error(`❌ [getPartyContactInfo] Error fetching party ${partyId}:`, partyError);
    return null;
  }

  if (!party) {
    console.warn(`⚠️ [getPartyContactInfo] Party ${partyId} not found or deleted`);
    return null;
  }

  if (!party.contacts_id) {
    console.warn(`⚠️ [getPartyContactInfo] Party ${partyId} has no contacts_id`);
    return null;
  }

  console.log(`✅ [getPartyContactInfo] Found party ${partyId} with contacts_id: ${party.contacts_id}`);

  // Step 2: Look up the contact using contacts_id
  const { data: contact, error: contactError } = await supabase
    .schema("public")
    .from("contacts")
    .select("id, name, first_name, last_name, email, phone_number, company, client_id")
    .eq("id", party.contacts_id)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .maybeSingle();

  if (contactError) {
    console.error(`❌ [getPartyContactInfo] Error fetching contact ${party.contacts_id}:`, contactError);
    return null;
  }

  if (!contact) {
    console.warn(`⚠️ [getPartyContactInfo] Contact ${party.contacts_id} not found, deleted, or doesn't belong to client ${clientId}`);
    return null;
  }

  const name =
    contact.name ||
    `${contact.first_name || ""} ${contact.last_name || ""}`.trim() ||
    "Unknown";

  console.log(`✅ [getPartyContactInfo] Found contact ${party.contacts_id}:`, {
    name,
    email: contact.email || "(no email)",
    phone: contact.phone_number || "(no phone)",
    company: contact.company || "(no company)",
  });

  return {
    type: "contact",
    id: contact.id,
    name,
    email: contact.email || undefined,
    phone: contact.phone_number || undefined,
    company: contact.company || undefined,
  };
}


