import { Server as NetServer, Socket } from "net";
import { NextApiResponse } from "next";
import { Server as SocketIOServer } from "socket.io";

export type NextApiResponseServerIo = NextApiResponse & {
  socket: Socket & {
    server: NetServer & {
      io: SocketIOServer;
    };
  };
};

export interface ChatUser {
  id: string;
  username: string;
  email: string;
  image?: string;
  lastMessage?: ChatMessage;
}

export interface ChatMessage {
  id: string;
  content: string;
  createdAt: string;
  timestamp: string;
  sender: string;
  senderId: string;
  senderImage?: string;
  receiverId: string;
  imageUrl?: string;
  audioUrl?: string;
  transcript?: string;
  deletedForEveryone?: boolean;
}
