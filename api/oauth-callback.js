/**
 * Vercel Serverless Function: OAuth Callback Handler
 * 
 * This function exchanges the authorization code for tokens
 * Called by the oauth-setup.html page after user authorizes
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, clientId, clientSecret, redirectUri } = req.body;

    // Validate input
    if (!code || !clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'code, clientId, and clientSecret are required'
      });
    }

    console.log('Exchanging authorization code for tokens...');

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.athom.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: `grant_type=authorization_code&authorization_code=${encodeURIComponent(code)}`
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      
      return res.status(tokenResponse.status).json({
        error: 'Token exchange failed',
        message: errorText,
        details: 'Check that your Client ID and Client Secret are correct'
      });
    }

    const tokens = await tokenResponse.json();
    
    console.log('Tokens received successfully');

    // Return tokens to client
    return res.status(200).json({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      message: 'Tokens obtained successfully'
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
