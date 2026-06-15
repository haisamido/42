/**
 * FileEditor.js — Text editor panel for InOut/ config files.
 *
 * Opens in a main-content tab. Provides line numbers, Save, and Save & Run.
 * Adapted from gmat-ui's script editor pattern.
 */

export class FileEditor {
   /**
    * @param {string} filePath - MEMFS path like '/InOut/Inp_Sim.txt'
    * @param {string} content - Initial file content
    * @param {object} callbacks
    * @param {Function} callbacks.onSave - (path, content) => void
    * @param {Function} callbacks.onSaveAndRun - (path, content) => void
    */
   constructor(filePath, content, callbacks = {}) {
      this._path = filePath;
      this._onSave = callbacks.onSave || (() => {});
      this._onSaveAndRun = callbacks.onSaveAndRun || (() => {});
      this._dirty = false;

      this._el = document.createElement('div');
      this._el.className = 'file-editor-wrap';
      this._el.innerHTML = `
         <div class="file-editor-toolbar">
            <span class="file-path">${this._escapeHtml(filePath)}</span>
            <span class="spacer"></span>
            <span class="dirty-indicator"></span>
            <button class="tb-btn btn-save">Save</button>
            <button class="tb-btn btn-save-run" style="background:var(--green);color:var(--crust)">Save &amp; Run</button>
         </div>
         <div class="file-editor-container">
            <div class="file-line-numbers"></div>
            <textarea class="file-textarea" spellcheck="false" wrap="off"></textarea>
         </div>
      `;

      this._textarea = this._el.querySelector('.file-textarea');
      this._lineNumbers = this._el.querySelector('.file-line-numbers');
      this._dirtyEl = this._el.querySelector('.dirty-indicator');

      this._textarea.value = content;
      this._updateLineNumbers();

      this._textarea.addEventListener('input', () => {
         this._dirty = true;
         this._dirtyEl.textContent = '\u25CF'; /* filled circle = unsaved */
         this._updateLineNumbers();
      });

      this._textarea.addEventListener('scroll', () => {
         this._lineNumbers.scrollTop = this._textarea.scrollTop;
      });

      /* Tab inserts spaces */
      this._textarea.addEventListener('keydown', (e) => {
         if (e.key === 'Tab') {
            e.preventDefault();
            const start = this._textarea.selectionStart;
            const end = this._textarea.selectionEnd;
            this._textarea.value =
               this._textarea.value.substring(0, start) +
               '   ' +
               this._textarea.value.substring(end);
            this._textarea.selectionStart = this._textarea.selectionEnd = start + 3;
            this._textarea.dispatchEvent(new Event('input'));
         }
         /* Ctrl+S to save */
         if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            this._save();
         }
      });

      this._el.querySelector('.btn-save').addEventListener('click', () => this._save());
      this._el.querySelector('.btn-save-run').addEventListener('click', () => this._saveAndRun());
   }

   get el() { return this._el; }

   getContent() { return this._textarea.value; }

   setContent(text) {
      this._textarea.value = text;
      this._dirty = false;
      this._dirtyEl.textContent = '';
      this._updateLineNumbers();
   }

   _save() {
      this._onSave(this._path, this._textarea.value);
      this._dirty = false;
      this._dirtyEl.textContent = '';
   }

   _saveAndRun() {
      this._onSaveAndRun(this._path, this._textarea.value);
      this._dirty = false;
      this._dirtyEl.textContent = '';
   }

   _updateLineNumbers() {
      const lines = this._textarea.value.split('\n').length;
      let html = '';
      for (let i = 1; i <= lines; i++) {
         html += `<div class="line-number">${i}</div>`;
      }
      this._lineNumbers.innerHTML = html;
   }

   _escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
   }
}
