# Third-Party Notices

This project is a derivative work of **DeepSeek ChatDemo** and uses open-source
libraries. The list below is a summary, not a substitute for the license files
shipped with each dependency.

## Upstream

- **DeepSeek ChatDemo** — MIT License
  - Copyright (c) 2026 DeepSeek
  - Original license: `chat-demo/LICENSE`
  - This repository contains modifications and additions by Super DeepSeek
    contributors.

## Major runtime dependencies

| Package | License |
| --- | --- |
| React / React DOM | MIT |
| Zustand | MIT |
| idb | ISC |
| fflate | MIT |
| KaTeX | MIT |
| Mermaid | MIT |
| PrismJS | MIT |
| clsx | MIT |
| mdast / micromark utilities | MIT |

## Build tooling

- rspack and related packages — MIT
- TypeScript — Apache-2.0
- oxlint / oxfmt — MIT

## Assets

- `macapp/AppIcon.icns` and icon preview are original artwork for this project.
- The DeepSeek name and wordmark are trademarks of their respective owner and
  are **not** licensed under this project's MIT license. See `TRADEMARKS.md`.
- Screenshots in `docs/screenshots/` were generated with empty demo data.

For a complete dependency license report, run:

```sh
cd chat-demo
pnpm licenses list
```
