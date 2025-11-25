export const NONE_OPTION = "None";

export const HAIR_STYLE_OPTIONS = ["None", "Short", "Medium length", "Long", "Curly", "Ponytail", "Undercut"];
export const HAIR_COLOR_OPTIONS = [
  "None",
  "Black",
  "Dark brown",
  "Light brown",
  "Blonde",
  "Red",
  "Silver",
  "Pastel blue",
];
export const EYE_COLOR_OPTIONS = ["None", "Brown", "Hazel", "Blue", "Green", "Gray", "Amber"];
export const EXPRESSION_OPTIONS = ["None", "Neutral", "Soft smile", "Focused", "Serious", "Playful", "Surprised"];
export const POSE_OPTIONS = [
  "None",
  "Neutral standing",
  "Three-quarter turn",
  "Hero stance",
  "Action pose",
  "Over-the-shoulder",
  "Close-up portrait",
];
export const LIGHTING_OPTIONS = [
  "None",
  "Soft daylight",
  "Golden hour",
  "Backlit rim light",
  "Studio softbox",
  "Neon mix",
  "Hard spotlight",
];
export const CHARACTER_STYLE_OPTIONS = [
  "None",
  "Anime cel shading",
  "Painterly concept art",
  "Comic ink",
  "Semi-realistic",
  "Chibi",
];

export const ENVIRONMENT_TYPE_OPTIONS = [
  "None",
  "City rooftop",
  "Urban alley",
  "Forest trail",
  "Mountain cliff",
  "Desert ruins",
  "Sci-fi lab",
  "Classroom interior",
];
export const FOCAL_ELEMENT_OPTIONS = [
  "None",
  "Bridge",
  "Tower",
  "Ancient tree",
  "Vehicle",
  "Statue",
  "Water feature",
];
export const PALETTE_OPTIONS = [
  "None",
  "Warm sunset",
  "Cool dusk",
  "Pastel morning",
  "Monochrome",
  "Neon accents",
  "Earth tones",
];
export const TIME_OF_DAY_OPTIONS = ["None", "Sunrise", "Daytime", "Golden hour", "Blue hour", "Night"];
export const ATMOSPHERE_OPTIONS = ["None", "Clear air", "Light fog", "Rainy", "Snowfall", "Dusty haze", "Stormy"];
export const BACKGROUND_STYLE_OPTIONS = [
  "None",
  "Matte painting",
  "Studio Ghibli inspired",
  "Low-poly stylized",
  "Photo-realistic",
  "Watercolor wash",
];

export type CharacterFormValues = {
  concept: string;
  hairStyle: string;
  hairColor: string;
  eyeColor: string;
  expression: string;
  wardrobe: string;
  props: string;
  pose: string;
  lighting: string;
  style: string;
  negative: string;
  seed: string;
};

export type BackgroundFormValues = {
  location: string;
  environmentType: string;
  palette: string;
  focalElement: string;
  timeOfDay: string;
  atmosphere: string;
  style: string;
  negative: string;
  seed: string;
};

export type ComboFormValues = {
  characterDescription: string;
  backgroundDescription: string;
  interaction: string;
  negative: string;
  seed: string;
};

export const DEFAULT_CHARACTER_FORM: CharacterFormValues = {
  concept: "",
  hairStyle: HAIR_STYLE_OPTIONS[1],
  hairColor: HAIR_COLOR_OPTIONS[1],
  eyeColor: EYE_COLOR_OPTIONS[1],
  expression: EXPRESSION_OPTIONS[1],
  wardrobe: "",
  props: "",
  pose: POSE_OPTIONS[1],
  lighting: LIGHTING_OPTIONS[1],
  style: CHARACTER_STYLE_OPTIONS[1],
  negative: "",
  seed: "",
};

export const DEFAULT_BACKGROUND_FORM: BackgroundFormValues = {
  location: "",
  environmentType: ENVIRONMENT_TYPE_OPTIONS[1],
  palette: PALETTE_OPTIONS[1],
  focalElement: FOCAL_ELEMENT_OPTIONS[1],
  timeOfDay: TIME_OF_DAY_OPTIONS[1],
  atmosphere: ATMOSPHERE_OPTIONS[1],
  style: BACKGROUND_STYLE_OPTIONS[1],
  negative: "",
  seed: "",
};

export const DEFAULT_COMBO_FORM: ComboFormValues = {
  characterDescription: "",
  backgroundDescription: "",
  interaction: "",
  negative: "",
  seed: "",
};

