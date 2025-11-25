/**
 * Vercel Serverless Function: Homey Cloud API Proxy (IMPROVED)
 * 
 * This function handles REMOTE authentication with Homey Pro via Cloud API
 * using an improved OAuth2 flow with proper error handling for serverless environments
 * 
 * Environment variables required in Vercel:
 * - HOMEY_CLIENT_ID (from https://tools.developer.homey.app/api/projects)
 * - HOMEY_CLIENT_SECRET
 * - HOMEY_USERNAME (your Homey account email)
 * - HOMEY_PASSWORD (your Homey account password)
 * - HOMEY_DEVICE_ID_TEMP (outdoor temperature sensor)
 * - HOMEY_DEVICE_ID_HUMIDITY (outdoor humidity sensor, optional)
 */

const fetch = require('node-fetch');

// Cache for auth tokens (persists across function invocations in same container)
let cachedAccessToken = null;
let cachedHomeyId = null;
let tokenExpiry = null;

/**
 * Manual OAuth2 authentication flow for Homey Cloud API
 * This implements the full flow that authenticateWithUsernamePassword does internally
 */
async function authenticateManually() {
  console.log('🔐 Starting manual OAuth2 authentication flow...');
  
  try {
    // Step 1: Login to Athom accounts
    console.log('Step 1: Logging in to Athom accounts...');
    const loginResponse = await fetch('https://accounts.athom.com/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `email=${encodeURIComponent(process.env.HOMEY_USERNAME)}&password=${encodeURIComponent(process.env.HOMEY_PASSWORD)}&otptoken=`,
      timeout: 15000
    });

    if (!loginResponse.ok) {
      throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
    }

    const loginData = await loginResponse.json();
    console.log('✅ Login successful');

    // Step 2: Get authorization code
    console.log('Step 2: Getting authorization code...');
    const authorizeUrl = `https://accounts.athom.com/authorise?client_id=${process.env.HOMEY_CLIENT_ID}&redirect_uri=${encodeURIComponent('http://localhost')}&response_type=code&user_token=${loginData.token}`;
    
    const authorizeResponse = await fetch(authorizeUrl, {
      method: 'GET',
      redirect: 'manual',
      timeout: 15000
    });

    const location = authorizeResponse.headers.get('location');
    if (!location) {
      throw new Error('No redirect location in authorize response');
    }

    const code = new URL(location).searchParams.get('code');
    if (!code) {
      throw new Error('No authorization code in redirect');
    }

    console.log('✅ Authorization code obtained');

    // Step 3: Exchange code for access token
    console.log('Step 3: Exchanging code for access token...');
    const tokenResponse = await fetch('https://api.athom.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `client_id=${process.env.HOMEY_CLIENT_ID}&client_secret=${process.env.HOMEY_CLIENT_SECRET}&grant_type=authorization_code&code=${code}`,
      timeout: 15000
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('✅ Access token obtained');

    // Step 4: Get delegation token for Homey
    console.log('Step 4: Getting delegation token for Homey...');
    const delegationResponse = await fetch('https://api.athom.com/delegation/token?audience=homey', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000
    });

    if (!delegationResponse.ok) {
      throw new Error(`Delegation token failed: ${delegationResponse.status}`);
    }

    const delegationData = await delegationResponse.json();
    console.log('✅ Delegation token obtained');

    // Step 5: Get user info to find Homey ID
    console.log('Step 5: Getting user info...');
    const userResponse = await fetch('https://api.athom.com/user/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${delegationData.token}`,
      },
      timeout: 15000
    });

    if (!userResponse.ok) {
      throw new Error(`User info failed: ${userResponse.status}`);
    }

    const userData = await userResponse.json();
    
    // Step 6: Get user's Homeys
    console.log('Step 6: Getting user Homeys...');
    const homeysResponse = await fetch(`https://api.athom.com/user/me/homey`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${delegationData.token}`,
      },
      timeout: 15000
    });

    if (!homeysResponse.ok) {
      throw new Error(`Get Homeys failed: ${homeysResponse.status}`);
    }

    const homeysData = await homeysResponse.json();
    
    if (!homeysData || homeysData.length === 0) {
      throw new Error('No Homeys found for this account');
    }

    const homeyId = homeysData[0].id;
    console.log(`✅ Found Homey: ${homeyId}`);

    // Cache the tokens
    cachedAccessToken = delegationData.token;
    cachedHomeyId = homeyId;
    tokenExpiry = Date.now() + (50 * 60 * 1000); // 50 minutes (tokens last 1 hour)

    return { accessToken: delegationData.token, homeyId };

  } catch (error) {
    console.error('❌ Manual authentication failed:', error.message);
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Get valid access token (use cache if available and valid)
 */
async function getAccessToken() {
  // Check if we have a valid cached token
  if (cachedAccessToken && cachedHomeyId && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('✅ Using cached access token');
    return { accessToken: cachedAccessToken, homeyId: cachedHomeyId };
  }

  console.log('🔄 No valid cached token, authenticating...');
  return await authenticateManually();
}

/**
 * Fetch device data from Homey Cloud API
 */
async function getDeviceData(accessToken, homeyId, deviceId) {
  try {
    const url = `https://${homeyId}.connect.athom.com/api/manager/devices/device/${deviceId}`;
    console.log(`📡 Fetching device ${deviceId}...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`Device fetch failed: ${response.status} ${response.statusText}`);
    }

    const device = await response.json();
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

    console.log('📡 Fetching Homey sensor data via Cloud API...');
    
    // Get valid access token
    const { accessToken, homeyId } = await getAccessToken();
    
    // Fetch temperature data
    const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const tempData = await getDeviceData(accessToken, homeyId, tempDeviceId);
    
    // Fetch humidity data (may be from same or different device)
    let humidityData = tempData; // Default to same device
    const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
    
    if (humidityDeviceId && humidityDeviceId !== tempDeviceId) {
      try {
        humidityData = await getDeviceData(accessToken, homeyId, humidityDeviceId);
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
      method: 'improved-oauth2'
    };
    
    console.log('✅ Successfully fetched sensor data:', responseData);
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('❌ Homey Cloud API Error:', error);
    
    // Clear cache on authentication errors
    if (error.message.includes('Authentication') || error.message.includes('401')) {
      cachedAccessToken = null;
      cachedHomeyId = null;
      tokenExpiry = null;
    }
    
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      timestamp: new Date().toISOString(),
      hint: 'Check that your Homey credentials and Client ID/Secret are correct'
    });
  }
}
