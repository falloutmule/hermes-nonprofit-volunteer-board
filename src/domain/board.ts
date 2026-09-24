import type Database from "better-sqlite3";
import { SMS_MESSAGES, offerMessage } from "./messages.js";
import { parseSmsIntent } from "./sms-intent.js";

export const CONSENT_POLICY_VERSION = "2026-09-23";

export type EventStatus = "draft" | "published" | "cancelled" | "completed";
export type SignupStatus = "confirmed" | "standby" | "cancelled";

export interface EventInput {
  slug: string;
  name: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: EventStatus;
  staffingEnabled?: boolean;
  standbyEnabled?: boolean;
  completionReportRequired?: boolean;
  completionStatement?: string | null;
  timezone?: string;
  seriesId?: string | null;
  recurrenceRule?: string | null;
  occurrenceDate?: string | null;
}

export interface EventRecord extends EventInput {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  to: string;
  body: string;
  volunteerId: number;
  eventId: number;
  classification: "standby_offer";
}

export interface ProcessInboundInput {
  from: string;
  body: string;
  messageSid: string;
  optOutType?: string;
}

export interface ProcessResult {
  duplicate: boolean;
  classification: string;
  reply: string | null;
  notifications: Notification[];
}

interface VolunteerRow {
  id: number;
  phone_e164: string;
  sms_status: "pending" | "opted_in" | "opted_out";
}

interface EventRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: EventStatus;
  staffing_enabled: number;
  standby_enabled: number;
  completion_report_required: number;
  completion_statement: string | null;
  timezone: string;
  series_id: string | null;
  recurrence_rule: string | null;
  occurrence_date: string | null;
  created_at: string;
  updated_at: string;
}

interface SignupRow {
  id: number;
  event_id: number;
  volunteer_id: number;
  status: SignupStatus;
  standby_position: number | null;
}

interface OfferRow {
  id: number;
  opening_id: number;
  event_id: number;
  signup_id: number;
  volunteer_id: number;
}

function timestamp(): string {
  return new Date().toISOString();
}

function toEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    staffingEnabled: Boolean(row.staffing_enabled), standbyEnabled: Boolean(row.standby_enabled),
    completionReportRequired: Boolean(row.completion_report_required), completionStatement: row.completion_statement,
    timezone: row.timezone, seriesId: row.series_id, recurrenceRule: row.recurrence_rule, occurrenceDate: row.occurrence_date,
  };
}

export class VolunteerBoard {
  constructor(private readonly db: Database.Database) {}

