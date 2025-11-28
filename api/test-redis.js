/**
 * Simple Redis Connection Test
 * Tests if we can connect to Redis and read/write data
 */

import Redis from 'ioredis';

export default async function handler(req, res) {
  console.log('🧪 Testing Redis connection...');
  
  let redis = null;
  const testResults = {
    timestamp: new Date().toISOString(),
    tests: []
  };
  
  try {
    // Test 1: Check if REDIS_URL exists
    testResults.tests.push({
      test: 'Environment Variable',
      status: process.env.REDIS_URL ? 'PASS' : 'FAIL',
      value: process.env.REDIS_URL ? 'EXISTS' : 'MISSING',
      url: process.env.REDIS_URL ? process.env.REDIS_URL.substring(0, 20) + '...' : 'N/A'
    });
    
    if (!process.env.REDIS_URL) {
      return res.status(500).json({
        success: false,
        error: 'REDIS_URL environment variable not set',
        results: testResults
      });
    }
    
    // Test 2: Create Redis client
    console.log('Creating Redis client...');
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 10000
    });
    
    testResults.tests.push({
      test: 'Create Client',
      status: 'PASS',
      message: 'Redis client created'
    });
    
    // Test 3: Connect to Redis
    console.log('Connecting to Redis...');
    await redis.connect();
    
    testResults.tests.push({
      test: 'Connect',
      status: 'PASS',
      message: 'Connected to Redis'
    });
    
    // Test 4: Write data
    console.log('Writing test data...');
    const testKey = 'test_connection';
    const testValue = JSON.stringify({ 
      test: true, 
      timestamp: new Date().toISOString() 
    });
    
    await redis.set(testKey, testValue);
    
    testResults.tests.push({
      test: 'Write Data',
      status: 'PASS',
      message: 'Successfully wrote to Redis'
    });
    
    // Test 5: Read data
    console.log('Reading test data...');
    const readValue = await redis.get(testKey);
    
    testResults.tests.push({
      test: 'Read Data',
      status: readValue ? 'PASS' : 'FAIL',
      message: readValue ? 'Successfully read from Redis' : 'Failed to read',
      data: readValue ? JSON.parse(readValue) : null
    });
    
    // Test 6: Set with expiry
    console.log('Testing SETEX...');
    await redis.setex('test_expiry', 60, 'expires in 60 seconds');
    
    testResults.tests.push({
      test: 'SETEX (with TTL)',
      status: 'PASS',
      message: 'Successfully set key with expiration'
    });
    
    // Test 7: Check TTL
    const ttl = await redis.ttl('test_expiry');
    
    testResults.tests.push({
      test: 'TTL Check',
      status: ttl > 0 ? 'PASS' : 'FAIL',
      message: `TTL: ${ttl} seconds`,
      ttl: ttl
    });
    
    // Clean up test keys
    await redis.del(testKey, 'test_expiry');
    
    console.log('✅ All Redis tests passed!');
    
    return res.status(200).json({
      success: true,
      message: '✅ Redis is working correctly!',
      results: testResults,
      summary: {
        total: testResults.tests.length,
        passed: testResults.tests.filter(t => t.status === 'PASS').length,
        failed: testResults.tests.filter(t => t.status === 'FAIL').length
      }
    });
    
  } catch (error) {
    console.error('❌ Redis test failed:', error);
    
    testResults.tests.push({
      test: 'Connection/Operation',
      status: 'FAIL',
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: 'Redis test failed',
      message: error.message,
      results: testResults
    });
    
  } finally {
    // Always try to disconnect
    if (redis) {
      try {
        await redis.quit();
        console.log('✅ Redis disconnected');
      } catch (e) {
        console.log('Redis disconnect error (ignored):', e.message);
      }
    }
  }
}
