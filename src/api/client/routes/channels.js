export const channelRoutes = {
  async "channels.searchPosts"(payload, options) {
    console.log("SEARCH POSTS", payload);

    return {
      messages: [],
      chats: [],
      users: [],
      count: 0,
      nextRate: 0,
    };
  },
};