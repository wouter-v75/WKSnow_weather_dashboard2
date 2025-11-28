/**
 * Background Data Refresh with Redis
 * Access via: /api/refresh-data.js?manual=true
 */

import Redis from 'ioredis';

const CACHE_TTL = 300;
const HAFJELL_COORDS = { lat: 61.234381, lon: 10.448835 };

function createRedisClient() {
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10000
  });
}

async function fetchForecastData(redis) {
  console.log('📊 Fetching forecast...');
  try {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HAFJELL_COORDS.lat}&lon=${HAFJELL_COORDS.lon}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WKWeatherDashboard/1.0 (wksnowdashboard.wvsailing.co.uk)' }
    });
    if (!response.ok) throw new Error(`Met.no: ${response.status}`);
    const data = await response.json();
    await redis.setex('forecast_data', CACHE_TTL, JSON.stringify({
      data, timestamp: new Date().toISOString(), source: 'yr.no'
    }));
    console.log('✅ Forecast cached');
    return { success: true, service: 'forecast' };
  } catch (error) {
    console.error('❌ Forecast:', error.message);
    return { success: false, service: 'forecast', error: error.message };
  }
}

async function fetchHomeyData(redis) {
  console.log('🏠 Fetching Homey...');
  
  if (!process.env.HOMEY_REFRESH_TOKEN) {
    console.log('⚠️ Homey not configured');
    return { success: false, service: 'homey', error: 'Not configured' };
  }
  
  try {
    // Call the .cjs endpoint (CommonJS file)
    const homeyEndpoint = 'https://wksnowdashboard.wvsailing.co.uk/api/homey.cjs';
    
    console.log('Calling Homey endpoint...');
    const response = await fetch(homeyEndpoint);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Homey endpoint error:', errorText.substring(0, 200));
      throw new Error(`Homey endpoint returned ${response.status}`);
    }
    
    const sensorData = await response.json();
    console.log('Homey data received:', sensorData);
    
    if (sensorData.error) {
      throw new Error(sensorData.message || sensorData.error);
    }
    
    // Cache the data
    await redis.setex('homey_data', CACHE_TTL, JSON.stringify(sensorData));
    console.log('✅ Homey cached');
    return { success: true, service: 'homey' };
    
  } catch (error) {
    console.error('❌ Homey error:', error.message);
    return { success: false, service: 'homey', error: error.message };
  }
}

async function fetchHafjellData(redis) {
  console.log('🏔️ Fetching Hafjell...');
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const targetUrl = encodeURIComponent('https://www.hafjell.no/en/snorapport-hafjell');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(proxyUrl + targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`Hafjell proxy: ${response.status}`);
    
    const data = await response.json();
    if (!data.contents) throw new Error('No HTML content in response');
    
    await redis.setex('hafjell_html', CACHE_TTL, JSON.stringify({
      html: data.contents, 
      timestamp: new Date().toISOString()
    }));
    
    console.log('✅ Hafjell cached');
    return { success: true, service: 'hafjell' };
    
  } catch (error) {
    console.error('❌ Hafjell:', error.message);
    return { success: false, service: 'hafjell', error: error.message };
  }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production' && !req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('🔄 Starting refresh...');
  const startTime = Date.now();
  let redis = null;
  
  try {
    redis = createRedisClient();
    await redis.connect();
    console.log('✅ Redis connected');
    
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
    console.log(`✅ Complete: ${successCount}/3 in ${duration}ms`);
    
    return res.status(200).json({
      success: true,
      message: 'Background refresh completed',
      summary
    });
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({ error: 'Refresh failed', message: error.message });
  } finally {
    if (redis) {
      try { await redis.quit(); } catch (e) {}
    }
  }
}
