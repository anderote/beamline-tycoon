# Staff Scale Validation

The staffing scale target is dozens of simultaneous employees, with 100 used
as a stress case. Simulation and presentation have separate validation paths.

## Headless simulation benchmark

Run:

```sh
npm run benchmark:staff
```

The deterministic benchmark sends 25, 50, and 100 employees across an open
18x18 facility. It includes the cold navigation build and reports mean/max tick
time, arrivals, and the peak number of new A* routes in one tick. It fails if
any employee does not arrive or the route-start budget is exceeded. Timing is
diagnostic rather than a hard cross-machine gate; the functional contract also
runs in `test/test-staff-scale.js`.

## Owner-authorized browser/profile checklist

The owner may profile this checklist directly or explicitly authorize a
repository agent to run it for the current task. Profile on target hardware
after a staff-rendering change:

1. Create or load facilities with approximately 25, 50, and 100 employees.
2. At normal zoom, center the camera on a busy control room/cafeteria transition
   and confirm nearby people retain smooth walking and work poses.
3. Pan away and zoom fully out. Confirm distant employees use stable simplified
   silhouettes without popping out, floating, or losing their profession color.
4. Trigger many simultaneous trips (mass hiring, load, or synchronized finished
   jobs). Confirm route starts spread across several simulation ticks and every
   employee eventually moves; nobody remains permanently on “Waiting for the
   next assignment pass.”
5. Build or demolish a wall while many employees are walking. Confirm re-routing
   is gradual, employees do not walk through the changed wall, and lost routes
   abandon their station reservation.
6. Check seated console/cafeteria poses, standing bench work, wandering, and
   incident ragdolls at near detail.
7. Capture frame-time and renderer draw-call samples for 10 seconds at each
   population. Treat 50 employees at normal zoom as the primary play target and
   100 fully zoomed out as the stress target; compare trends on the same machine
   rather than treating one device's absolute timing as universal.

The expected scene contract is one shadow caster per employee. At far detail,
the articulated 18-20-part body is hidden and replaced by one visible mesh.
