/**
 * Vercel Serverless Function: Test Cache Handler
 * Simplified version for debugging
 */

export default async function handler(req, res) {
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

  console.log('Request received:', {
    method: req.method,
    action: action,
    headers: req.headers
  });

  // Test authentication
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
  
  console.log('Auth check:', {
    received: authHeader ? authHeader.substring(0, 20) + '...' : 'none',
    expected: expectedAuth ? expectedAuth.substring(0, 20) + '...' : 'none',
    cronSecretSet: !!process.env.CRON_SECRET
  });

  if (action === 'refresh') {
    // Verify authorization
    if (authHeader !== expectedAuth) {
      console.error('Authorization failed');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized',
        debug: {
          authHeaderPresent: !!authHeader,
          cronSecretSet: !!process.env.CRON_SECRET
        }
      });
    }

    // Test environment variables
    const envCheck = {
      CRON_SECRET: !!process.env.CRON_SECRET,
      REDIS_CLOUD_URL: !!process.env.REDIS_CLOUD_URL,
      HOMEY_CLIENT_ID: !!process.env.HOMEY_CLIENT_ID,
      HOMEY_CLIENT_SECRET: !!process.env.HOMEY_CLIENT_SECRET,
      HOMEY_USERNAME: !!process.env.HOMEY_USERNAME,
      HOMEY_PASSWORD: !!process.env.HOMEY_PASSWORD,
      HOMEY_DEVICE_ID_TEMP: !!process.env.HOMEY_DEVICE_ID_TEMP
    };

    console.log('Environment variables check:', envCheck);

    return res.status(200).json({
      success: true,
      message: 'Test successful - ready for full implementation',
      environment: envCheck,
      timestamp: new Date().toISOString()
    });
  }

  if (action === 'get') {
    return res.status(200).json({
      success: true,
      message: 'Cache get endpoint - test mode',
      data: {
        homey: { temp: "5.2", hum: 65, ts: Date.now() },
        hafjell: { 
          top: { temp: "11", cond: "Sunny", wind: "5.6", snow: "65", snowDay: "0" },
          bottom: { temp: "20", cond: "Sunny", wind: "2.0", snow: "65", snowDay: "0" },
          ts: Date.now()
        }
      },
      timestamp: new Date().toISOString()
    });
  }

  return res.status(400).json({
    success: false,
    error: 'Invalid action',
    message: 'Use ?action=get or ?action=refresh'
  });
}
