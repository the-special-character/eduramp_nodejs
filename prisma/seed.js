// Fills the database with demo data. Run with: npm run db:seed
// Safe to run more than once: users are upserted, everything else is recreated.
// Note: this wipes ALL orders, reviews and categories, plus the demo users' products.
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

// Returns a Date `daysAgo` days in the past (keeps the demo data "recent").
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function main() {
  const password = await bcrypt.hash('Password123', 10);

  // --- Users ---------------------------------------------------------------
  const userData = [
    { name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
    { name: 'Alice', email: 'alice@example.com' },
    { name: 'Carol', email: 'carol@example.com' },
    { name: 'Dave', email: 'dave@example.com' },
    { name: 'Erin', email: 'erin@example.com' }, // never orders or reviews (useful for "none" filters)
  ];
  const users = {};
  for (const u of userData) {
    users[u.name] = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, password },
    });
  }
  const { Admin: admin, Alice: alice, Carol: carol, Dave: dave } = users;

  // --- Clean old demo data (children first, because of foreign keys) -------
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.review.deleteMany();
  await prisma.product.deleteMany({ where: { ownerId: { in: [admin.id, alice.id] } } });
  await prisma.category.deleteMany();

  // --- Categories ----------------------------------------------------------
  const [accessories, displays, furniture, audio] = await prisma.category.createManyAndReturn({
    data: [{ name: 'Accessories' }, { name: 'Displays' }, { name: 'Furniture' }, { name: 'Audio' }],
  });

  // --- Products ------------------------------------------------------------
  const productRows = await prisma.product.createManyAndReturn({
    data: [
      { name: 'Wireless Mouse', description: 'Ergonomic 2.4GHz mouse', price: 24.99, stock: 120, ownerId: alice.id, categoryId: accessories.id },
      { name: 'Mechanical Keyboard', description: 'RGB, brown switches', price: 89.5, stock: 40, ownerId: alice.id, categoryId: accessories.id },
      { name: 'USB-C Hub', description: '7-in-1 with HDMI', price: 39.0, stock: 75, ownerId: alice.id, categoryId: accessories.id },
      { name: 'Webcam HD', description: '1080p with microphone', price: 59.0, stock: 3, ownerId: alice.id, categoryId: accessories.id },
      { name: '27" Monitor', description: '1440p IPS display', price: 299.99, stock: 15, ownerId: admin.id, categoryId: displays.id },
      { name: '34" Ultrawide Monitor', description: 'Curved 3440x1440', price: 549.0, stock: 4, ownerId: admin.id, categoryId: displays.id },
      { name: 'Laptop Stand', description: 'Aluminium, adjustable', price: 29.95, stock: 60, ownerId: admin.id, categoryId: furniture.id },
      { name: 'Standing Desk', description: 'Electric, height adjustable', price: 399.0, stock: 8, ownerId: admin.id, categoryId: furniture.id },
      { name: 'Office Chair', description: 'Mesh back, lumbar support', price: 189.0, stock: 0, ownerId: admin.id, categoryId: furniture.id },
      { name: 'Noise-Cancelling Headphones', description: 'Over-ear, 30h battery', price: 249.0, stock: 25, ownerId: alice.id, categoryId: audio.id },
      { name: 'USB Microphone', description: 'Cardioid condenser mic', price: 79.0, stock: 2, ownerId: alice.id, categoryId: audio.id },
      { name: 'Cable Organizer', description: 'Silicone clips, pack of 10', price: 9.99, stock: 300, ownerId: alice.id }, // no category
    ],
  });
  const p = Object.fromEntries(productRows.map((row) => [row.name, row]));

  // --- Orders (spread over ~6 months so monthly reports have data) --------
  const orders = [
    { user: alice, status: 'PAID', days: 170, items: [['27" Monitor', 1], ['Wireless Mouse', 2]] },
    { user: carol, status: 'SHIPPED', days: 150, items: [['Mechanical Keyboard', 1], ['Wireless Mouse', 1]] },
    { user: dave, status: 'PAID', days: 120, items: [['Standing Desk', 1], ['Laptop Stand', 1]] },
    { user: carol, status: 'CANCELLED', days: 110, items: [['34" Ultrawide Monitor', 1]] },
    { user: alice, status: 'SHIPPED', days: 90, items: [['Noise-Cancelling Headphones', 1], ['USB-C Hub', 1]] },
    { user: dave, status: 'PAID', days: 75, items: [['Wireless Mouse', 3], ['Cable Organizer', 4]] },
    { user: carol, status: 'PAID', days: 60, items: [['27" Monitor', 2], ['Laptop Stand', 2]] },
    { user: admin, status: 'SHIPPED', days: 45, items: [['USB Microphone', 1], ['Webcam HD', 1]] },
    { user: dave, status: 'PAID', days: 30, items: [['34" Ultrawide Monitor', 1], ['Mechanical Keyboard', 1]] },
    { user: alice, status: 'PENDING', days: 10, items: [['Office Chair', 1]] },
    { user: carol, status: 'PAID', days: 5, items: [['Noise-Cancelling Headphones', 1], ['Wireless Mouse', 1]] },
    { user: dave, status: 'PENDING', days: 1, items: [['USB-C Hub', 2]] },
  ];

  for (const o of orders) {
    const items = o.items.map(([name, quantity]) => ({
      productId: p[name].id,
      quantity,
      unitPrice: p[name].price,
    }));
    const total = items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);

    // Nested write: creates the order AND its items in one query.
    await prisma.order.create({
      data: {
        userId: o.user.id,
        status: o.status,
        total: total.toFixed(2),
        createdAt: daysAgo(o.days),
        items: { create: items },
      },
    });
  }

  // --- Reviews -------------------------------------------------------------
  const reviews = [
    [alice, '27" Monitor', 5, 'Sharp and bright, great value.'],
    [carol, '27" Monitor', 4, 'Good, but the stand wobbles.'],
    [alice, 'Wireless Mouse', 4, 'Comfortable for long days.'],
    [carol, 'Wireless Mouse', 5, 'Battery lasts forever.'],
    [dave, 'Wireless Mouse', 3, 'Fine, nothing special.'],
    [carol, 'Mechanical Keyboard', 5, 'Love the brown switches.'],
    [dave, 'Mechanical Keyboard', 2, 'Too loud for the office.'],
    [dave, 'Standing Desk', 5, 'Changed how I work.'],
    [dave, 'Laptop Stand', 4, null],
    [alice, 'Noise-Cancelling Headphones', 5, 'Silence on the train!'],
    [carol, 'Noise-Cancelling Headphones', 5, 'Excellent sound quality.'],
    [admin, 'USB Microphone', 3, 'Picks up keyboard noise.'],
    [admin, 'Webcam HD', 2, 'Grainy in low light.'],
    [dave, '34" Ultrawide Monitor', 5, 'Perfect for coding.'],
  ];
  await prisma.review.createMany({
    data: reviews.map(([user, product, rating, comment], i) => ({
      userId: user.id,
      productId: p[product].id,
      rating,
      comment,
      createdAt: daysAgo(100 - i * 5),
    })),
  });

  console.log(`Seeded ${userData.length} users (password: Password123), e.g. admin@example.com, alice@example.com`);
  console.log(`Seeded 4 categories, ${productRows.length} products, ${orders.length} orders, ${reviews.length} reviews`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
