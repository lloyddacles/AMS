import app from './app.js';
import { config } from './config.js';

// Local development server. On Vercel the app is used directly as a
// serverless function, so no listener is started there.
app.listen(config.port, () => {
  console.log(`Attendance server running on http://localhost:${config.port}`);
});
