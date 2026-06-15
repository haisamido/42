/**
 * TabManager.js — Tab bar management for 42 Web UI
 *
 * Manages the main content area tabs (3D View, file editors, etc.)
 * Adapted from gmat-ui UITabManager.js.
 */

export class TabManager {
  constructor(barEl, contentEl) {
    this.barEl = barEl;
    this.contentEl = contentEl;
    this.tabs = new Map();
    this.activeId = null;
    this._onTabClick = null;
    this._onTabClose = null;
  }

  addTab(id, label, contentEl, closeable = true, meta = {}, icon = null) {
    if (this.tabs.has(id)) { this.activate(id); return id; }
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    if (icon) {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'tab-icon';
      iconSpan.textContent = icon;
      btn.appendChild(iconSpan);
      btn.appendChild(document.createTextNode(label));
    } else {
      btn.textContent = label;
    }
    btn.addEventListener('click', () => {
      this.activate(id);
      if (this._onTabClick) this._onTabClick(id);
    });
    if (closeable) {
      const x = document.createElement('span');
      x.className = 'tab-close';
      x.textContent = '\u00D7';
      x.addEventListener('click', e => { e.stopPropagation(); this.close(id); });
      btn.appendChild(x);
    }
    this.barEl.appendChild(btn);

    contentEl.classList.add('tab-panel');
    contentEl.style.display = 'none';
    this.contentEl.appendChild(contentEl);

    this.tabs.set(id, { label, contentEl, btn, closeable, meta });
    this.activate(id);
    return id;
  }

  activate(id) {
    for (const [tid, tab] of this.tabs) {
      const active = tid === id;
      tab.btn.classList.toggle('active', active);
      tab.contentEl.style.display = active ? 'flex' : 'none';
      tab.contentEl.classList.toggle('active', active);
    }
    this.activeId = id;
    if (this._onTabActivate) this._onTabActivate(id);
  }

  close(id) {
    const tab = this.tabs.get(id);
    if (!tab || !tab.closeable) return;
    tab.btn.remove();
    tab.contentEl.remove();
    this.tabs.delete(id);
    if (this.activeId === id) {
      const keys = [...this.tabs.keys()];
      if (keys.length > 0) this.activate(keys[keys.length - 1]);
    }
    if (this._onTabClose) this._onTabClose(id, this.activeId);
  }

  has(id) { return this.tabs.has(id); }

  getTab(id) { return this.tabs.get(id); }

  setTabLabel(id, label) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.label = label;
    const btn = tab.btn;
    for (const child of btn.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent = label;
        return;
      }
    }
    const iconSpan = btn.querySelector('.tab-icon');
    if (iconSpan) {
      iconSpan.after(document.createTextNode(label));
    } else {
      btn.prepend(document.createTextNode(label));
    }
  }

  getActiveTabId() { return this.activeId; }

  closeTab(id) { this.close(id); }

  closeAll() {
    for (const id of [...this.tabs.keys()]) {
      const tab = this.tabs.get(id);
      if (tab && tab.closeable) this.close(id);
    }
  }

  set onTabActivate(callback) { this._onTabActivate = callback; }
  get onTabActivate() { return this._onTabActivate; }

  onTabClick(callback) { this._onTabClick = callback; }
  onTabClose(callback) { this._onTabClose = callback; }
}
