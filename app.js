import cors from "cors";
import helmet from "helmet";
import express from "express";
import { env } from "./config/env.js";
import morgan from "morgan";
import authRoutes from "./routes/auth.routes.js";
import productRoutes from "./routes/products.routes.js";

const app = express();

// global middlewares
app.use(helmet()); // secure http headers
app.use(cors()); // allow browsers on other origins to call api
app.use(express.json({ limit: "100kb" }));
if (env.NODE_ENV !== "staging") {
  app.use(morgan("dev")); // log each request
}

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes)
app.use("/api/products", productRoutes)

// Return errors as JSON (Express' default handler sends HTML)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode ?? err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    success: false,
    message: status >= 500 ? "Internal Server Error" : err.message,
    ...(err.details && { details: err.details }),
  });
});

export default app;
