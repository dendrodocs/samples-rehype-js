import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {h} from 'hastscript';
import rehypeFormat from 'rehype-format';
import rehypeStringify from 'rehype-stringify';
import {unified} from 'unified';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataPath = path.join(rootDir, 'data', 'pitstop.analyzed.json');
const outputPath = path.join(rootDir, 'dist', 'pitstop.generated.html');
const stylesPath = path.join(rootDir, 'src', 'styles.css');

const COMMAND_BASE = 'Pitstop.Infrastructure.Messaging.Command';
const EVENT_BASE = 'Pitstop.Infrastructure.Messaging.Event';
const AGGREGATE_BASE = 'Pitstop.WorkshopManagementAPI.Domain.Core.AggregateRoot<';
const PRIVATE = 1 << 2;

const knownServiceNames = [
  'CustomerManagementAPI',
  'VehicleManagement',
  'WorkshopManagementAPI',
  'WorkshopManagementEventHandler',
  'InvoiceService',
  'NotificationService',
  'TimeService',
  'AuditlogService',
  'WebApp'
];

const source = await fs.readFile(dataPath, 'utf8');
const types = JSON.parse(source);
const stylesheet = await fs.readFile(stylesPath, 'utf8');

populateInheritedBaseTypes(types);
populateInheritedMembers(types);

const typeByFullName = new Map(types.map((type) => [type.FullName, type]));
const commands = groupByName(types.filter((type) => implementsType(type, COMMAND_BASE)));
const events = groupByName(types.filter((type) => implementsType(type, EVENT_BASE)));
const aggregates = types
  .filter((type) => (type.BaseTypes ?? []).some((baseType) => baseType.startsWith(AGGREGATE_BASE)))
  .sort(byName);

const commandSummaries = [...commands.values()].map(messageSummary);
const eventSummaries = [...events.values()].map(messageSummary);

const document = buildDocument();
const processor = unified()
  .use(rehypeHeadingIdsAndToc)
  .use(rehypeFormat)
  .use(rehypeStringify);

const transformed = await processor.run(document);
const html = processor.stringify(transformed);

await fs.mkdir(path.dirname(outputPath), {recursive: true});
await fs.writeFile(outputPath, html);

if (process.argv.includes('--check')) {
  assertGeneratedOutput(html);
}

console.log(`Generated ${path.relative(rootDir, outputPath)}`);
console.log(`- ${types.length} analyzed types`);
console.log(`- ${commandSummaries.length} command groups`);
console.log(`- ${eventSummaries.length} event groups`);
console.log(`- ${aggregates.length} aggregate roots`);

/**
 * Builds the complete HAST document before any Rehype plugins run.
 * This is the main composition point for changing page layout or adding sections.
 */
