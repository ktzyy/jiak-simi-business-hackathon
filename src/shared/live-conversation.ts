/** Only whole conversational requests: a greeting followed by an actual order
 * must still reach the authoritative quote path. */
export function isVoiceMenuConversation(text: string): boolean {
  const sentences = text.toLowerCase().split(/[.!?]+/).map(value => value.replace(/[,']/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return sentences.length > 0 && sentences.every(sentence => {
    const value = sentence.replace(/^(?:hi|hello|hey)\s+/, "");
    return /^(?:hi|hello|hey|menu(?: please)?|(?:please )?(?:show|send)(?: me)? (?:the |your )?menu(?: again| please)?|what(?:s| is) (?:on )?(?:the |your )?menu|what (?:can i order|do you have)|what food do you (?:have|sell))$/.test(value);
  });
}
