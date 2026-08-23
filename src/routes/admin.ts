import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { EventInput, VolunteerBoard } from "../domain/board.js";
import { deliverNotifications } from "../services/delivery.js";
import type { SmsSender } from "../services/twilio.js";

const EventFields = z.object({
    slug: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: z.number().int().nonnegative(),
    status: z.enum(["draft", "published", "cancelled", "completed"]),
  });

const EventSchema = EventFields.refine((event) => event.endsAt > event.startsAt, {
    message: "endsAt must be later than startsAt",
  });

const EventPatchSchema = EventFields.partial().refine(
  (event) => !event.startsAt || !event.endsAt || event.endsAt > event.startsAt,
  { message: "endsAt must be later than startsAt" },
);
const IdSchema = z.coerce.number().int().positive();
const MessageSchema = z.object({
  volunteerId: z.number().int().positive(),
  body: z.string().trim().min(1).max(1600),
  eventId: z.number().int().positive().optional(),
});

function parsed<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    void reply.code(400).send({ error: "Invalid request", issues: result.error.issues });
    return null;
  }
  return result.data;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; board: VolunteerBoard; smsSender: SmsSender },
): Promise<void> {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith("/api/admin/")) return;
    if (!dependencies.config.adminApiToken) {
      return reply.code(503).send({ error: "Admin API is not configured" });
    }
    if (request.headers.authorization !== `Bearer ${dependencies.config.adminApiToken}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/api/admin/events", async () => ({ events: dependencies.board.listEvents() }));

  app.get<{ Params: { id: string } }>("/api/admin/events/:id", async (request, reply) => {
    const id = parsed(IdSchema, request.params.id, reply);
    if (id === null) return;
    const event = dependencies.board.getEvent(id);
    return event ?? reply.code(404).send({ error: "Event not found" });
  });

  app.post("/api/admin/events", async (request, reply) => {
    const input = parsed(EventSchema, request.body, reply);
    if (!input) return;
    const event = dependencies.board.createEvent(input as EventInput);
    return reply.code(201).send(event);
  });

  app.patch<{ Params: { id: string } }>("/api/admin/events/:id", async (request, reply) => {
    const id = parsed(IdSchema, request.params.id, reply);
    const patch = parsed(EventPatchSchema, request.body, reply);
    if (id === null || !patch) return;
    const current = dependencies.board.getEvent(id);
    if (!current) return reply.code(404).send({ error: "Event not found" });
    const merged = EventSchema.safeParse({
      slug: patch.slug ?? current.slug,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      location: patch.location === undefined ? current.location : patch.location,
      startsAt: patch.startsAt ?? current.startsAt,
      endsAt: patch.endsAt ?? current.endsAt,
      capacity: patch.capacity ?? current.capacity,
      status: patch.status ?? current.status,
    });
    if (!merged.success) {
      return reply.code(400).send({ error: "Invalid request", issues: merged.error.issues });
    }
    return dependencies.board.updateEvent(id, patch as Partial<EventInput>);
  });

  app.get<{ Params: { id: string } }>("/api/admin/events/:id/signups", async (request, reply) => {
    const id = parsed(IdSchema, request.params.id, reply);
    if (id === null) return;
    if (!dependencies.board.getEvent(id)) return reply.code(404).send({ error: "Event not found" });
    return { signups: dependencies.board.listSignups(id) };
  });

  app.post<{ Params: { id: string } }>("/api/admin/signups/:id/drop", async (request, reply) => {
    const id = parsed(IdSchema, request.params.id, reply);
    if (id === null) return;
    const result = dependencies.board.dropSignupById(id);
    if (!result) return reply.code(404).send({ error: "Active signup not found" });
    await deliverNotifications(dependencies.board, dependencies.smsSender, result.notifications);
    return { dropped: true };
  });

  app.post("/api/admin/messages/send", async (request, reply) => {
    const input = parsed(MessageSchema, request.body, reply);
    if (!input) return;
    const volunteer = dependencies.board.getVolunteer(input.volunteerId);
    if (!volunteer) return reply.code(404).send({ error: "Volunteer not found" });
    if (volunteer.sms_status !== "opted_in") {
      return reply.code(409).send({ error: "Volunteer is not opted in" });
    }
    try {
      const result = await dependencies.smsSender.send(volunteer.phone_e164, input.body);
      dependencies.board.recordOutbound(
        {
          volunteerId: volunteer.id,
          ...(input.eventId ? { eventId: input.eventId } : {}),
          classification: "admin_message",
        },
        result.messageSid,
        result.status,
      );
      return reply.code(202).send(result);
    } catch {
      dependencies.board.recordOutbound(
        {
          volunteerId: volunteer.id,
          ...(input.eventId ? { eventId: input.eventId } : {}),
          classification: "admin_message",
        },
        null,
        "failed",
      );
      return reply.code(503).send({ error: "Outbound SMS is unavailable" });
    }
  });
}
