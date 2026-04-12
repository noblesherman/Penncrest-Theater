import crypto from 'node:crypto';

export type PaymentLineSseClient = {
  id: string;
  write: (chunk: string) => boolean;
};

const clientsByQueueKey = new Map<string, Map<string, PaymentLineSseClient>>();

export function buildPaymentLineClientId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function registerPaymentLineSseClient(queueKey: string, client: PaymentLineSseClient): () => void {
  const queueClients = clientsByQueueKey.get(queueKey) || new Map<string, PaymentLineSseClient>();
  queueClients.set(client.id, client);
  clientsByQueueKey.set(queueKey, queueClients);

  return () => {
    const current = clientsByQueueKey.get(queueKey);
    if (!current) {
      return;
    }

    current.delete(client.id);
    if (current.size === 0) {
      clientsByQueueKey.delete(queueKey);
    }
  };
}

export function broadcastPaymentLineEvent(queueKey: string, eventName: string, payload: unknown): void {
  const queueClients = clientsByQueueKey.get(queueKey);
  if (!queueClients || queueClients.size === 0) {
    return;
  }

  const serialized = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const deadClientIds: string[] = [];
  queueClients.forEach((client, clientId) => {
    const ok = client.write(serialized);
    if (!ok) {
      deadClientIds.push(clientId);
    }
  });

  deadClientIds.forEach((clientId) => {
    queueClients.delete(clientId);
  });

  if (queueClients.size === 0) {
    clientsByQueueKey.delete(queueKey);
  }
}
