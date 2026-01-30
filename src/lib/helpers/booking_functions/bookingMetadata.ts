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

  // Prefer stage/deal context when available
  if (stageName || dealId || dealSummary) {
    const parts: string[] = [];
    if (stageName) parts.push(stageName);
    if (dealSummary) parts.push(dealSummary);
    else if (dealId) parts.push(`Deal #${dealId}`);
    parts.push(customerDisplayName);
    return parts.join(" - ");
  }

  return fallbackSubject || customerDisplayName || "Appointment";
}


