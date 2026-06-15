/**
 * FileBrowser — TreeView-based file browser for MEMFS directories.
 *
 * Shows /InOut/ and /Model/ as root folders. Double-click a file to
 * open it in an editor tab. Lazy-loads subdirectories on expand.
 */

import { TreeView } from '../widgets/TreeView.js';

const ICONS = {
   dir:  '\u{1F4C1}',  /* folder */
   txt:  '\u{1F4C4}',  /* document */
   csv:  '\u{1F4CA}',  /* chart */
   obj:  '\u{1F4E6}',  /* package (3D model) */
   default: '\u{1F4C3}', /* page */
};

function iconFor(name, isDir) {
   if (isDir) return ICONS.dir;
   const ext = name.split('.').pop().toLowerCase();
   return ICONS[ext] || ICONS.default;
}

export class FileBrowser {
   /**
    * @param {HTMLElement} containerEl - DOM element to render into
    * @param {Worker} worker - SimWorker instance
    * @param {object} callbacks
    * @param {Function} callbacks.onFileOpen - (path) => void
    */
   constructor(containerEl, worker, callbacks = {}) {
      this.container = containerEl;
      this.worker = worker;
      this.onFileOpen = callbacks.onFileOpen || (() => {});
      this._ready = false;
      this._dirNodes = new Map(); /* path -> tree node */

      this.tree = new TreeView(this.container, {
         onDblClick: (node) => this._onDblClick(node),
      });

      /* Create root folder nodes */
      this._inoutNode = this.tree.addNode(this.tree.root, 'InOut', {
         type: 'dir', path: '/InOut', isDir: true, expanded: true,
      }, ICONS.dir);

      this._modelNode = this.tree.addNode(this.tree.root, 'Model', {
         type: 'dir', path: '/Model', isDir: true, expanded: false,
      }, ICONS.dir);

      this._dirNodes.set('/InOut', this._inoutNode);
      this._dirNodes.set('/Model', this._modelNode);

      this.tree.render();
   }

   setWorker(worker) {
      this.worker = worker;
      this._ready = false;
      /* Clear children but keep root nodes */
      this.tree.clearChildren(this._inoutNode);
      this.tree.clearChildren(this._modelNode);
      this.tree.render();
   }

   setReady() {
      this._ready = true;
      /* Request listing of the default expanded directory */
      this.worker.postMessage({ type: 'LIST_DIR', path: '/InOut' });
   }

   /** Handle DIR_LIST response from Worker */
   onDirList(path, entries) {
      const parentNode = this._dirNodes.get(path);
      if (!parentNode) return;

      this.tree.clearChildren(parentNode);

      for (const entry of entries) {
         const fullPath = path.replace(/\/$/, '') + '/' + entry.name;
         const node = this.tree.addNode(parentNode, entry.name, {
            type: entry.isDir ? 'dir' : 'file',
            path: fullPath,
            isDir: entry.isDir,
            expanded: false,
         }, iconFor(entry.name, entry.isDir));

         if (entry.isDir) {
            this._dirNodes.set(fullPath, node);
         }
      }

      this.tree.render();
   }

   _onDblClick(node) {
      if (!node.data) return;

      if (node.data.type === 'file') {
         this.onFileOpen(node.data.path);
      } else if (node.data.type === 'dir') {
         /* If expanding and children not loaded, request listing */
         if (node.expanded && node.children.length === 0 && this._ready) {
            this.worker.postMessage({ type: 'LIST_DIR', path: node.data.path });
         }
      }
   }
}
