import { routes } from "./routes/index.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  try {
    const { method, payload, options = {} } = req.body;

    const fn = routes[method];

    if (!fn) {
      return res.status(404).json({
        ok: false,
        error: `Unknown method: ${method}`,
      });
    }

    const result = await fn(payload, options);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[API CLIENT ERROR]", err);

    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}