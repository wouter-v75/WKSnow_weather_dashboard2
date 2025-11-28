/**
 * Vercel Serverless Function: Background Data Refresh with Redis Cloud
 * 
 * This function runs when triggered externally (via cron-job.org)
 * It pre-fetches and caches data from all sources using Redis Cloud
 * 
 * Environment variables required:
 * - REDIS_URL (auto-set by Vercel Redis Cloud integration)
 * - CRON_SECRET (you set this manually)
 * - HOMEY_* variables (existing)
 */

import { createClient } from 'redis';

const CACHE_TTL = 300; // 5 minutes in seconds

// Hafjell coordinates
const HAFJELL_COORDS = {
  lat: 61.234381,
  lon: 10.448835
};

// Redis client (will be created on first use)
let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL
    });
    
    redisClient.on('error', (err) => console.error('Redis Client Error', err));
    await redisClient.connect();
  }
  return redisClient;
}

/**
 * Fetch YR.no forecast data
 */
async function fetchForecastData() {
  console.log('📊 Fetching YR.no forecast data...');
  
  try {
    const metnoUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HAFJELL_COORDS.lat}&lon=${HAFJELL_COORDS.lon}`;
    
    const response = await fetch(metnoUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'WKWeatherDashboard/1.0 (wksnowdashboard.wvsailing.co.uk)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Met.no API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Cache the forecast data in Redis
    const cacheData = {
      data: data,
      timestamp: new Date().toISOString(),
      source: 'yr.no',
      coordinates: HAFJELL_COORDS
    };
    
    const redis = await getRedisClient();
    await redis.setEx('forecast_data', CACHE_TTL, JSON.stringify(cacheData));

    console.log('✅ YR.no forecast cached successfully');
    return { success: true, service: 'forecast' };
    
  } catch (error) {
    console.error('❌ Forecast fetch error:', error.message);
    return { success: false, service: 'forecast', error: error.message };
  }
}

/**
 * Fetch Homey sensor data
 */
async function fetchHomeyData() {
  console.log('🏠 Fetching Homey sensor data...');
  
  // Check if Homey is configured
  if (!process.env.HOMEY_CLIENT_ID || !process.env.HOMEY_CLIENT_SECRET || 
      !process.env.HOMEY_USERNAME || !process.env.HOMEY_PASSWORD) {
    console.log('⚠️  Homey not configured, skipping');
    return { success: false, service: 'homey', error: 'Not configured' };
  }

  try {
    // Dynamic import
    const { default: AthomCloudAPI } = await import('homey-api/lib/AthomCloudAPI.js');
    
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
    const homey = await user.getFirstHomey();
    const homeyApi = await homey.authenticate();
    
    // Fetch temperature data
    const tempDeviceId = process.env.HOMEY_DEVICE_ID_TEMP;
    const tempDevice = await homeyApi.devices.getDevice({ id: tempDeviceId });
    const tempCaps = tempDevice.capabilitiesObj || tempDevice.capabilities || {};
    
    const sensorData = {
      temperature: tempCaps.measure_temperature?.value || tempCaps.temperature?.value,
      humidity: tempCaps.measure_humidity?.value || tempCaps.humidity?.value,
      timestamp: new Date().toISOString()
    };
    
    // Try separate humidity sensor if configured
    const humidityDeviceId = process.env.HOMEY_DEVICE_ID_HUMIDITY;
    if (humidityDeviceId && humidityDeviceId !== tempDeviceId) {
      try {
        const humDevice = await homeyApi.devices.getDevice({ id: humidityDeviceId });
        const humCaps = humDevice.capabilitiesObj || humDevice.capabilities || {};
        sensorData.humidity = humCaps.measure_humidity?.value || humCaps.humidity?.value;
      } catch (error) {
        console.log('Using humidity from temp sensor');
      }
    }
    
    // Cache the sensor data in Redis
    const redis = await getRedisClient();
    await redis.setEx('homey_data', CACHE_TTL, JSON.stringify(sensorData));

    console.log('✅ Homey data cached:', sensorData);
    return { success: true, service: 'homey', data: sensorData };
    
  } catch (error) {
    console.error('❌ Homey fetch error:', error.message);
    return { success: false, service: 'homey', error: error.message };
  }
}

/**
 * Fetch Hafjell weather and lift data
 */
async function fetchHafjellData() {
  console.log('🏔️ Fetching Hafjell data...');
  
  try {
    // Use CORS proxy to get Hafjell page
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const response = await fetch(proxyUrl + targetUrl, {
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Hafjell fetch error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Cache the raw HTML for parsing by frontend
    const cacheData = {
      html: data.contents,
      timestamp: new Date().toISOString()
    };
    
    const redis = await getRedisClient();
    await redis.setEx('hafjell_html', CACHE_TTL, JSON.stringify(cacheData));

    console.log('✅ Hafjell data cached successfully');
    return { success: true, service: 'hafjell' };
    
  } catch (error) {
    console.error('❌ Hafjell fetch error:', error.message);
    return { success: false, service: 'hafjell', error: error.message };
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Verify this is authorized
  const authHeader = req.headers.authorization;
  
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️  Unauthorized request');
    // Allow manual testing with ?manual=true
    if (process.env.NODE_ENV === 'production' && !req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('🔄 Starting background data refresh...');
  const startTime = Date.now();
  
  try {
    // Fetch all data in parallel
    const results = await Promise.allSettled([
      fetchForecastData(),
      fetchHomeyData(),
      fetchHafjellData()
    ]);

    const duration = Date.now() - startTime;
    
    // Process results
    const summary = {
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      results: results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            success: false,
            service: ['forecast', 'homey', 'hafjell'][index],
            error: result.reason?.message || 'Unknown error'
          };
        }
      })
    };

    const successCount = summary.results.filter(r => r.success).length;
    const totalCount = summary.results.length;
    
    console.log(`✅ Background refresh complete: ${successCount}/${totalCount} successful in ${duration}ms`);
    
    // Close Redis connection
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
    }
    
    return res.status(200).json({
      success: true,
      message: `Background data refresh completed`,
      summary: summary
    });
    
  } catch (error) {
    console.error('❌ Refresh error:', error);
    
    // Close Redis connection on error
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
    }
    
    return res.status(500).json({
      error: 'Refresh failed',
      message: error.message
    });
  }
}
