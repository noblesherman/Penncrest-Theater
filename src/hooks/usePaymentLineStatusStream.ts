/*
Handoff note for Mr. Smith:
- File: `src/hooks/usePaymentLineStatusStream.ts`
- What this is: Custom React hook.
- What it does: Encapsulates reusable state/effect behavior for web UI.
- Connections: Consumed by pages/components to avoid duplicated effect logic.
- Main content type: Stateful behavior and side-effect control.
- Safe edits here: Readability comments and conservative non-breaking tweaks.
- Be careful with: Effect timing/subscriptions that can create subtle UI regressions.
- Useful context: If multiple screens show the same behavior bug, inspect this hook.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useMemo, useState } from 'react';
import {
  applyEntryUpdatedToSnapshot,
  buildAdminPaymentLineEventsUrl,
  fetchAdminPaymentLineSnapshot,
  findActiveEntry,
  issueAdminPaymentLineEventsToken,
  parseJsonEvent
} from '../lib/paymentLineApi';
import type {
  PaymentLineEntryUpdatedEvent,
  PaymentLineReadyEvent,
  PaymentLineSellerStreamPayload,
  PaymentLineSnapshot
} from '../lib/paymentLineTypes';

type Options = {
  queueKey: string | null;
  sellerEntryId?: string | null;
  enabled?: boolean;
};

type StreamState = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  snapshot: PaymentLineSnapshot | null;
  updatedAt: string;
  ready: PaymentLineReadyEvent | null;
};

export function usePaymentLineStatusStream(options: Options) {
  const enabled = Boolean(options.enabled ?? true);
  const [state, setState] = useState<StreamState>({
    connected: false,
    loading: false,
    error: null,
    snapshot: null,
    updatedAt: new Date(0).toISOString(),
    ready: null
  });

  useEffect(() => {
    if (!enabled || !options.queueKey) {
      setState({
        connected: false,
        loading: false,
        error: null,
        snapshot: null,
        updatedAt: new Date().toISOString(),
        ready: null
      });
      return;
    }

    let cancelled = false;
    let stream: EventSource | null = null;

    const refreshSnapshot = async () => {
      const snapshot = await fetchAdminPaymentLineSnapshot(options.queueKey!);
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        snapshot,
        updatedAt: snapshot.updatedAt,
        error: null
      }));
    };

    const connect = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const token = await issueAdminPaymentLineEventsToken(options.queueKey!);
        if (cancelled) return;

        stream = new EventSource(buildAdminPaymentLineEventsUrl(token));

        stream.onopen = () => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, connected: true, loading: false, error: null }));
        };

        stream.onerror = () => {
          if (cancelled) return;
          setState((prev) => ({ ...prev, connected: false, loading: false, error: 'Realtime stream disconnected' }));
        };

        stream.addEventListener('ready', (event) => {
          if (cancelled) return;
          const payload = parseJsonEvent<PaymentLineReadyEvent>(event as MessageEvent<string>);
          if (!payload) return;
          setState((prev) => ({
            ...prev,
            ready: payload,
            updatedAt: new Date().toISOString()
          }));
        });

        stream.addEventListener('queue_snapshot', (event) => {
          if (cancelled) return;
          const payload = parseJsonEvent<PaymentLineSnapshot>(event as MessageEvent<string>);
          if (!payload) return;
          setState((prev) => ({
            ...prev,
            snapshot: payload,
            updatedAt: payload.updatedAt,
            error: null
          }));
        });

        stream.addEventListener('entry_updated', (event) => {
          if (cancelled) return;
          const payload = parseJsonEvent<PaymentLineEntryUpdatedEvent>(event as MessageEvent<string>);
          if (!payload) return;

          setState((prev) => {
            if (!prev.snapshot) {
              return {
                ...prev,
                updatedAt: payload.updatedAt
              };
            }

            return {
              ...prev,
              snapshot: applyEntryUpdatedToSnapshot(prev.snapshot, payload),
              updatedAt: payload.updatedAt
            };
          });
        });

        const refreshOnMutation = () => {
          void refreshSnapshot().catch(() => undefined);
        };

        stream.addEventListener('now_serving_changed', refreshOnMutation);
        stream.addEventListener('entry_removed', refreshOnMutation);
        stream.addEventListener('active_timeout', refreshOnMutation);
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          connected: false,
          loading: false,
          error: err instanceof Error ? err.message : 'We hit a small backstage snag while trying to start realtime stream'
        }));
      }
    };

    void refreshSnapshot().catch(() => undefined);
    void connect();

    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [enabled, options.queueKey]);

  const sellerPayload = useMemo<PaymentLineSellerStreamPayload>(() => {
    const activeEntry = findActiveEntry(state.snapshot);
    const sellerEntry = options.sellerEntryId
      ? state.snapshot?.entries.find((entry) => entry.entryId === options.sellerEntryId) || null
      : activeEntry;

    return {
      queueKey: options.queueKey || '',
      snapshot: state.snapshot,
      activeEntry,
      sellerEntry,
      updatedAt: state.updatedAt
    };
  }, [options.queueKey, options.sellerEntryId, state.snapshot, state.updatedAt]);

  return {
    ...state,
    sellerPayload
  };
}
