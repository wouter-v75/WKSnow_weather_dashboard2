/**
 * Vercel Serverless Function: Get Cached Dashboard Data from Upstash Redis
 * 
 * Returns pre-cached data from the background refresh job
 * This makes the dashboard load instantly without waiting for API calls
 * 
 * Usage: GET /api/cached-data?type=forecast|homey|hafjell|all
 */

import { Redis } from '@upstash/redis';

// Initialize Upstash Redis client
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only GET requests are supported' 
    });
  }

  try {
    const { type = 'all' } = req.query;
    
    // Set cache headers for browser caching
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    
    switch (type) {
      case 'forecast': {
        const cachedString = await redis.get('forecast_data');
        if (!cachedString) {
          return res.status(404).json({
            error: 'No cached data',
            message: 'Forecast data not yet cached. Wait for background refresh.'
          });
        }
        
        const data = JSON.parse(cachedString);
        return res.status(200).json({
          success: true,
          ...data
        });
      }
      
      case 'homey': {
        const cachedString = await redis.get('homey_data');
        if (!cachedString) {
          return res.status(404).json({
            error: 'No cached data',
            message: 'Homey data not yet cached. Wait for background refresh.'
          });
        }
        
        const data = JSON.parse(cachedString);
        return res.status(200).json({
          success: true,
          data: data,
          source: 'homey',
          timestamp: data.timestamp
        });
      }
      
      case 'hafjell': {
        const cachedString = await redis.get('hafjell_html');
        if (!cachedString) {
          return res.status(404).json({
            error: 'No cached data',
            message: 'Hafjell data not yet cached. Wait for background refresh.'
          });
        }
        
        const data = JSON.parse(cachedString);
        return res.status(200).json({
          success: true,
          html: data.html,
          timestamp: data.timestamp
        });
      }
      
      case 'all': {
        // Get all cached data in parallel
        const [forecastStr, homeyStr, hafjellStr] = await Promise.all([
          redis.get('forecast_data'),
          redis.get('homey_data'),
          redis.get('hafjell_html')
        ]);
        
        // Parse cached data
        const forecast = forecastStr ? JSON.parse(forecastStr) : null;
        const homey = homeyStr ? JSON.parse(homeyStr) : null;
        const hafjell = hafjellStr ? JSON.parse(hafjellStr) : null;
        
        return res.status(200).json({
          success: true,
          data: {
            forecast: forecast,
            homey: homey,
            hafjell: hafjell
          },
          cached: {
            forecast: !!forecast,
            homey: !!homey,
            hafjell: !!hafjell
          },
          timestamp: new Date().toISOString()
        });
      }
      
      default:
        return res.status(400).json({
          error: 'Invalid type parameter',
          message: 'Valid types are: forecast, homey, hafjell, all'
        });
    }
    
  } catch (error) {
    console.error('Cached data error:', error);
    
    return res.status(500).json({
      error: 'Failed to retrieve cached data',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
