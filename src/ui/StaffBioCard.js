// src/ui/StaffBioCard.js — shared bio-card renderer for the hiring dialog and
// the staff inspector, so the two callers cannot drift. Reads a StaffMember
// (hire candidates are StaffMember instances too — see Game._refreshStaffCandidates)
// and shows full name, profession + specialty, backstory, traits, skills, and
// career stats: the payoff for the profession/specialty/backstory/stats data
// model is that the player reads a person, not a stat block.
//
// The HTML-building core (bioCardHTML) is a pure string function kept
// separate from renderBioCard's document.createElement wrapper so it can be
// unit-tested without a DOM — see test/test-staff-bio-card.js.

import { PROFESSIONS, SPECIALTY_AXES, SKILLS } from '../data/professions.js';
import { BACKSTORIES } from '../data/backstories.js';
import { ZONES } from '../data/facility.js';
import { traitDesc } from '../game/staff/StaffMember.js';
import { careerMilestones } from '../game/staff/careerLog.js';
import { ROLE_COLORS, staffMoodColor, escapeHtml } from './format.js';

// Career-row copy for StaffMember.stats keys, in display order. A key absent
// here (there shouldn't be one) is simply skipped.
const CAREER_LABELS = {
  ticksWorked: 'Ticks Worked',
  commissions: 'Commissions',
  repairs: 'Repairs Made',
  sparesMade: 'Spares Fabricated',
  beamHours: 'Beam Hours',
  analyses: 'Analyses Run',
  breakdowns: 'Breakdowns',
};

// { label, value } rows derived from member.stats, omitting zero-valued
// counters so a new hire's card is short and a veteran's is long.
export function formatCareer(member) {
  const stats = member?.stats || {};
  const rows = [];
  for (const [key, label] of Object.entries(CAREER_LABELS)) {
    const v = stats[key];
    if (!v) continue; // omits 0, undefined and NaN alike
    rows.push({ label, value: Number.isInteger(v) ? v : Number(v.toFixed(1)) });
  }
  return rows;
}

// The specialty def ({id, name, zoneId}) a member is currently on, or null
// when their profession carries no specialty axis (operator, technician,
// machinist, admin) or none has been rolled.
function specialtyOf(member) {
  const prof = PROFESSIONS[member?.profession];
  if (!prof || !prof.specialtyAxis || !member.specialty) return null;
  const axis = SPECIALTY_AXES[prof.specialtyAxis];
  return axis?.specialties?.[member.specialty] || null;
}

// ZONES colors are 0xRRGGBB ints (renderer-side); the DOM layer needs a CSS
// hex string. userScience has zoneId: null and so has no accent.
function zoneAccentCss(zoneId) {
  const zone = zoneId != null ? ZONES[zoneId] : null;
  return zone ? '#' + zone.color.toString(16).padStart(6, '0') : null;
}

function skillBarsHTML(member) {
  let html = '';
  for (const k of SKILLS) {
    const v = typeof member.skills?.[k] === 'number' ? member.skills[k] : 0;
    const pct = Math.max(0, Math.min(10, v)) / 10 * 100;
    const col = v >= 7 ? '#44dd66' : v >= 4 ? '#ddaa22' : '#888';
    html += `<div class="staff-skill-row"><span class="staff-skill-name">${k}</span>` +
      `<div class="staff-bar-track"><div class="staff-bar-fill" style="width:${pct}%;background:${col};"></div></div>` +
      `<span class="staff-skill-val">${v.toFixed(1)}</span></div>`;
  }
  return html;
}

// Pure HTML-string builder for the card body. opts.compact renders the
// shorter hiring-list variant (no career rows); the inspector renders full.
export function bioCardHTML(member, opts = {}) {
  const compact = !!opts.compact;
  const prof = PROFESSIONS[member.profession];
  const specialty = specialtyOf(member);
  const backstory = member.backstoryId ? BACKSTORIES[member.backstoryId] : null;
  const roleColor = ROLE_COLORS[member.profession] || '#4466aa';
  const mood = member.mood || 'content';

  let html = `<div class="bio-card-header">`;
  html += `<div class="bio-card-portrait" style="border-color:${staffMoodColor(mood)};"></div>`;
  html += `<div class="bio-card-heading">`;
  html += `<div class="bio-card-name">${escapeHtml(member.name)}</div>`;
  html += `<div class="bio-card-profession" style="color:${roleColor};">${escapeHtml(prof?.name || member.profession)}`;
  if (specialty) {
    const accent = zoneAccentCss(specialty.zoneId);
    html += ` <span class="bio-card-specialty"${accent ? ` style="color:${accent};"` : ''}>— ${escapeHtml(specialty.name)}</span>`;
  }
  html += `</div>`;
  html += `</div>`;
  html += `</div>`;

  if (backstory) {
    html += `<div class="bio-card-backstory">`;
    html += `<div class="bio-card-backstory-name">${escapeHtml(backstory.name)}</div>`;
    html += `<div class="bio-card-backstory-blurb">${escapeHtml(backstory.blurb)}</div>`;
    html += `</div>`;
  }

  const traits = member.traits || [];
  html += `<div class="bio-card-traits">`;
  html += traits.length
    ? traits.map(t => `<div class="bio-card-trait">${escapeHtml(traitDesc(t))}</div>`).join('')
    : `<div class="bio-card-trait bio-card-trait-none">No traits</div>`;
  html += `</div>`;

  html += `<div class="ctx-section-label">Skills (0–10)</div>`;
  html += skillBarsHTML(member);

  if (!compact) {
    const career = formatCareer(member);
    if (career.length) {
      html += `<div class="ctx-section-label">Career</div>`;
      html += `<div class="bio-card-career">`;
      for (const row of career) {
        html += `<div class="bio-card-career-row"><span class="bio-card-career-label">${escapeHtml(row.label)}</span><span class="bio-card-career-value">${row.value}</span></div>`;
      }
      html += `</div>`;
    }

    // Task 7 (staff-professions-3, jobs-and-gates) follow-up, fix round 1:
    // careerMilestones() turns the same stats formatCareer just tabulated
    // into player-facing prose ("recovered the beam 47 times") — the actual
    // payoff of this task, and the one piece that was computed but never
    // reached the screen. A brand-new hire's stats are all below every
    // milestone threshold, so this returns [] and the section (heading
    // included) is omitted entirely, same as Career above does for a hire
    // with no stats yet — never an empty "Highlights" heading with nothing
    // under it.
    const milestones = careerMilestones(member);
    if (milestones.length) {
      html += `<div class="ctx-section-label">Highlights</div>`;
      html += `<div class="bio-card-milestones">`;
      html += milestones.map(m => `<div class="bio-card-milestone">${escapeHtml(m)}</div>`).join('');
      html += `</div>`;
    }
  }

  return html;
}

// Builds the full bio card as an HTMLElement. The portrait is an empty
// placeholder (.bio-card-portrait) — a later plan fills it with a live
// offscreen head render; nothing draws into it yet.
export function renderBioCard(member, opts = {}) {
  const el = document.createElement('div');
  el.className = 'bio-card' + (opts.compact ? ' bio-card-compact' : '');
  el.innerHTML = bioCardHTML(member, opts);
  return el;
}
