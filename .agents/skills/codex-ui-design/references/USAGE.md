# Using the Codex UI Design skill

Invoke `$codex-ui-design` when requesting the approved dark desktop style.
Example: “Use $codex-ui-design to implement the sidebar and composer in this app.”
The project's `.agents/skills/codex-ui-design` folder is canonical
and supports local skill discovery.
This folder can be copied into another project's `.agents/skills` directory.
No global installation or optional interview archive is required.

## Reuse

Read [DESIGN.md](DESIGN.md) and the topic recipes needed for the task.
`../assets/tokens.css` is canonical; `../assets/design-tokens.json` mirrors it.
`../assets/token-evidence.json` records confidence and provenance.
`../assets/preview-sources.json` orders the CSS sections and HTML regions.
Adapt only the requested components; scope the specimen's CSS to the owning UI.
`../assets/playground.js` demonstrates local interactions; it is not product API wiring.

The SVGs in `../assets/icons/` are Lucide-static 1.53.0, with a bundled ISC license.
Use equivalent named Lucide icons at source stroke 1.75 in a 24x24 viewBox.
For React, a pinned matching library may be adopted through the project's package manager;
the skill itself requires no npm dependencies or CDN.

## Preview

Run this from the project root:

```sh
python3 .agents/skills/codex-ui-design/scripts/build_preview.py
```

The builder resolves assets relative to itself, so it also works after relocating the skill.
It checks token parity and writes the self-contained `../assets/dist/components.html`.
Generated output is ignored; maintained sources and references are versionable.
Open the output in a browser, or serve the skill through a temporary loopback HTTP server
when browser automation requires HTTP. Draft entry, selection and model popup act locally.
No provider or account is contacted. See [VERIFICATION.md](VERIFICATION.md).

## Changes and boundaries

When editing tokens, update canonical CSS and mirrored JSON together, then rebuild.
Preserve the original response JSON and comparison screenshots in `../assets/evidence/`.
Record a deliberate adaptation separately from the approved baseline.
The original JSON paths identify the historical interview sources, not live dependencies.

The system covers the user-calibrated dark default fixture at 1511x951 CSS pixels.
Native fonts, ChatGPT web, light theme, streaming and unseen dialogs remain unverified.
Hover, focus, popup and narrow-screen behavior are proposed, locally tested recipes.
The signed red count has a documented contrast limitation; see the accessibility record.
This is an OpenDesign-style package, not a registered OpenDesign catalog entry.
