import { supabase } from "../../server/lib/supabase.js";

export default async function handler(req, res) {
  const { userId } = req.query;

  const { data: user } = await supabase
    .from("tg_users")
    .select("avatar_path")
    .eq("id", String(userId))
    .single();

  if (!user?.avatar_path) {
    return res.status(404).send("No avatar");
  }

  res.redirect(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${user.avatar_path}`);
}