function buildDocument() {
  return {
    type: 'root',
    children: [
      {type: 'doctype'},
      h('html', {lang: 'en'}, [
        h('head', [
          h('meta', {charset: 'utf-8'}),
          h('meta', {name: 'viewport', content: 'width=device-width, initial-scale=1'}),
          h('link', {rel: 'icon', href: 'data:,'}),
          h('title', 'Pitstop Generated Documentation'),
          h('style', stylesheet)
        ]),
        h('body', [
          h('header.hero', [
            h('p.eyebrow', 'DendroDocs Rehype sample'),
            h('h1', 'Pitstop Generated Documentation'),
            h('p.lead', 'HTML documentation generated from DendroDocs intermediary JSON through a HAST tree and Rehype transforms.'),
            h('div.metrics', [
              metric(`${types.length}`, 'analyzed types'),
              metric(`${commandSummaries.length}`, 'command groups'),
              metric(`${eventSummaries.length}`, 'event groups'),
              metric(`${aggregates.length}`, 'aggregate roots')
            ])
          ]),
          h('div.shell', [
            h('aside.sidebar', [
              h('nav', {'aria-label': 'On this page', 'data-toc': true})
            ]),
            h('main', [
              h('section.panel', [
                h('h2', 'Overview'),
                h('div.toolbar', [
                  h('label.search', [
                    h('span', 'Filter'),
                    h('input', {
                      id: 'filter',
                      type: 'search',
                      'aria-describedby': 'filter-status',
                      placeholder: 'Search commands, events, services, or fields'
                    })
                  ]),
                  h('button.clear-filter', {id: 'clear-filter', type: 'button', hidden: true}, 'Clear filter'),
                  h('p.filter-status', {id: 'filter-status', 'aria-live': 'polite'})
                ]),
                h('div.signal-grid', [
                  signal('Commands with missing handlers', commandSummaries.filter((item) => item.unhandledDefinitions.length > 0).length),
                  signal('Duplicate message definitions', [...commands.values(), ...events.values()].filter((group) => group.length > 1).length),
                  signal('Payload type mismatches', [...commandSummaries, ...eventSummaries].filter((item) => item.fieldConflicts.length > 0).length),
                  signal('Undocumented payload fields', [...commandSummaries, ...eventSummaries].reduce((sum, item) => sum + item.missingFieldDocs, 0))
                ])
              ]),
              renderMessageSection('Commands', commandSummaries, 'command'),
              renderMessageSection('Events', eventSummaries, 'event'),
              renderAggregateSection()
            ])
          ]),
          h('script', clientScript())
        ])
      ])
    ]
  };
}

/**
 * Renders a top-level Commands or Events section from grouped message summaries.
 */
function renderMessageSection(title, summaries, kind) {
  return h('section.panel.catalog-section', {'data-section': true}, [
    h('h2', title),
    h('p.section-intro', kind === 'command'
      ? 'Commands represent requests to change the system. The flow shows methods that accept each command.'
      : 'Events record facts that happened. A message can be defined by more than one service.'),
    h('div.card-grid', summaries.map((summary) => renderMessageCard(summary, kind)))
  ]);
}

/**
 * Renders one command/event card with services, warnings, payload details, and flow metadata.
 */
function renderMessageCard(summary, kind) {
  const warningNodes = [];

  if (kind === 'command' && summary.unhandledDefinitions.length > 0) {
    warningNodes.push(h('p.warning', `No command handler was detected for: ${summary.unhandledDefinitions.map((type) => type.FullName).join(', ')}.`));
  }

  if (summary.fieldConflicts.length > 0) {
    warningNodes.push(h('p.warning', `Inconsistent payload field types: ${summary.fieldConflicts.join(', ')}.`));
  }

  return h('article.message-card', {'data-search': summary.searchText}, [
    h('div.card-head', [
      h('h3', sentenceCase(summary.name)),
      h('span.badge', kind)
    ]),
    h('div.badges', summary.services.map((service) => h('span.service', service))),
    h('p.card-subtitle', definitionLabel(summary.definitions)),
    ...warningNodes,
    h('h4', 'Payload'),
    renderFieldTable(summary.fields),
    kind === 'command' ? renderHandlerFlow(summary) : h('p.note', `${summary.definitions.length} service definition${summary.definitions.length === 1 ? '' : 's'} found.`)
  ]);
}

/**
 * Renders a payload table and links field types when the target type exists in the analyzed JSON.
 */
function renderFieldTable(fields) {
  if (fields.length === 0) {
    return h('p.note', 'No payload fields detected.');
  }

  return h('table.payload', [
    h('thead', h('tr', [
      h('th', 'Property'),
      h('th', 'Type'),
      h('th', 'Description')
    ])),
    h('tbody', fields.map((field) => h('tr', [
      h('td', field.Name),
      h('td', linkKnownType(field.Type)),
      h('td', field.DocumentationComments?.Summary || '')
    ])))
  ]);
}

/**
 * Shows handler methods in a compact disclosure. Long method names stay readable
 * without taking over the message card.
 */
