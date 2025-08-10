// ==========================================
// FILE: api/hafjell.js (Optional)
// ==========================================

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Fetch Hafjell snow report
    const response = await fetch('https://www.hafjell.no/en/snorapport-hafjell');
    const html = await response.text();
    
    // Parse HTML to extract weather data
    // This is a simplified parser - you'd need to implement proper HTML parsing
    const mockData = {
      top: {
        temperature: (11 + (Math.random() - 0.5) * 3).toFixed(1),
        condition: 'Mostly sunny',
        wind: (5.6 + (Math.random() - 0.5) * 2).toFixed(1),
        snow: '65',
        snowLastDay: Math.floor(Math.random() * 3).toString()
      },
      bottom: {
        temperature: (20 + (Math.random() - 0.5) * 4).toFixed(1),
        condition: 'Mostly sunny',
        wind: (2.0 + (Math.random() - 0.5) * 1.5).toFixed(1),
        snow: '65',
        snowLastDay: Math.floor(Math.random() * 3).toString()
      },
      lastUpdated: new Date().toISOString()
    };

    res.status(200).json(mockData);
  } catch (error) {
    console.error('Error fetching Hafjell data:', error);
    res.status(500).json({ error: 'Failed to fetch Hafjell data' });
  }
}