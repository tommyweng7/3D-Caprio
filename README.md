# 3D Caprio

Type "make a modern wooden chair" and get a chair built from separate parts: a seat, a back, a cushion, and four legs. Each part is generated on its own, so you can change one without regenerating the rest.

3D Caprio is the component layer I built for **Sondial**, our HackCMU 2026 text/image-to-3D project. This repo holds only my layer. It runs on top of a Sondial checkout, and it does not include Sondial's code.

## What it does

1. **Plan.** `POST /api/caprio/plan` turns a prompt into named components with roles and quantities (`Seat`, `Back`, `Cushion`, `Leg x4`), plus how they attach. Vague prompts get up to three clarifying questions instead of a guess. A local heuristic planner covers the chair case with no API key and acts as the fallback when the LLM's JSON fails validation.
2. **Generate parts.** Each component gets its own mesh prompt (one isolated part, real-world proportions) and its own mesh task. Repeated parts are generated once and placed as instances.
3. **Assemble.** Parts are scaled to a shared frame, snapped together, and linked by the planned dependencies. The first result is saved as an iteration called "Blockout 1".
4. **Edit one part at a time.** Dimension edits (height, width, taper) go through a CAD path instead of regenerating. You can also split a part, merge parts, lock a part, or replace it from a library.
5. **History.** Every geometry edit adds a new version of that part and keeps the old ones. Iterations snapshot which version of each part was in use, and branches let you try a direction without losing the main line. The History panel lets you click back to any version.

## Layout

```
src/caprio/               planner, generation, versioning, CAD, GLB tools
src/app/api/caprio/       API routes
src/app/caprio/           the /caprio page
src/components/caprio/    workspace, inspector, history tree, viewer
vitest.config.ts
```

## Running it

This layer imports three things from Sondial: `@/lib/llm`, `@/providers`, and `@/providers/types`. Copy these folders onto a Sondial checkout, then:

```
npm install zod
npm install -D vitest
npx tsc --noEmit
npx vitest run
npm run dev        # open /caprio
```

Changes needed in Sondial:

- Add `quality?: "fast" | "detail"` to the input of `MeshGenerationProvider.generateMesh` in `src/providers/types.ts`. Providers that cannot vary resolution can ignore it.
- Add `zod` and `vitest` as dependencies, and a `"test": "vitest run"` script.
- Add `/data/` to `.gitignore`. The component store and per-part GLBs live in `./data` by default.

Optional environment variables:

```
CAPRIO_LLM_PROVIDER=heuristic   # heuristic | gemini | anthropic
CAPRIO_MESH_PROVIDER=local      # local | meshy
DATA_DIR=./data
```

`heuristic` plans parts with no key at all, and `local` builds parts from primitives instead of calling Meshy.

## Credits

Sondial was built by the HackCMU 2026 team. Upstream: https://github.com/adamkablawi/sondial. Team repo: https://github.com/eddieliu1/Sondial. I wrote the component layer in this repo.
