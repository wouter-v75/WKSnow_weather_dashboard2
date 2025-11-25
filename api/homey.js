/**
 * Vercel Serverless Function: Homey Cloud API Proxy (FIXED v2)
 * 
 * This version uses the ACTUAL homey-api library (same as setup-homey.js)
 * but with optimizations for serverless environments
 * 
 * Environment variables required in Vercel:
 * - HOMEY_CLIENT_ID (from https://tools.developer.homey.app/api/projects)
 * - HOMEY_CLIENT_SECRET
 * - HOMEY_USERNAME (your Homey account email)
 * - HOMEY_PASSWORD (your Homey account password)
 * - HOMEY_DEVICE_ID_TEMP (outdoor temperature sensor)
 * - HOMEY_DEVICE_ID_HUMIDITY (outdoor humidity sensor, optional)
 */

const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');

// Cache for Homey API session (persists across function invocations in same container)
let cachedHomeyApi = null;
let cacheTimestamp = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes (conservative for serverless)

/**
 * Get authenticated Homey API with retry logic
 */
async function getHomeyApiWithRetry(maxRetries = 2) {
  const now = Date.now();
  
  // Return cached connection if still valid
  if (cachedHomeyApi && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('✅ Using cached Homey API session');
    try {
      // Quick test to ensure session is still valid
      await cachedHomeyApi.system.getInfo();
      return cachedHomeyApi;
    } catch (error) {
      console.warn('⚠️ Cached session invalid, re-authenticating...');
      cachedHomeyApi = null;
      cacheTimestamp = null;
    }
  }
  
  console.log('🔐 Authenticating with Homey Cloud API...');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create Cloud API instance (same as setup-homey.js)
      const cloudApi = new AthomCloudAPI({
        clientId: process.env.HOMEY_CLIENT_ID,
        clientSecret: process.env.HOMEY_CLIENT_SECRET,
      });

      console.log(`Attempt ${attempt}/${maxRetries}: Authenticating with username/password...`);

      // Authenticate with username/password
      // Wrap in a promise with timeout
      await Promise.race([
        cloudApi.authenticateWithUsernamePassword({
          username: process.env.HOMEY_USERNAME,
          password: process.env.HOMEY_PASSWORD,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Authentication timeout after 25 seconds')), 25000)
        )
      ]);

      console.log('✅ Authentication successful, getting user...');

      // Get user and Homey
      const user = await Promise.race([
        cloudApi.getAuthenticatedUser(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Get user timeout after 10 seconds')), 10000)
        )
      ]);

      console.log('✅ User retrieved, getting Homey...');

      const homey = await Promise.race([
        user.getFirstHomey(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Get Homey timeout after 10 seconds')), 10000)
        )
      ]);

      console.log('✅ Homey found, creating session...');

      // Create session on Homey
      const homeyApi = await Promise.race([
        homey.authenticate(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session creation timeout after 15 seconds')), 15000)
        )
      ]);

      console.log('✅ Homey API session created successfully');

      // Cache the session
      cachedHomeyApi = homeyApi;
      cacheTimestamp = now;

      return homeyApi;

    } catch (error) {
      console.error(`❌ Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Authentication failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Authentication failed: Max retries exceeded');
}

/**
 * Fetch device data from Homey
 */
async function getDeviceData(homeyApi, deviceId) {
  try {
    console.log(`📡 Fetching device ${deviceId}...`);

    const device = await Promise.race([
      homeyApi.devices.getDevice({ id: deviceId }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Device fetch timeout after 10 seconds')), 10000)
      )
    ]);

    const caps = device.capabilitiesObj || device.capabilities || {};
    
    const data = {};
    
    // Try different temperature capability names
    if (caps.measure_temperature) {
      data.temperature = caps.measure_temperature.value;
    } else if (caps.temperature) {
      data.temperature = caps.temperature.value;
    }
    
    // Try different humidity capability names
    if (caps.measure_humidity) {
      data.humidity = caps.measure_humidity.value;
    } else if (caps.humidity) {
      data.humidity = caps.humidity.value;
    }
    
    console.log(`✅ Device data retrieved:`, data);
    return data;
    
  } catch (error) {
    console.error(`❌ Error fetching device ${deviceId}:`, error.message);
    throw error;
  }
}

export default async function handler(req, res) {
  // Set timeout for entire function
  const startTime = Date.now();
  const FUNCTION_TIMEOUT = 55000; // 55 seconds (Vercel limit is 60s)

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
        message: `Missing environment variables: ${missingVars.join(', ')}`,
        note: 'Please configure these in Vercel environment variables',
        setup: {
          step1: 'Register app at: https://tools.developer.homey.app/api/projects',
          step2: 'Set HOMEY_CLIENT_ID and HOMEY_CLIENT_SECRET from your registered app',
          step3: 'Set HOMEY_USERNAME and HOMEY_PASSWORD (your Homey account credentials)',
          step4: 'Run setup-homey.js to find your HOMEY_DEVICE_ID_TEMP'
        }
      });
    }

    console.log('📡 Fetching Homey sensor data via Cloud API (using homey-api library)...');
    
    // Check if we're approaching timeout
    if (Date.now() - startTime > FUNCTION_TIMEOUT - 10000) {
      throw new Error('Function timeout approaching');
    }

    // Get authenticated Homey API
    const homeyApi = await getHomeyApiWithRetry();
    
    // Check timeout again
    if (Date.now() - startTime > FUNCTION_TIMEOUT - 5000) {
      throw new Error('Function timeout approaching after authentication');
    }

    // Fetch temperature data
    const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const tempData = await getDeviceData(homeyApi, tempDeviceId);
    
    // Fetch humidity data (may be from same or different device)
    let humidityData = tempData; // Default to same device
    const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
    
    if (humidityDeviceId && humidityDeviceId !== tempDeviceId) {
      try {
        humidityData = await getDeviceData(homeyApi, humidityDeviceId);
      } catch (error) {
        console.warn('⚠️ Could not fetch separate humidity sensor, using temp sensor:', error.message);
      }
    }
    
    // Combine data
    const responseData = {
      temperature: tempData.temperature,
      humidity: humidityData.humidity || tempData.humidity,
      timestamp: new Date().toISOString(),
      source: 'homey-cloud-api',
      method: 'homey-api-library',
      processingTime: `${Date.now() - startTime}ms`
    };
    
    console.log('✅ Successfully fetched sensor data:', responseData);
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ Homey Cloud API Error:', error);
    
    // Clear cache on authentication errors
    if (error.message.includes('Authentication') || 
        error.message.includes('401') || 
        error.message.includes('invalid') ||
        error.message.includes('credentials')) {
      console.log('🧹 Clearing cached session due to auth error');
      cachedHomeyApi = null;
      cacheTimestamp = null;
    }
    
    // Determine appropriate status code
    let statusCode = 500;
    if (error.message.includes('timeout')) {
      statusCode = 504; // Gateway Timeout
    } else if (error.message.includes('Authentication') || error.message.includes('401')) {
      statusCode = 401; // Unauthorized
    }
    
    return res.status(statusCode).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      timestamp: new Date().toISOString(),
      processingTime: `${Date.now() - startTime}ms`,
      hints: [
        'Check that HOMEY_CLIENT_ID and HOMEY_CLIENT_SECRET are correct',
        'Verify HOMEY_USERNAME and HOMEY_PASSWORD are correct',
        'Ensure your Homey is online at https://my.homey.app',
        'First request may take 20-30 seconds (authentication)',
        'Check Vercel function logs for detailed error information'
      ]
    });
  }
}
