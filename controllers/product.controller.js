import { success } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/ApiError.js";

const ownerSelect = { owner: { select: { id: true, name: true } } };

async function findOwnedProductOrThrow(id, userId) {
  const existedProduct = await prisma.product.findUnique({ where: { id } });

  if (!existedProduct) {
    throw ApiError.notFound("Product not available");
  }

  if (existedProduct.ownerId !== userId) {
    throw ApiError.conflict("you can not modify this");
  }
}

export async function listProducts(req, res) {
  const { page, limit, search, minPrice, maxPrice, sortBy, order } =
    req.validated.query;

  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {};
    if (minPrice !== undefined) where.price.gte = minPrice;
    if (maxPrice !== undefined) where.price.lte = maxPrice;
  }

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: ownerSelect,
      orderBy: { [sortBy]: order },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  res.json({
    success: true,
    data: products,
    meta: { page, limit, totalPages: Math.ceil(total / limit) },
  });
}

export async function getProduct(req, res) {
  try {
    const { id } = req.validated.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true } } },
    });

    console.log(product.ownerId);

    res.json({ success: true, data: product });
  } catch (error) {
    throw ApiError.conflict(error.message);
  }
}

export async function createProduct(req, res) {
  try {
    const product = await prisma.product.create({
      data: {
        ...req.validated.body,
        ownerId: req.user.id,
      },
      include: { owner: { select: { id: true, name: true } } },
    });

    res.status(201).json({
      success: true,
      message: "Product created",
      data: product,
    });
  } catch (error) {
    throw ApiError.conflict(error.message);
  }
}

export async function updateProduct(req, res) {
  try {
    const { id } = req.validated.params;

    await findOwnedProductOrThrow(id, req.user.id);

    const product = await prisma.product.update({
      where: { id },
      data: req.validated.body,
      include: { owner: { select: { id: true, name: true } } },
    });

    res.json({
      success: true,
      message: "Product updated",
      data: product,
    });
  } catch (error) {
    throw ApiError.conflict(error.message);
  }
}

export async function deleteProduct(req, res) {
  try {
    const { id } = req.validated.params;

    await findOwnedProductOrThrow(id, req.user.id);

    await prisma.product.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    throw ApiError.conflict(error.message);
  }
}

export async function wellReviewedProducts(req, res) {
  const { page, limit, search, minPrice, maxPrice, sortBy, order } =
    req.validated.query;

  const where = {
        stock: { gt: 0 },
        reviews: {
          some: { rating: 5 },
          none: { rating: { lt: 3 } },
        },
        OR: [
          { category: { name: { in: ["Audio", "Displays"] } } },
          { price: { lt: 50 } },
        ],
        NOT: { name: { contains: "mouse", mode: "insensitive" } },
      };

  const [products, total ] = await prisma.$transaction([prisma.product.findMany({
      where,
      select: {
        name: true,
        price: true,
        stock: true,
        category: { select: { name: true } },
        reviews: { select: { rating: true } },
      },
      orderBy: { price: "desc" },
    }),
    prisma.product.count({ where })
  ])  

  res.json({
    success: true,
    data: products,
    meta: { page, limit, totalPages: Math.ceil(total / limit) },
  });
}


export async function monthlyRevenue(req, res) {
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
  const status = ["PAID", "SHIPPED"];



  //created_at
  const data = await prisma.$queryRaw`
    SELECT 
        to_char(date_trunc('month', o."createdAt"), 'YYYY-MM') AS month,
        COUNT(*)::int AS orders,
        SUM(o.total)::float as revenue,
        SUM(SUM(o.total)) OVER (ORDER BY date_trunc('month', o."createdAt"))::float as running_total
        FROM orders o
    where o."createdAt" >= ${since}
    AND o.status = ANY(${status}::"OrderStatus"[])
    GROUP BY date_trunc('month', o."createdAt")
    ORDER BY date_trunc('month', o."createdAt")
  `

  res.json({
    success: true,
    data,
  });
}
