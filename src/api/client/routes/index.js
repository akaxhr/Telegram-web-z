import { messageRoutes } from "./messages.js";
import { channelRoutes } from "./channels.js";
import { aiComposeRoutes } from "./aicompose.js";
import { userRoutes } from "./users.js";
import { langRoutes } from "./lang.js";
import { chatRoutes } from "./chats.js";

export const routes = {
  ...messageRoutes,
  ...channelRoutes,
  ...aiComposeRoutes,
    ...userRoutes,
      ...langRoutes,
       ...chatRoutes,
  
};
