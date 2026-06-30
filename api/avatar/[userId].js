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

  res.setHeader("Content-Type", img.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Disposition", "inline");

  return res.status(200).send(buffer);
}