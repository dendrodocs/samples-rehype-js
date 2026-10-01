# DendroDocs Rehype Sample

This sample renders DendroDocs intermediary JSON into a useful static HTML catalog.

It is intentionally small and framework-free: the source analyzer has already produced JSON, and this renderer builds a HTML AST (`hast`) that is transformed and serialized with Rehype.

This is the JavaScript-first version. Everything that turns the JSON into a page lives in `src/generate.js`, uses ordinary modern JavaScript, and runs directly with Node—there is no compiler or custom build setup to understand.

```text
pitstop.analyzed.json -> hast tree -> rehype plugins -> pitstop.generated.html
```

## Run

```shell
npm install
npm run generate
```

Open `dist/pitstop.generated.html` in a browser.

Use this command for a quick verification pass:

```shell
npm run check
```

## Repository Layout

```text
samples-rehype/
  data/
    pitstop.analyzed.json   copied DendroDocs input used by the sample
  src/
    generate.js             renderer and Rehype pipeline
    styles.css              page styling injected into the generated HTML
  dist/                     generated output, ignored by git
```

## What The Sample Shows

- Commands and events grouped by message name.
- Services detected from namespaces.
- Payload tables with inherited message fields.
- Warnings for commands without a detected handler.
- A live filter that reports matches, hides empty sections, and can be cleared with one button.
- Original full type names, so readers can see exactly where each message was defined.
- Cross-links from payload types to known analyzed types.
- Aggregate summaries for the workshop aggregate root.
- A Rehype plugin that adds heading IDs and generates the sidebar table of contents.

## How It Works

The renderer has three main stages:

1. Read `data/pitstop.analyzed.json` and prepare the few derived values the page needs.
2. Build a HAST document with `hastscript`.
3. Run Rehype plugins and serialize the final tree to HTML.

Important functions in `src/generate.js`:

- `buildDocument()` composes the page sections.
- `messageSummary()` turns DendroDocs type groups into the small plain-object model used by cards.
- `populateInheritedBaseTypes()` and `populateInheritedMembers()` mimic the workshop helper behavior.
- `serviceFromType()` maps Pitstop namespaces to readable service names.
- `rehypeHeadingIdsAndToc()` is the custom Rehype plugin that modifies the HAST tree.

## Adapting It

For another project, start here:

1. Replace `data/pitstop.analyzed.json` with your DendroDocs output.
2. Update `COMMAND_BASE`, `EVENT_BASE`, and `AGGREGATE_BASE` if your domain uses different base types.
3. Update `knownServiceNames` and `serviceFromType()` to match your namespace or package structure.
4. Change `renderMessageCard()` and `renderAggregateSection()` to render the documentation your stakeholders need.
5. Add additional Rehype plugins after `rehypeHeadingIdsAndToc()` if you want more AST transformations.

The sample emits a single self-contained HTML file. That makes it easy to publish as a CI artifact or attach to generated documentation output.

Explore [DendroDocs](https://github.com/dendrodocs) for more tools, libraries, and documentation resources.
