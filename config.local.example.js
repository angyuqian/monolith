// Copy to config.local.js (gitignored) and paste your keys. Never commit the real file.
export default {
  GEMINI_KEY: '',       // AI Studio key for generativelanguage.googleapis.com
  GOOGLE_MAPS_KEY: '',  // optional "AIza..." key: enables the Photoreal 3D view
  COMMS: {
    recipient: { name: 'Investment Team', greeting: 'Investment Team', org: 'your fund', email: 'investors@example.com' }, // investor memo email (optional override)
    sender: 'The Monolith team',
  },
};
