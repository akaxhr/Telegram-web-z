import { supabase } from "../../server/lib/supabase.js";

export default async function handler(req, res) {
  const { userId } = req.query;

  const { data } = await supabase
    .from("tg_users")
    .select("avatar_path")
    .eq("id", String(userId))
    .single();

  if (!data?.avatar_path) {
    return res.status(404).send("No avatar");
  }

  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${data.avatar_path}`;

  res.writeHead(302, {
    Location: url,
    "Cache-Control": "public, max-age=86400",
  });

  res.end();
}