function renderHandlerFlow(summary) {
  if (summary.handlers.length === 0) {
    return h('p.note', 'No handler methods were detected.');
  }

  return h('details.handler-flow', [
    h('summary', [
      h('span', `${summary.handlers.length} detected handler${summary.handlers.length === 1 ? '' : 's'}`),
      h('span.handler-hint', 'Show methods')
    ]),
    h('ol.handler-list', summary.handlers.map((handler) => h('li.handler-row', [
      h('div.handler-route', [
        h('span.route-service.source', handler.sourceService),
        h('span.arrow', '→'),
        h('span.route-service.target', serviceFromType(handler.type))
      ]),
      h('code.handler-method', `${shortName(handler.type.FullName)}.${handler.method.Name}`)
    ])))
  ]);
}

/**
 * Renders aggregate root cards using public properties and related analyzed types.
 */
function renderAggregateSection() {
  return h('section.panel.catalog-section', {'data-section': true}, [
    h('h2', 'Aggregates'),
    h('p.section-intro', 'Aggregate roots group domain state and the types they expose.'),
    h('div.card-grid', aggregates.map((aggregate) => h('article.message-card', {'data-search': `${aggregate.FullName} ${fieldsOf(aggregate).map((field) => field.Name).join(' ')}`}, [
      h('div.card-head', [
        h('h3', sentenceCase(shortName(aggregate.FullName))),
        h('span.badge', 'aggregate')
      ]),
      h('p.note', aggregate.FullName),
      h('h4', 'Public Properties'),
      renderFieldTable((aggregate.Properties ?? []).filter((property) => !isPrivate(property)).sort(byName)),
      h('h4', 'Related Types'),
      renderRelatedTypes(aggregate)
    ])))
  ]);
}

/**
 * Lists analyzed types referenced by an aggregate's properties.
 */
function renderRelatedTypes(type) {
  const related = (type.Properties ?? [])
    .map((property) => referencedType(property.Type))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort();

  if (related.length === 0) {
    return h('p.note', 'No related analyzed types detected.');
  }

  return h('ul.related', related.map((name) => h('li', linkKnownType(name))));
}

function metric(value, label) {
  return h('div.metric', [
    h('strong', value),
    h('span', label)
  ]);
}

function signal(label, value) {
  return h('div.signal', [
    h('strong', String(value)),
    h('span', label)
  ]);
}

/**
 * Gives readers a compact hint about the original analyzed type definitions.
 */
function definitionLabel(definitions) {
  const names = definitions.map((type) => type.FullName).sort();
  return `${names.length} definition${names.length === 1 ? '' : 's'}: ${names.join(', ')}`;
}

/**
 * Converts all type definitions for a message name into the view model used by the renderer.
 */
function messageSummary(group) {
  const name = shortName(group[0].FullName);
  const fields = uniqueFields(group.flatMap(fieldsOf)).sort(byName);
  const services = [...new Set(group.map(serviceFromType))].sort();
  const handlers = findHandlers(group);
  const handledTypes = new Set(handlers.map((handler) => handler.messageType.FullName));
  const unhandledDefinitions = group.filter((type) => !handledTypes.has(type.FullName));
  const fieldConflicts = conflictingFieldNames(group.flatMap(fieldsOf));
  const missingFieldDocs = fields.filter((field) => !field.DocumentationComments?.Summary).length;

  return {
    name,
    definitions: group,
    fields,
    services,
    handlers,
    unhandledDefinitions,
    fieldConflicts,
    missingFieldDocs,
    searchText: [
      name,
      ...services,
      ...fields.flatMap((field) => [field.Name, field.Type]),
      ...handlers.map((handler) => handler.type.FullName)
    ].join(' ').toLowerCase()
  };
}

/**
 * Finds methods with parameters matching one of the concrete command/event types.
 * This creates a useful first-pass "who handles this message" signal without domain-specific code.
 */
