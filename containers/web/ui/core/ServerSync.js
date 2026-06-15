/**
 * ServerSync.js — Client-side wrapper for the server file API.
 *
 * Provides async methods to read/write/list files on the server's
 * mounted InOut/ directory. All methods handle errors gracefully
 * and never throw — they return { success, error? } objects.
 *
 * If no InOut/ volume is mounted in the container, `available` is
 * false and all write/sync operations are no-ops.
 */

export class ServerSync {
   constructor(sessionId, sessionTs) {
      this.available = false;
      this.sessionId = sessionId || '';
      this.sessionTs = sessionTs || '';
      this._baseUrl = '/api/files';
   }

   /**
    * Check if server-side file sync is available.
    * @returns {Promise<boolean>}
    */
   async checkAvailability() {
      try {
         const res = await fetch(`${this._baseUrl}/status`, {
            headers: { 'X-Session-ID': this.sessionId, 'X-Session-TS': this.sessionTs },
         });
         if (res.ok) {
            const data = await res.json();
            this.available = data.available === true;
         } else {
            this.available = false;
         }
      } catch (e) {
         this.available = false;
      }
      return this.available;
   }

   /**
    * Write a single file to the server.
    * @param {string} relPath - Relative path within InOut/ (e.g. 'Inp_Sim.txt')
    * @param {string} content - File content as UTF-8 text
    * @returns {Promise<{success: boolean, error?: string}>}
    */
   async writeFile(relPath, content) {
      if (!this.available) return { success: false, error: 'Sync unavailable' };
      try {
         const res = await fetch(`${this._baseUrl}/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': this.sessionId, 'X-Session-TS': this.sessionTs },
            body: JSON.stringify({ path: relPath, content }),
         });
         const data = await res.json();
         return { success: data.success === true, error: data.error };
      } catch (e) {
         return { success: false, error: e.message };
      }
   }

   /**
    * Bulk-write multiple files to the server.
    * @param {Array<{path: string, content: string}>} files
    * @returns {Promise<{success: boolean, written?: string[], errors?: Array, error?: string}>}
    */
   async syncFiles(files) {
      if (!this.available) return { success: false, error: 'Sync unavailable' };
      if (!files || files.length === 0) return { success: true, written: [] };
      try {
         const res = await fetch(`${this._baseUrl}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-ID': this.sessionId, 'X-Session-TS': this.sessionTs },
            body: JSON.stringify({ files }),
         });
         return await res.json();
      } catch (e) {
         return { success: false, error: e.message };
      }
   }

   /**
    * Convert a MEMFS absolute path to a relative path for the server API.
    * e.g. '/InOut/Inp_Sim.txt' → 'Inp_Sim.txt'
    * @param {string} memfsPath
    * @returns {string}
    */
   toRelPath(memfsPath) {
      return memfsPath.replace(/^\/InOut\/?/, '');
   }
}
