import { EffectPreviewTool } from '../input/effect-preview-tool.js';
import {
  particleEffectDefinitions,
  particleEffectProfile,
  resetParticleEffectProfile,
} from '../renderer3d/particle-effect-tuning.js';

const STORAGE_KEY = 'beamlineTycoon.particleEffects.v1';

function displayValue(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.max(1, Math.min(3, String(step).split('.')[1]?.length || 1));
  return Number(value).toFixed(decimals).replace(/\.0+$/, '');
}

export class EffectsWorkshop {
  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;
    this.definitions = particleEffectDefinitions();
    this.selectedId = Object.keys(this.definitions)[0];
    this._rearming = false;
    this.control = document.getElementById('effects-workshop-control');
    this.toggle = document.getElementById('effects-workshop-toggle');
    this.panel = document.getElementById('effects-workshop-panel');
    this.tabs = document.getElementById('effects-workshop-tabs');
    this.sliders = document.getElementById('effects-workshop-sliders');
    this.description = document.getElementById('effects-workshop-description');
    this.status = document.getElementById('effects-workshop-status');
    this._load();
    this._renderTabs();
    this._renderSliders();
    this._bind();
  }

  _bind() {
    this.toggle?.addEventListener('click', () => this.toggleOpen());
    document.getElementById('effects-workshop-close')?.addEventListener('click', () => this.close());
    document.getElementById('effects-workshop-reset')?.addEventListener('click', () => {
      const values = resetParticleEffectProfile(this.selectedId);
      this.renderer.setParticleEffectTuning?.(this.selectedId, values);
      this._save();
      this._renderSliders();
      this._arm();
    });
  }

  _load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
    for (const id of Object.keys(this.definitions)) {
      this.renderer.setParticleEffectTuning?.(id, saved?.[id] || particleEffectProfile(id));
    }
  }

  _save() {
    const values = Object.fromEntries(
      Object.keys(this.definitions).map(id => [id, particleEffectProfile(id)]),
    );
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_) {}
  }

  _renderTabs() {
    if (!this.tabs) return;
    this.tabs.replaceChildren();
    for (const [id, def] of Object.entries(this.definitions)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'effects-workshop-tab';
      button.textContent = def.label;
      button.dataset.effectId = id;
      button.classList.toggle('active', id === this.selectedId);
      button.setAttribute('aria-pressed', String(id === this.selectedId));
      button.addEventListener('click', () => {
        this.selectedId = id;
        this._renderTabs();
        this._renderSliders();
        this._arm();
      });
      this.tabs.appendChild(button);
    }
  }

  _renderSliders() {
    if (!this.sliders) return;
    const def = this.definitions[this.selectedId];
    const values = particleEffectProfile(this.selectedId);
    if (this.description) this.description.textContent = def.description;
    this.sliders.replaceChildren();
    for (const [key, field] of Object.entries(def.fields)) {
      const row = document.createElement('label');
      row.className = 'effects-workshop-slider';
      const name = document.createElement('span');
      name.className = 'effects-workshop-slider-name';
      name.textContent = field.label;
      const value = document.createElement('output');
      value.className = 'effects-workshop-slider-value';
      value.textContent = displayValue(values[key], field.step);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = field.min;
      input.max = field.max;
      input.step = field.step;
      input.value = values[key];
      input.dataset.setting = key;
      input.addEventListener('input', () => {
        const profile = this.renderer.setParticleEffectTuning?.(
          this.selectedId, { [key]: Number(input.value) },
        );
        value.textContent = displayValue(profile?.[key] ?? input.value, field.step);
        this._save();
      });
      row.append(name, value, input);
      this.sliders.appendChild(row);
    }
  }

  toggleOpen() {
    if (this.panel?.classList.contains('hidden')) this.open();
    else this.close();
  }

  open() {
    this.panel?.classList.remove('hidden');
    this.toggle?.setAttribute('aria-expanded', 'true');
    this._arm();
  }

  close() {
    this.panel?.classList.add('hidden');
    this.toggle?.setAttribute('aria-expanded', 'false');
    if (this.input.activeTool?.kind === 'effectPreview') this.input.setTool(null);
  }

  _arm() {
    this._rearming = true;
    this.input.setTool(new EffectPreviewTool(this.selectedId, () => {
      if (!this._rearming) {
        this.panel?.classList.add('hidden');
        this.toggle?.setAttribute('aria-expanded', 'false');
      }
    }));
    this._rearming = false;
    if (this.status) {
      const def = this.definitions[this.selectedId];
      this.status.textContent = def.liveBeam
        ? `LIVE BEAMS UPDATE AS YOU TUNE · CLICK THE WORLD FOR A ${def.label.toUpperCase()} SAMPLE`
        : `CLICK THE WORLD TO CREATE ${def.label.toUpperCase()}`;
    }
  }
}
