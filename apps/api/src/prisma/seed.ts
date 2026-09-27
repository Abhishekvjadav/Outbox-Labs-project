process.env.ETHEREAL_CACHE = 'false';

import { prisma } from './client';

async function seed() {
  console.log('[Seed] Starting database seed...');

  // 1. Create or find default user
  const user = await prisma.user.upsert({
    where: { email: 'abhishek@reachinbox.ai' },
    update: {},
    create: {
      email: 'abhishek@reachinbox.ai',
      name: 'Abhishek (ReachInbox Candidate)',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
  });

  console.log(`[Seed] User ready: ${user.name} (${user.email})`);

  // 2. Provision Ethereal test senders if none exist
  const senderCount = await prisma.sender.count({ where: { userId: user.id } });
  if (senderCount === 0) {
    console.log('[Seed] Provisioning Ethereal test senders...');

    const { etherealService } = await import('../services/ethereal');

    const account1 = await etherealService.createTestSender();
    const sender1 = await prisma.sender.create({
      data: {
        userId: user.id,
        email: account1.email,
        name: 'Growth Outreach (Mailbox A)',
        etherealUser: account1.user,
        etherealPass: account1.pass,
        hourlyLimit: 50,
      },
    });

    const account2 = await etherealService.createTestSender();
    const sender2 = await prisma.sender.create({
      data: {
        userId: user.id,
        email: account2.email,
        name: 'Product Announcements (Mailbox B)',
        etherealUser: account2.user,
        etherealPass: account2.pass,
        hourlyLimit: 100,
      },
    });

    console.log(
      `[Seed] Senders created:\n  - ${sender1.name} (${sender1.email})\n  - ${sender2.name} (${sender2.email})`
    );
  } else {
    console.log(`[Seed] Senders already exist (${senderCount} found). Skipping sender creation.`);
  }

  console.log('[Seed] Database seeding completed successfully.');
}

seed()
  .catch((e) => {
    console.error('[Seed] Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
