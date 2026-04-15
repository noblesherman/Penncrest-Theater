const DEFAULT_FRIENDLY_FALLBACK = 'Something went a little off-script. Please try again in just a moment, thanks!';

function normalizeMessage(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function lowerFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function ensureEndingPunctuation(text: string): string {
  if (!text) return text;
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function toFriendlyCore(rawMessage: string): string {
  const message = normalizeMessage(rawMessage);
  if (!message) return DEFAULT_FRIENDLY_FALLBACK;

  if (/^failed to\s+/i.test(message)) {
    const remainder = message.replace(/^failed to\s+/i, '');
    return `We hit a small backstage snag while trying to ${lowerFirst(remainder)}`;
  }

  if (/^unable to\s+/i.test(message)) {
    const remainder = message.replace(/^unable to\s+/i, '');
    return `We could not ${lowerFirst(remainder)} just yet`;
  }

  if (/^could not\s+/i.test(message)) {
    const remainder = message.replace(/^could not\s+/i, '');
    return `We could not ${lowerFirst(remainder)} just yet`;
  }

  if (/^missing\s+/i.test(message)) {
    const remainder = message.replace(/^missing\s+/i, '');
    return `We're missing ${lowerFirst(remainder)}`;
  }

  if (/^invalid\s+/i.test(message)) {
    const remainder = message.replace(/^invalid\s+/i, '');
    return `That ${lowerFirst(remainder)} isn't quite in the right format yet`;
  }

  if (/request failed/i.test(message)) {
    return message.replace(/request failed/gi, 'That request missed its cue');
  }

  if (/not found/i.test(message)) {
    return message.replace(/not found/gi, "isn't on today's playbill");
  }

  if (/timed out/i.test(message)) {
    return 'That took a little longer than expected backstage';
  }

  if (/network request failed/i.test(message)) {
    return 'We could not reach the theater network right now';
  }

  return message;
}

export function toTheaterFriendlyErrorMessage(input: unknown, fallback = DEFAULT_FRIENDLY_FALLBACK): string {
  if (typeof input !== 'string') return fallback;
  const core = toFriendlyCore(input);
  if (!core) return fallback;

  const punctuated = ensureEndingPunctuation(core);
  if (/thanks|thank you/i.test(punctuated)) {
    return punctuated;
  }
  if (/please\s+try\s+again/i.test(punctuated)) {
    return `${punctuated} Thanks for your patience!`;
  }

  return `${punctuated} Please try again in just a moment, thanks!`;
}
