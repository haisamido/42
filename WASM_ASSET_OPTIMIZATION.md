# WebAssembly Asset Bundle Optimization

## Current Situation

The 42 simulator's WebAssembly build includes a **384 MB asset bundle** (`42.Model`) containing the Model/ directory. This creates a large initial download for users.

**File Breakdown:**
- Model directory: 384 MB
  - Noise3DTex.raw: 64 MB (3D noise texture)
  - Astronomical data files (ascp*.430/440): 6 files × 29 MB = 174 MB
  - 3D models (67P.obj, Phobos.obj, etc.): ~60 MB
  - Textures and sky maps: ~86 MB
- InOut directory: 100 KB

## Why This Matters

1. **Initial Load Time**: Users must download 384 MB before the simulation starts
2. **Browser Memory**: Large preloaded files can cause memory issues
3. **Mobile Devices**: May fail to load on devices with limited RAM
4. **Network Costs**: Expensive on metered connections

## Optimization Strategies

### 1. Lazy Loading (Recommended)

Load assets on-demand rather than preloading everything.

**Implementation:**
```javascript
// In 42.html, add asset loader
async function loadAssetOnDemand(path) {
    const response = await fetch(`/Model/${path}`);
    const data = await response.arrayBuffer();
    FS.writeFile(`/Model/${path}`, new Uint8Array(data));
}
```

**Makefile changes:**
```makefile
# Remove --preload-file Model@/Model
# Keep only essential files preloaded
EMFLAGS = ... --preload-file InOut@/InOut \
          --preload-file Model/minimal@/Model/minimal
```

### 2. Create Minimal Model Directory

Create `Model/minimal/` with only essential files for basic simulation:
- Essential spacecraft models (< 10 MB)
- Required configuration files
- Basic textures

**To implement:**
```bash
mkdir Model/minimal
# Copy only essential files
cp Model/Inp_*.txt Model/minimal/
cp Model/*Simple*.obj Model/minimal/
# ~10-20 MB total
```

### 3. Use IndexedDB Caching (IDBFS)

Cache assets in browser's IndexedDB after first load.

**Makefile addition:**
```makefile
EMFLAGS += -lidbfs.js
```

**JavaScript in 42.html:**
```javascript
// Mount IDBFS for persistent storage
FS.mkdir('/ModelCache');
FS.mount(IDBFS, {}, '/ModelCache');

// Sync from IndexedDB on startup
FS.syncfs(true, function(err) {
    // Assets loaded from cache
});

// Sync to IndexedDB after loading
FS.syncfs(false, function(err) {
    // Assets cached for next time
});
```

### 4. Serve from CDN

Host the 42.Model file on a CDN with proper caching headers.

**Benefits:**
- Parallel downloads
- Geographic distribution
- Browser caching
- Reduced server load

### 5. Split Asset Bundle

Create multiple smaller `.data` files:
```makefile
--preload-file Model/core@/Model/core       # 50 MB - essential files
--preload-file Model/textures@/Model/tex    # 100 MB - load on demand
--preload-file Model/models@/Model/models   # 100 MB - load on demand
--preload-file Model/astro@/Model/astro     # 134 MB - load on demand
```

### 6. Compress Assets

The current `--use-preload-cache` flag enables caching but doesn't compress.

**Add compression:**
```makefile
EMFLAGS += --preload-file Model@/Model \
           --use-preload-cache \
           --compression=gzip
```

This reduces the download size by ~60-80% while keeping the same files.

## Immediate Actions Taken

✅ **Added** `-Wno-unused-but-set-variable` to suppress compilation warnings
✅ **Added** `--use-preload-cache` flag for browser caching
✅ **Added** comments in Makefile documenting the issue
✅ **Fixed** UNITV divide-by-zero warnings with magnitude checks

## Recommended Next Steps

1. **Short-term** (for testing):
   - Current setup works but requires good internet connection
   - Browser caching (`--use-preload-cache`) helps on subsequent loads

2. **Medium-term** (for deployment):
   - Create `Model/minimal/` with essential files (~20 MB)
   - Implement lazy loading for non-essential assets
   - Add compression with `--compression=gzip`

3. **Long-term** (for production):
   - Host assets on CDN
   - Implement IDBFS for persistent caching
   - Create progressive loading UI showing download progress
   - Consider creating multiple simulation "profiles" (LEO, GEO, Deep Space) with different asset bundles

## References

- [Emscripten File System Guide](https://emscripten.org/docs/api_reference/Filesystem-API.html)
- [Synchronous Execution and Filesystem Access](https://hacks.mozilla.org/2015/02/synchronous-execution-and-filesystem-access-in-emscripten/)
- [Emscripten Optimization](https://emscripten.org/docs/optimizing/Optimizing-Code.html)
