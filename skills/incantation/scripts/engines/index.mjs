// The engine table (docs/spec/incantation.md, S5.1): a name to a shipped
// module, fixed in code. Settings name an engine by its key here; any other
// name is refused before anything is imported. A second engine is one more
// row and one more file (W5).

const ENGINES = Object.freeze({
  voicebox: () => import('./voicebox.mjs'),
  sherpa: () => import('./sherpa.mjs'),
});

export const isEngine = name => typeof name === 'string' && Object.hasOwn(ENGINES, name);

// The engine for the settings, or Error('engine').
export async function loadEngine(name, settings) {
  if (!isEngine(name)) throw new Error('engine');
  const mod = await ENGINES[name]();
  return mod.makeEngine(settings);
}
