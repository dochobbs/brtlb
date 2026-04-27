# brtlb brand

Source-of-truth assets and brand guidelines for brtlb v0.1.

## Layout

| Path                                | Purpose                              |
| ----------------------------------- | ------------------------------------ |
| `source/brtlb_brand_book_v0.1.pdf`  | Full brand book (developer handoff)  |
| `source/brtlb_brand_book_v0.1.docx` | Editable source for the brand book   |
| `exports/brtlb_primary_logo.svg`    | Stacked dots + wordmark lockup       |
| `exports/brtlb_dots_mark.svg`       | Dots-only mark (graphite background) |
| `exports/logo_primary_light.png`    | Primary lockup on white              |
| `exports/logo_primary_dark.png`     | Primary lockup on graphite           |
| `exports/logo_dots_only_dark.png`   | Dots mark on dark surface            |
| `exports/app_icon.png`              | iOS / Android / Mac app icon         |

## In-app usage

The dots mark and wordmark are exposed as React components in
`@brtlb/ui` — prefer those over re-importing the SVG files. The serving
copy of the dots mark lives at `apps/web/public/favicon.svg` and
`apps/web/public/dots.svg`; the app icon is mirrored at
`apps/web/public/app-icon.png`.

## Color tokens

| Token                   | Hex       | Use                                              |
| ----------------------- | --------- | ------------------------------------------------ |
| `--brtlb-graphite`      | `#1F2328` | Primary text, dark surfaces, app icon background |
| `--brtlb-graphite-soft` | `#3D444D` | Secondary text, softer dark surfaces             |
| `--brtlb-seafoam`       | `#A8E6CF` | Primary accent, dots, selected states            |
| `--brtlb-seafoam-pale`  | `#E8FAF3` | Soft accent backgrounds                          |
| `--brtlb-white`         | `#FFFFFF` | Primary background                               |
| `--brtlb-mist`          | `#F6F8FA` | Secondary background / app chrome                |

CSS custom properties are defined in `apps/web/src/index.css`. Tailwind
extensions live in `apps/web/tailwind.config.ts`. Use Tailwind classes
(`bg-graphite`, `text-seafoam`, etc.) in components.

## Typography

Primary face: **Inter**, weight 600 for the wordmark, with
`letter-spacing: -0.035em`. Loaded from Google Fonts via
`apps/web/index.html`. System sans fallbacks are wired through both the
Tailwind `fontFamily.sans` token and the CSS `:root` body font stack.

## Voice

| Line                                 | Use                                   |
| ------------------------------------ | ------------------------------------- |
| Less noise. Same meaning.            | Primary brand tagline                 |
| Pediatric documentation, compressed. | Category descriptor / product context |
| Chart less. Notice more.             | Clinician-facing hero / campaign line |

Brand should feel modern, calm, precise, and useful. Avoid
medical/cute/AI-trope visuals — see the brand book for the full guard
rails.

## Updating

To bump brand assets:

1. Edit the source `.docx` (or whatever the brand author publishes).
2. Regenerate the PDF and SVG exports into `brand/`.
3. Mirror updated served assets into `apps/web/public/`.
4. Bump the brand version in this README and in commit messages.
