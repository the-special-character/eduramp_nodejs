
import express from 'express';
import { validate } from '../middlewares/validate.js';
import { createProductSchema, listProductSchema, PoruductIdSchema, updatedProductSchema } from '../validators/product.schema.js';
import { createProduct, deleteProduct, getProduct, listProducts, monthlyRevenue, updateProduct, wellReviewedProducts } from '../controllers/product.controller.js';
import { authenticate } from '../middlewares/auth.js';
const productRoutes = express.Router();


// Product list
productRoutes.get("/", validate(listProductSchema), listProducts)

productRoutes.get("/well", validate(listProductSchema), wellReviewedProducts)

productRoutes.get("/monthly", validate(listProductSchema), monthlyRevenue)

// get Product by ID
productRoutes.get("/:id", validate(PoruductIdSchema), getProduct)




// Create new product
productRoutes.post("/", authenticate, validate(createProductSchema), createProduct)
// Update Product
productRoutes.patch("/:id", authenticate, validate(updatedProductSchema), updateProduct)
// Delete Product
productRoutes.delete("/:id", authenticate, validate(PoruductIdSchema), deleteProduct)




export default productRoutes;