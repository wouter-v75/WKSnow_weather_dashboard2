export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  try {
    // Just test environment variables - no Homey import yet
    const envCheck = {
      HOMEY_CLIENT_ID: !!process.env.HOMEY_CLIENT_ID,
      HOMEY_CLIENT_SECRET: !!process.env.HOMEY_CLIENT_SECRET,
      HOMEY_USERNAME: !!process.env.HOMEY_USERNAME,
      HOMEY_PASSWORD: !!process.env.HOMEY_PASSWORD,
      HOMEY_DEVICE_ID_TEMP: !!process.env.HOMEY_DEVICE_ID_TEMP,
      HOMEY_DEVICE_ID_HUMIDITY: !!process.env.HOMEY_DEVICE_ID_HUMIDITY
    };

    return res.status(200).json({
      message: 'Minimal test - environment variables check',
      envCheck,
      allPresent: Object.values(envCheck).every(v => v === true)
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
