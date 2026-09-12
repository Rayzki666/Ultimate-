// Shooting intentions, not image filters. All live advice stays on the device.
export const STYLES = [
  { id: 'cinematic', example: './assets/styles/cinematic-curvy.jpg', exampleAlt: "Curvy woman in a cream blouse, softly lit by a cafe window in a three-quarter pose.", poseNote: "Try a gentle three-quarter turn and relaxed shoulders. Rest your hands loosely at waist height, with window light to one side.", name: 'Cinematic Portrait', mood: 'INTIMATE / SCULPTED',
    description: 'A strong subject, sculpted light and room for the story.',
    shotType: 'half', composition: 'thirds', lightMode: 'directional',
    scales: { half: [.48, .86], full: [.6, .9], close: [.5, 1], duo: [.42, .9] },
    palette: ['#122d32', '#bf9673', '#0a1b21'],
    setup: 'Start near a window or open shade. Keep some space between your subject and the background.' },
  { id: 'golden', example: './assets/styles/golden-curvy.jpg', exampleAlt: "Curvy woman in an ivory dress, with a softly lit face and golden light around her curls.", poseNote: "Turn slightly toward the soft light. Let your arms fall comfortably with a little space from your torso; keep both hands visible.", name: 'Golden Glow', mood: 'WARM / LUMINOUS',
    description: 'Warm atmosphere with a softly lit face and a luminous edge.',
    shotType: 'half', composition: 'thirds', lightMode: 'rim',
    scales: { half: [.42, .86], full: [.6, .9], close: [.5, 1], duo: [.42, .9] },
    palette: ['#71422c', '#ffcf85', '#453126'],
    setup: 'Look for warm, low light. Keep the brightest source just outside the frame.' },
  { id: 'travel', example: './assets/styles/travel-curvy.jpg', exampleAlt: "Full-body portrait of a curvy woman in hiking clothes beside an alpine lake.", poseNote: "Try one foot slightly forward and keep your shoulders relaxed. Show both hands and feet, with room around you for the landscape.", name: 'Travel Story', mood: 'EXPANSIVE / EXPLORING',
    description: 'A smaller subject. More of the place. A frame that takes you back.',
    shotType: 'full', composition: 'thirds', lightMode: 'balanced',
    scales: { full: [.32, .64], half: [.3, .6], close: [.5, 1], duo: [.32, .7] },
    palette: ['#477674', '#e0cfad', '#21474a'],
    setup: 'Find a view with depth. Leave space around your subject to show the setting.' },
  { id: 'editorial', example: './assets/styles/editorial-curvy.jpg', exampleAlt: "Curvy woman in a charcoal trouser suit, centered in a symmetrical stone doorway.", poseNote: "Shift your weight comfortably onto one leg. Relax your shoulders and arms, keep both feet visible, and stay centered.", name: 'Editorial', mood: 'PRECISE / CONFIDENT',
    description: 'A deliberate center, clean edges and a bold sense of presence.',
    shotType: 'full', composition: 'center', lightMode: 'clean',
    scales: { full: [.66, .92], half: [.52, .9], close: [.5, 1], duo: [.5, .9] },
    palette: ['#c1b7a6', '#ebe1cd', '#353634'],
    setup: 'Try a simple wall or doorway. Build the frame around a strong central subject.' },
];
export function getStyle(id) { return STYLES.find(s => s.id === id) || null; }
export function styleHint(style, stats, reading) {
  if (!style) return 'Follow the current light and framing guidance.';
  if (!stats || !reading) return style.setup;
  if (style.id === 'golden') return stats.warmth > 18
    ? 'Warm tones detected. Keep the face lit while preserving the glow.'
    : 'Warm tones are not detected yet. Try warmer light for this look; you can still shoot.';
  if (style.id === 'cinematic') return Math.abs(stats.sideBias) > 20
    ? 'Uneven light detected. Keep that contrast and check the face for deep shadows.'
    : 'Light is fairly even. For more depth, try a window to one side of your subject.';
  if (style.id === 'travel') return stats.top - stats.bottom > 55
    ? 'The upper frame is much brighter. Include less bright sky to protect detail.'
    : 'Leave room for the setting. Check the background edges before you shoot.';
  return reading.light.level === 'good'
    ? 'Light is usable. Look for a clean background and deliberate lines.'
    : 'Find more even light before refining the central composition.';
}
