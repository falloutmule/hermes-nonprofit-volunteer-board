import type Database from "better-sqlite3";
import { PLACEHOLDER_MESSAGES, offerMessage } from "./messages.js";
import { parseSmsIntent } from "./sms-intent.js";

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
}

export interface EventRecord {
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
  };
}

export class VolunteerBoard {
  constructor(private readonly db: Database.Database) {}

  processInbound(input: ProcessInboundInput): ProcessResult {
    return this.db.transaction(() => {
      const createdAt = timestamp();
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO sms_events
             (twilio_message_sid, direction, classification, delivery_status, created_at)
           VALUES (?, 'inbound', 'received', 'received', ?)`,
        )
        .run(input.messageSid, createdAt);

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

      const intent = parseSmsIntent(input.body);
      let result: Omit<ProcessResult, "duplicate">;

      switch (intent.kind) {
        case "join":
          result = this.join(volunteer, input.messageSid);
          break;
        case "help":
          result = this.help(volunteer, input.messageSid);
          break;
        case "stop":
          result = this.stop(volunteer, input.messageSid);
          break;
        case "drop":
          result = intent.eventKeyword
            ? this.dropByKeyword(volunteer, intent.eventKeyword)
            : {
                classification: "drop_missing_event",
                reply: PLACEHOLDER_MESSAGES.dropNeedsEvent,
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
            reply: PLACEHOLDER_MESSAGES.unknown,
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

  createEvent(input: EventInput): EventRecord {
    const now = timestamp();
    const slug = input.slug.trim().toUpperCase();
    const result = this.db
      .prepare(
        `INSERT INTO events
          (slug, name, description, location, starts_at, ends_at, capacity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        input.name,
        input.description ?? null,
        input.location ?? null,
        input.startsAt,
        input.endsAt,
        input.capacity,
        input.status,
        now,
        now,
      );
    return this.getEvent(Number(result.lastInsertRowid)) as EventRecord;
  }

  updateEvent(id: number, patch: Partial<EventInput>): EventRecord | null {
    const current = this.getEvent(id);
    if (!current) return null;
    const merged: EventInput = {
      slug: patch.slug ?? current.slug,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      location: patch.location === undefined ? current.location : patch.location,
      startsAt: patch.startsAt ?? current.startsAt,
      endsAt: patch.endsAt ?? current.endsAt,
      capacity: patch.capacity ?? current.capacity,
      status: patch.status ?? current.status,
    };
    this.db
      .prepare(
        `UPDATE events SET slug = ?, name = ?, description = ?, location = ?, starts_at = ?,
          ends_at = ?, capacity = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        merged.slug.trim().toUpperCase(),
        merged.name,
        merged.description ?? null,
        merged.location ?? null,
        merged.startsAt,
        merged.endsAt,
        merged.capacity,
        merged.status,
        timestamp(),
        id,
      );
    return this.getEvent(id);
  }

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
      spotsAvailable: Math.max(
        0,
        row.capacity - Number(row.confirmed_count) - Number(row.reserved_count),
      ),
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
      const signup = this.db.prepare("SELECT * FROM signups WHERE id = ?").get(signupId) as
        | SignupRow
        | undefined;
      if (!signup || signup.status === "cancelled") return null;
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

  private join(volunteer: VolunteerRow, messageSid: string): Omit<ProcessResult, "duplicate"> {
    const now = timestamp();
    this.db
      .prepare("UPDATE volunteers SET sms_status = 'opted_in', updated_at = ? WHERE id = ?")
      .run(now, volunteer.id);
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, created_at)
         VALUES (?, 'opt_in', 'twilio_inbound', 'JOIN', ?, ?)`,
      )
      .run(volunteer.id, messageSid, now);
    return { classification: "join", reply: PLACEHOLDER_MESSAGES.joined, notifications: [] };
  }

  private help(volunteer: VolunteerRow, messageSid: string): Omit<ProcessResult, "duplicate"> {
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, created_at)
         VALUES (?, 'help', 'twilio_inbound', 'HELP', ?, ?)`,
      )
      .run(volunteer.id, messageSid, timestamp());
    return { classification: "help", reply: PLACEHOLDER_MESSAGES.help, notifications: [] };
  }

  private stop(volunteer: VolunteerRow, messageSid: string): Omit<ProcessResult, "duplicate"> {
    const now = timestamp();
    this.db
      .prepare("UPDATE volunteers SET sms_status = 'opted_out', updated_at = ? WHERE id = ?")
      .run(now, volunteer.id);
    this.db
      .prepare(
        `INSERT INTO consent_events
          (volunteer_id, action, source, keyword, twilio_message_sid, created_at)
         VALUES (?, 'opt_out', 'twilio_inbound', 'STOP', ?, ?)`,
      )
      .run(volunteer.id, messageSid, now);
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
    return { classification: "stop", reply: PLACEHOLDER_MESSAGES.stopped, notifications };
  }

  private signupByKeyword(
    volunteer: VolunteerRow,
    keyword: string,
  ): Omit<ProcessResult, "duplicate"> {
    const event = this.db
      .prepare("SELECT * FROM events WHERE slug = ? AND status = 'published'")
      .get(keyword) as EventRow | undefined;
    if (!event) {
      return { classification: "unknown", reply: PLACEHOLDER_MESSAGES.unknown, notifications: [] };
    }
    if (volunteer.sms_status !== "opted_in") {
      return {
        classification: "signup_requires_opt_in",
        reply: PLACEHOLDER_MESSAGES.joinFirst,
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
          ? `TEST COPY: You are confirmed for ${event.name}. Reply DROP ${event.slug} to cancel this event.`
          : `TEST COPY: ${event.name} is full. You are standby position ${standbyPosition}.`,
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
    if (!event) {
      return { classification: "drop_not_found", reply: PLACEHOLDER_MESSAGES.noSignup, notifications: [] };
    }
    const signup = this.db
      .prepare(
        "SELECT * FROM signups WHERE event_id = ? AND volunteer_id = ? AND status IN ('confirmed', 'standby')",
      )
      .get(event.id, volunteer.id) as SignupRow | undefined;
    if (!signup) {
      return { classification: "drop_not_found", reply: PLACEHOLDER_MESSAGES.noSignup, notifications: [] };
    }
    const priorStatus = signup.status;
    const notifications: Notification[] = [];
    this.cancelSignup(signup, notifications);
    return {
      classification: `drop_${priorStatus}`,
      reply: `TEST COPY: Your ${event.name} signup was cancelled.`,
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
    if (signup.status === "confirmed") {
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
      return { classification: "offer_missing", reply: PLACEHOLDER_MESSAGES.noOffer, notifications: [] };
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
    if (confirmed >= event.capacity || signup.status !== "standby") {
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
        reply: PLACEHOLDER_MESSAGES.offerConflict,
        notifications: [],
      };
    }
    const accepted = this.db
      .prepare(
        "UPDATE standby_offers SET status = 'accepted', responded_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(now, now, offer.id);
    if (accepted.changes !== 1) {
      return { classification: "offer_missing", reply: PLACEHOLDER_MESSAGES.noOffer, notifications: [] };
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
      reply: `TEST COPY: You are now confirmed for ${event.name}.`,
      notifications,
    };
  }

  private declineOffer(volunteer: VolunteerRow): Omit<ProcessResult, "duplicate"> {
    const offers = this.db
      .prepare("SELECT * FROM standby_offers WHERE volunteer_id = ? AND status = 'pending'")
      .all(volunteer.id) as OfferRow[];
    if (offers.length !== 1) {
      return { classification: "offer_missing", reply: PLACEHOLDER_MESSAGES.noOffer, notifications: [] };
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
      reply: "TEST COPY: You declined this opening and remain on standby.",
      notifications,
    };
  }

  private advanceOfferChain(eventId: number, notifications: Notification[]): void {
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
