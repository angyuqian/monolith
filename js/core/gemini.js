// Browser-side Gemini client (generativelanguage.googleapis.com). No SDK, no backend.
//
//   gemini.generate('prompt' | contents[], { system, tools, json, schema, model })
//   gemini.generateJSON('prompt', schema)          -> parsed object
//   gemini.image('prompt', { images: [dataURL] })  -> { images: [dataURL], text }
//   gemini.omni('prompt' | parts[], { images })    -> { text, images: [url], videos: [url] }  (Interactions API)
//   gemini.video('prompt', { image })              -> { videos: [url] }                         (Veo long-running op)
import { CONFIG } from '../../config.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {}

async function request(path, { method = 'POST', body, timeout = 45000 } = {}) {
  if (!CONFIG.GEMINI_KEY) throw new GeminiError('No Gemini API key set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.GEMINI_KEY },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GeminiError(data?.error?.message || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new GeminiError(`Timed out after ${timeout / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Standard JSON Schema (lowercase types) -> Gemini OpenAPI subset (uppercase types).
export function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum.map(String);
  if (s.format) out.format = s.format;
  if (s.nullable) out.nullable = true;
  if (s.required) out.required = s.required;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

export function dataURLToPart(dataURL) {
  const [head, data] = dataURL.split(',');
  const mimeType = head.match(/data:(.*?);/)[1];
  return { inlineData: { mimeType, data } };
}

function b64ToBlobURL(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

function toContents(input) {
  if (typeof input === 'string') return [{ role: 'user', parts: [{ text: input }] }];
  return input;
}

export async function generate(input, opts = {}) {
  const { system, tools, json, schema, model = CONFIG.MODELS.text, temperature, timeout } = opts;
  const body = { contents: toContents(input), generationConfig: {} };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        ...(t.parameters && Object.keys(t.parameters.properties || {}).length
          ? { parameters: toGeminiSchema(t.parameters) } : {}),
      })),
    }];
  }
  if (json || schema) body.generationConfig.responseMimeType = 'application/json';
  if (schema) body.generationConfig.responseSchema = toGeminiSchema(schema);
  if (temperature != null) body.generationConfig.temperature = temperature;

  const data = await request(`models/${model}:generateContent`, { body, timeout });
  const content = data.candidates?.[0]?.content || { role: 'model', parts: [] };
  const parts = content.parts || [];
  return {
    content, // pass back verbatim in multi-turn (keeps thought signatures)
    parts,
    text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(''),
    functionCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall),
    raw: data,
  };
}

export async function generateJSON(input, schema, opts = {}) {
  const res = await generate(input, { ...opts, schema });
  try {
    return JSON.parse(res.text);
  } catch {
    const m = res.text.match(/[\[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new GeminiError('Model did not return JSON');
  }
}

export async function image(prompt, { images = [], model = CONFIG.MODELS.image, timeout = 120000 } = {}) {
  const body = {
    contents: [{ role: 'user', parts: [...images.map(dataURLToPart), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  const data = await request(`models/${model}:generateContent`, { body, timeout });
  const parts = data.candidates?.[0]?.content?.parts || [];
  const out = parts.filter((p) => p.inlineData).map((p) => `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`);
  if (!out.length) throw new GeminiError('No image returned');
  return { images: out, text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('') };
}

// Omni is served through the Interactions API. It can return text, image, audio or video (inline base64).
export async function omni(input, { images = [], model = CONFIG.MODELS.omni, timeout = 300000 } = {}) {
  let payload = input;
  if (images.length) {
    payload = [
      ...(typeof input === 'string' ? [{ type: 'text', text: input }] : input),
      ...images.map((d) => {
        const { inlineData } = dataURLToPart(d);
        return { type: 'image', data: inlineData.data, mime_type: inlineData.mimeType };
      }),
    ];
  }
  const data = await request('interactions', { body: { model, input: payload }, timeout });
  const out = { text: '', images: [], videos: [], audio: [], id: data.id };
  for (const step of data.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const c of step.content || []) {
      if (c.type === 'text') out.text += c.text;
      const url = c.data ? b64ToBlobURL(c.data, c.mime_type) : c.uri;
      if (c.type === 'image' && url) out.images.push(url);
      if (c.type === 'video' && url) out.videos.push(url);
      if (c.type === 'audio' && url) out.audio.push(url);
    }
  }
  return out;
}

// Veo text/image-to-video. Long-running: start, poll, download. (Untested on this key — Omni is the primary path.)
export async function video(prompt, { image: img, model = CONFIG.MODELS.video, timeout = 360000, onProgress } = {}) {
  const instance = { prompt };
  if (img) {
    const { inlineData } = dataURLToPart(img);
    instance.image = { bytesBase64Encoded: inlineData.data, mimeType: inlineData.mimeType };
  }
  let op = await request(`models/${model}:predictLongRunning`, {
    body: { instances: [instance], parameters: { aspectRatio: '16:9' } },
  });
  const started = Date.now();
  while (!op.done) {
    if (Date.now() - started > timeout) throw new GeminiError('Video generation timed out');
    onProgress?.(Math.round((Date.now() - started) / 1000));
    await new Promise((r) => setTimeout(r, 8000));
    op = await request(op.name, { method: 'GET' });
  }
  if (op.error) throw new GeminiError(op.error.message);
  const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new GeminiError('No video returned');
  const res = await fetch(uri, { headers: { 'x-goog-api-key': CONFIG.GEMINI_KEY } });
  return { videos: [URL.createObjectURL(await res.blob())] };
}

export async function ping() {
  await request('models?pageSize=1', { method: 'GET', timeout: 8000 });
  return true;
}

export const gemini = { generate, generateJSON, image, omni, video, ping };
