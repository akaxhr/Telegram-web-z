import { supabase } from "../../server/lib/supabase.js";

export default async function handler(req, res) {
  const { userId } = req.query;

  const { data } = await supabase
    .from("tg_users")
    .select("avatar_path")
    .eq("id", String(userId))
    .single();

  if (!data?.avatar_path) {
    return res.status(404).end();
  }

  const tgUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.avatar_path}`;
  const img = await fetch(tgUrl);

  if (!img.ok) {
    return res.status(404).end();
  }

  const buffer = Buffer.from(await img.arrayBuffer());

  // 1. DYNAMICALLY DETECT TYPE FROM TELEGRAM PATH
  // Telegram paths usually end in .jpg or .png (e.g., "photos/file_0.jpg")
  let contentType = "image/jpeg"; // safe fallback
  if (data.avatar_path.toLowerCase().endsWith(".png")) {
    contentType = "image/png";
  }

  // 2. EXPLICITLY FORCE THE BROWSER TO DISPLAY IT INLINE
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Disposition", "inline");

  return res.status(200).send(buffer);
}