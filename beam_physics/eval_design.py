# beam_physics/eval_design.py — headless physics evaluation for stock designs.
#
# The Python half of scripts/eval-design.mjs. Node owns the design data and the
# spec bands (both live in src/data/*.js); this file owns nothing but the call
# into the real engine, so a blueprint is measured by exactly the code that
# runs in the player's browser rather than by a reimplementation of it.
#
# It deliberately does NOT decide pass/fail. Bands live in
# src/data/beamline-types.js and are read by the Node side; duplicating them
# here would create a second source of truth that drifts the first time a band
# is retuned.
#
# Usage:
#   python3 -m beam_physics.eval_design <payload.json> [effects.json]
#
# The payload is exactly what src/beamline/physics.js hands Pyodide: a list of
# elements each carrying `physicsType`. Emits one JSON object on stdout with
# the summary fields a blueprint is judged on, and drops the multi-megabyte
# per-element `envelope` unless --envelope is passed — a 20-blueprint sweep
# otherwise moves ~16 MB through a pipe to print a table of nine numbers.

import json
import sys

from beam_physics.gameplay import compute_beam_for_game

# What a blueprint is actually judged on. Everything else the engine returns is
# either derived from these or is per-element detail.
SUMMARY_FIELDS = (
    "beamEnergy",           # GeV
    "beamCurrent",          # mA
    "beamQuality",          # 0-1
    "beamAlive",
    "totalLossFraction",    # NB: includes RF capture efficiency, not just
                            # aperture scraping — a bunched machine is
                            # legitimately ~0.5 here, so this is a diagnostic
                            # rather than a pass/fail criterion.
    "finalBeamSizeX",       # m
    "finalBeamSizeY",       # m
    "finalNormEmittanceX",  # m-rad
    "finalNormEmittanceY",
    "finalEnergySpread",
    "finalBunchLength",
    "luminosity",
    "photonRate",
    "dataRate",
    "felSaturated",
    "collisionRate",
    "maxDispersion",
    "nDiagnostics",
)


def evaluate(payload, effects=None, keep_envelope=False):
    """Run one design through the engine and return its summary dict.

    `payload` is the element list; `effects` is the research-effects dict,
    whose `machineType` key selects the physics module stack in machines.py —
    passing the blueprint's own type there is the whole reason a spallation
    line and an XFEL built from similar hardware do not behave alike.
    """
    raw = compute_beam_for_game(json.dumps(payload), json.dumps(effects or {}))
    result = json.loads(raw)

    out = {k: result.get(k) for k in SUMMARY_FIELDS}
    if keep_envelope:
        out["envelope"] = result.get("envelope", [])
    else:
        # Peak transverse size along the line, which is what tells you WHERE a
        # design is scraping rather than merely that it did. Cheap to carry;
        # the full envelope is not.
        env = result.get("envelope") or []
        if env:
            out["peakBeamSizeX"] = max(e.get("sigma_x", 0.0) or 0.0 for e in env)
            out["peakBeamSizeY"] = max(e.get("sigma_y", 0.0) or 0.0 for e in env)
            out["nElements"] = len(env)
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    keep_envelope = "--envelope" in argv

    if not args:
        print("usage: python3 -m beam_physics.eval_design <payload.json> "
              "[effects.json] [--envelope]", file=sys.stderr)
        return 2

    with open(args[0]) as fh:
        payload = json.load(fh)

    effects = {}
    if len(args) > 1:
        with open(args[1]) as fh:
            effects = json.load(fh)

    try:
        out = evaluate(payload, effects, keep_envelope)
    except Exception as exc:  # noqa: BLE001 — the harness reports, never crashes
        # A blueprint that makes the engine raise is a finding, not a crash:
        # the sweep has to keep going and report which one did it.
        json.dump({"error": f"{type(exc).__name__}: {exc}"}, sys.stdout)
        return 1

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
