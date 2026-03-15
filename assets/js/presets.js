// ── Built-in Visual Presets ───────────────────────────────────────────────────
// To add a preset:   add a new buildPreset(...) entry to BUILT_IN_PRESETS below.
// To remove a preset: delete its entry from BUILT_IN_PRESETS.
//
// buildPreset(id, name, background, accent, extra)
//   id         – unique slug stored in Firestore per user (never change an existing one)
//   name       – display name shown in the UI
//   background – CSS gradient string for the page background
//   accent     – 6-digit hex colour, e.g. '#4f46e5'
//   extra      – optional object to override any computed or colour tokens
//                (textColor, headingColor, subtitleColor, mutedColor, greetingColor,
//                 surfaceColor, surfaceSoftColor, surfaceMutedColor, borderColor, cardTextColor)
// ─────────────────────────────────────────────────────────────────────────────

function toRgba(hex, alpha) {
  const cleaned = String(hex || '').replace('#', '').trim();
  if (!/^[\da-fA-F]{6}$/.test(cleaned)) return `rgba(79, 70, 229, ${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildPreset(id, name, background, accent, extra = {}) {
  const safeAccent = /^#[\da-fA-F]{6}$/.test(accent) ? accent : '#4f46e5';
  return {
    id,
    name,
    background: background || '',
    accent: safeAccent,
    accentHover: safeAccent,
    accentSoft: toRgba(safeAccent, 0.12),
    accentSoftStrong: toRgba(safeAccent, 0.18),
    accentBorder: toRgba(safeAccent, 0.35),
    accentShadow: toRgba(safeAccent, 0.22),
    ...extra
  };
}

export const BUILT_IN_PRESETS = [
  buildPreset(
    'preset_classic',
    'Classic Indigo',
    'radial-gradient(circle at top, #f7f5ff 0%, #e5f4ff 45%, #f6fff7 100%)',
    '#4f46e5'
  ),
  buildPreset(
    'preset_forest',
    'Forest Calm',
    'radial-gradient(circle at top, #f3fff8 0%, #dcfce7 42%, #eefbf2 100%)',
    '#0f766e'
  ),
  buildPreset(
    'preset_sunset',
    'Sunset Warm',
    'radial-gradient(circle at top, #fff7ed 0%, #ffedd5 48%, #fef3c7 100%)',
    '#ea580c'
  ),
  buildPreset(
    'preset_midnight',
    'Midnight Blue',
    'radial-gradient(circle at top, #ecf3ff 0%, #dbeafe 45%, #e0e7ff 100%)',
    '#1d4ed8'
  ),
  buildPreset(
    'preset_darkmode',
    'Dark Mode',
    'radial-gradient(circle at top, #121826 0%, #0f172a 48%, #111827 100%)',
    '#8b5cf6',
    {
      textColor: '#e5e7eb',
      headingColor: '#f8fafc',
      subtitleColor: '#cbd5e1',
      mutedColor: '#cbd5e1',
      greetingColor: '#e2e8f0',
      surfaceColor: '#172033',
      surfaceSoftColor: '#1e293b',
      surfaceMutedColor: '#1f2937',
      borderColor: 'rgba(148, 163, 184, 0.35)',
      cardTextColor: '#f8fafc'
    }
  )
];
