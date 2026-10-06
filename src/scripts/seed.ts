import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding synthetic test data for Revenue Lift...');

  // Clean existing synthetic records
  await prisma.auditEvent.deleteMany();
  await prisma.measurement.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.campaignAction.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.constraint.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.merchant.deleteMany();

  // 1. Create Synthetic Merchant Tenant
  const merchant = await prisma.merchant.create({
    data: {
      name: 'ShopNova Electronics & Lifestyle [SYNTHETIC DEMO]',
      email: 'merchant-demo@shopnova.in',
      currency: 'INR',
      baseMarginPct: 32.0, // Base gross margin 32%
      isSynthetic: true,
      razorpayKeyId: 'rzp_test_SYNTHETIC_DEMO_KEY',
      razorpayKeySecret: 'SYNTHETIC_DEMO_SECRET',
    },
  });

  console.log(`✅ Created Merchant: ${merchant.name} (${merchant.id})`);

  // 2. Create Synthetic Catalog Products (with explicit Cost Price for Margin Computation)
  const products = await Promise.all([
    prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'AeroBeat Pro Wireless Earbuds [SYNTHETIC]',
        sku: 'EAR-AERO-01',
        category: 'Audio',
        costPrice: 900,     // ₹900 cost
        sellingPrice: 1499, // ₹1,499 retail -> ~39.9% margin
        inventory: 120,
        isSynthetic: true,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'Veloce Titan Smartwatch [SYNTHETIC]',
        sku: 'WATCH-VEL-02',
        category: 'Wearables',
        costPrice: 1950,    // ₹1,950 cost
        sellingPrice: 2999, // ₹2,999 retail -> ~35% margin
        inventory: 45,
        isSynthetic: true,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'HyperCharge 65W GaN Charger [SYNTHETIC]',
        sku: 'PWR-GAN-03',
        category: 'Accessories',
        costPrice: 650,     // ₹650 cost
        sellingPrice: 1199, // ₹1,199 retail -> ~45.7% margin
        inventory: 80,
        isSynthetic: true,
      },
    }),
    prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: 'EcoSound Bamboo Desk Speaker [SYNTHETIC]',
        sku: 'SPK-ECO-04',
        category: 'Audio',
        costPrice: 1800,    // ₹1,800 cost
        sellingPrice: 2299, // ₹2,299 retail -> ~21.7% base margin (tight margin product)
        inventory: 30,
        isSynthetic: true,
      },
    }),
  ]);

  console.log(`✅ Seeded ${products.length} Products with cost/selling economics`);

  // 3. Create Synthetic Customer Profiles
  const customersData = [
    // Segment: FAILED_CHECKOUT (Failed payment in last 48h)
    { name: 'Aarav Sharma [SYNTHETIC]', email: 'aarav.sharma.demo@example.com', phone: '+91 9820198201', segment: 'FAILED_CHECKOUT', totalSpend: 4500, orderCount: 2 },
    { name: 'Priya Iyer [SYNTHETIC]', email: 'priya.iyer.demo@example.com', phone: '+91 9820298202', segment: 'FAILED_CHECKOUT', totalSpend: 2999, orderCount: 1 },
    { name: 'Rohan Gupta [SYNTHETIC]', email: 'rohan.gupta.demo@example.com', phone: '+91 9820398203', segment: 'FAILED_CHECKOUT', totalSpend: 8999, orderCount: 4 },
    { name: 'Ananya Verma [SYNTHETIC]', email: 'ananya.verma.demo@example.com', phone: '+91 9820498204', segment: 'FAILED_CHECKOUT', totalSpend: 1499, orderCount: 1 },
    
    // Segment: DORMANT_HIGH_LTV (High historical spend, inactive 60-90 days)
    { name: 'Vikram Malhotra [SYNTHETIC]', email: 'vikram.m.demo@example.com', phone: '+91 9820598205', segment: 'DORMANT_HIGH_LTV', totalSpend: 18500, orderCount: 7, lastActiveAt: new Date(Date.now() - 75 * 86400000) },
    { name: 'Sneha Patel [SYNTHETIC]', email: 'sneha.p.demo@example.com', phone: '+91 9820698206', segment: 'DORMANT_HIGH_LTV', totalSpend: 14200, orderCount: 5, lastActiveAt: new Date(Date.now() - 65 * 86400000) },
    { name: 'Karan Mehra [SYNTHETIC]', email: 'karan.m.demo@example.com', phone: '+91 9820798207', segment: 'DORMANT_HIGH_LTV', totalSpend: 22000, orderCount: 9, lastActiveAt: new Date(Date.now() - 80 * 86400000) },
    { name: 'Divya Nair [SYNTHETIC]', email: 'divya.n.demo@example.com', phone: '+91 9820898208', segment: 'DORMANT_HIGH_LTV', totalSpend: 12500, orderCount: 4, lastActiveAt: new Date(Date.now() - 70 * 86400000) },

    // Segment: PRICE_SENSITIVE (Discount responsive)
    { name: 'Amitabh Sen [SYNTHETIC]', email: 'amitabh.s.demo@example.com', phone: '+91 9820998209', segment: 'PRICE_SENSITIVE', totalSpend: 3100, orderCount: 2 },
    { name: 'Neha Joshi [SYNTHETIC]', email: 'neha.j.demo@example.com', phone: '+91 9821098210', segment: 'PRICE_SENSITIVE', totalSpend: 2400, orderCount: 2 },
  ];

  const customers = [];
  for (const c of customersData) {
    const customer = await prisma.customer.create({
      data: {
        ...c,
        isSynthetic: true,
      },
    });
    customers.push(customer);
  }

  console.log(`✅ Seeded ${customers.length} synthetic customer records across segments`);

  // 4. Create Recent Failed Orders & Payments (for Failed Payment Recovery simulation)
  const failedCustomer1 = customers[0];
  const order1 = await prisma.order.create({
    data: {
      merchantId: merchant.id,
      customerId: failedCustomer1.id,
      orderNumber: 'ORD-DEMO-9001',
      itemsPrice: 2999,
      totalPrice: 2999,
      paymentStatus: 'FAILED',
      orderStatus: 'PENDING',
      isSynthetic: true,
      items: {
        create: [
          {
            productId: products[1].id,
            productName: products[1].name,
            unitPrice: 2999,
            costPrice: 1950,
            quantity: 1,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      orderId: order1.id,
      customerId: failedCustomer1.id,
      razorpayOrderId: 'order_test_mock_9001',
      amount: 2999,
      status: 'failed',
      failureReason: 'bank_server_timeout',
      isSynthetic: true,
    },
  });

  const failedCustomer2 = customers[1];
  const order2 = await prisma.order.create({
    data: {
      merchantId: merchant.id,
      customerId: failedCustomer2.id,
      orderNumber: 'ORD-DEMO-9002',
      itemsPrice: 1499,
      totalPrice: 1499,
      paymentStatus: 'FAILED',
      orderStatus: 'PENDING',
      isSynthetic: true,
      items: {
        create: [
          {
            productId: products[0].id,
            productName: products[0].name,
            unitPrice: 1499,
            costPrice: 900,
            quantity: 1,
          },
        ],
      },
    },
  });

  await prisma.payment.create({
    data: {
      orderId: order2.id,
      customerId: failedCustomer2.id,
      razorpayOrderId: 'order_test_mock_9002',
      amount: 1499,
      status: 'failed',
      failureReason: 'card_declined_insufficient_balance',
      isSynthetic: true,
    },
  });

  console.log('✅ Seeded synthetic failed orders & payment records for recovery discovery');

  // 5. Seed a Default Active Goal with Locked Hard Constraints
  const goal = await prisma.goal.create({
    data: {
      merchantId: merchant.id,
      targetRevenue: 50000, // ₹50,000
      timeframeDays: 30,
      status: 'ACTIVE',
      constraints: {
        create: [
          {
            type: 'MARGIN_FLOOR',
            operator: 'GTE',
            thresholdValue: 25.0, // Margin floor >= 25%
            unit: 'PERCENT',
            isHard: true,
          },
          {
            type: 'DISCOUNT_CAP',
            operator: 'LTE',
            thresholdValue: 10.0, // Discount cap <= 10%
            unit: 'PERCENT',
            isHard: true,
          },
          {
            type: 'INVENTORY_MIN',
            operator: 'GTE',
            thresholdValue: 15.0, // Inventory minimum >= 15 units
            unit: 'UNITS',
            isHard: true,
          },
          {
            type: 'DUPLICATE_WINDOW_DAYS',
            operator: 'GTE',
            thresholdValue: 14.0, // No re-contact within 14 days
            unit: 'DAYS',
            isHard: true,
          },
        ],
      },
    },
  });

  console.log(`✅ Seeded active merchant goal: ₹${goal.targetRevenue} with 4 hard constraints locked`);

  // 6. Seed Initial Audit Log for Goal Initialization
  await prisma.auditEvent.create({
    data: {
      merchantId: merchant.id,
      actor: 'MERCHANT',
      eventType: 'GOAL_CREATED',
      entityType: 'Goal',
      entityId: goal.id,
      summary: 'Merchant defined objective: Generate ₹50,000 incremental revenue within 30 days',
      detailsJson: JSON.stringify({
        targetRevenue: 50000,
        timeframeDays: 30,
      }),
    },
  });

  await prisma.auditEvent.create({
    data: {
      merchantId: merchant.id,
      actor: 'SYSTEM',
      eventType: 'CONSTRAINTS_LOCKED',
      entityType: 'Goal',
      entityId: goal.id,
      summary: 'Hard constraints locked: Margin >= 25%, Discount <= 10%, Inventory >= 15 units, Dedupe window >= 14d',
      detailsJson: JSON.stringify({
        marginFloor: 25.0,
        discountCap: 10.0,
        inventoryMin: 15,
        dedupeWindowDays: 14,
      }),
    },
  });

  console.log('✅ Audit trail initialized with creation events');

  // 7. Deterministically evaluate and persist Demo Opportunities & Decision Records
  const { DEMO_OPPORTUNITY_CANDIDATES } = await import('../opportunities/demoCandidates');
  const { evaluateOpportunities } = await import('../core/evaluator');

  const constraintRules = [
    { type: 'MARGIN_FLOOR' as const, operator: 'GTE' as const, thresholdValue: 25.0, unit: 'PERCENT' as const, isHard: true },
    { type: 'DISCOUNT_CAP' as const, operator: 'LTE' as const, thresholdValue: 10.0, unit: 'PERCENT' as const, isHard: true },
    { type: 'INVENTORY_MIN' as const, operator: 'GTE' as const, thresholdValue: 15.0, unit: 'UNITS' as const, isHard: true },
    { type: 'DUPLICATE_WINDOW_DAYS' as const, operator: 'GTE' as const, thresholdValue: 14.0, unit: 'DAYS' as const, isHard: true },
  ];

  const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, constraintRules, goal.id);

  for (const opp of report.allOpportunities) {
    const createdOpp = await prisma.opportunity.create({
      data: {
        id: opp.id,
        goalId: goal.id,
        type: opp.type,
        title: opp.title,
        description: opp.description,
        targetSegment: opp.targetSegment,
        eligibleCustomers: opp.scoring.eligibleCustomers,
        acceptanceProbability: opp.scoring.acceptanceProbability,
        incrementalRevenuePerCustomer: opp.scoring.incrementalRevenuePerCustomer,
        incentiveCostPerCustomer: opp.scoring.incentiveCostPerCustomer,
        expectedNetValue: opp.scoring.expectedNetValue,
        projectedMarginPct: opp.projectedMarginPct,
        projectedDiscountPct: opp.projectedDiscountPct,
        inventoryImpact: opp.projectedInventoryRemaining,
        status: opp.status,
        rejectionReasons: opp.rejectionReasons.length > 0 ? JSON.stringify(opp.rejectionReasons) : null,
        isRecommended: opp.isWinner,
        recommendationReason: opp.explanation,
      },
    });

    // Create Audit Events for discovery & evaluation
    await prisma.auditEvent.create({
      data: {
        merchantId: merchant.id,
        actor: 'SYSTEM',
        eventType: opp.isEligible ? 'OPPORTUNITY_EVALUATED' : 'OPPORTUNITY_REJECTED',
        entityType: 'Opportunity',
        entityId: createdOpp.id,
        summary: opp.isEligible
          ? `Opportunity '${opp.title}' evaluated: ELIGIBLE with Expected Net Value ₹${opp.scoring.expectedNetValue.toLocaleString('en-IN')}`
          : `Opportunity '${opp.title}' REJECTED: ${opp.rejectionReasons.join('; ')}`,
        detailsJson: JSON.stringify({
          expectedNetValue: opp.scoring.expectedNetValue,
          projectedMargin: opp.projectedMarginPct,
          projectedDiscount: opp.projectedDiscountPct,
          rejectionReasons: opp.rejectionReasons,
        }),
      },
    });

    // If winner, create the initial Decision record (Awaiting Merchant Approval)
    if (opp.isWinner) {
      const campaignAction = await prisma.campaignAction.create({
        data: {
          opportunityId: createdOpp.id,
          status: 'PENDING_APPROVAL',
          recommendedAt: new Date(),
          decisionRationale: opp.explanation,
        },
      });

      await prisma.auditEvent.create({
        data: {
          merchantId: merchant.id,
          actor: 'AGENT',
          eventType: 'ACTION_RECOMMENDED',
          entityType: 'CampaignAction',
          entityId: campaignAction.id,
          summary: `Agent recommended '${opp.title}'. Awaiting explicit merchant approval before any Razorpay execution.`,
          detailsJson: JSON.stringify({
            opportunityId: createdOpp.id,
            expectedNetValue: opp.scoring.expectedNetValue,
            expectedRevenue: opp.scoring.incrementalRevenue,
            incentiveCost: opp.scoring.expectedIncentiveCost,
          }),
        },
      });
    }
  }

  console.log(`✅ Evaluated & seeded ${report.allOpportunities.length} opportunities (Winner: ${report.winner?.title})`);
  console.log('🎉 Synthetic seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
