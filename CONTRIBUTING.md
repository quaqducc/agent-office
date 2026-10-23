# Contributing

Thanks for helping! Issues and pull requests are welcome. Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organised.

## Setup

```sh
git clone https://github.com/quaqducc/agent-office.git
cd agent-company
npm install
npm start            # runs the app from the TypeScript sources (Node 22.19+)
```

## Before you open a pull request

```sh
npm run check                          # type-check
npm test                               # unit tests, no model calls
node scripts/build-catalog.mjs --check # catalog index matches catalog/ files
node scripts/pack-check.mjs            # nothing private ends up in the npm package
```

- Keep changes small and focused; add or update a test with every behaviour change.
- Code, comments and docs are in English. The UI text is Vietnamese.
- Never commit API keys, `.company/` run logs or anything from `~/.agent-company`.

## Roles and skills

Base roles live in `library/`; store roles live in `catalog/`. After changing anything under
`catalog/`, run `npm run catalog` to refresh `catalog/index.json` (checksums) and commit it.
Third-party skills keep their `.source` file and license; add new sources to
`THIRD_PARTY_NOTICES.md`.

## Real-model tests

`tests/e2e/*.ts` call a real model through your configured provider (`agent-company` settings) and
cost tokens. Run them only when you change orchestration or prompts.
