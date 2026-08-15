import { test, expect } from '@playwright/test';

const TRACK_FILE = 'Night Drive fixture.wav';

function silentWav(durationSeconds = 2, sampleRate = 8000) {
  const dataBytes = durationSeconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test('title-screen continue gesture starts a previously paused soundtrack', async ({ page }) => {
  await page.route('**/music-web/tracks.json', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      baseUrl: '/__test_music',
      themes: { sovietcore: [TRACK_FILE] },
    }),
  }));
  await page.route('**/__test_music/**', route => route.fulfill({
    contentType: 'audio/wav',
    body: silentWav(),
  }));
  await page.addInitScript(({ trackFile }) => {
    window.__musicPlayCalls = 0;
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__musicPlayCalls += 1;
      return nativePlay.apply(this, args);
    };
    localStorage.setItem('beamlineTycoon.music', JSON.stringify({
      selectedTheme: 'sovietcore',
      currentIndex: 0,
      currentTrackFile: trackFile,
      currentTime: 0,
      wasPlaying: false,
      volume: 0.4,
      shuffled: false,
      minimized: false,
    }));
  }, { trackFile: TRACK_FILE });

  await page.goto('/');
  await expect(page.locator('#title-screen')).toBeVisible();
  await expect(page.locator('.mp-track-name-inner')).toHaveText('Night Drive fixture');
  await expect.poll(() => page.evaluate(() => window.__blMusic?.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.__musicPlayCalls)).toBe(0);

  await page.locator('.title-loading').click({ position: { x: 20, y: 20 } });

  await expect.poll(() => page.evaluate(() => window.__musicPlayCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__blMusic?.audio.paused)).toBe(false);
});
