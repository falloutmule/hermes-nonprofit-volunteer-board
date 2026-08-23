export const SMS_MESSAGES = {
  joined: "Hermes Non-Profit: You're enrolled in volunteer SMS testing. Msg frequency varies, typically 1-8 msgs/test event. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  help: "Hermes Non-Profit SMS Testing: Help at Falloutmule@gmail.com. Msg & data rates may apply. Reply STOP to opt out.",
  stopped: "Hermes Non-Profit: You are unsubscribed and will receive no more messages. Reply START to re-enroll.",
  joinFirst: "Hermes Non-Profit: Reply JOIN to enroll before signing up for an event.",
  unknown: "Hermes Non-Profit: I didn't understand that. Reply HELP for help or STOP to opt out.",
  dropNeedsEvent: "Reply DROP followed by the event keyword, for example DROP PANTRY.",
  noSignup: "No active signup was found for that event.",
  noOffer: "There is no current standby offer for this number.",
  offerConflict: "That opening is no longer available. You remain on standby.",
} as const;

export function offerMessage(eventName: string, keyword: string): string {
  return `Hermes Non-Profit: A spot opened for ${eventName}. Reply YES to accept or NO to pass. Event keyword: ${keyword}. Reply STOP to opt out.`;
}