  processInbound(input: ProcessInboundInput): ProcessResult {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE operation_context SET source='sms' WHERE id=1").run();
      const createdAt = timestamp();
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO sms_events
             (twilio_message_sid, direction, classification, twilio_opt_out_type, delivery_status, created_at)
           VALUES (?, 'inbound', 'received', ?, 'received', ?)`,
        )
        .run(input.messageSid, input.optOutType?.trim().toUpperCase() ?? null, createdAt);

      if (inserted.changes === 0) {
        return {
          duplicate: true,
          classification: "duplicate",
          reply: null,
          notifications: [],
        };
      }

      const volunteer = this.findOrCreateVolunteer(input.from);
      this.db
        .prepare("UPDATE sms_events SET volunteer_id = ? WHERE twilio_message_sid = ?")
        .run(volunteer.id, input.messageSid);

      const optOutType = input.optOutType?.trim().toUpperCase();
      const managedKeyword =
        optOutType === "STOP" || optOutType === "START" || optOutType === "HELP"
          ? optOutType
          : null;
      const intent = parseSmsIntent(managedKeyword ?? input.body);
      const consentSource = managedKeyword ? "twilio_opt_out_type" : "twilio_inbound";
      let result: Omit<ProcessResult, "duplicate">;

      switch (intent.kind) {
        case "done":
          result = this.completeBySms(volunteer, intent.eventKeyword);
          break;
        case "join":
          result = this.join(volunteer, input.messageSid, "JOIN", consentSource);
          break;
        case "help":
          result = this.help(volunteer, input.messageSid, consentSource);
          break;
        case "stop":
          result = this.stop(volunteer, input.messageSid, consentSource);
          break;
        case "start":
          result = this.join(volunteer, input.messageSid, "START", consentSource);
          break;
        case "drop":
          result = intent.eventKeyword
            ? this.dropByKeyword(volunteer, intent.eventKeyword)
            : {
                classification: "drop_missing_event",
                reply: SMS_MESSAGES.dropNeedsEvent,
                notifications: [],
              };
          break;
        case "yes":
          result = this.acceptOffer(volunteer);
          break;
        case "no":
          result = this.declineOffer(volunteer);
          break;
        case "event":
          result = this.signupByKeyword(volunteer, intent.keyword);
          break;
        case "unknown":
          result = {
            classification: "unknown",
            reply: SMS_MESSAGES.unknown,
            notifications: [],
          };
      }

      this.db
        .prepare(
          "UPDATE sms_events SET classification = ?, delivery_status = 'processed' WHERE twilio_message_sid = ?",
        )
        .run(result.classification, input.messageSid);
      return { duplicate: false, ...result };
    })();
  }

  private validateEvent(input: EventInput, id?: number): void {
    if (/^(JOIN|HELP|STOP|START|DROP|YES|NO|DONE)$/i.test(input.slug)) throw new Error("Reserved event keyword");
    if (!Number.isInteger(input.capacity) || input.capacity < 0 || input.endsAt <= input.startsAt) throw new Error("Invalid event definition");
    try { new Intl.DateTimeFormat('en-US', {timeZone:input.timezone ?? 'America/Denver'}); } catch { throw new Error("Invalid timezone"); }
    if (input.completionReportRequired && (!input.staffingEnabled || !input.completionStatement?.trim())) throw new Error("Completion reporting requires staffing and an approved statement");
    if (input.standbyEnabled && !input.staffingEnabled) throw new Error("Standby requires staffing");
    if (!!input.seriesId !== !!input.occurrenceDate) throw new Error("Series identity requires occurrence date");
    if (input.recurrenceRule) { try { JSON.parse(input.recurrenceRule); } catch { throw new Error("Invalid recurrence JSON"); } }
    if (id) {
      const counts=this.db.prepare("SELECT SUM(status='confirmed') confirmed,SUM(status IN ('confirmed','standby')) active FROM signups WHERE event_id=?").get(id) as {confirmed:number;active:number};
      const reserved=Number((this.db.prepare("SELECT COUNT(*) n FROM standby_openings WHERE event_id=? AND status='pending'").get(id) as {n:number}).n);
      if (!input.staffingEnabled && counts.active) throw new Error("Resolve active commitments before disabling staffing");
      if (input.capacity < (counts.confirmed ?? 0)+reserved) throw new Error("Capacity cannot be below commitments and reserved openings");
      if (!input.standbyEnabled && reserved) throw new Error("Resolve pending offers before disabling standby");
    }
  }

  createEvent(input: EventInput): EventRecord {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE operation_context SET source='admin_api' WHERE id=1").run();
      this.validateEvent(input);
      const now=timestamp();
      const result=this.db.prepare(`INSERT INTO events(slug,name,description,location,starts_at,ends_at,capacity,status,
        staffing_enabled,standby_enabled,completion_report_required,completion_statement,timezone,series_id,recurrence_rule,occurrence_date,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.slug.trim().toUpperCase(),input.name,input.description??null,input.location??null,
        input.startsAt,input.endsAt,input.capacity,input.status,Number(input.staffingEnabled??false),Number(input.standbyEnabled??false),
        Number(input.completionReportRequired??false),input.completionStatement??null,input.timezone??'America/Denver',input.seriesId??null,
        input.recurrenceRule??null,input.occurrenceDate??null,now,now);
      return this.getEvent(Number(result.lastInsertRowid))!;
    })();
  }

  updateEvent(id: number, patch: Partial<EventInput>): EventRecord | null {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE operation_context SET source='admin_api' WHERE id=1").run();
      const current=this.getEvent(id); if (!current) return null;
      const merged={...current,...patch}; this.validateEvent(merged,id);
      if (['completed','cancelled'].includes(current.status) && merged.status!==current.status) throw new Error("Closed events cannot be reopened");
      this.db.prepare(`UPDATE events SET slug=?,name=?,description=?,location=?,starts_at=?,ends_at=?,capacity=?,status=?,
        staffing_enabled=?,standby_enabled=?,completion_report_required=?,completion_statement=?,timezone=?,series_id=?,recurrence_rule=?,occurrence_date=?,updated_at=? WHERE id=?`)
        .run(merged.slug.toUpperCase(),merged.name,merged.description,merged.location,merged.startsAt,merged.endsAt,merged.capacity,merged.status,
          Number(merged.staffingEnabled),Number(merged.standbyEnabled),Number(merged.completionReportRequired),merged.completionStatement,
          merged.timezone,merged.seriesId,merged.recurrenceRule,merged.occurrenceDate,timestamp(),id);
      if (['completed','cancelled'].includes(merged.status)) this.closeOpenings(id);
      return this.getEvent(id);
    })();
  }

  materializeSeries(seriesId:string, inputs:EventInput[]): EventRecord[] {
    return this.db.transaction(() => inputs.map(input => {
      if (input.seriesId!==seriesId || !input.occurrenceDate || input.status!=='draft') throw new Error("Only draft series occurrences can be prepared");
      const existing=this.listEvents().find(e => (e.seriesId===seriesId && e.occurrenceDate===input.occurrenceDate) || e.slug===input.slug.toUpperCase());
      if (!existing) return this.createEvent(input);
      if (existing.seriesId===seriesId && existing.occurrenceDate===input.occurrenceDate) return existing;
      if (existing.seriesId || ['name','startsAt','endsAt','capacity','location','status'].some(key => ((existing as any)[key] ?? null) !== ((input as any)[key] ?? null))) throw new Error("Existing occurrence differs; explicit organizer review required");
      return this.updateEvent(existing.id,{seriesId,occurrenceDate:input.occurrenceDate,recurrenceRule:input.recurrenceRule??null,timezone:input.timezone??'America/Denver'})!;
    }))();
  }

  updateSeries(seriesId:string,fromDate:string,patch:Partial<EventInput>): EventRecord[] {
    return this.db.transaction(() => this.listEvents().filter(e=>e.seriesId===seriesId && e.occurrenceDate!>=fromDate && !['completed','cancelled'].includes(e.status)).map(e=>this.updateEvent(e.id,patch)!))();
  }

  updateOccurrences(seriesId:string,changes:{id:number;patch:Partial<EventInput>}[]):EventRecord[] {
    return this.db.transaction(()=>changes.map(({id,patch})=>{
      const event=this.getEvent(id);if(!event || event.seriesId!==seriesId)throw new Error("Occurrence is not in this series");
      if(['id','slug','seriesId','occurrenceDate'].some(k=>k in patch))throw new Error("Occurrence identity cannot change");
      return this.updateEvent(id,patch)!;
    }))();
  }

  private closeOpenings(eventId:number):void {
    const now=timestamp();
    this.db.prepare("UPDATE standby_offers SET status='cancelled',responded_at=?,updated_at=? WHERE event_id=? AND status='pending'").run(now,now,eventId);
    this.db.prepare("UPDATE standby_openings SET status='cancelled',updated_at=? WHERE event_id=? AND status='pending'").run(now,eventId);
  }

  private completeBySms(volunteer:VolunteerRow,keyword?:string):Omit<ProcessResult,'duplicate'> {
    const answer=(classification:string,reply:string)=>({classification,reply,notifications:[]});
    if (volunteer.sms_status!=='opted_in') return answer('done_requires_opt_in',SMS_MESSAGES.joinFirst);
    const rows=this.db.prepare(`SELECT e.* FROM events e JOIN signups s ON s.event_id=e.id
      WHERE s.volunteer_id=? AND s.status='confirmed' AND e.completion_report_required=1 AND e.staffing_enabled=1
      AND e.status IN ('published','completed')`).all(volunteer.id) as EventRow[];
    const eligible=rows.filter(e=>e.status==='published');
    // A delayed retry must never complete a different task after another task closed.
    if (!keyword && eligible.length && rows.some(e=>e.status==='completed')) {
      return answer('done_ambiguous','A previous assignment is already completed. To confirm another assignment, reply '+eligible.map(e=>`DONE ${e.slug} (${e.name})`).join('; '));
    }
    const event=keyword ? rows.find(e=>e.slug===keyword) : eligible.length===1 ? eligible[0] : undefined;
    if (!event) {
      if (!keyword && eligible.length>1) return answer('done_ambiguous','Which assignment? '+eligible.map(e=>`${e.name}: DONE ${e.slug}`).join('; '));
      if (!keyword && eligible.length===0 && rows.some(e=>e.status==='completed')) return answer('done_already_completed','Your reportable assignments are already completed.');
      return answer('done_not_found','No matching assigned task needs a completion report. Reply HELP for help.');
    }
    if (event.status==='completed') return answer('done_already_completed',`${event.name} is already completed.`);
    const now=timestamp();
    this.db.prepare('INSERT INTO event_completions(event_id,volunteer_id,statement,completed_at) VALUES(?,?,?,?)').run(event.id,volunteer.id,event.completion_statement!,now);
    this.db.prepare("UPDATE events SET status='completed',updated_at=? WHERE id=? AND status='published'").run(now,event.id);
    this.closeOpenings(event.id);
    return answer('done_completed',`Hermes Non-Profit: Completed: ${event.completion_statement}`);
  }

  staffing(eventId:number) {
    const signups=this.db.prepare(`SELECT s.id,s.event_id eventId,s.volunteer_id volunteerId,COALESCE(v.display_name,'Volunteer #'||v.id) displayName,
      s.status,s.standby_position standbyPosition,s.created_at createdAt,s.updated_at updatedAt,s.cancelled_at cancelledAt
      FROM signups s JOIN volunteers v ON v.id=s.volunteer_id WHERE s.event_id=? ORDER BY s.standby_position,s.id`).all(eventId) as {status:string}[];
    const offers=this.db.prepare(`SELECT id,event_id eventId,volunteer_id volunteerId,signup_id signupId,status,offered_at offeredAt,responded_at respondedAt
      FROM standby_offers WHERE event_id=? ORDER BY id`).all(eventId);
    const reservedCount=(this.db.prepare("SELECT COUNT(*) n FROM standby_openings WHERE event_id=? AND status='pending'").get(eventId) as {n:number}).n;
    const confirmedCount=signups.filter(s=>s.status==='confirmed').length,standbyCount=signups.filter(s=>s.status==='standby').length;
    const event=this.getEvent(eventId);
    return {signups,offers,completion:this.completion(eventId),confirmedCount,standbyCount,reservedCount,spotsAvailable:event?.staffingEnabled && event.status==='published' ? Math.max(0,event.capacity-confirmedCount-reservedCount):0};
  }

  private completion(eventId:number) {
    return this.db.prepare(`SELECT c.volunteer_id volunteerId,COALESCE(v.display_name,'Volunteer #'||v.id) displayName,
      c.completed_at completedAt,c.statement FROM event_completions c JOIN volunteers v ON v.id=c.volunteer_id WHERE c.event_id=?`).get(eventId)??null;
  }

  activity(after=0) {
    return this.db.prepare('SELECT id,event_id eventId,source,action,target,result,created_at createdAt FROM activity WHERE id>? ORDER BY id').all(after);
  }
  projectionSnapshot() {
    return this.db.transaction(() => {
      const events=this.listEvents().map(event=> {
        const {signups,offers,...counts}=this.staffing(event.id);
        const completion=this.completion(event.id);
        return {...event,...counts,completion};
      });
      return {events,staffing:events.flatMap(e=>this.staffing(e.id).signups),offers:events.flatMap(e=>this.staffing(e.id).offers),activity:this.activity(),generatedAt:timestamp()};
    })();
  }
  pendingProjections() { return this.db.prepare('SELECT id,activity_id activityId,created_at createdAt FROM projection_outbox WHERE acknowledged_at IS NULL ORDER BY id LIMIT 500').all(); }
  acknowledgeProjections(ids:number[]) { return this.db.transaction(()=>ids.reduce((n,id)=>n+this.db.prepare('UPDATE projection_outbox SET acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL').run(timestamp(),id).changes,0))(); }

  getEvent(id: number): EventRecord | null {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as
      | EventRow
      | undefined;
    return row ? toEvent(row) : null;
  }

  listEvents(): EventRecord[] {
    return (this.db.prepare("SELECT * FROM events ORDER BY starts_at, id").all() as EventRow[]).map(
      toEvent,
    );
  }

  listPublicEvents(): Array<EventRecord & { confirmedCount: number; spotsAvailable: number }> {
    const rows = this.db
      .prepare(
        `SELECT e.*,
          COUNT(DISTINCT CASE WHEN s.status = 'confirmed' THEN s.id END) AS confirmed_count,
          (SELECT COUNT(*) FROM standby_openings o
           WHERE o.event_id = e.id AND o.status = 'pending') AS reserved_count
         FROM events e
         LEFT JOIN signups s ON s.event_id = e.id
         WHERE e.status = 'published'
         GROUP BY e.id
         ORDER BY e.starts_at, e.id`,
      )
      .all() as Array<EventRow & { confirmed_count: number; reserved_count: number }>;
    return rows.map((row) => ({
      ...toEvent(row),
      confirmedCount: Number(row.confirmed_count),
      spotsAvailable: row.staffing_enabled ? Math.max(
        0,
        row.capacity - Number(row.confirmed_count) - Number(row.reserved_count),
      ) : 0,
    }));
  }

  listSignups(eventId: number): unknown[] {
    return this.db
      .prepare(
        `SELECT s.id, s.event_id AS eventId, s.volunteer_id AS volunteerId, s.status,
          s.standby_position AS standbyPosition, s.created_at AS createdAt,
          s.updated_at AS updatedAt, s.cancelled_at AS cancelledAt,
          v.display_name AS displayName, v.sms_status AS smsStatus
         FROM signups s JOIN volunteers v ON v.id = s.volunteer_id
         WHERE s.event_id = ?
         ORDER BY CASE s.status WHEN 'confirmed' THEN 0 WHEN 'standby' THEN 1 ELSE 2 END,
                  s.standby_position, s.created_at, s.id`,
      )
      .all(eventId);
  }

  getVolunteer(id: number): VolunteerRow | null {
    return (
      (this.db
        .prepare("SELECT id, phone_e164, sms_status FROM volunteers WHERE id = ?")
        .get(id) as VolunteerRow | undefined) ?? null
    );
  }

  dropSignupById(signupId: number): ProcessResult | null {
    return this.db.transaction(() => {
      this.db.prepare("UPDATE operation_context SET source='admin_api' WHERE id=1").run();
      const signup = this.db.prepare("SELECT * FROM signups WHERE id = ?").get(signupId) as
        | SignupRow
        | undefined;
      if (!signup || signup.status === "cancelled" || this.getEvent(signup.event_id)?.status !== "published") return null;
      const notifications: Notification[] = [];
      this.cancelSignup(signup, notifications);
      return {
        duplicate: false,
        classification: "admin_drop",
        reply: null,
        notifications,
      };
    })();
  }

  recordOutbound(
    notification: { volunteerId: number; eventId?: number; classification: string },
    messageSid: string | null,
    deliveryStatus: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO sms_events
          (twilio_message_sid, direction, volunteer_id, event_id, classification, delivery_status, created_at)
         VALUES (?, 'outbound', ?, ?, ?, ?, ?)`,
      )
      .run(
        messageSid,
        notification.volunteerId,
        notification.eventId ?? null,
        notification.classification,
        deliveryStatus,
        timestamp(),
      );
  }

  private findOrCreateVolunteer(phone: string): VolunteerRow {
    const existing = this.db
      .prepare("SELECT id, phone_e164, sms_status FROM volunteers WHERE phone_e164 = ?")
      .get(phone) as VolunteerRow | undefined;
    if (existing) return existing;
    const now = timestamp();
    const result = this.db
      .prepare(
        `INSERT INTO volunteers(phone_e164, sms_status, created_at, updated_at)
         VALUES (?, 'pending', ?, ?)`,
      )
      .run(phone, now, now);
    return {
      id: Number(result.lastInsertRowid),
      phone_e164: phone,
      sms_status: "pending",
    };
  }

  private join(
    volunteer: VolunteerRow,
    messageSid: string,
    keyword: "JOIN" | "START",
    source: "twilio_inbound" | "twilio_opt_out_type",
  ): Omit<ProcessResult, "duplicate"> {
    if (keyword === "JOIN" && volunteer.sms_status === "opted_out") {
      return {
        classification: "join_requires_start",
        reply: SMS_MESSAGES.stopped,
        notifications: [],
      };
    }
    if (keyword === "START" && volunteer.sms_status !== "opted_out") {
      return {
        classification: "start_not_opted_out",
        reply:
          volunteer.sms_status === "opted_in" ? SMS_MESSAGES.joined : SMS_MESSAGES.joinFirst,
        notifications: [],
      };
    }
    const now = timestamp();
    this.db
      .prepare("UPDATE volunteers SET sms_status = 'opted_in', updated_at = ? WHERE id = ?")
      .run(now, volunteer.id);
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, policy_version, created_at)
         VALUES (?, 'opt_in', ?, ?, ?, ?, ?)`,
      )
      .run(volunteer.id, source, keyword, messageSid, CONSENT_POLICY_VERSION, now);
    return {
      classification: keyword === "START" ? "start" : "join",
      reply: SMS_MESSAGES.joined,
      notifications: [],
    };
  }

  private help(
    volunteer: VolunteerRow,
    messageSid: string,
    source: "twilio_inbound" | "twilio_opt_out_type",
  ): Omit<ProcessResult, "duplicate"> {
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, policy_version, created_at)
         VALUES (?, 'help', ?, 'HELP', ?, ?, ?)`,
      )
      .run(volunteer.id, source, messageSid, CONSENT_POLICY_VERSION, timestamp());
    return { classification: "help", reply: SMS_MESSAGES.help, notifications: [] };
  }

  private stop(
    volunteer: VolunteerRow,
    messageSid: string,
    source: "twilio_inbound" | "twilio_opt_out_type",
  ): Omit<ProcessResult, "duplicate"> {
    const now = timestamp();
    this.db
      .prepare("UPDATE volunteers SET sms_status = 'opted_out', updated_at = ? WHERE id = ?")
      .run(now, volunteer.id);
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, policy_version, created_at)
         VALUES (?, 'opt_out', ?, 'STOP', ?, ?, ?)`,
      )
      .run(volunteer.id, source, messageSid, CONSENT_POLICY_VERSION, now);
    const notifications: Notification[] = [];
    const pendingOffers = this.db
      .prepare("SELECT * FROM standby_offers WHERE volunteer_id = ? AND status = 'pending'")
      .all(volunteer.id) as OfferRow[];
    for (const offer of pendingOffers) {
      this.db
        .prepare(
          "UPDATE standby_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, offer.id);
      this.advanceOfferChain(offer.event_id, notifications);
    }
    return { classification: "stop", reply: SMS_MESSAGES.stopped, notifications };
  }

  private signupByKeyword(
    volunteer: VolunteerRow,
    keyword: string,
  ): Omit<ProcessResult, "duplicate"> {
    const event = this.db
      .prepare("SELECT * FROM events WHERE slug = ? AND status = 'published'")
      .get(keyword) as EventRow | undefined;
    if (!event) {
      return { classification: "unknown", reply: SMS_MESSAGES.unknown, notifications: [] };
    }
    if (!event.staffing_enabled) return {classification:"signup_disabled",reply:"This event does not need volunteer signups.",notifications:[]};
    if (volunteer.sms_status !== "opted_in") {
      return {
        classification: "signup_requires_opt_in",
        reply: SMS_MESSAGES.joinFirst,
        notifications: [],
      };
    }
    const existing = this.db
      .prepare(
        "SELECT * FROM signups WHERE event_id = ? AND volunteer_id = ? AND status IN ('confirmed', 'standby')",
      )
      .get(event.id, volunteer.id) as SignupRow | undefined;
    if (existing) {
      return {
        classification: "signup_existing",
        reply: `You are already ${existing.status} for ${event.name}.`,
        notifications: [],
      };
    }

    const counts = this.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM signups WHERE event_id = ? AND status = 'confirmed') AS confirmed,
          (SELECT COUNT(*) FROM standby_openings WHERE event_id = ? AND status = 'pending') AS reserved`,
      )
      .get(event.id, event.id) as { confirmed: number; reserved: number };
    const status: SignupStatus =
      counts.confirmed + counts.reserved < event.capacity ? "confirmed" : "standby";
    if (status === "standby" && !event.standby_enabled) return {classification:"signup_full",reply:"This event is full and has no standby list.",notifications:[]};
    const standbyPosition =
      status === "standby"
        ? Number(
            (
              this.db
                .prepare(
                  "SELECT COALESCE(MAX(standby_position), 0) + 1 AS next FROM signups WHERE event_id = ?",
                )
                .get(event.id) as { next: number }
            ).next,
          )
        : null;
    const now = timestamp();
    this.db
      .prepare(
        `INSERT INTO signups
          (event_id, volunteer_id, status, standby_position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(event.id, volunteer.id, status, standbyPosition, now, now);
    return {
      classification: `signup_${status}`,
      reply:
        status === "confirmed"
          ? `Hermes Non-Profit: You're signed up for ${event.name}.${event.completion_report_required ? ` When finished, reply DONE ${event.slug}.` : ''} Reply DROP ${event.slug} to cancel this event. Reply STOP to opt out of all texts.`
          : `Hermes Non-Profit: ${event.name} is full. You are standby position ${standbyPosition}. Reply STOP to opt out.`,
      notifications: [],
    };
  }

  private dropByKeyword(
    volunteer: VolunteerRow,
    keyword: string,
  ): Omit<ProcessResult, "duplicate"> {
    const event = this.db.prepare("SELECT * FROM events WHERE slug = ?").get(keyword) as
      | EventRow
      | undefined;
    if (!event || event.status !== "published") {
      return { classification: "drop_not_found", reply: SMS_MESSAGES.noSignup, notifications: [] };
    }
    const signup = this.db
      .prepare(
        "SELECT * FROM signups WHERE event_id = ? AND volunteer_id = ? AND status IN ('confirmed', 'standby')",
      )
      .get(event.id, volunteer.id) as SignupRow | undefined;
    if (!signup) {
      return { classification: "drop_not_found", reply: SMS_MESSAGES.noSignup, notifications: [] };
    }
    const priorStatus = signup.status;
    const notifications: Notification[] = [];
    this.cancelSignup(signup, notifications);
    return {
      classification: `drop_${priorStatus}`,
      reply: `Hermes Non-Profit: Your signup for ${event.name} has been cancelled. You remain enrolled in volunteer SMS coordination. Reply STOP to opt out of all texts.`,
      notifications,
    };
  }

  private cancelSignup(signup: SignupRow, notifications: Notification[]): void {
    const now = timestamp();
    this.db
      .prepare(
        "UPDATE signups SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, signup.id);
    const pendingOffer = this.db
      .prepare("SELECT * FROM standby_offers WHERE signup_id = ? AND status = 'pending'")
      .get(signup.id) as OfferRow | undefined;
    if (pendingOffer) {
      this.db
        .prepare(
          "UPDATE standby_offers SET status = 'cancelled', responded_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, pendingOffer.id);
    }
    const event=this.getEvent(signup.event_id);
    if (signup.status === "confirmed" && event?.status === "published" && event.standbyEnabled) {
      this.db
        .prepare(
          "INSERT INTO standby_openings(event_id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
        )
        .run(signup.event_id, now, now);
    }
    this.advanceOfferChain(signup.event_id, notifications);
  }

  private acceptOffer(volunteer: VolunteerRow): Omit<ProcessResult, "duplicate"> {
    const offers = this.db
      .prepare("SELECT * FROM standby_offers WHERE volunteer_id = ? AND status = 'pending'")
      .all(volunteer.id) as OfferRow[];
    if (offers.length !== 1) {
      return { classification: "offer_missing", reply: SMS_MESSAGES.noOffer, notifications: [] };
    }
    const offer = offers[0] as OfferRow;
    const event = this.db.prepare("SELECT * FROM events WHERE id = ?").get(offer.event_id) as EventRow;
    const signup = this.db.prepare("SELECT * FROM signups WHERE id = ?").get(offer.signup_id) as SignupRow;
    const confirmed = Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM signups WHERE event_id = ? AND status = 'confirmed'")
          .get(event.id) as { count: number }
      ).count,
    );
    const now = timestamp();
    if (confirmed >= event.capacity || signup.status !== "standby" || event.status!=="published" || !event.staffing_enabled || !event.standby_enabled || volunteer.sms_status!=="opted_in") {
      this.db
        .prepare(
          "UPDATE standby_offers SET status = 'expired', responded_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(now, now, offer.id);
      this.db
        .prepare("UPDATE standby_openings SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now, offer.opening_id);
      return {
        classification: "offer_conflict",
        reply: SMS_MESSAGES.offerConflict,
        notifications: [],
      };
    }
    const accepted = this.db
      .prepare(
        "UPDATE standby_offers SET status = 'accepted', responded_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(now, now, offer.id);
    if (accepted.changes !== 1) {
      return { classification: "offer_missing", reply: SMS_MESSAGES.noOffer, notifications: [] };
    }
    this.db
      .prepare("UPDATE signups SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'standby'")
      .run(now, signup.id);
    this.db
      .prepare("UPDATE standby_openings SET status = 'filled', updated_at = ? WHERE id = ?")
      .run(now, offer.opening_id);
    const notifications: Notification[] = [];
    this.advanceOfferChain(event.id, notifications);
    return {
      classification: "offer_accepted",
      reply: `Hermes Non-Profit: You're now confirmed for ${event.name}.${event.completion_report_required ? ` When finished, reply DONE ${event.slug}.` : ''} Reply STOP to opt out.`,
      notifications,
    };
  }

  private declineOffer(volunteer: VolunteerRow): Omit<ProcessResult, "duplicate"> {
    const offers = this.db
      .prepare("SELECT * FROM standby_offers WHERE volunteer_id = ? AND status = 'pending'")
      .all(volunteer.id) as OfferRow[];
    if (offers.length !== 1) {
      return { classification: "offer_missing", reply: SMS_MESSAGES.noOffer, notifications: [] };
    }
    const offer = offers[0] as OfferRow;
    const now = timestamp();
    this.db
      .prepare(
        "UPDATE standby_offers SET status = 'declined', responded_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(now, now, offer.id);
    const notifications: Notification[] = [];
    this.advanceOfferChain(offer.event_id, notifications);
    return {
      classification: "offer_declined",
      reply: "Hermes Non-Profit: You declined this opening and remain on standby. Reply STOP to opt out.",
      notifications,
    };
  }

  private advanceOfferChain(eventId: number, notifications: Notification[]): void {
    const event=this.getEvent(eventId);
    if (!event || event.status!=="published" || !event.staffingEnabled || !event.standbyEnabled) return;
    const existingPending = this.db
      .prepare("SELECT id FROM standby_offers WHERE event_id = ? AND status = 'pending'")
      .get(eventId);
    if (existingPending) return;

    while (true) {
      const opening = this.db
        .prepare(
          "SELECT id FROM standby_openings WHERE event_id = ? AND status = 'pending' ORDER BY id LIMIT 1",
        )
        .get(eventId) as { id: number } | undefined;
      if (!opening) return;
      const candidate = this.db
        .prepare(
          `SELECT s.id AS signup_id, s.volunteer_id, v.phone_e164, e.name, e.slug
           FROM signups s
           JOIN volunteers v ON v.id = s.volunteer_id
           JOIN events e ON e.id = s.event_id
           WHERE s.event_id = ? AND s.status = 'standby' AND v.sms_status = 'opted_in'
             AND NOT EXISTS (
               SELECT 1 FROM standby_offers prior
               WHERE prior.opening_id = ? AND prior.signup_id = s.id
             )
           ORDER BY s.standby_position, s.created_at, s.id
           LIMIT 1`,
        )
        .get(eventId, opening.id) as
        | { signup_id: number; volunteer_id: number; phone_e164: string; name: string; slug: string }
        | undefined;
      if (!candidate) {
        this.db
          .prepare("UPDATE standby_openings SET status = 'exhausted', updated_at = ? WHERE id = ?")
          .run(timestamp(), opening.id);
        continue;
      }
      const now = timestamp();
      this.db
        .prepare(
          `INSERT INTO standby_offers
            (opening_id, event_id, signup_id, volunteer_id, status, offered_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          opening.id,
          eventId,
          candidate.signup_id,
          candidate.volunteer_id,
          now,
          now,
          now,
        );
      notifications.push({
        to: candidate.phone_e164,
        body: offerMessage(candidate.name, candidate.slug),
        volunteerId: candidate.volunteer_id,
        eventId,
        classification: "standby_offer",
      });
      return;
    }
  }
}
