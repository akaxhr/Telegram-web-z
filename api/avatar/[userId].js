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

  // 1. Force the content type explicitly based on the extension
  let contentType = "image/jpeg";
  if (data.avatar_path.toLowerCase().endsWith(".png")) {
    contentType = "image/png";
  }

  // 2. Set headers cleanly
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", buffer.length); // Tells the browser exactly how much data to expect
  res.setHeader("Content-Disposition", "inline");
  
  // 3. TEMPORARILY DISABLE CACHE: This stops your browser from using the old "download" instructions
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  // 4. Use res.end(buffer) instead of res.send(buffer) 
  // This guarantees Node treats it as a raw binary image chunk instead of a generic object/string
  return res.status(200).end(buffer);
}