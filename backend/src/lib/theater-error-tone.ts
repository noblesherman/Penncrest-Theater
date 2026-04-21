const DEFAULT_FRIENDLY_FALLBACK = 'Something went a little off-script. Please try again in just a moment, thanks!';
const RETRY_SUFFIX = ' Please try again in just a moment, thanks!';

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

function stripRetrySuffix(text: string): string {
  return text
    .replace(/\s*please\s+try\s+again(?:\s+in\s+just\s+a\s+moment)?(?:,\s*thanks)?!?$/i, '')
    .replace(/\s*thanks\s+for\s+your\s+patience!?$/i, '')
    .trim();
}

function shouldSuggestRetry(message: string): boolean {
  const normalized = normalizeMessage(message).toLowerCase();

  if (!normalized) return false;

  if (
    /no remaining complimentary student tickets/.test(normalized) ||
    /no complimentary student tickets (are currently )?available/.test(normalized) ||
    /student code is not approved/.test(normalized) ||
    /limit reached/.test(normalized) ||
    /is required/.test(normalized) ||
    /is inactive/.test(normalized) ||
    /not enabled/.test(normalized) ||
    /not available for this performance/.test(normalized) ||
    /online sales are closed/.test(normalized) ||
    /online sales are not live/.test(normalized) ||
    /invalid authentication code/.test(normalized) ||
    /authentication code required/.test(normalized)
  ) {
    return false;
  }

  if (
    /just yet/.test(normalized) ||
    /small backstage snag/.test(normalized) ||
    /missed its cue/.test(normalized) ||
    /longer than expected backstage/.test(normalized) ||
    /network right now/.test(normalized) ||
    /internal server error/.test(normalized) ||
    /timed out/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function toFriendlyCore(rawMessage: string): string {
  const message = normalizeMessage(rawMessage);
  if (!message) return DEFAULT_FRIENDLY_FALLBACK;

  if (/^no remaining complimentary student tickets$/i.test(message)) {
    return 'All student complimentary tickets for this performance have already been claimed';
  }

  if (/^no complimentary student tickets (are currently )?available(?: for checkout| for this checkout)?$/i.test(message)) {
    return 'Student complimentary tickets are currently all spoken for on this performance';
  }

  if (/^authentication code required$/i.test(message)) {
    return 'Please enter the 6-digit code from your authenticator app';
  }

  if (/^invalid authentication code$/i.test(message)) {
    return "That 6-digit authenticator code didn't match";
  }

  if (/^two-factor authentication is not configured correctly$/i.test(message)) {
    return 'Two-factor setup is incomplete for this account. Please contact a theater admin';
  }

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

  const punctuated = ensureEndingPunctuation(stripRetrySuffix(core));
  if (/thanks|thank you/i.test(punctuated)) {
    return punctuated;
  }
  if (/please\s+try\s+again|refresh and try again|reselect/i.test(punctuated)) {
    return punctuated;
  }

  if (shouldSuggestRetry(punctuated)) {
    return `${punctuated}${RETRY_SUFFIX}`;
  }

  return punctuated;
}

type PlainRecord = Record<string, unknown>;

export function theaterizeErrorPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  const record: PlainRecord = { ...(payload as PlainRecord) };

  if (typeof record.error === 'string') {
    record.error = toTheaterFriendlyErrorMessage(record.error);
  }

  if (typeof record.message === 'string') {
    record.message = toTheaterFriendlyErrorMessage(record.message);
  }

  if (Array.isArray(record.errors)) {
    record.errors = record.errors.map((item) =>
      typeof item === 'string' ? toTheaterFriendlyErrorMessage(item) : item
    );
  }

  return record;
}
