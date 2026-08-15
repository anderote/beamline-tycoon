# Stock Blueprints

Every beamline type ships with prebuilt designs at ascending tiers. Place one, run it, then start moving pieces.

---

## What a Blueprint Is

**Quick Tip:** A blueprint is a complete, working beamline you can place in one gesture instead of assembling it component by component.

**How It Works:**

When you start a new beamline you pick a type — Test Stand, Therapy Line, XFEL, and so on. Each type comes with two or three blueprints at ascending tiers. Selecting one arms a placement ghost: the machine follows your cursor, you rotate it to fit your site, and one click builds the whole thing, pours the concrete under it, and wires the components to each other.

Every type is available from the beginning. Choosing what the beamline is for
sets its target bands, scoring and recommended hardware; it does not grant any
technology. Research unlocks the components themselves, so a stock blueprint
can still be unavailable when it contains a cavity, source, endpoint or upgrade
you have not researched. You can always choose the mission and begin a custom
design with the hardware you currently know how to build.

Blueprints are not a shortcut past the game. They are a starting point that works, which is a different thing. A placed blueprint still has to be fed: power, cooling, vacuum, and — for superconducting hardware — cryogenics. None of that comes with the blueprint, because provisioning the machine is a large part of what you are actually playing.

A blueprint is also not optimal. It is a competent, conservative design of its kind, in the way a stock coaster is a competent coaster. Beating it is the point.

**What the Numbers Mean:**

Each blueprint card shows the energy and current the machine was *measured* to deliver — not a nameplate claim. Every blueprint is run through the same physics engine that runs your live beamline, and one that does not land inside its type's specification band does not ship. If a card shows no performance figures, that blueprint has not been measured, and the game will not guess on its behalf.

Those measurements assume the machine is properly supplied. A blueprint starved of RF power or running warm will not reach the numbers on its card, and the fault will be in your facility rather than in the design.

---

## Tiers

**Quick Tip:** Tier is *within* a type. A tier-1 Test Stand and a tier-1 XFEL are both "the entry machine of this kind" — they are not comparable to each other.

**How It Works:**

Beamline types have their own tier in the roster, from the Test Stand up to the Linear Collider, and that ordering is economic: it says which machines are ambitious. A blueprint's tier means something narrower — where it sits on the ladder *inside* one type.

Each step up the ladder is a real change in capability, never the same lattice at a higher price. The step might be energy, current, or beam quality, and which one it is tells you something about the type:

- A **Test Stand** steps first in energy and then in current, because a single S-band structure already lands mid-band and the only headroom left above it is milliamps.
- An **E-beam Processing Line** steps to its 10 MeV nameplate and then doubles current *at* that energy. It does not go higher, because above roughly 10 MeV the product being sterilised begins to activate. A more energetic processing line is not an upgrade — it is a machine you are not allowed to sell time on.

That second case is the general lesson. A type's band has a ceiling as well as a floor, and overshooting it is a mistake rather than an achievement.

---

## Editing a Blueprint

**Quick Tip:** Stock blueprints cannot be edited or deleted. Duplicate one into your own designs and edit the copy.

**How It Works:**

The Designs library lists stock blueprints under their own tab, marked as stock. From there, **Duplicate to My Designs** copies one into your personal library where it becomes fully editable — retune the magnets, swap the source, add a diagnostic section.

This is the intended path from placing machines to designing them. Taking apart a design that already works, and watching what breaks when you change one number, teaches the optics faster than starting from an empty site.

Two things are worth knowing before you start retuning.

**Magnet strength depends on beam energy.** A quadrupole's focusing goes as `1/p`, where `p` is the beam momentum. The same magnet setting that is correct at 1 GeV will over-focus a 40 MeV beam catastrophically — the envelope blows up and the beam scrapes the vacuum chamber within a metre. When you move a magnet to a different point in the line, or change the energy upstream of it, its setting needs to change too.

**Focusing settings are tuned points, not thresholds.** Solenoid response in particular is sharply non-monotonic: a setting that transmits the entire beam can lose most of it a few milliteslas away in either direction. If a small change costs you a lot of current, the answer is usually to step back rather than to keep going in the same direction.

**The Math:**

A quadrupole's focusing strength is

```
k = 0.2998 * g / p
```

with the gradient `g` in tesla per metre and the momentum `p` in GeV/c. The focusing a magnet actually applies over its length `L` goes as `sqrt(k) * L`, and useful values sit in a fairly narrow range — enough to bend the envelope back, not so much that it crosses the axis and diverges before the next magnet.

A solenoid focuses in both planes at once:

```
k = 0.2998 * B / (2p)
```

which is why solenoids are the tool of choice right at the source, where the beam is slow, space charge is strong, and there is not yet enough momentum for a quadrupole doublet to be gentle enough to help.
