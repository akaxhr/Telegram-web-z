import { supabase } from "../../server/lib/supabase.js";

export default async function handler(req, res) {
  const raw = String(req.query.userId || "");
  const userId = raw.replace(".jpg", "");

  const { data } = await supabase
    .from("tg_users")
    .select("photo")
    .eq("id", userId)
    .single();

  if (!data?.photo) return res.status(404).send("No avatar");

  const base64 = data.photo.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "public, max-age=86400");

  return res.status(200).send(buffer);
}