export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

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

    // Try multiple import strategies
    let AthomCloudAPI;
    
    // Strategy 1: Try dynamic import of main package
    try {
      const homeyApi = await import('homey-api');
      AthomCloudAPI = homeyApi.AthomCloudAPI || homeyApi.default?.AthomCloudAPI;
    } catch (e) {
      console.log('Strategy 1 failed:', e.message);
    }
    
    // Strategy 2: Try importing the specific file
    if (!AthomCloudAPI) {
      try {
        const athomModule = await import('homey-api/lib/AthomCloudAPI.js');
        AthomCloudAPI = athomModule.default || athomModule.AthomCloudAPI || athomModule;
      } catch (e) {
        console.log('Strategy 2 failed:', e.message);
      }
    }
    
    // Strategy 3: Try require (CommonJS)
    if (!AthomCloudAPI) {
      try {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');
      } catch (e) {
        console.log('Strategy 3 failed:', e.message);
      }
    }

    if (!AthomCloudAPI || typeof AthomCloudAPI !== 'function') {
      return res.status(500).json({
        error: 'Could not import AthomCloudAPI',
        message: 'All import strategies failed',
        type: typeof AthomCloudAPI
      });
    }

    // Create Cloud API instance
    const cloudApi = new AthomCloudAPI({
      clientId: process.env.HOMEY_CLIENT_ID,
      clientSecret: process.env.HOMEY_CLIENT_SECRET,
    });

    // Check if method exists
    if (typeof cloudApi.authenticateWithUsernamePassword !== 'function') {
      return res.status(500).json({
        error: 'authenticateWithUsernamePassword not found',
        availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(cloudApi)),
        cloudApiType: typeof cloudApi
      });
    }

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
    
    // Fetch device data
    const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const device = await homeyApiInstance.devices.getDevice({ id: tempDeviceId });
    const caps = device.capabilitiesObj || device.capabilities || {};
    
    const responseData = {
      temperature: caps.measure_temperature?.value || caps.temperature?.value || null,
      humidity: caps.measure_humidity?.value || caps.humidity?.value || null,
      timestamp: new Date().toISOString(),
      source: 'homey-pro'
    };
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}
