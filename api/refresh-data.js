/**
 * Background Data Refresh - Simplified for Redis Cloud
 * Uses ioredis which works better with serverless functions
 */

import Redis from 'ioredis';

const CACHE_TTL = 300; // 5 minutes
const HAFJELL_COORDS = { lat: 61.234381, lon: 10.448835 };

// Create Redis client with serverless-friendly settings
function createRedisClient() {
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10000
  });
}

/**
 * Fetch YR.no forecast
 */
async function fetchForecastData(redis) {
  console.log('📊 Fetching YR.no forecast...');
  
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HAFJELL_COORDS.lat}&lon=${HAFJELL_COORDS.lon}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WKWeatherDashboard/1.0 (wksnowdashboard.wvsailing.co.uk)'
      }
    });

    if (!response.ok) throw new Error(`Met.no error: ${response.status}`);

    const data = await response.json();
    
    const cacheData = {
      data,
      timestamp: new Date().toISOString(),
      source: 'yr.no'
    };
    
    await redis.setex('forecast_data', CACHE_TTL, JSON.stringify(cacheData));
    console.log('✅ Forecast cached');
    
    return { success: true, service: 'forecast' };
  } catch (error) {
    console.error('❌ Forecast error:', error.message);
    return { success: false, service: 'forecast', error: error.message };
  }
}

/**
 * Fetch Homey data
 */
async function fetchHomeyData(redis) {
  console.log('🏠 Fetching Homey...');
  
  if (!process.env.HOMEY_CLIENT_ID) {
    console.log('⚠️  Homey not configured');
    return { success: false, service: 'homey', error: 'Not configured' };
  }

  try {
    const { default: AthomCloudAPI } = await import('homey-api/lib/AthomCloudAPI.js');
    
    const cloudApi = new AthomCloudAPI({
      clientId: process.env.HOMEY_CLIENT_ID,
      clientSecret: process.env.HOMEY_CLIENT_SECRET,
    });

    await cloudApi.authenticateWithUsernamePassword({
      username: process.env.HOMEY_USERNAME,
      password: process.env.HOMEY_PASSWORD,
    });

    const user = await cloudApi.getAuthenticatedUser();
    const homey = await user.getFirstHomey();
    const homeyApi = await homey.authenticate();
    
    const tempDevice = await homeyApi.devices.getDevice({ id: process.env.HOMEY_DEVICE_ID_TEMP });
    const caps = tempDevice.capabilitiesObj || {};
    
    const sensorData = {
      temperature: caps.measure_temperature?.value,
      humidity: caps.measure_humidity?.value,
      timestamp: new Date().toISOString()
    };
    
    await redis.setex('homey_data', CACHE_TTL, JSON.stringify(sensorData));
    console.log('✅ Homey cached');
    
    return { success: true, service: 'homey' };
  } catch (error) {
    console.error('❌ Homey error:', error.message);
    return { success: false, service: 'homey', error: error.message };
  }
}

/**
 * Fetch Hafjell data
 */
async function fetchHafjellData(redis) {
  console.log('🏔️ Fetching Hafjell...');
  
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const response = await fetch(proxyUrl + targetUrl, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) throw new Error(`Hafjell error: ${response.status}`);
    
    const data = await response.json();
    
    const cacheData = {
      html: data.contents,
      timestamp: new Date().toISOString()
    };
    
    await redis.setex('hafjell_html', CACHE_TTL, JSON.stringify(cacheData));
    console.log('✅ Hafjell cached');
    
    return { success: true, service: 'hafjell' };
  } catch (error) {
    console.error('❌ Hafjell error:', error.message);
    return { success: false, service: 'hafjell', error: error.message };
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Simple auth check
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production' && !req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('🔄 Starting refresh...');
  const startTime = Date.now();
  
  let redis = null;
  
  try {
    // Create and connect Redis client
    redis = createRedisClient();
    await redis.connect();
    console.log('✅ Redis connected');
    
    // Fetch all data
    const results = await Promise.allSettled([
      fetchForecastData(redis),
      fetchHomeyData(redis),
      fetchHafjellData(redis)
    ]);

    const duration = Date.now() - startTime;
    
    const summary = {
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      results: results.map((r, i) => 
        r.status === 'fulfilled' ? r.value : {
          success: false,
          service: ['forecast', 'homey', 'hafjell'][i],
          error: r.reason?.message
        }
      )
    };

    const successCount = summary.results.filter(r => r.success).length;
    console.log(`✅ Refresh complete: ${successCount}/3 successful in ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      message: 'Background refresh completed',
      summary
    });
    
  } catch (error) {
    console.error('❌ Refresh failed:', error);
    return res.status(500).json({
      error: 'Refresh failed',
      message: error.message
    });
  } finally {
    // Always disconnect Redis
    if (redis) {
      try {
        await redis.quit();
        console.log('✅ Redis disconnected');
      } catch (e) {
        console.log('Redis disconnect error (ignored)');
      }
    }
  }
}
