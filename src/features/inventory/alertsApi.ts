import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// INV-06: alertas materializadas (stock_low, expiry_soon, order_late,
// credit_overdue). Lectura filtrada por RLS; marcar leída solo por RPC.

export interface AlertRow {
  id: number;
  type: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

export const ALERT_LABELS: Record<string, string> = {
  stock_low: "Stock bajo",
  expiry_soon: "Próximo a vencer",
  order_late: "Pedido atrasado",
  credit_overdue: "Fiado vencido",
};

export async function fetchOpenAlerts(): Promise<LoadResult<AlertRow[]>> {
  const { data, error } = await supabase
    .from("alerts")
    .select("id,type,message,created_at,read_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  return { data: (data ?? []) as AlertRow[], error };
}

export async function markAlertRead(alertId: number): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("mark_alert_read", { p_alert: alertId });
  return { error };
}
