/**
 * Placeholder de preço de plano — billing real (Stripe) é item de V1
 * (§12 do PRD, "backlog"). Até lá, o custo do plano é fixo por `plan_id`
 * só para permitir calcular o ROI mostrado no dashboard (§1.6 item 12).
 */
const PLAN_PRICE_CENTS: Record<string, number> = {
  trial: 0,
  basic: 9700,
  pro: 19700,
};

export function getPlanCostCents(planId: string): number {
  return PLAN_PRICE_CENTS[planId] ?? 0;
}
