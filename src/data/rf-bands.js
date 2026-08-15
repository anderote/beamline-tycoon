// Neutral RF band data shared by content, UI, and the RF utility solver.
// Keep this module dependency-free: data registries may import it without
// pulling runtime solver code back into their initialization graph.

export const RF_BANDS = [
  { id: 'vhf',   loMHz:    50, hiMHz:   500, label: 'VHF',     tier: 'beginner' },
  { id: 'uhf',   loMHz:   500, hiMHz:  1000, label: 'UHF',     tier: 'proton SRF' },
  { id: 'lband', loMHz:  1000, hiMHz:  2000, label: 'L-band',  tier: 'SRF workhorse' },
  { id: 'sband', loMHz:  2000, hiMHz:  4000, label: 'S-band',  tier: 'mid NC' },
  { id: 'cband', loMHz:  4000, hiMHz:  8000, label: 'C-band',  tier: 'high-gradient NC' },
  { id: 'xband', loMHz:  8000, hiMHz: 16000, label: 'X-band',  tier: 'expert NC' },
];

export function bandForFrequencyHz(hz) {
  const mhz = hz / 1e6;
  for (const band of RF_BANDS) {
    if (mhz >= band.loMHz && mhz < band.hiMHz) return band.id;
  }
  return null;
}
