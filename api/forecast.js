/**
 * Vercel Serverless Function: YR.no Forecast API Proxy
 * 
 * This function proxies requests to the Met.no Weather API with proper User-Agent header
 * Solves iOS Safari compatibility issues where custom User-Agent headers cannot be set
 * 
 * Usage: GET /api/forecast?lat=XX.XXXX&lon=XX.XXXX
 */

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
    // Get coordinates from query parameters
    const { lat, lon } = req.query;
    
    // Validate parameters
    if (!lat || !lon) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'Both lat and lon query parameters are required'
      });
    }

    // Validate coordinate format (must be valid numbers)
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    
    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'lat and lon must be valid numbers'
      });
    }

    // Validate coordinate ranges
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        error: 'Invalid coordinates',
        message: 'Latitude must be between -90 and 90, longitude between -180 and 180'
      });
    }

    // Round to 4 decimals as per Met.no best practices
    const roundedLat = Math.round(latitude * 10000) / 10000;
    const roundedLon = Math.round(longitude * 10000) / 10000;

    console.log(`Fetching forecast for coordinates: ${roundedLat}, ${roundedLon}`);

    // Build Met.no API URL
    const metnoUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${roundedLat}&lon=${roundedLon}`;
    
    // Make request to Met.no with proper User-Agent header
    const response = await fetch(metnoUrl, {
      method: 'GET',
      headers: {
        // Met.no requires proper User-Agent identification
        'User-Agent': 'WKWeatherDashboard/1.0 (wksnowdashboard.wvsailing.co.uk)',
        'Accept': 'application/json'
      }
    });

    // Check if request was successful
    if (!response.ok) {
      console.error(`Met.no API error: ${response.status} ${response.statusText}`);
      
      // Handle specific error codes
      if (response.status === 403) {
        return res.status(500).json({
          error: 'Met.no API access denied',
          message: 'The weather service rejected our request. Please try again later.',
          statusCode: response.status
        });
      }
      
      if (response.status === 429) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests to weather service. Please wait a moment.',
          statusCode: response.status
        });
      }
      
      throw new Error(`Met.no API returned ${response.status}: ${response.statusText}`);
    }

    // Get response data
    const forecastData = await response.json();
    
    // Get caching headers from Met.no response
    const expires = response.headers.get('Expires');
    const lastModified = response.headers.get('Last-Modified');
    
    console.log(`Successfully fetched forecast data. Expires: ${expires}`);

    // Set appropriate caching headers for client
    if (expires) {
      res.setHeader('Expires', expires);
    }
    if (lastModified) {
      res.setHeader('Last-Modified', lastModified);
    }
    
    // Cache for 5 minutes (Met.no updates hourly, but we refresh more frequently)
    res.setHeader('Cache-Control', 'public, max-age=300');

    // Return the forecast data
    return res.status(200).json({
      success: true,
      data: forecastData,
      source: 'yr.no',
      coordinates: {
        lat: roundedLat,
        lon: roundedLon
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Forecast API Error:', error);
    
    return res.status(500).json({
      error: 'Failed to fetch forecast',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
