/**
 * PpmLoader.js — Load PPM (P6) and PGM (P5) image files for the 42 web UI.
 *
 * These are the texture formats used in 42's World/ and Model/ directories.
 * Supports binary PPM P6 (RGB) and PGM P5 (grayscale), both 8-bit and 16-bit.
 *
 * Usage:
 *   import { loadPpmTexture, loadPpmImageData } from './PpmLoader.js';
 *
 *   // For Three.js (WebGL texture):
 *   const texture = await loadPpmTexture('/api/files/raw/World/BlueMarble2.ppm');
 *
 *   // For Canvas2D:
 *   const imageData = await loadPpmImageData('/api/files/raw/World/BlueMarble2.ppm');
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* PPM/PGM binary parser                                               */
/* ------------------------------------------------------------------ */

/**
 * Parse a PPM (P6) or PGM (P5) binary buffer.
 * @param {ArrayBuffer} buffer — raw file contents
 * @returns {{ width: number, height: number, channels: number, data: Uint8Array }}
 */
export function parsePpm(buffer) {
   const bytes = new Uint8Array(buffer);
   let pos = 0;

   /** Skip whitespace characters and # comment lines. */
   function skipWsAndComments() {
      while (pos < bytes.length) {
         if (bytes[pos] === 0x23) { /* '#' — comment to end of line */
            while (pos < bytes.length && bytes[pos] !== 0x0A) pos++;
            if (pos < bytes.length) pos++;
         } else if (bytes[pos] <= 0x20) { /* whitespace */
            pos++;
         } else {
            break;
         }
      }
   }

   /** Read the next ASCII token (delimited by whitespace). */
   function readToken() {
      skipWsAndComments();
      let token = '';
      while (pos < bytes.length && bytes[pos] > 0x20) {
         token += String.fromCharCode(bytes[pos++]);
      }
      return token;
   }

   /* Header fields */
   const magic  = readToken();
   const width  = parseInt(readToken(), 10);
   const height = parseInt(readToken(), 10);
   const maxval = parseInt(readToken(), 10);

   /* Per Netpbm spec: exactly one whitespace byte separates header from data */
   if (pos < bytes.length && bytes[pos] <= 0x20) pos++;

   const channels = (magic === 'P6') ? 3 : 1;
   const bytesPerSample = (maxval > 255) ? 2 : 1;
   const pixelCount = width * height;
   const sampleCount = pixelCount * channels;
   const data = new Uint8Array(sampleCount);

   if (bytesPerSample === 1) {
      data.set(bytes.subarray(pos, pos + sampleCount));
   } else {
      /* 16-bit big-endian samples — scale to 8-bit */
      for (let i = 0; i < sampleCount; i++) {
         const hi = bytes[pos + i * 2];
         const lo = bytes[pos + i * 2 + 1];
         data[i] = Math.round(((hi << 8) | lo) * 255 / maxval);
      }
   }

   return { width, height, channels, data };
}

/* ------------------------------------------------------------------ */
/* Three.js DataTexture conversion                                     */
/* ------------------------------------------------------------------ */

/**
 * Convert a PPM/PGM ArrayBuffer to a Three.js DataTexture.
 * Handles RGB→RGBA expansion and vertical flip (PPM is top-down,
 * WebGL expects bottom-up).
 *
 * @param {ArrayBuffer} buffer
 * @returns {THREE.DataTexture}
 */
export function ppmToTexture(buffer) {
   const ppm = parsePpm(buffer);
   const { width: w, height: h, channels: ch, data } = ppm;
   const pixelCount = w * h;

   /* Expand to RGBA (Three.js deprecated RGBFormat) and flip vertically */
   const rgba = new Uint8Array(pixelCount * 4);

   for (let srcY = 0; srcY < h; srcY++) {
      const dstY = h - 1 - srcY; /* vertical flip */
      for (let x = 0; x < w; x++) {
         const si = (srcY * w + x) * ch;
         const di = (dstY * w + x) * 4;
         if (ch === 3) {
            rgba[di]     = data[si];
            rgba[di + 1] = data[si + 1];
            rgba[di + 2] = data[si + 2];
         } else {
            rgba[di] = rgba[di + 1] = rgba[di + 2] = data[si];
         }
         rgba[di + 3] = 255;
      }
   }

   const texture = new THREE.DataTexture(rgba, w, h);
   texture.format = THREE.RGBAFormat;
   texture.type = THREE.UnsignedByteType;
   texture.needsUpdate = true;
   texture.colorSpace = THREE.SRGBColorSpace;
   texture.minFilter = THREE.LinearFilter;
   texture.magFilter = THREE.LinearFilter;
   texture.wrapS = THREE.ClampToEdgeWrapping;
   texture.wrapT = THREE.ClampToEdgeWrapping;
   return texture;
}

/* ------------------------------------------------------------------ */
/* Canvas2D ImageData conversion                                       */
/* ------------------------------------------------------------------ */

/**
 * Convert a PPM/PGM ArrayBuffer to a Canvas2D ImageData.
 * PPM pixels are in top-down order, matching Canvas2D convention.
 *
 * @param {ArrayBuffer} buffer
 * @returns {ImageData}
 */
export function ppmToImageData(buffer) {
   const ppm = parsePpm(buffer);
   const imageData = new ImageData(ppm.width, ppm.height);
   const dst = imageData.data;

   for (let i = 0; i < ppm.width * ppm.height; i++) {
      if (ppm.channels === 3) {
         dst[i * 4]     = ppm.data[i * 3];
         dst[i * 4 + 1] = ppm.data[i * 3 + 1];
         dst[i * 4 + 2] = ppm.data[i * 3 + 2];
      } else {
         dst[i * 4] = dst[i * 4 + 1] = dst[i * 4 + 2] = ppm.data[i];
      }
      dst[i * 4 + 3] = 255;
   }

   return imageData;
}

/* ------------------------------------------------------------------ */
/* Async loaders (fetch + parse)                                       */
/* ------------------------------------------------------------------ */

/**
 * Fetch a PPM/PGM file from a URL and return a Three.js DataTexture.
 * @param {string} url
 * @returns {Promise<THREE.DataTexture>}
 */
export async function loadPpmTexture(url) {
   const res = await fetch(url);
   if (!res.ok) throw new Error(`PPM load failed: ${url} (${res.status})`);
   const buffer = await res.arrayBuffer();
   return ppmToTexture(buffer);
}

/**
 * Fetch a PPM/PGM file from a URL and return a Canvas2D ImageData.
 * @param {string} url
 * @returns {Promise<ImageData>}
 */
export async function loadPpmImageData(url) {
   const res = await fetch(url);
   if (!res.ok) throw new Error(`PPM load failed: ${url} (${res.status})`);
   const buffer = await res.arrayBuffer();
   return ppmToImageData(buffer);
}