function findHandlers(messageTypes) {
  const names = new Set(messageTypes.map((type) => type.FullName));
  const sourceServices = new Map(messageTypes.map((type) => [type.FullName, serviceFromType(type)]));
  const handlers = [];

  for (const type of types) {
    for (const method of type.Methods ?? []) {
      for (const parameter of method.Parameters ?? []) {
        if (names.has(parameter.Type)) {
          handlers.push({
            messageType: messageTypes.find((messageType) => messageType.FullName === parameter.Type),
            type,
            method,
            sourceService: sourceServices.get(parameter.Type) ?? 'Unknown source'
          });
        }
      }
    }
  }

  return handlers;
}

/**
 * Adds transitive base types in-place so queries can match indirect inheritance.
 */
function populateInheritedBaseTypes(allTypes) {
  const map = new Map(allTypes.map((type) => [type.FullName, type]));

  function visit(type, seen = new Set()) {
    for (const baseType of [...(type.BaseTypes ?? [])]) {
      if (seen.has(baseType)) continue;
      seen.add(baseType);

      const base = map.get(baseType);
      if (!base) continue;

      for (const inherited of visit(base, seen)) {
        if (!type.BaseTypes.includes(inherited)) {
          type.BaseTypes.push(inherited);
        }
      }
    }

    return type.BaseTypes ?? [];
  }

  for (const type of allTypes) {
    type.BaseTypes ??= [];
    visit(type);
  }
}

/**
 * Copies non-private inherited members onto derived types for the sample renderer.
 */
function populateInheritedMembers(allTypes) {
  const map = new Map(allTypes.map((type) => [type.FullName, type]));

  for (const type of allTypes) {
    for (const baseType of type.BaseTypes ?? []) {
      const base = map.get(baseType);
      if (!base) continue;

      inheritCollection(type, 'Fields', base.Fields);
      inheritCollection(type, 'Properties', base.Properties);
      inheritCollection(type, 'Methods', base.Methods);
    }
  }
}

/**
 * Copies inherited fields/properties/methods while avoiding duplicate name/type pairs.
 */
function inheritCollection(type, propertyName, inheritedItems = []) {
  type[propertyName] ??= [];
  const existing = new Set(type[propertyName].map((item) => `${item.Type ?? ''}:${item.Name}`));

  for (const item of inheritedItems.filter((candidate) => !isPrivate(candidate))) {
    const key = `${item.Type ?? ''}:${item.Name}`;
    if (!existing.has(key)) {
      type[propertyName].push(item);
      existing.add(key);
    }
  }
}

/**
 * Groups analyzed types by simple class name, matching the workshop command/event grouping.
 */
