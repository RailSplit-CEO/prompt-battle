import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

function getItchClientId(): string {
  const config = functions.config();
  return config.itch?.client_id || process.env.ITCH_CLIENT_ID || '';
}

function getItchClientSecret(): string {
  const config = functions.config();
  return config.itch?.client_secret || process.env.ITCH_CLIENT_SECRET || '';
}

/**
 * Handles itch.io OAuth callback — exchanges auth code for token,
 * gets user profile, creates Firebase custom token.
 */
export const itchOAuthCallback = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { code } = req.body;
  if (!code) { res.status(400).json({ error: 'Missing authorization code' }); return; }

  const clientId = getItchClientId();
  const clientSecret = getItchClientSecret();
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'itch.io OAuth not configured' }); return;
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://itch.io/api/1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('itch.io token exchange failed:', err);
      res.status(400).json({ error: 'Failed to exchange code' }); return;
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) { res.status(400).json({ error: 'No access token received' }); return; }

    // 2. Get itch.io user profile
    const meRes = await fetch(`https://itch.io/api/1/${accessToken}/me`);
    if (!meRes.ok) { res.status(400).json({ error: 'Failed to get itch.io profile' }); return; }

    const meData = await meRes.json();
    const itchUser = meData.user;
    if (!itchUser?.id) { res.status(400).json({ error: 'Invalid itch.io user data' }); return; }

    // 3. Create Firebase custom token with itch_ prefix to avoid UID collisions
    const firebaseUid = `itch_${itchUser.id}`;
    const firebaseToken = await admin.auth().createCustomToken(firebaseUid, {
      itchId: itchUser.id,
      itchUsername: itchUser.username,
      provider: 'itch',
    });

    res.json({
      firebaseToken,
      itchUser: {
        id: itchUser.id,
        username: itchUser.username,
        displayName: itchUser.display_name || itchUser.username,
        coverUrl: itchUser.cover_url || null,
      },
    });
  } catch (err: any) {
    console.error('itch.io OAuth error:', err);
    res.status(500).json({ error: 'OAuth processing failed' });
  }
});
