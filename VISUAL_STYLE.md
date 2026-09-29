# Illustrated tabletop visual language

Keep the interface simple and the collection readable. Use warm ivory (#f5f0e6) or deep ink (#19232d) behind opaque paper/panel surfaces (#fffaf0 / #24323e), with muted sea-glass and amber accents. Use 8 / 12 / 16 point corner radii and the existing 4 point spacing rhythm. Body text stays in the platform sans-serif family; weight establishes hierarchy.

Depth is shallow: a crisp outline, one short lower edge, and one small upper-left highlight. Keep decoration off the states that carry meaning: selection, focus, errors and status badges stay as they are.

The one exception is the card itself, which is a physical object and is drawn as one: its face tilts up to ten degrees towards the pointer, catches the light, and carries the wear its grade implies (soft corners, whitened edges, dust, fingerprints, print lines, scratches, dents, yellowing, stains and a crease as the grade falls; only dust and a print line may cross the middle of the art), a holo or foil finish shows a colour-dodge rainbow that brightens the art rather than covering it, a raw card may curl a few degrees, and a graded card sits inside a three-plane slab. That depth stops at the card's edge; the panel it sits on keeps the shallow treatment above.

Preserve existing accessibility settings. Colour is supported by existing labels, symbols and patterns. Card artwork and chart semantics remain authoritative, and anything drawn on a panel (chart surfaces included) uses the panel colour, not the ground.

Before merging, inspect light and dark modes, a narrow phone layout, and the selected, hovered, focused, disabled, error and empty states. Run the repository typecheck and existing tests.
