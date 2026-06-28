import { messageRoutes } from "./messages.js";
import { channelRoutes } from "./channels.js";
import { aiComposeRoutes } from "./aicompose.js";

export const routes = {
  ...messageRoutes,
  ...channelRoutes,
  ...aiComposeRoutes,
  
};