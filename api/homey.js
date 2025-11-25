/**
 * Vercel Serverless Function: Homey API Proxy
 * 
 * This function handles authentication and data fetching from Homey Pro
 * Environment variables required in Vercel:
 * - HOMEY_CLIENT_ID
 * - HOMEY_CLIENT_SECRET
 * - HOMEY_USERNAME
 * - HOMEY_PASSWORD
 * - HOMEY_DEVICE_ID_TEMP (outdoor temperature sensor)
 * - HOMEY_DEVICE_ID_HUMIDITY (outdoor humidity sensor, optional)
 */

import AthomCloudAPI from 'homey-api/lib/AthomCloudAPI.js';

// Cache for Homey API connection (persists across function invocations)
let cachedHomeyApi = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getHomeyApi() {
  const now = Date.now();
  
  // Return cached connection if still valid
  if (cachedHomeyApi && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('Using cached Homey API connection');
    return cachedHomeyApi;
  }
  
  console.log('Creating new Homey API connection...');
  console.log('AthomCloudAPI type:', typeof AthomCloudAPI);
  console.log('AthomCloudAPI:', AthomCloudAPI);
  
  // Create Cloud API instance
  const cloudApi = new AthomCloudAPI({
    clientId: process.env.HOMEY_CLIENT_ID,
    clientSecret: process.env.HOMEY_CLIENT_SECRET,
  });

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
  
  // Create session
  const homeyApi = await homey.authenticate();
  
  // Cache the connection
  cachedHomeyApi = homeyApi;
  cacheTimestamp = now;
  
  console.log('Homey API connection established and cached');
  return homeyApi;
}

async function getDeviceData(homeyApi, deviceId) {
  try {
    const device = await homeyApi.devices.getDevice({ id: deviceId });
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
    
    return data;
  } catch (error) {
    console.error(`Error fetching device ${deviceId}:`, error.message);
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
        note: 'Please configure these in Vercel environment variables'
      });
    }

    console.log('Fetching Homey sensor data...');
    
    // Get Homey API connection
    const homeyApi = await getHomeyApi();
    
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
        console.warn('Could not fetch separate humidity sensor, using temp sensor:', error.message);
      }
    }
    
    // Combine data
    const responseData = {
      temperature: tempData.temperature,
      humidity: humidityData.humidity || tempData.humidity,
      timestamp: new Date().toISOString(),
      source: 'homey-pro'
    };
    
    console.log('Successfully fetched sensor data:', responseData);
    
    return res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Homey API Error:', error);
    
    return res.status(500).json({
      error: 'Failed to fetch Homey data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
