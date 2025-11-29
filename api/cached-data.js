/**
 * Vercel Serverless Function: Simple Cache Test (CommonJS)
 * No dependencies, no Redis - just testing the endpoint
 */

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  const { action } = req.query;

  // ========== REFRESH ACTION ==========
  if (req.method === 'POST' && action === 'refresh') {
    // Verify authorization
    const authHeader = req.headers.authorization;
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
    
    if (authHeader !== expectedAuth) {
      console.error('Authorization failed');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        debug: {
          authReceived: authHeader ? 'yes' : 'no',
          cronSecretSet: process.env.CRON_SECRET ? 'yes' : 'no'
        }
      });
    }

    // Return success without actually fetching data (test mode)
    return res.status(200).json({
      success: true,
      refreshed: true,
      message: 'Test mode - cache refresh endpoint working',
      environment: {
        CRON_SECRET: !!process.env.CRON_SECRET,
        REDIS_CLOUD_URL: !!process.env.REDIS_CLOUD_URL,
        HOMEY_CLIENT_ID: !!process.env.HOMEY_CLIENT_ID
      },
      timestamp: new Date().toISOString()
    });
  }

  // ========== GET ACTION ==========
  if (req.method === 'GET' && action === 'get') {
    // Return test data
    return res.status(200).json({
      success: true,
      cached: true,
      message: 'Test mode - returning sample data',
      data: {
        homey: {
          temp: "5.2",
          hum: 65,
          ts: Date.now()
        },
        hafjell: {
          top: {
            temp: "11",
            cond: "Mostly sunny",
            wind: "5.6",
            snow: "65",
            snowDay: "0"
          },
          bottom: {
            temp: "20",
            cond: "Mostly sunny",
            wind: "2.0",
            snow: "65",
            snowDay: "0"
          },
          ts: Date.now()
        },
        forecast: {
          fc: [],
          ts: Date.now()
        },
        lifts: {
          lifts: {
            backyardheisen: 1,
            gondolen: 1,
            vidsynexpressen: 1
          },
          ts: Date.now()
        },
        tempHistory: []
      },
      timestamp: new Date().toISOString()
    });
  }

  // Invalid request
  return res.status(400).json({
    success: false,
    error: 'Invalid request',
    message: 'Use ?action=get (GET) or ?action=refresh (POST)'
  });
};
