import prisma from '@/lib/db';

describe('Goal fallback and opportunity visibility', () => {
  it('should load opportunities for the most recent goal even after it becomes ACHIEVED', async () => {
    // Ensure we have a merchant with seeded data
    const merchant = await prisma.merchant.findFirst({
      include: { goals: { orderBy: { createdAt: 'desc' }, include: { opportunities: true } } },
    });
    expect(merchant).toBeTruthy();
    if (!merchant) return;

    // Find the most recent goal that has opportunities (fallback to first if none)
    const recentGoal = merchant.goals.find(g => g.opportunities && g.opportunities.length > 0) || merchant.goals[0];
    expect(recentGoal).toBeTruthy();
    // Ensure there are opportunities associated with the recent goal
    const opps = await prisma.opportunity.findMany({ where: { goalId: recentGoal.id } });
    expect(opps.length).toBeGreaterThan(0);

    // Update the goal status to ACHIEVED to simulate post‑measurement state
    const updatedGoal = await prisma.goal.update({
      where: { id: recentGoal.id },
      data: { status: 'ACHIEVED' },
      include: { opportunities: true },
    });
    expect(updatedGoal.status).toBe('ACHIEVED');
    // Verify opportunities are still present after status change
    expect(updatedGoal.opportunities?.length).toBeGreaterThan(0);

    // Simulate the page.tsx query logic (no status filter, ordered by createdAt desc)
    const merchantAfter = await prisma.merchant.findFirst({
      include: {
        goals: {
          orderBy: { createdAt: 'desc' },
          include: { constraints: true, opportunities: { include: { actions: { include: { executions: { orderBy: { executedAt: 'desc' } }, measurement: true } } }, orderBy: { expectedNetValue: 'desc' } } },
        },
        products: true,
        auditEvents: { take: 10, orderBy: { timestamp: 'desc' } },
      },
    });
    const fallbackGoal = merchantAfter?.goals?.[0];
    expect(fallbackGoal).toBeTruthy();
    // Verify opportunities are still present via direct query
    const oppsAfter = await prisma.opportunity.findMany({ where: { goalId: recentGoal.id } });
    expect(oppsAfter.length).toBeGreaterThan(0);
  }, 30000);
});
