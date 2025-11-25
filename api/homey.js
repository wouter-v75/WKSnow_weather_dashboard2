export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }

  try {
    // Just test environment variables - no Homey import yet
    const envCheck = {
      HOMEY_CLIENT_ID: !!process.env.HOMEY_CLIENT_ID,
      HOMEY_CLIENT_SECRET: !!process.env.HOMEY_CLIENT_SECRET,
      HOMEY_USERNAME: !!process.env.HOMEY_USERNAME,
      HOMEY_PASSWORD: !!process.env.HOMEY_PASSWORD,
      HOMEY_DEVICE_ID_TEMP: !!process.env.HOMEY_DEVICE_ID_TEMP,
      HOMEY_DEVICE_ID_HUMIDITY: !!process.env.HOMEY_DEVICE_ID_HUMIDITY
    };

    return res.status(200).json({
      message: 'Minimal test - environment variables check',
      envCheck,
      allPresent: Object.values(envCheck).every(v => v === true)
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
```

Upload this via Vercel dashboard, wait for deployment, then visit:
```
https://wksnowdashboard.wvsailing.co.uk/api/homey
```

**What do you see?** This should at least work and tell us if environment variables are set.

---

## Step 2: Check if homey-api is installed

The crash might be because `homey-api` isn't being installed. Check your **package.json** is in the root directory:
```
your-project/
├── api/
│   ├── homey.js
│   └── auth.js
├── package.json  ← Must be HERE at root level
├── index.html
└── vercel.json
```

**Is package.json at the root level?** If not, move it there.

---

## Step 3: Check Vercel Build Logs

In Vercel dashboard:
1. Go to **Deployments**
2. Click latest deployment
3. Click **Building** or **Build Logs** tab
4. Look for lines about `npm install` - does it say:
```
   Installing dependencies...
   added X packages
