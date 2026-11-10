// Acces Capacitor fără import ESM (aplicația nu are bundler).
// Schimbarea motoarelor native se face în native-tts.js / native-stt.js.
export const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
export const isNative = () => !!(cap() && typeof cap().isNativePlatform === 'function' && cap().isNativePlatform());
export const plugin = name => cap()?.Plugins?.[name] || null;
