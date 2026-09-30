// Agent manifest. To add an agent: copy _template.js, then add its filename here. That's it.
// Each file is loaded in isolation — if one fails to load, the rest of the app keeps working.
export const AGENTS = [
  'siteScout.js',
  'render.js',
  'compliance.js',
  'comms.js',
  'voice.js',
];
