/**
 * TreeView.js — Hierarchical tree widget for file browser
 *
 * Renders a collapsible tree of directories and files.
 * Adapted from gmat-ui TreeView.js.
 */

export class TreeView {
  constructor(container, opts = {}) {
    this.container = container;
    this.onSelect = opts.onSelect || (() => {});
    this.onDblClick = opts.onDblClick || (() => {});
    this.onCtxMenu = opts.onCtxMenu || (() => {});
    this.root = { children: [], expanded: true, _isRoot: true };
    this.selected = null;
  }

  addNode(parent, label, data = {}, icon = '') {
    const node = { label, data, icon, children: [], expanded: data.expanded !== false, parent, el: null };
    parent.children.push(node);
    return node;
  }

  clearChildren(node) { node.children = []; }

  findNode(predicate, startNode) {
    const root = startNode || this.root;
    for (const child of root.children) {
      if (predicate(child)) return child;
      const found = this.findNode(predicate, child);
      if (found) return found;
    }
    return null;
  }

  render() {
    this.container.innerHTML = '';
    this._renderChildren(this.root, this.container, 0);
  }

  _renderChildren(node, parentEl, depth) {
    for (const child of node.children) this._renderNode(child, parentEl, depth);
  }

  _renderNode(node, parentEl, depth) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = (depth * 14 + 4) + 'px';

    const hasKids = node.children.length > 0 || node.data.isDir;
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = hasKids ? (node.expanded ? '\u25BC' : '\u25B6') : '\u00A0';
    if (hasKids) toggle.addEventListener('click', e => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      this.onDblClick(node); /* triggers lazy-load for dirs */
      this.render();
    });
    item.appendChild(toggle);

    if (node.icon) {
      const ic = document.createElement('span');
      ic.className = 'tree-icon';
      ic.textContent = node.icon;
      item.appendChild(ic);
    }

    const lbl = document.createElement('span');
    lbl.className = 'tree-label';
    lbl.textContent = node.label;
    item.appendChild(lbl);

    item.addEventListener('click', () => this._select(node, item));
    item.addEventListener('dblclick', () => this.onDblClick(node));

    if (this.selected === node) item.classList.add('selected');
    node.el = item;
    parentEl.appendChild(item);

    if (node.expanded && node.children.length > 0) {
      const childDiv = document.createElement('div');
      this._renderChildren(node, childDiv, depth + 1);
      parentEl.appendChild(childDiv);
    }
  }

  _select(node, el) {
    if (this.selected && this.selected.el) this.selected.el.classList.remove('selected');
    this.selected = node;
    el.classList.add('selected');
    this.onSelect(node);
  }

  expandAll() {
    const setExpanded = (node, val) => { node.expanded = val; node.children.forEach(c => setExpanded(c, val)); };
    this.root.children.forEach(c => setExpanded(c, true));
    this.render();
  }

  collapseAll() {
    const setExpanded = (node, val) => { node.expanded = val; node.children.forEach(c => setExpanded(c, val)); };
    this.root.children.forEach(c => setExpanded(c, false));
    this.render();
  }
}
