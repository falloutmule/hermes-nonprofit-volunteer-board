// Non-production fixtures. Replace only with approved compliance copy.
export const PLACEHOLDER_MESSAGES = {
  joined: "TEST COPY: You are opted in for Hermes Non-Profit volunteer texts. Reply HELP for options or STOP to opt out.",
  help: "TEST COPY: Reply with an event keyword to volunteer, DROP <keyword> to cancel an event, or STOP to opt out.",
  stopped: "TEST COPY: You are opted out of Hermes Non-Profit volunteer texts.",
  joinFirst: "TEST COPY: Reply JOIN before signing up for an event.",
  unknown: "I didn't understand that yet. Reply HELP for options.",
  dropNeedsEvent: "Reply DROP followed by the event keyword, for example DROP PANTRY.",
  noSignup: "No active signup was found for that event.",
  noOffer: "There is no current standby offer for this number.",
  offerConflict: "That opening is no longer available. You remain on standby.",
} as const;

export function offerMessage(eventName: string, keyword: string): string {
  return `TEST COPY: A spot opened for ${eventName}. Reply YES to accept or NO to decline. Event keyword: ${keyword}.`;
}
