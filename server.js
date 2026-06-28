import "dotenv/config";
import express from "express";
import cors from "cors";
import { routes } from "./src/api/client/routes/index.js";

const app = express();

app.use(cors());
app.use(express.json());

app.post("/api/bot/webhook", async (req, res) => {
  try {
    const update = req.body;
    const msg = update.message || update.edited_message;

    if (!msg) return res.json({ ok: true });

    console.log("[BOT UPDATE]", msg);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[BOT WEBHOOK ERROR]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/client/request", async (req, res) => {
  try {
    const { method, payload, options = {} } = req.body;

  console.log("METHOD:", method);
console.log("HAS METHOD:", Boolean(routes[method]));
console.log("AVAILABLE USER ROUTES:", Object.keys(routes).filter((k) => k.startsWith("users.")));

const fn = routes[method];

if (!fn) {
      return res.status(404).json({
        ok: false,
        error: `Unknown method: ${method}`,
      });
    }

    const result = await fn(payload, options);
    return res.json(result);
  } catch (err) {
    console.error("[SERVER ERROR]", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.listen(3001, () => {
  console.log("API server running on http://localhost:3001");
});