const CHARACTER_NEGATIVE_BASE =
  "duplicate limbs, extra hands, cropped head, muddy textures, low detail, lowres, watermark, text artifacts";
const BACKGROUND_NEGATIVE_BASE =
  "figures, person, character, humanoid silhouettes, blurry shapes, messy perspective, blown highlights";
const COMBO_NEGATIVE_BASE =
  "mismatched lighting, double exposure, floating feet, duplicated limbs, messy compositing, grainy noise";

type Dimensions = { width: number; height: number };

const sanitize = (value: string) => value.trim();
const isActive = (value?: string) => Boolean(value && value !== NONE_OPTION);

const mergeNegatives = (base: string, extra?: string) => {
  if (extra && extra.trim()) {
    return `${base}, ${extra.trim()}`;
  }
  return base;
};

export const buildCharacterPrompt = (form: CharacterFormValues, dims: Dimensions) => {
  const parts: string[] = [
    "ultra-detailed character concept, production-ready illustration",
    `concept: ${sanitize(form.concept)}`,
  ];
  if (isActive(form.style)) {
    parts.push(`style: ${form.style}`);
  }
  if (isActive(form.hairStyle) || isActive(form.hairColor)) {
    const style = isActive(form.hairStyle) ? form.hairStyle : "styled";
    const color = isActive(form.hairColor) ? `, color ${form.hairColor}` : "";
    parts.push(`hair: ${style}${color}`);
  }
  if (isActive(form.eyeColor) || isActive(form.expression)) {
    const descriptor = [isActive(form.eyeColor) ? `eyes ${form.eyeColor}` : null, isActive(form.expression) ? form.expression : null]
      .filter(Boolean)
      .join(", ");
    if (descriptor) {
      parts.push(`face: ${descriptor}`);
    }
  }
  if (sanitize(form.wardrobe)) {
    parts.push(`wardrobe: ${sanitize(form.wardrobe)}`);
  }
  if (sanitize(form.props)) {
    parts.push(`props: ${sanitize(form.props)}`);
  }
  if (isActive(form.pose)) {
    parts.push(`pose: ${form.pose}`);
  }
  if (isActive(form.lighting)) {
    parts.push(`lighting: ${form.lighting}`);
  }
  parts.push(`final render ${dims.width}x${dims.height}, clean linework, cinematic depth of field`);
  return parts.join(", ");
};

export const buildCharacterNegativePrompt = (form: CharacterFormValues) =>
  mergeNegatives(CHARACTER_NEGATIVE_BASE, form.negative);

export const buildBackgroundPrompt = (form: BackgroundFormValues, dims: Dimensions) => {
  const parts: string[] = [
    "cinematic environment matte painting",
    `location: ${sanitize(form.location)}`,
  ];
  if (isActive(form.environmentType)) {
    parts.push(`environment type: ${form.environmentType}`);
  }
  if (isActive(form.timeOfDay)) {
    parts.push(`time of day: ${form.timeOfDay}`);
  }
  if (isActive(form.palette)) {
    parts.push(`color palette: ${form.palette}`);
  }
  if (isActive(form.atmosphere)) {
    parts.push(`atmosphere: ${form.atmosphere}`);
  }
  if (isActive(form.focalElement)) {
    parts.push(`focal element: ${form.focalElement}`);
  }
  if (isActive(form.style)) {
    parts.push(`style: ${form.style}`);
  }
  parts.push(`rendered at ${dims.width}x${dims.height}, depth cues, no characters`);
  return parts.join(", ");
};

export const buildBackgroundNegativePrompt = (form: BackgroundFormValues) =>
  mergeNegatives(BACKGROUND_NEGATIVE_BASE, form.negative);

export const buildComboPrompt = (form: ComboFormValues, dims: Dimensions) => {
  const parts = [
    "hero shot blending character and background seamlessly",
    `character: ${sanitize(form.characterDescription)}`,
    `environment: ${sanitize(form.backgroundDescription)}`,
  ];
  if (sanitize(form.interaction)) {
    parts.push(`interaction: ${sanitize(form.interaction)}`);
  }
  parts.push("matched lighting, shared color grade, grounded shadows");
  parts.push(`final frame ${dims.width}x${dims.height}`);
  return parts.join(", ");
};

export const buildComboNegativePrompt = (form: ComboFormValues) =>
  mergeNegatives(COMBO_NEGATIVE_BASE, form.negative);

