
const EagleEye = (() => {
  const TIER_RANK = { measured: 3, sourced: 2, argued: 1 };

  // Box text is a stranger's text. This turns it into text the browser shows
  // rather than markup the browser runs, and it is the only guard between a
  // shared box file and the page you opened.
  //
  // It escapes & and < and nothing else. That is deliberate and it is narrow:
  // it is enough only because no box text reaches an HTML attribute, where the
  // double quote would end the value. SECURITY.md states that pairing, and
  // tests/esc.test.mjs pins both halves of it.
  //
  // It lives here, and not beside the markup that calls it, so a test can
  // reach it. render.mjs inlines this module into the page, so the page and
  // the test run the same function.
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function index(box){
    const optById = {}, chosenOf = {};
    box.dims.forEach(d => { d.opts.forEach(o => { optById[o.id] = { ...o, dim: d }; }); chosenOf[d.id] = d.opts.find(o => o.chosen).id; });
    return { optById, chosenOf };
  }

  // A restore code ("eagle-eye: opt-id, opt-id") to the configuration it names: the chosen set with
  // each listed option swapped in, and the rows the code changed. "none", or no code, is the chosen
  // set. The renderer and the audit both read --sel through this, so they cannot disagree about
  // which set a code names or which edges are active. An unknown id throws; each caller turns that
  // into its usage error. The id comes from the command line, so the lookup is an own-property test:
  // `constructor` is not an option just because a plain object has one.
  function parseSel(box, code){
    const { chosenOf, optById } = index(box);
    const sel = { ...chosenOf }, touched = new Set();
    if (code) code.replace(/^\s*eagle-eye:\s*/i, '').split(',').map(s => s.trim()).filter(s => s && s !== 'none').forEach(id => {
      if (!Object.hasOwn(optById, id)) throw new Error(`unknown option "${id}"`);
      sel[optById[id].dim.id] = id; touched.add(optById[id].dim.id);
    });
    return { sel, touched };
  }

  // sel: {dimId: optId}. touched: Set of dimIds the user has clicked in. Returns everything the panel needs.
  function analyse(box, sel, touched = new Set()){
    const { optById, chosenOf } = index(box);
    const selected = new Set(Object.values(sel));
    const overrides = box.dims.filter(d => sel[d.id] !== chosenOf[d.id]).map(d => sel[d.id]);
    const conflicts = [], unmet = [], met = [], closed = new Map(), pulled = new Map();
    const edgesOf = id => (box.rel[id]?.rel || []).map(([tid, kind, why, tier, src]) => ({ from: id, to: tid, kind, why, tier: tier || 'argued', src }));

    selected.forEach(id => edgesOf(id).forEach(e => {
      if (optById[e.to].dim.id === optById[id].dim.id) return; // same row: a swap, not a relation
      const tSel = selected.has(e.to);
      if (e.kind === 'conf') { if (tSel) { if (!conflicts.some(c => c.from === e.to && c.to === e.from)) conflicts.push(e); } else closed.set(e.to, (closed.get(e.to) || []).concat(e)); }
      else { if (tSel) met.push(e); else { unmet.push(e); pulled.set(e.to, (pulled.get(e.to) || []).concat(e)); } }
    }));

    // A chosen set can be broken. Test the edges before the change count, or "as chosen" hides
    // the conflict the author wrote into the baseline — the one state nobody clicks to discover.
    const verdict = conflicts.length ? 'does not hold' : unmet.length ? 'incomplete' : !overrides.length ? 'as chosen' : 'consistent';
    const active = conflicts.concat(unmet, met);
    const basis = active.length ? Object.entries(active.reduce((m, e) => (m[e.tier] = (m[e.tier] || 0) + 1, m), {})) : [];

    // ---- the moves ----
    const moves = [];

    // 1. untouched row: bound to the most overridden rows, never clicked.
    const overriddenDims = new Set(overrides.map(id => optById[id].dim.id));
    const bindCount = {};
    box.dims.forEach(d => { if (overriddenDims.has(d.id) || touched.has(d.id)) return;
      let n = 0; d.opts.forEach(o => edgesOf(o.id).forEach(e => { if (overriddenDims.has(optById[e.to].dim.id)) n++; }));
      overrides.forEach(id => edgesOf(id).forEach(e => { if (optById[e.to].dim.id === d.id) n++; }));
      if (n) bindCount[d.id] = n; });
    // Report the whole backlog, not just its head. Naming one row at a time reads as though opening
    // it did nothing: the reader clicks, the finding returns naming the next row, and the fix looks broken.
    const ranked = Object.entries(bindCount).sort((a, b) => b[1] - a[1]);
    const untouched = ranked[0];
    if (untouched) {
      const rest = ranked.length - 1;
      moves.push({ kind: 'row not opened', text: `<b>${esc(box.dims.find(d => d.id === untouched[0]).name)}</b> has ${untouched[1]} edge${untouched[1] > 1 ? 's' : ''} to the rows you changed. You did not open it. Open it.${rest ? ` ${rest} more row${rest > 1 ? 's are' : ' is'} still unopened.` : ''}` });
    }

    // 2. weakest edge under the verdict
    const weakest = active.slice().sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])[0];
    // The tier is the one box value a finding writes into an HTML attribute, and esc does not
    // escape the double quote. render.mjs refuses a tier that is not one of the three names, so
    // no page it writes carries one. This does not lean on that check.
    const tierClass = weakest && Object.hasOwn(TIER_RANK, weakest.tier) ? weakest.tier : 'argued';
    if (weakest && overrides.length) moves.push({ kind: 'weakest edge', text: `The verdict depends on the edge <b>${esc(optById[weakest.from].dim.name)} ${weakest.kind === 'conf' ? 'vs' : 'needs'} ${esc(optById[weakest.to].dim.name)}</b>. This edge is <span class="tier ${tierClass}">${esc(weakest.tier)}</span>. “${esc(weakest.why)}” ${weakest.tier === 'argued' ? 'Nobody measured it. Measure this edge first.' : weakest.tier === 'sourced' ? 'A document says so. Read the source.' : ''}` });

    // 3. load-bearing option: the selected cell with the most edges to other selected cells (either direction)
    const degree = {};
    selected.forEach(id => { degree[id] = 0; });
    selected.forEach(id => edgesOf(id).forEach(e => { if (optById[e.to].dim.id === optById[id].dim.id) return;
      degree[id]++; if (selected.has(e.to)) degree[e.to]++; }));
    const lb = Object.entries(degree).sort((a, b) => b[1] - a[1])[0];
    if (lb && lb[1]) moves.push({ kind: 'most connected', text: `<b>${esc(optById[lb[0]].dim.name)}: ${esc(optById[lb[0]].short || optById[lb[0]].label)}</b> has ${lb[1]} edge${lb[1] === 1 ? '' : 's'} to the other selected options. If you change this option, the most options change with it.` });

    // 4. free rows: no edges in or out, any option
    const inbound = new Set(); box.dims.forEach(d => d.opts.forEach(o => edgesOf(o.id).forEach(e => inbound.add(optById[e.to].dim.id))));
    const free = box.dims.filter(d => !inbound.has(d.id) && d.opts.every(o => edgesOf(o.id).length === 0));
    if (free.length) moves.push({ kind: 'row with no edges', text: `<b>${free.map(d => esc(d.name)).join(', ')}</b> ${free.length > 1 ? 'have' : 'has'} no edges. Decide ${free.length > 1 ? 'these rows' : 'this row'} alone, or add the edge that is missing.` });

    // 5. survived strawmen: strawman options not ruled out by the selection, whose own conflicts are not selected
    const survived = [];
    box.dims.forEach(d => d.opts.filter(o => o.strawman).forEach(o => {
      if (selected.has(o.id)) return;
      const ruledOut = closed.has(o.id);
      const wouldConflict = edgesOf(o.id).some(e => e.kind === 'conf' && selected.has(e.to) && optById[e.to].dim.id !== d.id);
      // a selected option that requires a *different* option in this row excludes the strawman just as surely as a conflict
      const pulledAway = [...selected].some(sid => optById[sid].dim.id !== d.id && edgesOf(sid).some(e => e.kind === 'req' && optById[e.to].dim.id === d.id && e.to !== o.id));
      if (!ruledOut && !wouldConflict && !pulledAway) survived.push(optById[o.id]);
    }));
    if (survived.length) moves.push({ kind: 'strawman not rejected', text: `${survived.map(o => `<b>${esc(o.dim.name)}: ${esc(o.short || o.label)}</b>`).join('; ')}. No selected option rules ${survived.length > 1 ? 'these strawmen' : 'this strawman'} out. Give the reason to reject ${survived.length > 1 ? 'them' : 'it'}, or pick ${survived.length > 1 ? 'one' : 'it'}.` });

    // 6. chains: the join between two edges. The audit above reads one edge at a time,
    // and three sound edges can carry an unsound argument when the fault sits in the join.
    //
    // Only a req edge composes. A req edge carries the run forward. A conf edge ends it,
    // because a conf removes the target from the set and the target's own edges never fire.
    // So a chain is one or more req edges, optionally closed by one conf edge. A req run
    // derives "requires"; a run closed by a conf derives "rules out".
    //
    // This reads the whole box, not the selection. A cycle and an unstated derived relation
    // are authoring faults: they are true of the box whatever the reader clicks, and a finding
    // that disappears on a click teaches the reader that clicking fixed it.
    // The walk enumerates every simple run of req edges, and a box you did not write is the
    // threat SECURITY.md names. A box built to branch hard would run for a long time on the
    // machine of the person who opened it, so the walk stops. The number is far past any box
    // a person writes: the shipped example takes under a hundred steps.
    const derived = new Map(), cycles = new Map();
    let steps = 0;
    const walk = (path, tiers) => {
      if (++steps > 20000) return;
      const at = path[path.length - 1], src = path[0];
      edgesOf(at).forEach(e => {
        const onPath = path.includes(e.to);
        // A req edge back onto the path is a cycle, not a chain. Keyed on the set of options,
        // so the pair that draws it twice reports once.
        if (e.kind === 'req' && onPath) { const loop = path.slice(path.indexOf(e.to)), key = loop.slice().sort().join('+'); if (!cycles.has(key)) cycles.set(key, loop); return; }
        // path.length > 1 is the whole "a conf never starts a chain" rule: the walk only
        // recurses along req edges, so anything past the first hop arrived on one.
        // An edge back onto the path derives nothing to report: the far option is already an
        // option on the path, so the finding would name it as its own step. A conf drawn back
        // onto the path says the box contradicts itself, which is a second finding and not this one.
        if (path.length > 1 && !onPath && optById[src].dim.id !== optById[e.to].dim.id) { // same row: a swap, not a relation
          const key = `${src}>${e.to}:${e.kind}`, best = derived.get(key);
          if (!best || best.path.length <= path.length) derived.set(key, { src, to: e.to, kind: e.kind, path: path.concat(e.to), tiers: tiers.concat(e.tier) });
        }
        if (e.kind === 'req' && !onPath) walk(path.concat(e.to), tiers.concat(e.tier));
      });
    };
    Object.keys(optById).forEach(id => walk([id], []));

    const nm = id => esc(`${optById[id].dim.name}: ${optById[id].short || optById[id].label}`);
    const joinAnd = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
    // "Does the box say it?" is the actionable half. A derived relation nobody wrote is a
    // hidden constraint, and the reader fixes it by adding the edge or by writing the reason.
    const states = c => edgesOf(c.src).some(e => e.to === c.to && e.kind === c.kind)
      || (c.kind === 'conf' && edgesOf(c.to).some(e => e.to === c.src && e.kind === 'conf')); // a conf drawn once is enough
    // A loop of three options derives a relation between two of them on the way round. That
    // relation is the loop said again, and the chain finding would tell the author to write it
    // down, which draws the loop a third time. The cycle finding already names the whole loop,
    // so a relation with both ends inside one loop is dropped. A pair does this by itself: the
    // walk stops at the second edge, so a two-option loop derives nothing to drop.
    const loops = [...cycles.values()].map(loop => new Set(loop));
    const chains = [...derived.values()].filter(c => !loops.some(l => l.has(c.src) && l.has(c.to)))
      .map(c => ({ ...c, stated: states(c), tier: c.tiers.slice().sort((a, b) => TIER_RANK[a] - TIER_RANK[b])[0] }))
      // Report the longest path, because it is the one no reader holds in their head.
      // Then the unstated one, then the one that rests on the weakest evidence.
      .sort((a, b) => b.path.length - a.path.length || a.stated - b.stated || TIER_RANK[a.tier] - TIER_RANK[b.tier]);
    const chain = chains[0];
    if (chain) {
      const rest = chains.length - 1;
      // The tier reaches an HTML attribute here, where esc does not help. Same guard as the
      // weakest edge above: an unknown tier reads as argued rather than as markup.
      const tier = Object.hasOwn(TIER_RANK, chain.tier) ? chain.tier : 'argued';
      moves.push({ kind: 'chain', text: `<b>${nm(chain.src)}</b> ${chain.kind === 'conf' ? 'rules out' : 'requires'} <b>${nm(chain.to)}</b>, through ${joinAnd(chain.path.slice(1, -1).map(id => `<b>${nm(id)}</b>`))}. ${chain.stated ? 'The box states this relation.' : 'The box does not state it. Add the edge, or say in the notes why the path is enough.'} The weakest edge on the path is <span class="tier ${tier}">${esc(chain.tier)}</span>.${rest ? ` The box derives ${rest} more relation${rest > 1 ? 's' : ''} this way.` : ''}` });
    }
    if (cycles.size) moves.push({ kind: 'cycle', text: `${[...cycles.values()].map(loop => `${joinAnd(loop.map(id => `<b>${nm(id)}</b>`))} require each other.`).join(' ')} A loop is one decision drawn more than once. Merge its rows, or drop one of its edges.` });

    // 7. evidence for the verdict
    const argued = active.filter(e => e.tier === 'argued').length;
    // Branch on the edges, not on the change count. A set with no overrides can still carry
    // conflicts, and a set with overrides can still touch no edge. Both read as tested when
    // the count decides, and both are untested.
    // "Nobody measured them" is only true of the argued edges. A set whose active edges are all
    // measured or sourced is the strong case, and saying it is untested inverts the finding.
    const evidenced = active.filter(e => e.tier !== 'argued');
    // The count says the verdict is unevidenced and never says where to measure. These are the
    // addresses: a row whose selected cell touches active edges, and every one of them is argued.
    // A row no active edge touches is not named. Nothing tests that row either way, and
    // "row with no edges" is the finding for it.
    const onlyArgued = box.dims.filter(d => {
      const touching = active.filter(e => e.from === sel[d.id] || e.to === sel[d.id]);
      return touching.length && touching.every(e => e.tier === 'argued');
    }).map(d => d.name);
    // Past three rows the list stops being an address and becomes a backlog. The shipped example
    // names 10 of its 13 rows: "open these ten rows" is an instruction nobody follows, and the
    // count is one sentence a reader finishes.
    const address = !onlyArgued.length ? ''
      : onlyArgued.length > 3
        ? ` The active edges at ${onlyArgued.length} of ${box.dims.length} rows are all argued.`
        : ` The active edges at ${onlyArgued.map(n => `<b>${esc(n)}</b>`).join(', ')} are all argued. Measure ${onlyArgued.length === 1 ? 'that row' : 'those rows'} first.`;
    moves.push({ kind: 'evidence for the verdict', text: !active.length
      ? `No edge reaches this set, so nothing in the box tested it. Add the edge that is missing, or change an option to see which edges hold.`
      : argued
        ? `${argued} of ${active.length} active edge${active.length === 1 ? '' : 's'} ${argued === 1 ? 'is' : 'are'} argued. Nobody measured ${argued === 1 ? 'that one' : 'those'}.${address} If all the edges are true, the verdict is “${verdict}”. If one argued edge is false, the verdict can change.`
        : `Every active edge carries evidence: ${evidenced.filter(e => e.tier === 'measured').length} measured, ${evidenced.filter(e => e.tier === 'sourced').length} sourced. If all the edges are true, the verdict is “${verdict}”.` });

    // affected rows for coach mode: rows whose cells changed colour because of the overrides
    // only edges that involve an override count — what the chosen set rules out on its own is the baseline, not a change
    const affected = new Set();
    const viaOverride = e => overriddenDims.has(optById[e.from].dim.id) || overriddenDims.has(optById[e.to].dim.id);
    conflicts.filter(viaOverride).forEach(e => { affected.add(optById[e.from].dim.id); affected.add(optById[e.to].dim.id); });
    unmet.filter(viaOverride).forEach(e => affected.add(optById[e.to].dim.id));
    closed.forEach((es, tid) => { if (es.some(viaOverride)) affected.add(optById[tid].dim.id); });
    overriddenDims.forEach(d => affected.delete(d));

    return { optById, chosenOf, selected, overrides, conflicts, unmet, met, closed, pulled, verdict, basis, moves, affected, suspected: box.suspected || [] };
  }

  return { analyse, index, parseSel, esc };
})();
if (typeof module !== 'undefined') module.exports = EagleEye;
