# Cohesive hobby visual language

Cards, Skins, Retro Games, Comics, Watches and Whisky share a visual family, not a
single workflow. Keep collection browsing artwork-forward, portfolios numerical,
and capture/review tools focused. Preserve each hobby's terminology and recorded
condition or grading data.

## Shared appearance

`packages/core/src/family-theme.css` is loaded by the shared `ThemeToggle`. It
coordinates backgrounds, opaque panels, raised surfaces, buttons, focus rings,
and chart surfaces. The existing platform body font and condensed display face
remain. Depth stays shallow: a crisp outline, short lower edge and subtle upper
highlight. Existing app layouts and navigation remain in place.

Light, Dark and System are separate from the eight palettes: Teal (sea glass),
Amber, Sky, Indigo, Violet, Plum, Copper and Slate. Teal retains the warm-paper /
deep-ink default. The header offers the same palette choices as Settings.

`appearance.ts` retains the `theme` and `colorScheme` localStorage keys. Choices
apply across routes and same-origin tabs. Separate app origins, ports and devices
do not automatically synchronize preferences. If storage is blocked, a visible
warning accompanies an in-memory choice, which lasts only in that loaded page.
System mode follows OS changes. Printing temporarily uses light mode, then
restores the current preference. Browser chrome follows the resolved background;
installed icon artwork and static launch-screen metadata are not regenerated.

## Meaning is not decoration

A palette never assigns financial or categorical chart colors: gains remain green,
losses red, with signs and labels carrying direction. Artwork, slab/company labels,
rarity colors and grade data are not recolored. Chart hover halos use their actual
panel surface. Do not use an aesthetic accent to communicate profit or loss.

## Integration and checks

The current default branch contains Cards and Skins. The four additional hobby
apps use the older `claude/scaffold-five-apps-y6pgsp` branch and its shared AppShell.
Keep that integration separate; do not replace newer storage/security code with
an older scaffold just to share appearance. The older layouts apply the selected
palette when the client mounts; before-paint palette restoration remains an
integration follow-up there.

The added `family-theme.test.ts` files guard palette definitions and text/focus
contrast. The `family-theme.spec.ts` browser tests cover navigation, cross-tab
updates, blocked storage, print restoration and phone menu bounds. Before merging,
run the repository lint, typecheck, unit, build and browser suites and inspect all
apps in both modes. Check selected, hover, keyboard focus, disabled, error, empty,
print and reduced-motion states. An isolated CSS/control fixture is not a substitute
for those full-application and physical-device checks.
