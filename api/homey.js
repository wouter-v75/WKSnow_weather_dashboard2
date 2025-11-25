export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  try {
    const testResults = {
      step: 'starting',
      errors: []
    };

    // Test 1: Can we import the package at all?
    testResults.step = 'importing homey-api';
    let homeyApi;
    try {
      homeyApi = await import('homey-api');
      testResults.importSuccess = true;
      testResults.homeyApiKeys = Object.keys(homeyApi);
      testResults.hasDefault = !!homeyApi.default;
      testResults.hasAthomCloudAPI = !!homeyApi.AthomCloudAPI;
    } catch (importError) {
      testResults.importSuccess = false;
      testResults.importError = importError.message;
      return res.status(500).json(testResults);
    }

    // Test 2: Can we access AthomCloudAPI?
    testResults.step = 'accessing AthomCloudAPI';
    let AthomCloudAPI;
    try {
      AthomCloudAPI = homeyApi.AthomCloudAPI || homeyApi.default?.AthomCloudAPI || homeyApi.default;
      testResults.athomCloudAPIType = typeof AthomCloudAPI;
      testResults.athomCloudAPIFound = !!AthomCloudAPI;
    } catch (accessError) {
      testResults.accessError = accessError.message;
      return res.status(500).json(testResults);
    }

    // Test 3: Can we create an instance?
    testResults.step = 'creating instance';
    let cloudApi;
    try {
      cloudApi = new AthomCloudAPI({
        clientId: process.env.HOMEY_CLIENT_ID,
        clientSecret: process.env.HOMEY_CLIENT_SECRET,
      });
      testResults.instanceCreated = true;
      testResults.instanceType = typeof cloudApi;
      
      // Get all methods on the instance
      const proto = Object.getPrototypeOf(cloudApi);
      testResults.availableMethods = Object.getOwnPropertyNames(proto);
      testResults.hasAuthMethod = testResults.availableMethods.includes('authenticateWithUsernamePassword');
      
    } catch (constructError) {
      testResults.instanceCreated = false;
      testResults.constructError = constructError.message;
      return res.status(500).json(testResults);
    }

    return res.status(200).json({
      message: 'Import test successful',
      testResults
    });
    
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
