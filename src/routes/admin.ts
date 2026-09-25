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
    staffingEnabled: z.boolean().optional(),
    standbyEnabled: z.boolean().optional(),
    completionReportRequired: z.boolean().optional(),
    completionStatement: z.string().trim().min(1).max(500).nullable().optional(),
    timezone: z.string().max(100).optional(),
    seriesId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).nullable().optional(),
    recurrenceRule: z.string().max(2000).nullable().optional(),
    occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
    try { return reply.code(201).send(dependencies.board.createEvent(input as EventInput)); }
    catch { return reply.code(409).send({error:"Event conflicts with existing state or validation rules"}); }
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
    try { return dependencies.board.updateEvent(id, patch as Partial<EventInput>); }
    catch { return reply.code(409).send({error:"Event conflicts with existing commitments or validation rules"}); }
  });

  app.get<{ Params: { id: string } }>("/api/admin/events/:id/signups", async (request, reply) => {
    const id = parsed(IdSchema, request.params.id, reply);
    if (id === null) return;
    if (!dependencies.board.getEvent(id)) return reply.code(404).send({ error: "Event not found" });
    return { signups: dependencies.board.listSignups(id) };
  });

  app.get<{Params:{id:string}}>("/api/admin/events/:id/staffing",async(request,reply)=>{
    const id=parsed(IdSchema,request.params.id,reply); if(id===null)return;
    if(!dependencies.board.getEvent(id))return reply.code(404).send({error:"Event not found"});
    return dependencies.board.staffing(id);
  });
  app.get("/api/admin/projection/snapshot",async()=>dependencies.board.projectionSnapshot());
  app.get("/api/admin/projection/pending",async()=>({pending:dependencies.board.pendingProjections()}));
  app.post("/api/admin/projection/ack",async(request,reply)=>{
    const input=parsed(z.object({ids:z.array(z.number().int().positive()).max(500)}),request.body,reply);if(!input)return;
    return {acknowledged:dependencies.board.acknowledgeProjections(input.ids)};
  });
  app.get<{Querystring:{after?:string}}>("/api/admin/projection/activity",async(request,reply)=>{
    const after=parsed(z.coerce.number().int().nonnegative(),request.query.after??0,reply);if(after===null)return;
    return {activity:dependencies.board.activity(after)};
  });
  const CategorySchema=z.object({key:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,31}$/),name:z.string().trim().min(1).max(100),capacity:z.number().int().min(0).max(10000),standbyEnabled:z.boolean(),active:z.boolean().optional(),sortOrder:z.number().int().nonnegative().optional()});
  app.put<{Params:{seriesId:string}}>("/api/admin/series/:seriesId/categories",async(request,reply)=>{
    const input=parsed(z.object({effectiveFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),eventName:z.string().trim().min(1).max(200).optional(),categories:z.array(CategorySchema).min(1).max(20)}),request.body,reply);if(!input)return;
    try {const result=dependencies.board.configureSeriesCategories(request.params.seriesId,input.effectiveFrom,input.categories,input.eventName);await deliverNotifications(dependencies.board,dependencies.smsSender,result.notifications);return {events:result.events};}
    catch{return reply.code(409).send({error:"Category configuration conflicts with keywords, commitments or event history"});}
  });
  app.put<{Params:{id:string}}>("/api/admin/events/:id/categories",async(request,reply)=>{
    const id=parsed(IdSchema,request.params.id,reply),input=parsed(z.object({categories:z.array(CategorySchema).min(1).max(20)}),request.body,reply);if(id===null||!input)return;
    try {const result=dependencies.board.configureEventCategories(id,input.categories);await deliverNotifications(dependencies.board,dependencies.smsSender,result.notifications);return {events:result.events};}
    catch{return reply.code(409).send({error:"Category configuration conflicts with keywords, commitments or event history"});}
  });
  app.post<{Params:{seriesId:string}}>("/api/admin/series/:seriesId/occurrences",async(request,reply)=>{
    const input=parsed(z.object({events:z.array(EventSchema).min(1).max(52)}),request.body,reply);if(!input)return;
    try {return {events:dependencies.board.materializeSeries(request.params.seriesId,input.events as EventInput[])};}
    catch{return reply.code(409).send({error:"Series occurrence conflicts with existing event; review required"});}
  });
  app.patch<{Params:{seriesId:string}}>("/api/admin/series/:seriesId",async(request,reply)=>{
    if (request.body && typeof request.body==='object' && 'occurrenceChanges' in request.body) {
      const changes=parsed(z.object({occurrenceChanges:z.array(z.object({id:IdSchema,patch:EventPatchSchema})).min(1).max(52)}),request.body,reply);if(!changes)return;
      try{return {events:dependencies.board.updateOccurrences(request.params.seriesId,changes.occurrenceChanges as {id:number;patch:Partial<EventInput>}[])};}
      catch{return reply.code(409).send({error:"Occurrence changes conflict with existing state"});}
    }
    const input=parsed(z.object({fromDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),patch:EventPatchSchema}),request.body,reply);if(!input)return;
    if(['slug','seriesId','occurrenceDate','startsAt','endsAt'].some(k=>k in input.patch))return reply.code(400).send({error:"Identity/time changes require explicit occurrence-specific updates"});
    try {return {events:dependencies.board.updateSeries(request.params.seriesId,input.fromDate,input.patch as Partial<EventInput>)};}
    catch{return reply.code(409).send({error:"Series update conflicts with existing state"});}
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
