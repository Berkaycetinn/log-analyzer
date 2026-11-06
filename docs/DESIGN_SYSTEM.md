# Frontend design system

Approved direction: a restrained developer-tool interface with slate neutrals,
teal accents, accessible status colors and responsive layouts. This direction
was explicitly approved for the React implementation; no earlier design file
was present in the repository.

The UI language is Turkish, matching the project documentation and report
instructions. Original log text and generated report content are never translated.

## Foundations

- Canvas `#f4f7fb`, sidebar `#0e192b`, white panels, borders `#e1e7ef`.
- Main text `#253247`, headings `#142238`, primary action `#0f766e`.
- System fonts: Inter when locally available, Segoe UI, Arial; logs use Cascadia
  Code, SFMono-Regular or Consolas. No remote font or image requests.
- 7–12px component radii, restrained borders, minimal shadows and clear spacing.
- Lucide icons are bundled locally and supplement visible labels.

## Components and behavior

Shared components include buttons, status/severity/confidence badges, paginated
tables, error/empty/loading panels, dialogs, notifications and copy controls.
Destructive actions require a dialog explaining the real backend effect.
Dialogs trap keyboard focus, support Escape, restore focus and prevent dismissal
during submission. Error notifications remain until dismissed.

Status colors always have text and/or icons: queued slate, processing blue,
completed green, warnings amber, failure red, cancelled neutral. Severity `none`
is distinct from `low`. Confidence is a model assessment, not a probability.

Visible focus rings, a skip link, semantic headings/tables/forms, named icon
buttons, reduced motion, accessible dialogs and live errors are included. At
950px the sidebar becomes a top navigation row; at 700px cards use two columns,
details stack, and wide tables scroll within their container. Log text wraps.

## Data honesty

There are no simulated progress percentages, trend charts, sample results or
success fallbacks in production. Unknown summary counts display `—`. Stale
summary data is identified after a refresh error. Results with quote-check
warnings get a prominent warning. Even a successful quote check does not verify
the model's causal hypothesis. Log timestamps retain their original text; job
timestamps use the browser's local timezone. The health page distinguishes
backend/database health from AI/model readiness.
