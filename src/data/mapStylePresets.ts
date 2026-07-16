/** Curated starting prompts for the "AI Export…" panel's manual style pass
 *  (see DMConsolePage.tsx). Picking one just overwrites manualStylePrompt —
 *  the DM can freely edit from there, same as always. Not used by the
 *  automatic "AI atmosphere pass on export" checkbox, which intentionally
 *  stays fixed-prompt (see comfyui.rs's POSITIVE_PROMPT). */
export interface MapStylePreset {
  id: string;
  label: string;
  prompt: string;
}

export const MAP_STYLE_PRESETS: MapStylePreset[] = [
  {
    id: 'atmospheric',
    label: 'Atmospheric',
    prompt: 'top-down tabletop RPG battle map, detailed dungeon floor texture, atmospheric lighting, dramatic shadows, digital painting, high detail. Do not add any text, watermarks, or UI elements.',
  },
  {
    id: 'anime',
    label: 'Anime',
    prompt: 'top-down tabletop RPG battle map, Japanese anime art style, clean cel-shaded linework, vibrant saturated colors, Studio Ghibli-inspired dungeon floor texture, high detail. Do not add any text, watermarks, or UI elements.',
  },
  {
    id: 'realistic',
    label: 'Realistic',
    prompt: 'top-down tabletop RPG battle map, photorealistic dungeon floor texture, natural realistic lighting, physically accurate materials and wear, cinematic detail. Do not add any text, watermarks, or UI elements.',
  },
  {
    id: 'fantastical',
    label: 'Fantastical',
    prompt: 'top-down tabletop RPG battle map, vivid whimsical fantasy illustration, magical glowing accents, richly colorful storybook art style, painterly detail. Do not add any text, watermarks, or UI elements.',
  },
  {
    id: 'dreary',
    label: 'Dreary',
    prompt: 'top-down tabletop RPG battle map, muted desaturated color palette, overcast gloomy atmosphere, grim melancholic mood, weathered decayed textures, low contrast. Do not add any text, watermarks, or UI elements.',
  },
];
