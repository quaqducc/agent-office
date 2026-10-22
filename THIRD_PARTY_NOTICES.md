# Third-party notices

Agent Company ships (in `library/`) and distributes through its role store (in `catalog/`) role
personas and skills adapted from the open-source projects below. Each skill folder contains a
`.source` file naming its origin; the full license texts are in `library/licenses/` and
`catalog/licenses/`. Content is copied unmodified unless noted; role files (`roles/*.md`) are original
to Agent Company and only reference these personas and skills.

| Source (id) | Repository | Commit | License |
|---|---|---|---|
| agency-agents | https://github.com/msitarzewski/agency-agents | 652b2692f8d8ec2b1f1a38e559073e287dfdc469 | MIT — Copyright (c) 2025 AgentLand Contributors |
| agent-skills | https://github.com/addyosmani/agent-skills | aeac41d4d005999432bb7312f7ff06383a91d59d | MIT — Copyright (c) 2025 Addy Osmani |
| anthropic-skills | https://github.com/anthropics/skills (`frontend-design` only) | dbd4588f9e1033efb41dad4bef2f7947c8993d44 | Apache-2.0 |
| ecc | https://github.com/affaan-m/ECC | 76aaa77df6adc5b889e689007bf99b9a4f74af34 | MIT — Copyright (c) 2026 Affaan Mustafa |
| marketingskills | https://github.com/coreyhaines31/marketingskills | 365b412152b9542499ca1439426f7fc3cc92bb65 | MIT — Copyright (c) 2025 Corey Haines |
| pm-skills | https://github.com/phuryn/pm-skills | 07b34f64ee828df08953f505b7f747aef85ae7c6 | MIT — Copyright (c) 2026 Pawel Huryn |
| superpowers | https://github.com/obra/superpowers | 8ca22dba9a94f28898bbce59f2537ff4d87c747d | MIT — Copyright (c) 2025 Jesse Vincent |
| ui-ux-pro-max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (`ui-ux-pro-max` skill only) | 56ea9cf174ed86786187daa9de0e6247cb0747e4 | MIT — Copyright (c) 2024 Next Level Builder |
| wshobson-agents | https://github.com/wshobson/agents (`llm-application-dev` skills) | 0874a27b17a22e2b7c2e2bcd725768e0803cad06 | MIT — Copyright (c) 2024 Seth Hobson |

Runtime dependencies (installed by npm, not vendored): `@earendil-works/pi-coding-agent` and its
`@earendil-works/*` packages, `marked`, `typebox` — see their own licenses in `node_modules`.

Vendored web client libraries:
- `ui/vendor/prism.js` & `ui/vendor/prism.css`: PrismJS (v1.29.0) — MIT License, Copyright (c) 2012 Lea Verou and Prism contributors (https://prismjs.com/).
