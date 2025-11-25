/**
 * Vercel Serverless Function: Homey API Proxy (Alternative approach)
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate environment variables
    const requiredEnvVars = [
      'HOMEY_CLIENT_ID',
      'HOMEY_CLIENT_SECRET',
      'HOMEY_USERNAME',
      'HOMEY_PASSWORD',
      'HOMEY_DEVICE_ID_TEMP'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      return res.status(500).json({
        error: 'Configuration error',
        message: `Missing environment variables: ${missingVars.join(', ')}`
      });
    }

    console.log('Attempting dynamic import of homey-api...');
    
    // Dynamic import to avoid compilation issues
    const homeyApi = await import('homey-api');
    console.log('homeyApi module:', Object.keys(homeyApi));
    
    const AthomCloudAPI = homeyApi.AthomCloudAPI || homeyApi.default?.AthomCloudAPI || homeyApi.default;
    console.log('AthomCloudAPI type:', typeof AthomCloudAPI);
    
    if (!AthomCloudAPI) {
      throw new Error('Could not find AthomCloudAPI in homey-api module');
    }
    
    // Create Cloud API instance
    const cloudApi = new AthomCloudAPI({
      clientId: process.env.HOMEY_CLIENT_ID,
      clientSecret: process.env.HOMEY_CLIENT_SECRET,
    });

    console.log('cloudApi methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(cloudApi)));

    // Authenticate
    await cloudApi.authenticateWithUsernamePassword({
      username: process.env.HOMEY_USERNAME,
      password: process.env.HOMEY_PASSWORD,
    });

    // Get user and first Homey
    const user = await cloudApi.getAuthenticatedUser();
    const homeys = await user.getHomeys();
    
    if (homeys.length === 0) {
      throw new Error('No Homey devices found');
    }
    
    const homey = homeys[0];
    const homeyApiInstance = await homey.authenticate();
    
    // Fetch temperature data
    const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const device = await homeyApiInstance.devices.getDevice({ id: tempDeviceId });
    const caps = device.capabilitiesObj || device.capabilities || {};
    
    const responseData = {
      temperature: caps.measure_temperature?.value || caps.temperature?.value || null,
      humidity: caps.measure_humidity?.value || caps.humidity?.value || null,
      timestamp: new Date().toISOString(),
      source: 'homey-pro'
    };
    
    console.log('Successfully fetched sensor data:', responseData);
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Homey API Error:', error);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
