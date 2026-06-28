import { routes } from "../../server/routes/index.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { method, payload, options = {} } = req.body;
    const fn = routes[method];

    if (!fn) {
      return res.status(404).json({ ok: false, error: `Unknown method: ${method}` });
    }

    const result = await fn(payload, options);
    return res.json(result);
  } catch (err) {
    console.error("[CLIENT REQUEST ERROR]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}