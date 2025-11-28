/**
 * Vercel Cron Job: Background Data Refresh with Upstash Redis
 * 
 * This function runs every 5 minutes (even when no one is viewing the dashboard)
 * It pre-fetches and caches data from all sources using Upstash Redis
 * 
 * Schedule: */5 * * * * (every 5 minutes)
 * 
 * Environment variables required:
 * - UPSTASH_REDIS_REST_URL (auto-set by Vercel Marketplace integration)
 * - UPSTASH_REDIS_REST_TOKEN (auto-set by Vercel Marketplace integration)
 * - CRON_SECRET (you set this manually)
 * - HOMEY_* variables (existing)
 */

import { Redis } from '@upstash/redis';

// Initialize Upstash Redis client
// This automatically reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
const redis = Redis.fromEnv();

const CACHE_TTL = 300; // 5 minutes in seconds

// Hafjell coordinates
const HAFJELL_COORDS = {
  lat: 61.234381,
  lon: 10.448835
};

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
    
    await redis.setex('forecast_data', CACHE_TTL, JSON.stringify(cacheData));

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
    // Dynamic import to avoid issues if module not installed
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
    await redis.setex('homey_data', CACHE_TTL, JSON.stringify(sensorData));

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
    
    await redis.setex('hafjell_html', CACHE_TTL, JSON.stringify(cacheData));

    console.log('✅ Hafjell data cached successfully');
    return { success: true, service: 'hafjell' };
    
  } catch (error) {
    console.error('❌ Hafjell fetch error:', error.message);
    return { success: false, service: 'hafjell', error: error.message };
  }
}

/**
 * Main cron handler
 */
export default async function handler(req, res) {
  // Verify this is a cron request (security)
  const authHeader = req.headers.authorization;
  
  // Vercel cron jobs include a special header
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️  Unauthorized cron request');
    // Still allow for manual testing with ?manual=true
    if (process.env.NODE_ENV === 'production' && !req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('🔄 Starting background data refresh...');
  const startTime = Date.now();
  
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
  
  // Return summary
  return res.status(200).json({
    success: true,
    message: `Background data refresh completed`,
    summary: summary
  });
}