function groupByName(items) {
  const groups = new Map();

  for (const item of items) {
    const name = shortName(item.FullName);
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }

  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Keeps one field for each name/type pair across duplicated message definitions.
 */
function uniqueFields(fields) {
  const seen = new Set();
  const result = [];

  for (const field of fields) {
    const key = `${field.Type}:${field.Name}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(field);
    }
  }

  return result;
}

/**
 * Finds payload fields that share a name but have different types across services.
 */
function conflictingFieldNames(fields) {
  const typeNames = new Map();

  for (const field of fields) {
    const values = typeNames.get(field.Name) ?? new Set();
    values.add(field.Type);
    typeNames.set(field.Name, values);
  }

  return [...typeNames.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([name]) => name)
    .sort();
}

function fieldsOf(type) {
  return [...(type.Fields ?? []), ...(type.Properties ?? [])];
}

function implementsType(type, fullName) {
  return (type.BaseTypes ?? []).includes(fullName);
}

function isPrivate(member) {
  return ((member.Modifiers ?? 0) & PRIVATE) === PRIVATE;
}

function byName(left, right) {
  return (left.Name ?? shortName(left.FullName)).localeCompare(right.Name ?? shortName(right.FullName));
}

function shortName(fullName = '') {
  return fullName.split('.').at(-1) ?? fullName;
}

function namespaceOf(fullName = '') {
  return fullName.split('.').slice(0, -1).join('.');
}

/**
 * Derives a readable service name from known Pitstop namespace segments.
 * Replace this with your own domain mapping when adapting the sample.
 */
function serviceFromType(type) {
  const namespace = namespaceOf(type.FullName);
  const match = knownServiceNames.find((serviceName) => namespace.includes(serviceName));
  return sentenceCase(match ?? namespace.split('.').at(-2) ?? namespace);
}

function sentenceCase(value = '') {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function readableType(typeName = '') {
  return typeName
    .replaceAll('System.', '')
    .replaceAll('Collections.Generic.', '')
    .replaceAll('Pitstop.', '');
}

function referencedType(typeName = '') {
  if (typeByFullName.has(typeName)) {
    return typeName;
  }

  const generic = typeName.match(/<([^<>]+)>/);
  if (generic && typeByFullName.has(generic[1])) {
    return generic[1];
  }

  return null;
}

/**
 * Renders a field type as a cross-link when that type was present in the analysis input.
 */
function linkKnownType(typeName) {
  const target = referencedType(typeName);
  if (!target) {
    return readableType(typeName);
  }

  return h('a', {href: `#${slug(sentenceCase(shortName(target)))}`, title: target}, readableType(typeName));
}

/**
 * Rehype plugin that assigns stable heading IDs and fills the sidebar table of contents.
 * This demonstrates where AST transformations fit after the initial HAST tree is built.
 */
function rehypeHeadingIdsAndToc() {
  return (tree) => {
    const headings = [];
    const used = new Map();

    visit(tree, (node) => {
      if (!isElement(node)) return;
      if (!/^h[2-3]$/.test(node.tagName)) return;

      const text = textContent(node);
      const base = slug(text);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;

      node.properties ??= {};
      node.properties.id = id;
      headings.push({id, text, rank: Number(node.tagName.slice(1))});
    });

    visit(tree, (node) => {
      if (!isElement(node)) return;
      if (!node.properties?.dataToc) return;

      node.children = [
        h('div.toc-title', 'Contents'),
        h('ol.toc-list', headings.map((heading) => h('li', {className: [`rank-${heading.rank}`]}, [
          h('a', {href: `#${heading.id}`}, heading.text)
        ])))
      ];
    });
  };
}

function visit(node, callback) {
  callback(node);

  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}

function isElement(node) {
  return node?.type === 'element';
}

function textContent(node) {
  if (node.type === 'text') {
    return node.value;
  }

  return (node.children ?? []).map(textContent).join('');
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Minimal smoke test used by npm run check.
 */
function assertGeneratedOutput(value) {
  const required = [
    'Pitstop Generated Documentation',
    'Commands',
    'Events',
    'Register Customer',
    'Customer Registered',
    'No command handler was detected',
    'Clear filter',
    'Showing all'
  ];

  for (const text of required) {
    if (!value.includes(text)) {
      throw new Error(`Generated HTML did not include expected text: ${text}`);
    }
  }
}

/**
 * Small inline script for client-side filtering in the generated static HTML.
 */
function clientScript() {
  return `
const input = document.querySelector('#filter');
const cards = [...document.querySelectorAll('[data-search]')];
const sections = [...document.querySelectorAll('[data-section]')];
const status = document.querySelector('#filter-status');
const clearButton = document.querySelector('#clear-filter');

function updateFilter() {
  const query = input.value.trim().toLowerCase();
  let visibleCards = 0;

  for (const card of cards) {
    const matches = !query || card.dataset.search.includes(query);
    card.classList.toggle('is-hidden', !matches);
    if (matches) visibleCards += 1;
  }

  for (const section of sections) {
    section.classList.toggle('is-hidden', query && !section.querySelector('[data-search]:not(.is-hidden)'));
  }

  clearButton.hidden = !query;
  status.textContent = query
    ? \`Showing \${visibleCards} of \${cards.length} catalog entries\`
    : \`Showing all \${cards.length} catalog entries\`;
}

input?.addEventListener('input', () => {
  updateFilter();
});
clearButton?.addEventListener('click', () => {
  input.value = '';
  input.focus();
  updateFilter();
});
updateFilter();
`;
}
