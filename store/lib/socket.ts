import { io } from "socket.io-client";

// This ensures we only have one socket connection across our app
export const socket = io({
  path: "/api/socket/io",
  addTrailingSlash: false,
  autoConnect: false,
});
