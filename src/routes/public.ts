import type { FastifyInstance } from "fastify";
import type { VolunteerBoard } from "../domain/board.js";

export async function registerPublicRoutes(
  app: FastifyInstance,
  board: VolunteerBoard,
): Promise<void> {
  app.get("/health", async () => ({ ok: true }));
  app.get("/api/public/events", async () => ({ events: board.listPublicEvents() }));
  app.get("/styles.css", async (_request, reply) =>
    reply.type("text/css; charset=utf-8").sendFile("styles.css"),
  );
  app.get("/", async (_request, reply) => reply.type("text/html").sendFile("index.html"));
  app.get("/calendar/", async (_request, reply) =>
    reply.type("text/html").sendFile("calendar/index.html"),
  );
  app.get("/privacy/", async (_request, reply) =>
    reply.type("text/html").sendFile("privacy/index.html"),
  );
  app.get("/terms/", async (_request, reply) =>
    reply.type("text/html").sendFile("terms/index.html"),
  );
}
