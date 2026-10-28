// Complex Prisma query examples, built on the demo data from `npm run db:seed`.
//
// Run all examples:      npm run examples
// Run just one:          npm run examples -- 9
// List them:             npm run examples -- list
//
// Each example is a small function with comments explaining the idea.
// Read the code first, guess the output, then run it and compare.
//
// Examples 9, 10 and 11 write to the database. Run `npm run db:seed` to reset.
import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../lib/prisma.js';

// ---------------------------------------------------------------------------
// 1. Relation filters: some / none + AND / OR / NOT
// ---------------------------------------------------------------------------
// "Show in-stock products that have at least one 5-star review and NO review
//  below 3 stars, that are either Audio/Displays or cheaper than $50,
//  but not mice."
async function wellReviewedProducts() {
  return prisma.product.findMany({
    where: {
      // Every key at the top level is joined with AND.
      stock: { gt: 0 },
      reviews: {
        some: { rating: 5 }, // at least one related row matches
        none: { rating: { lt: 3 } }, // zero related rows match
      },
      OR: [
        { category: { name: { in: ['Audio', 'Displays'] } } }, // filter through a relation
        { price: { lt: 50 } },
      ],
      NOT: { name: { contains: 'mouse', mode: 'insensitive' } },
    },
    select: {
      name: true,
      price: true,
      stock: true,
      category: { select: { name: true } },
      reviews: { select: { rating: true } },
    },
    orderBy: { price: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// 2. The `every` trap
// ---------------------------------------------------------------------------
// `every` is also TRUE when there are no related rows at all ("all zero orders
// are paid" is technically true). Add `some: {}` to require at least one.
async function everyVsSome() {
  // We print emails because they are unique (two users could share a name).
  const select = { email: true };

  const [everyOnly, everyAndSome, neverOrdered] = await Promise.all([
    // Also includes users with no orders at all (e.g. erin@example.com)!
    prisma.user.findMany({
      where: { orders: { every: { status: { in: ['PAID', 'SHIPPED'] } } } },
      select,
    }),
    // Correct "every order is paid or shipped, and there is at least one".
    prisma.user.findMany({
      where: { orders: { some: {}, every: { status: { in: ['PAID', 'SHIPPED'] } } } },
      select,
    }),
    // Users with no orders.
    prisma.user.findMany({ where: { orders: { none: {} } }, select }),
  ]);

  return {
    everyOnly: everyOnly.map((u) => u.email),
    everyAndSome: everyAndSome.map((u) => u.email),
    neverOrdered: neverOrdered.map((u) => u.email),
  };
}

// ---------------------------------------------------------------------------
// 3. Deep nested select with filtering, sorting and limits on relations
// ---------------------------------------------------------------------------
// "For each customer: their 2 most recent non-cancelled orders, with each
//  item's product and category, plus how many reviews they wrote."
// One Prisma call, data comes back already shaped like the JSON we want.
async function customerOrderHistory() {
  return prisma.user.findMany({
    where: { orders: { some: {} } },
    select: {
      name: true,
      _count: { select: { reviews: true } },
      orders: {
        where: { status: { not: 'CANCELLED' } }, // filter the relation
        orderBy: { createdAt: 'desc' }, // sort the relation
        take: 2, // limit the relation
        select: {
          id: true,
          status: true,
          total: true,
          createdAt: true,
          items: {
            select: {
              quantity: true,
              unitPrice: true,
              product: { select: { name: true, category: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// 4. Counting relations (with filters) and sorting by a relation count
// ---------------------------------------------------------------------------
async function productsByPopularity() {
  return prisma.product.findMany({
    select: {
      name: true,
      _count: {
        select: {
          reviews: true, // all reviews
          orderItems: { where: { order: { status: { in: ['PAID', 'SHIPPED'] } } } }, // only completed sales
        },
      },
    },
    orderBy: [{ reviews: { _count: 'desc' } }, { name: 'asc' }], // tie-breaker
    take: 5,
  });
}

// ---------------------------------------------------------------------------
// 5. aggregate(): many statistics in one query
// ---------------------------------------------------------------------------
async function salesStatistics() {
  const [catalog, sales] = await Promise.all([
    prisma.product.aggregate({
      _count: { _all: true },
      _avg: { price: true },
      _min: { price: true },
      _max: { price: true },
      _sum: { stock: true },
    }),
    prisma.order.aggregate({
      where: { status: { in: ['PAID', 'SHIPPED'] } },
      _count: { _all: true },
      _sum: { total: true },
      _avg: { total: true },
      _min: { createdAt: true }, // first sale
      _max: { createdAt: true }, // latest sale
    }),
  ]);
  return { catalog, sales };
}

// ---------------------------------------------------------------------------
// 6. groupBy() + having, then "join" the names in JavaScript
// ---------------------------------------------------------------------------
// "Products with at least 2 reviews and an average rating of 4 or more."
// groupBy cannot `include` relations, so we fetch product names separately
// and merge them. That's a very common real-world pattern.
async function topRatedProducts() {
  const groups = await prisma.review.groupBy({
    by: ['productId'],
    _avg: { rating: true },
    _count: { _all: true },
    having: {
      // `having` filters the GROUPS (like SQL HAVING), `where` filters rows.
      productId: { _count: { gte: 2 } },
      rating: { _avg: { gte: 4 } },
    },
    orderBy: { _avg: { rating: 'desc' } },
  });

  const products = await prisma.product.findMany({
    where: { id: { in: groups.map((g) => g.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  return groups.map((g) => ({
    product: nameById.get(g.productId),
    reviews: g._count._all,
    avgRating: Number(g._avg.rating.toFixed(2)),
  }));
}

// ---------------------------------------------------------------------------
// 7. groupBy() with a relation filter in `where`: best sellers
// ---------------------------------------------------------------------------
async function bestSellers() {
  const groups = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: { status: { in: ['PAID', 'SHIPPED'] } } }, // ignore pending/cancelled
    _sum: { quantity: true },
    _count: { orderId: true }, // in how many orders it appeared
    orderBy: { _sum: { quantity: 'desc' } },
    take: 3,
  });

  const products = await prisma.product.findMany({
    where: { id: { in: groups.map((g) => g.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));

  return groups.map((g) => ({
    product: nameById.get(g.productId),
    unitsSold: g._sum.quantity,
    orders: g._count.orderId,
  }));
}

// ---------------------------------------------------------------------------
// 8. Cursor-based pagination (better than skip/offset for big tables)
// ---------------------------------------------------------------------------
// With `skip`, the database still reads and throws away all skipped rows.
// With a cursor, it jumps straight to "rows after id X" using the index.
async function cursorPagination() {
  const pages = [];
  let cursor; // undefined for the first page

  while (true) {
    const page = await prisma.product.findMany({
      take: 5,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }), // skip the cursor row itself
      orderBy: { id: 'asc' }, // cursor pagination needs a stable, unique order
      select: { id: true, name: true },
    });
    if (page.length === 0) break;

    pages.push(page.map((p) => `#${p.id} ${p.name}`));
    cursor = page.at(-1).id; // the last id becomes the next cursor
  }
  return pages;
}

// ---------------------------------------------------------------------------
// 9. Interactive transaction: place an order safely  (WRITES DATA)
// ---------------------------------------------------------------------------
// All steps succeed together or none of them happen. If any item is out of
// stock we throw, and Prisma rolls back the stock already taken for earlier items.
async function placeOrder(userId, cart) {
  return prisma.$transaction(async (tx) => {
    let total = new Prisma.Decimal(0); // money: use Decimal, not JS floats
    const items = [];

    for (const { productId, quantity } of cart) {
      // Atomic "check and decrement" in ONE statement. Reading the stock first
      // and updating later would let two customers buy the last item at once.
      const { count } = await tx.product.updateMany({
        where: { id: productId, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (count === 0) {
        throw new Error(`Not enough stock for product #${productId}`);
      }

      const product = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: { price: true },
      });
      total = total.plus(product.price.times(quantity));
      items.push({ productId, quantity, unitPrice: product.price });
    }

    // Nested write: order + all its items in one query.
    return tx.order.create({
      data: { userId, total, items: { create: items } },
      include: { items: { include: { product: { select: { name: true, stock: true } } } } },
    });
  });
}

async function placeOrderDemo() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const byName = async (name) => prisma.product.findFirstOrThrow({ where: { name } });
  const organizer = await byName('Cable Organizer');
  const chair = await byName('Office Chair'); // stock is 0

  // a) Succeeds
  const order = await placeOrder(admin.id, [{ productId: organizer.id, quantity: 2 }]);

  // b) Fails on the 2nd item -> the organizer stock taken for the 1st item is given back
  const stockBefore = (await byName('Cable Organizer')).stock;
  let error;
  try {
    await placeOrder(admin.id, [
      { productId: organizer.id, quantity: 1 },
      { productId: chair.id, quantity: 1 },
    ]);
  } catch (err) {
    error = err.message;
  }
  const stockAfter = (await byName('Cable Organizer')).stock;

  return {
    success: { orderId: order.id, total: order.total, items: order.items },
    failure: { error, organizerStockBefore: stockBefore, organizerStockAfter: stockAfter },
  };
}

// ---------------------------------------------------------------------------
// 10. Nested writes: upsert with a compound unique key + connectOrCreate  (WRITES DATA)
// ---------------------------------------------------------------------------
// Both are safe to run many times (idempotent).
async function nestedWrites() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const organizer = await prisma.product.findFirstOrThrow({ where: { name: 'Cable Organizer' } });

  // @@unique([userId, productId]) gives us the `userId_productId` key.
  // Creates the review the first time, updates it after that.
  const review = await prisma.review.upsert({
    where: { userId_productId: { userId: admin.id, productId: organizer.id } },
    create: { userId: admin.id, productId: organizer.id, rating: 4, comment: 'Tidy desk at last.' },
    update: { rating: 5, comment: 'Bought more, still great.' },
  });

  // Put the product in a "Cables" category, creating the category if needed.
  const product = await prisma.product.update({
    where: { id: organizer.id },
    data: {
      category: {
        connectOrCreate: { where: { name: 'Cables' }, create: { name: 'Cables' } },
      },
    },
    select: { name: true, category: true },
  });

  return { review, product };
}

// ---------------------------------------------------------------------------
// 11. Bulk update as a "dry run": updateManyAndReturn + rollback  (no lasting change)
// ---------------------------------------------------------------------------
// "Preview a 10% price rise for low-stock furniture, then undo it."
// Throwing inside an interactive transaction rolls everything back.
class DryRun extends Error {
  constructor(preview) {
    super('dry run');
    this.preview = preview;
  }
}

async function dryRunPriceIncrease() {
  const where = { category: { name: 'Furniture' }, stock: { lt: 10 } };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateManyAndReturn({
        where,
        data: { price: { multiply: 1.1 } }, // atomic: price = price * 1.1
        select: { name: true, price: true, stock: true },
      });
      throw new DryRun(updated); // roll back on purpose
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
    const pricesNow = await prisma.product.findMany({ where, select: { name: true, price: true } });
    return { previewedPrices: err.preview, actualPricesAfterRollback: pricesNow };
  }
}

// ---------------------------------------------------------------------------
// 12. Raw SQL: monthly revenue with a running total (window function)
// ---------------------------------------------------------------------------
// Prisma's query API has no window functions, so we use $queryRaw.
// The ${...} values are sent as parameters, so this is safe from SQL injection.
// Note: table/column names are the real DB names (@@map), e.g. "orders".
async function monthlyRevenue() {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const statuses = ['PAID', 'SHIPPED'];

  return prisma.$queryRaw`
    SELECT
      to_char(date_trunc('month', o."createdAt"), 'YYYY-MM')        AS month,
      COUNT(*)::int                                                AS orders,
      SUM(o.total)::float                                          AS revenue,
      SUM(SUM(o.total)) OVER (ORDER BY date_trunc('month', o."createdAt"))::float AS running_total
    FROM orders o
    WHERE o."createdAt" >= ${since}
      -- Parameters arrive as text, so cast them to the enum type.
      AND o.status = ANY(${statuses}::"OrderStatus"[])
    GROUP BY date_trunc('month', o."createdAt")
    ORDER BY date_trunc('month', o."createdAt")
  `;
}

// ---------------------------------------------------------------------------
// 13. Raw SQL: top 2 products per category by revenue (RANK + PARTITION BY)
// ---------------------------------------------------------------------------
// "Top N per group" is hard with the Prisma API but natural in SQL.
async function topProductsPerCategory(topN = 2) {
  return prisma.$queryRaw`
    WITH product_revenue AS (
      SELECT
        c.name                                   AS category,
        p.name                                   AS product,
        SUM(oi.quantity * oi."unitPrice")::float AS revenue,
        RANK() OVER (
          PARTITION BY c.id
          ORDER BY SUM(oi.quantity * oi."unitPrice") DESC
        )::int                                   AS rank
      FROM order_items oi
      JOIN orders     o ON o.id = oi."orderId"
      JOIN products   p ON p.id = oi."productId"
      JOIN categories c ON c.id = p."categoryId"
      WHERE o.status IN ('PAID', 'SHIPPED')
      GROUP BY c.id, c.name, p.id, p.name
    )
    SELECT * FROM product_revenue
    WHERE rank <= ${topN}
    ORDER BY category, rank
  `;
}

// ---------------------------------------------------------------------------
// 14. Raw SQL: "customers who bought X also bought..." (self-join)
// ---------------------------------------------------------------------------
async function alsoBought(productName = 'Wireless Mouse') {
  return prisma.$queryRaw`
    SELECT
      other.name                        AS product,
      COUNT(DISTINCT o."userId")::int   AS customers
    FROM order_items mine
    JOIN products target ON target.id = mine."productId" AND target.name = ${productName}
    JOIN orders o         ON o.id = mine."orderId"
    -- other items from orders of the same customers
    JOIN orders o2        ON o2."userId" = o."userId"
    JOIN order_items oi2  ON oi2."orderId" = o2.id
    JOIN products other   ON other.id = oi2."productId" AND other.id <> target.id
    GROUP BY other.name
    ORDER BY customers DESC, other.name
    LIMIT 5
  `;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const examples = [
  ['Relation filters: some / none + AND / OR / NOT', wellReviewedProducts],
  ['The `every` trap (empty relations)', everyVsSome],
  ['Deep nested select with relation filters, sort and take', customerOrderHistory],
  ['Filtered relation counts + order by relation count', productsByPopularity],
  ['aggregate(): catalog and sales statistics', salesStatistics],
  ['groupBy() + having: top-rated products', topRatedProducts],
  ['groupBy() with relation filter: best sellers', bestSellers],
  ['Cursor-based pagination', cursorPagination],
  ['Interactive transaction: place an order (writes data)', placeOrderDemo],
  ['Nested writes: upsert + connectOrCreate (writes data)', nestedWrites],
  ['Dry-run bulk update with rollback', dryRunPriceIncrease],
  ['Raw SQL: monthly revenue + running total', monthlyRevenue],
  ['Raw SQL: top 2 products per category', () => topProductsPerCategory(2)],
  ['Raw SQL: customers who bought X also bought', () => alsoBought('Wireless Mouse')],
];

// Decimal -> string (via its toJSON), BigInt -> number, so results print nicely.
const print = (data) =>
  console.log(JSON.stringify(data, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));

async function main() {
  const arg = process.argv[2];

  if (arg === 'list') {
    examples.forEach(([title], i) => console.log(`${String(i + 1).padStart(2)}. ${title}`));
    return;
  }

  const selected = arg ? [Number(arg)] : examples.map((_, i) => i + 1);
  for (const n of selected) {
    const example = examples[n - 1];
    if (!example) throw new Error(`No example #${arg}. Try: npm run examples -- list`);

    const [title, run] = example;
    console.log(`\n=== ${n}. ${title} ===`);
    print(await run());
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
