import { Server as NetServer } from "http";
import { NextApiRequest } from "next";
import { Server as ServerIO } from "socket.io";
import { NextApiResponseServerIo } from "../../../types";

export const config = {
  api: {
    bodyParser: false,
  },
};

const ioHandler = (req: NextApiRequest, res: NextApiResponseServerIo) => {
  if (!res.socket.server.io) {
    const httpServer = res.socket.server as unknown as NetServer;
    const io = new ServerIO(httpServer, {
      path: "/api/socket/io",
      addTrailingSlash: false,
    });
    res.socket.server.io = io;

    io.on("connection", (socket) => {
      console.log("New Client Connected:", socket.id);

      socket.on("register-user", (userId: string) => {
        if (!userId) {
          return;
        }

        socket.join(`user:${userId}`);
      });

      socket.on("send-message", (data) => {
        if (!data?.senderId || !data?.receiverId) {
          return;
        }

        io.to(`user:${data.senderId}`).to(`user:${data.receiverId}`).emit("receive-message", data);
      });

      socket.on("typing", (data) => {
        if (!data?.receiverId) {
          return;
        }

        io.to(`user:${data.receiverId}`).emit("display-typing", data);
      });

      socket.on("delete-message", (data) => {
        if (!data?.senderId || !data?.receiverId || !data?.message) {
          return;
        }

        io.to(`user:${data.senderId}`)
          .to(`user:${data.receiverId}`)
          .emit("message-deleted", data);
      });

      socket.on("disconnect", () => {
        console.log("Client Disconnected");
      });
    });
  }

  res.status(200).json({ ok: true });
};

export default ioHandler;
