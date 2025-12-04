/**
 * Debug script: Inspect full Fnugg API response
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  try {
    console.log('🔍 Fetching Fnugg API...');
    
    const url = 'https://api.fnugg.no/search';
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'WKWeatherDashboard/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const hits = data.hits?.hits || [];
    const total = data.hits?.total || 0;
    
    console.log(`✅ Received ${hits.length} resorts (Total: ${total})`);
    
    // Show all resort IDs and names
    const resortList = hits.map(hit => ({
      id: hit._source?.id,
      name: hit._source?.name,
      _id: hit._id
    }));
    
    // Search for Hafjell with different methods
    const searchResults = {
      byId12: hits.find(h => h._source?.id === 12),
      byIdString12: hits.find(h => h._source?.id === '12'),
      byName: hits.find(h => h._source?.name?.toLowerCase().includes('hafjell')),
      by_id12: hits.find(h => h._id === '12'),
      by_idString: hits.find(h => String(h._source?.id) === '12')
    };
    
    // Get first 3 resorts as sample
    const sampleResorts = hits.slice(0, 3).map(hit => ({
      _id: hit._id,
      id: hit._source?.id,
      name: hit._source?.name,
      hasLifts: !!hit._source?.lifts,
      hasConditions: !!hit._source?.conditions
    }));
    
    // Look for Hafjell specifically
    const hafjellIndex = hits.findIndex(h => {
      const name = (h._source?.name || '').toLowerCase();
      return name.includes('hafjell');
    });
    
    return res.status(200).json({
      success: true,
      totalResorts: total,
      receivedResorts: hits.length,
      sampleResorts,
      allResortIds: resortList.slice(0, 20), // First 20 for readability
      searchResults: {
        byId12: !!searchResults.byId12,
        byIdString12: !!searchResults.byIdString12,
        byName: !!searchResults.byName,
        by_id12: !!searchResults.by_id12,
        by_idString: !!searchResults.by_idString
      },
      hafjellIndex,
      hafjellData: hafjellIndex >= 0 ? {
        _id: hits[hafjellIndex]._id,
        id: hits[hafjellIndex]._source?.id,
        name: hits[hafjellIndex]._source?.name,
        hasLifts: !!hits[hafjellIndex]._source?.lifts,
        hasConditions: !!hits[hafjellIndex]._source?.conditions,
        liftCount: hits[hafjellIndex]._source?.lifts?.count,
        openLifts: hits[hafjellIndex]._source?.lifts?.open
      } : null,
      // Full first resort for structure reference
      firstResortStructure: hits[0]
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
