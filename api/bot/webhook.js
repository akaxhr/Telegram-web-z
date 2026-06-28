import { handleTelegramUpdate } from "../../server/bot/handleUpdate.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    await handleTelegramUpdate(req.body);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK ERROR]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}