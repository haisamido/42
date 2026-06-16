/* 42wasm_unbuf.h — Redirect fopen to unbuffered wrapper for WASM.     */
/* Force-included via -include flag so every source file uses it.       */
/* This ensures all fprintf output goes directly to MEMFS, bypassing   */
/* musl's stdio buffering which is unreliable in Emscripten.           */
/* See: https://github.com/emscripten-core/emscripten/issues/7360     */

#ifndef _42WASM_UNBUF_H
#define _42WASM_UNBUF_H

#include <stdio.h>

FILE *_42w_fopen_unbuf(const char *, const char *);
#define fopen(p, m) _42w_fopen_unbuf(p, m)

#endif
