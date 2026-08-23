import twilio from "twilio";

export interface SendResult {
  messageSid: string;
  status: string;
}

export interface SmsSender {
  send(to: string, body: string): Promise<SendResult>;
}

export class TwilioSmsSender implements SmsSender {
  private readonly client: ReturnType<typeof twilio>;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly options: { from?: string; messagingServiceSid?: string },
  ) {
    if (!options.from && !options.messagingServiceSid) {
      throw new Error("Twilio sender requires a phone number or Messaging Service SID");
    }
    this.client = twilio(accountSid, authToken);
  }

  async send(to: string, body: string): Promise<SendResult> {
    const message = await this.client.messages.create({
      to,
      body,
      ...(this.options.messagingServiceSid
        ? { messagingServiceSid: this.options.messagingServiceSid }
        : { from: this.options.from as string }),
    });
    return { messageSid: message.sid, status: message.status };
  }
}

export class FakeSmsSender implements SmsSender {
  readonly messages: Array<{ to: string; body: string }> = [];

  async send(to: string, body: string): Promise<SendResult> {
    this.messages.push({ to, body });
    return { messageSid: `SMFAKE${String(this.messages.length).padStart(6, "0")}`, status: "queued" };
  }
}

export class UnconfiguredSmsSender implements SmsSender {
  async send(): Promise<SendResult> {
    throw new Error("Outbound Twilio is not configured");
  }
}
