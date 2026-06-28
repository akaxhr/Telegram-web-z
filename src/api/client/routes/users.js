import { supabase } from "../../../../server/lib/supabase.js";

function mapUser(u) {
  return {
    id: u.id,
    firstName: u.first_name ?? "",
    lastName: u.last_name ?? "",
    username: u.username ?? undefined,
    phoneNumber: u.phone_number ?? undefined,
    type: "user",
    isSelf: false,
    raw: u.raw ?? undefined,
  };
}

export const userRoutes = {
  async "users.getFullUser"(payload) {
    const userId = typeof payload.id === "string" ? payload.id : payload.id?.id ?? payload.id?.userId;

    const { data, error } = await supabase
      .from("tg_users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;

    const user = mapUser(data);

    return {
      fullUser: {
        id: user.id,
        about: data.about ?? "",
        profilePhoto: data.profile_photo ?? undefined,
        personalPhoto: undefined,
        fallbackPhoto: undefined,
        botInfo: undefined,
      },
      users: [user],
      chats: [],
    };
  },

  async "users.getCommonChats"() {
    return {
      chats: [],
      users: [],
      count: 0,
    };
  },

  async "users.getRequirementsToContact"() {
    return [];
  },

  async "users.getNearestDc"() {
    return {
      country: "IN",
      thisDc: 1,
      nearestDc: 1,
    };
  },

  async "users.getContacts"() {
    const { data, error } = await supabase
      .from("tg_users")
      .select("*")
      .order("first_name", { ascending: true });

    if (error) throw error;

    return {
      users: (data ?? []).map(mapUser),
      chats: [],
    };
  },

  async "users.getUsers"(payload) {
    const userIds = payload.userIds ?? [];

    if (!userIds.length) return [];

    const { data, error } = await supabase
      .from("tg_users")
      .select("*")
      .in("id", userIds);

    if (error) throw error;

    return (data ?? []).map(mapUser);
  },

  async "users.importContacts"(payload) {
    const contacts = payload.contacts ?? [];

    const rows = contacts.map((c) => ({
      id: `contact-${c.phone}`,
      first_name: c.firstName ?? "",
      last_name: c.lastName ?? "",
      phone_number: c.phone ?? "",
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("tg_users")
      .upsert(rows)
      .select();

    if (error) throw error;

    return {
      imported: (data ?? []).map((u) => ({ userId: u.id })),
      users: (data ?? []).map(mapUser),
    };
  },

  async "users.addContact"(payload) {
    const { id, firstName, lastName, phoneNumber, note } = payload;

    const { error } = await supabase
      .from("tg_users")
      .upsert({
        id,
        first_name: firstName ?? "",
        last_name: lastName ?? "",
        phone_number: phoneNumber ?? null,
        note: note ?? null,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return true;
  },

  async "users.deleteContact"(payload) {
    const { id } = payload;

    const { error } = await supabase
      .from("tg_users")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return true;
  },

  async "users.toggleNoPaidMessagesException"() {
    return true;
  },

  async "users.getPaidMessagesRevenue"() {
    return {
      starsAmount: 0,
    };
  },

  async "users.getUserPhotos"() {
    return {
      photos: [],
      count: 0,
    };
  },

  async "users.reportSpam"(payload) {
    console.log("[REPORT SPAM]", payload);
    return true;
  },

  async "users.updateEmojiStatus"() {
    return true;
  },

  async "users.editCloseFriends"(payload) {
    console.log("[EDIT CLOSE FRIENDS]", payload.ids);
    return true;
  },

  async "users.updateContactNote"(payload) {
    const { id, note } = payload;

    const { error } = await supabase
      .from("tg_users")
      .update({
        note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;
    return true;
  },

  async "users.toggleNoForwards"() {
    return true;
  },
};