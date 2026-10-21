# Console design: Rosh 27

The console, the Alexa+ page and the break-in page are built on the Rosh 27 design system (v27.0).
This note records how its rules map onto HomePulse, so new screens stay in the system.

## Where things live

| File | What it holds |
| --- | --- |
| `src/styles/tokens.css` | Every token: semantic roles for light and dark, Rosh Glass densities, elevation, aura, silk, motion and springs, fonts |
| `src/index.css` | Tailwind reads the roles only: the default palette, text sizes, radii and breakpoints are removed |
| `src/styles/components.css` | The component kit: glass, cards, buttons, chips, tags, fields, switch, segmented, slider, banners, seals, lists, toast, empty state |
| `src/ui/kit.tsx` | React wrappers: `Icon`, `Button`, `Tag`, `Banner`, `Seal`, `Card`, `CardHeader`, `Segmented`, `Kbd`, `Live`, `Empty`, `Mark` |
| `src/ui/Shell.tsx` | Desktop and web anatomy: floating sidebar, glass toolbar, drawer under 1024 px |
| `src/fonts/` | Self-hosted Geist, Geist Mono, Newsreader Italic and a 95-icon cut of Material Symbols Rounded |

## Decisions

- **Tint: Champagne** (`#8A6A3A` light, `#E2C28A` text in dark, `#8A6A3A` fill). It is the only accent.
- **Roles, never hues.** Utilities are named after roles: `bg-canvas`, `bg-card`, `text-label-2`, `bg-fill-3`, `text-positive`. Fixed colours appear only where the system defines them: the aura and the silk, and the TV, camera frame and code blocks, which are dark in both appearances.
- **Appearance.** Auto follows the system; Light and Dark are remembered in this browser. `index.html` resolves the choice before first paint, so the CSS has one dark block (`:root[data-theme="dark"]`).
- **Glass is for the navigation layer:** the sidebar, toolbar, drawer, toasts, the break-in header and controls floating over media or silk. Content is opaque. Reduce Transparency swaps every density for Opaque.
- **System settings are honoured.** Reduce Motion turns movement into cross-fades, Reduce Transparency makes glass opaque, and Increase Contrast raises edges to 1.5 pt and steps up labels and the tint.
- **Status always pairs colour with a glyph and a word.**
  - Allowed: positive, open-lock glyph.
  - Blocked: caution, lock glyph.
  - Untrusted data: caution, warning glyph.
  - Alarm red: only for the unguarded baseline door opening and for errors.
- **On the break-in page, colour follows the outcome for the house.** A door that stayed locked is positive, and a door that opened is an alarm.
- **Aura edge, once per page:**
  - Console: the decision card.
  - Alexa+: the push-to-talk orb.
  - Break in: the "With HomePulse" result.
- **Type:**
  - Geist for the interface, with tabular figures for times, counts and codes.
  - Geist Mono for ids and tool calls.
  - Newsreader Italic only for words that are spoken aloud: Alexa's replies, the baseline's replies, the visitor's words.
- **Sentence case everywhere.** The server's `ALLOWED`/`BLOCKED` are shown as "Allowed"/"Blocked"; all caps only in the small eyebrow labels.
- **One Prominent button per view.** The exceptions are phone requests, where Approve or Confirm is the person's decision.
- **Motion:**
  - Springs for controls.
  - 240 ms rises with a 24 ms stagger for new rows.
  - A 2 s tint fade on log rows that just arrived.
  - Reduce Motion turns everything into 150 ms cross-fades.
- **Icons** are drawn by code point from the cut-down font. To add one, list it in `scripts/build-fonts.py` and run the script (its header has the steps).

## Test hooks kept from the earlier console

These stay stable for the browser checks:

- **Buttons:** Why?, Confirm, Approve, Deny, Send to visitor, Ring the bell, Send.
- **Elements:**
  - `#scrub` (time travel).
  - `#speech` and `input[type=file]` (break in).
  - `section[aria-live]` (decision).
  - `section[aria-label='Public counter']`.
- **Text:** "MCP session · elicitation".
- **Keyboard:** keys 1–4.
