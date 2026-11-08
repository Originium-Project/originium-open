# Visual Design

An instruction-only skill for planning, building, and reviewing visual work across reports, web interfaces, GUI apps, and terminals. The core lives in one portable Markdown file. It supplies a six-field plan, decision rationales, medium adaptations, and a capture/critique/revision method; it is neither a renderer nor a CSS framework.

The installed skill is named `visual-design`. No book text, images, fonts, or other copyrighted assets are bundled, and no full-book reading is claimed. Source scope is documented in [SOURCES.md](SOURCES.md).

## Files

| Path | Use |
| --- | --- |
| [skills/visual-design/SKILL.md](skills/visual-design/SKILL.md) | Complete standalone operating instructions; the only required install file |
| [SOURCES.md](SOURCES.md) | Evidence levels, attribution limits, and adaptations |
| [guides/media-adapters.md](guides/media-adapters.md) | Expanded medium-specific decisions and checks |
| [templates/design-plan.md](templates/design-plan.md) | Copyable pre-build contract |
| [templates/visual-review.md](templates/visual-review.md) | Capture-first critique and verification record |
| [examples/cross-medium-briefs.md](examples/cross-medium-briefs.md) | Synthetic PDF, web, GUI, and terminal plans |

## Practical prompts

- **PDF/report:** “Use visual-design to plan a printable 12-page safety report. Give the six-field contract and page proofing plan before generating it.”
- **Website:** “Use visual-design to plan this service page for desktop, 320px reflow, keyboard, and 400% zoom. Explain each layout decision.”
- **Dashboard:** “Use visual-design to review these actual screenshots and data definitions. Record located violations before suggesting edits; distinguish unknowns.”
- **GUI app:** “Use visual-design to plan the edit, warning, and confirmation states of this native settings screen, including text scaling.”
- **CLI/TUI:** “Use visual-design to plan human-readable command output for 80-column and narrow terminals, plain non-TTY output, and a separate TUI focus order.”

## Use and installation

With the user's approval, copy or link **only** [SKILL.md](skills/visual-design/SKILL.md) into a directory named `visual-design` under a compatible skill location. Inspect existing files first; do not overwrite an existing skill blindly. No sibling document is required for a one-file install. In Pi, run `/reload`, then invoke `/skill:visual-design`. Other assistants can simply read the Markdown as instructions. The renderer, browser, PDF exporter, terminal, and accessibility test tools remain separate; this skill grants no publication or deployment permission.

## License

MIT, copyright (c) 2026 Originium Project contributors. See [LICENSE](LICENSE).
