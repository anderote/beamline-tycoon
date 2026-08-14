// test/browser/staff-poses.spec.mjs — smoke test for the pose row added to
// staff-foundry.html (task 5: the knee joint and pose state targets).
//
// This is NOT part of the model-level guarantee: test/test-staff-builder.js
// owns the actual joint-rotation math via its headless THREE stub, which is
// faster and far more precise than anything a screenshot can assert. This
// spec only checks that the foundry page's pose row renders in a real
// browser with a real WebGL context and produces no console errors — i.e.
// that applyPose()/POSES wire up without throwing when driven by real THREE.
//
// KNOWN GAP (see task-5-report.md): the browser suite currently cannot
// complete a run in this repo — the vite dev server on :8123 drops mid-run
// and everything after dies on connection refused. This spec is written and
// believed correct, but has not been verified to actually pass.

import { test, expect } from '@playwright/test';
import { createErrorCollector, frames } from './helpers.mjs';

test('staff-foundry pose row renders one labelled figure per POSES entry, no console errors', async ({ page }) => {
  const errors = createErrorCollector(page);

  await page.goto('/staff-foundry.html');
  await page.waitForSelector('#poseGrid .pose-card', { timeout: 30_000 });

  const labels = await page.locator('#poseGrid .pose-label').allTextContents();
  // Mirrors POSES' key order in staff-builder.js: stand, walk, sit, deskWork,
  // benchWork, carry, push.
  expect(labels).toEqual(['stand', 'walk', 'sit', 'deskWork', 'benchWork', 'carry', 'push']);

  const canvases = page.locator('#poseGrid canvas');
  await expect(canvases).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    const box = await canvases.nth(i).boundingBox();
    expect(box, `pose card ${labels[i]} canvas has a layout box`).not.toBeNull();
    expect(box.width, `pose card ${labels[i]} canvas has width`).toBeGreaterThan(0);
  }

  // Let a few animation frames run (turntable spin, sun placement) so any
  // per-frame throw in the render loop has a chance to surface.
  await frames(page, 5);

  errors.checkAll('staff-foundry pose row');
});
