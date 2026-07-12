import { DurableObject } from "cloudflare:workers";

interface BudgetState {
  month: string; // "YYYY-MM"
  used: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export class RenderBudget extends DurableObject {
  async consume(cap: number): Promise<{ allowed: boolean; used: number }> {
    const stored = (await this.ctx.storage.get<BudgetState>("state")) ?? { month: currentMonth(), used: 0 };
    const month = currentMonth();
    const used = stored.month === month ? stored.used : 0;
    if (used >= cap) return { allowed: false, used };
    const next = used + 1;
    await this.ctx.storage.put("state", { month, used: next });
    return { allowed: true, used: next };
  }

  async fetch(): Promise<Response> {
    return new Response("use the consume() RPC", { status: 405 });
  }
}
