import { Client, Environment } from 'square';
import * as functions from 'firebase-functions';

let _client: Client | null = null;

export function getSquareClient(): Client {
  if (_client) return _client;

  const config = functions.config();
  const accessToken = config.square?.access_token || process.env.SQUARE_ACCESS_TOKEN || '';
  const env = config.square?.environment || process.env.SQUARE_ENVIRONMENT || 'sandbox';

  _client = new Client({
    accessToken,
    environment: env === 'production' ? Environment.Production : Environment.Sandbox,
  });

  return _client;
}

export function getSquareLocationId(): string {
  const config = functions.config();
  return config.square?.location_id || process.env.SQUARE_LOCATION_ID || '';
}

export function getSquareWebhookSignatureKey(): string {
  const config = functions.config();
  return config.square?.webhook_signature_key || process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
}
