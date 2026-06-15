/**
 * FileBrowser — Browse and view Inp*.txt files from the WASM MEMFS filesystem.
 *
 * Shows a file list on the left and file content on the right (or below).
 * Files are read from the Worker via GET_FILES / LIST_DIR messages.
 */

export class FileBrowser {
   /**
    * @param {HTMLElement} containerEl - DOM element to render into
    * @param {Worker} worker - SimWorker instance for MEMFS access
    */
   constructor(containerEl, worker) {
      this.container = containerEl;
      this.worker = worker;
      this._files = [];
      this._selectedFile = null;
      this._ready = false;
      this._render();
   }

   _render() {
      this.container.innerHTML = `
         <div class="file-browser">
            <div class="file-browser-header">
               <h3>InOut Files</h3>
               <button id="btn-refresh-files" title="Refresh file list">Refresh</button>
            </div>
            <div class="file-browser-body">
               <ul id="file-list" class="file-list"></ul>
            </div>
         </div>
      `;

      this.listEl = this.container.querySelector('#file-list');
      this.container.querySelector('#btn-refresh-files')
         .addEventListener('click', () => this.requestFileList());
   }

   /** Replace the Worker reference (used after reset) */
   setWorker(worker) {
      this.worker = worker;
      this._ready = false;
      this._files = [];
      this._selectedFile = null;
      this._renderFileList();
   }

   /** Called when the Worker becomes ready */
   setReady() {
      this._ready = true;
      this.requestFileList();
   }

   /** Ask the Worker to list /InOut/ directory */
   requestFileList() {
      if (!this._ready) return;
      this.worker.postMessage({ type: 'LIST_DIR', path: '/InOut' });
   }

   /** Handle DIR_LIST response from Worker */
   onDirList(path, entries) {
      if (path !== '/InOut') return;

      this._files = entries
         .filter(e => !e.isDir && e.name.endsWith('.txt'))
         .map(e => e.name);

      this._renderFileList();
   }

   /** Handle FILES response from Worker */
   onFileContent(files) {
      for (const [path, content] of Object.entries(files)) {
         if (content !== null) {
            this._showFileContent(path, content);
         }
      }
   }

   _renderFileList() {
      this.listEl.innerHTML = '';

      for (const name of this._files) {
         const li = document.createElement('li');
         li.className = 'file-item';
         if (name === this._selectedFile) {
            li.classList.add('selected');
         }
         li.textContent = name;
         li.addEventListener('click', () => this._selectFile(name));
         this.listEl.appendChild(li);
      }
   }

   _selectFile(name) {
      this._selectedFile = name;
      this._renderFileList();
      this.worker.postMessage({ type: 'GET_FILES', paths: ['/InOut/' + name] });
   }

   _showFileContent(path, content) {
      const name = path.split('/').pop();

      /* Show in a modal overlay */
      let overlay = document.getElementById('file-viewer-overlay');
      if (!overlay) {
         overlay = document.createElement('div');
         overlay.id = 'file-viewer-overlay';
         overlay.className = 'file-viewer-overlay';
         document.body.appendChild(overlay);
      }

      overlay.innerHTML = `
         <div class="file-viewer">
            <div class="file-viewer-header">
               <span class="file-viewer-title">${name}</span>
               <button id="btn-close-viewer" title="Close">X</button>
            </div>
            <pre class="file-viewer-content">${this._escapeHtml(content)}</pre>
         </div>
      `;

      overlay.style.display = 'flex';
      overlay.querySelector('#btn-close-viewer')
         .addEventListener('click', () => { overlay.style.display = 'none'; });
      overlay.addEventListener('click', (e) => {
         if (e.target === overlay) overlay.style.display = 'none';
      });
   }

   _escapeHtml(text) {
      return text
         .replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;');
   }
}
