import type { VolunteerBoard, Notification } from "../domain/board.js";
import type { SmsSender } from "./twilio.js";

export async function deliverNotifications(
  board: VolunteerBoard,
  sender: SmsSender,
  notifications: Notification[],
): Promise<void> {
  for (const notification of notifications) {
    try {
      const result = await sender.send(notification.to, notification.body);
      board.recordOutbound(notification, result.messageSid, result.status);
    } catch {
      board.recordOutbound(notification, null, "failed");
    }
  }
}
