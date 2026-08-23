import type { FastifyInstance } from "fastify";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import twilio from "twilio";
import type { AppConfig } from "../config.js";
import type { VolunteerBoard } from "../domain/board.js";
import { deliverNotifications } from "../services/delivery.js";
import type { SmsSender } from "../services/twilio.js";

interface TwilioInboundBody {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  [key: string]: string | undefined;
}

function normalizePhone(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, "US");
  return parsed?.isValid() ? parsed.number : null;
}

export async function registerTwilioInbound(
  app: FastifyInstance,
  dependencies: { config: AppConfig; board: VolunteerBoard; smsSender: SmsSender },
): Promise<void> {
  app.post<{ Body: TwilioInboundBody }>("/webhooks/twilio/inbound", async (request, reply) => {
    const authToken = dependencies.config.twilioAuthToken;
    if (!authToken) {
      return reply.code(503).send({ error: "Twilio webhook validation is not configured" });
    }
    const signature = request.headers["x-twilio-signature"];
    if (typeof signature !== "string") {
      return reply.code(403).send({ error: "Invalid Twilio signature" });
    }
    const webhookUrl = `${dependencies.config.publicBaseUrl}${request.url}`;
    const parameters = Object.fromEntries(
      Object.entries(request.body).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    if (!twilio.validateRequest(authToken, signature, webhookUrl, parameters)) {
      return reply.code(403).send({ error: "Invalid Twilio signature" });
    }
    const { From, Body, MessageSid } = request.body;
    if (!From || Body === undefined || !MessageSid) {
      return reply.code(400).send({ error: "From, Body, and MessageSid are required" });
    }
    const phone = normalizePhone(From);
    if (!phone) {
      return reply.code(400).send({ error: "From must be a valid phone number" });
    }

    const result = dependencies.board.processInbound({ from: phone, body: Body, messageSid: MessageSid });
    await deliverNotifications(dependencies.board, dependencies.smsSender, result.notifications);
    const response = new twilio.twiml.MessagingResponse();
    if (result.reply) response.message(result.reply);
    return reply.type("text/xml; charset=utf-8").send(response.toString());
  });
}
