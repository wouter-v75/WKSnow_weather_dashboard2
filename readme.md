// ==========================================
// FILE: README.md
// ==========================================

# WK Snow Weather Dashboard

A beautiful glassmorphism weather dashboard featuring real-time data from multiple sources.

## Features

- 🌡️ **Outdoor sensors** via Homey Pro integration
- 🎿 **Hafjell weather stations** (top and bottom)
- 📅 **YR.no forecast** for Mosetertoppen
- 📈 **6-hour temperature trend graph**
- 🔮 **Glassmorphism design** with smooth animations
- 📱 **iPad landscape optimized** layout
- ⚡ **Auto-refresh** every 5 minutes

## Quick Start

### Deploy to Vercel

1. Fork this repository
2. Connect your GitHub repo to [Vercel](https://vercel.com)
3. Deploy with one click!

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/wk-snow-weather-dashboard)

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/wk-snow-weather-dashboard.git
cd wk-snow-weather-dashboard

# Install Vercel CLI (optional)
npm install -g vercel

# Run locally
vercel dev
# or simply open index.html in your browser
```

## Configuration

### Homey Pro Setup

1. Get your Homey Pro IP address
2. Generate a bearer token in Homey Settings → Advanced → Developer
3. Find your device IDs in Homey Developer Tools
4. Update the `CONFIG` object in `index.html`:

```javascript
const CONFIG = {
    homey: {
        localUrl: 'http://192.168.1.100', // Your Homey IP
        bearerToken: 'your-bearer-token-here',
        devices: {
            outdoorTempSensor: 'your-device-id-here',
            outdoorHumiditySensor: 'your-device-id-here'
        }
    },
    location: {
        lat: 61.236, // Mosetertoppen coordinates
        lon: 10.460
    }
};
```

### Hafjell Data Setup

For production use, you'll need a server-side proxy to scrape Hafjell data due to CORS restrictions:

1. Create an API endpoint that scrapes `https://www.hafjell.no/en/snorapport-hafjell`
2. Update the `fetchHafjellData()` function to call your endpoint
3. Deploy the proxy as a Vercel API function (see `/api` folder)

## File Structure

```
wk-snow-weather-dashboard/
├── index.html          # Main dashboard file
├── package.json        # Project configuration
├── vercel.json         # Vercel deployment config
├── README.md           # This file
└── api/                # Optional: Vercel API functions
    └── hafjell.js      # Hafjell data proxy
```

## Technologies Used

- **HTML5/CSS3** - Structure and styling
- **Vanilla JavaScript** - Logic and API calls
- **Chart.js** - Temperature trend graph
- **Glassmorphism** - Modern UI design
- **Vercel** - Static site hosting
- **YR.no API** - Weather forecast data

## Browser Support

- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers

## License

MIT License - feel free to use and modify!

## Contributing

1. Fork the project
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

Made with ❄️ for the perfect winter weather experience!
