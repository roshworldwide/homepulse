# Fonts

Self-hosted so the console works offline and never calls a font CDN. Built by
`scripts/build-fonts.py` from the official npm packages (see the script's header).

| File | Family | Licence |
| --- | --- | --- |
| `geist.woff2` | Geist, variable weight 100–900, Latin | SIL Open Font License 1.1 (Vercel) |
| `geist-mono.woff2` | Geist Mono, variable weight 100–900, Latin | SIL Open Font License 1.1 (Vercel) |
| `newsreader-italic.woff2` | Newsreader Italic, variable weight, Latin | SIL Open Font License 1.1 (Production Type) |
| `material-symbols-rounded.woff2` | Material Symbols Rounded, FILL and weight axes, 95 icons | Apache License 2.0 (Google) |

The icon font is cut down to the icons the console uses and drawn by code point
(`src/ui/icon-points.ts`), which keeps it near 26 KB instead of 5.4 MB. To add an
icon, add its name to `ICONS` in the build script and run it again.
