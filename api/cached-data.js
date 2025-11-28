/**
 * Get Cached Data - CommonJS Version
 */

const Redis = require('ioredis');

function createRedisClient() {
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10000
  });
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type = 'all' } = req.query;
  let redis = null;

  try {
    redis = createRedisClient();
    await redis.connect();
    
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    if (type === 'all') {
      const [forecast, homey, hafjell] = await Promise.all([
        redis.get('forecast_data'),
        redis.get('homey_data'),
        redis.get('hafjell_html')
      ]);
      
      return res.status(200).json({
        success: true,
        data: {
          forecast: forecast ? JSON.parse(forecast) : null,
          homey: homey ? JSON.parse(homey) : null,
          hafjell: hafjell ? JSON.parse(hafjell) : null
        },
        cached: {
          forecast: !!forecast,
          homey: !!homey,
          hafjell: !!hafjell
        }
      });
    }
    
    // Single type
    const key = type === 'forecast' ? 'forecast_data' : 
                type === 'homey' ? 'homey_data' : 
                type === 'hafjell' ? 'hafjell_html' : null;
    
    if (!key) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    
    const data = await redis.get(key);
    
    if (!data) {
      return res.status(404).json({ error: 'No cached data' });
    }
    
    return res.status(200).json({
      success: true,
      ...JSON.parse(data)
    });
    
  } catch (error) {
    console.error('Cache error:', error);
    return res.status(500).json({
      error: 'Failed to get cached data',
      message: error.message
    });
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
};
