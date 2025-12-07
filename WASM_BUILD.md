# Building 42 for WebAssembly

This document describes how to build the 42 spacecraft dynamics simulator for WebAssembly (WASM).

## Prerequisites

1. **Emscripten SDK**: Install the Emscripten compiler toolchain
   ```bash
   # Download and install Emscripten
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk
   ./emsdk install latest
   ./emsdk activate latest
   source ./emsdk_env.sh  # On Windows: emsdk_env.bat
   ```

2. Verify installation:
   ```bash
   emcc --version
   ```

## Building

### Quick Build

From the project root directory:

```bash
make wasm
```

This will:
- Set the platform to WebAssembly
- Disable GUI features (not compatible with WASM)
- Compile all source files with `emcc`
- Generate `42.wasm` and `42.js` files

### Manual Build

To manually specify the platform:

```bash
make 42 42PLATFORM=__WASM__ GUIFLAG=
```

### Clean Build

To clean all build artifacts including WASM files:

```bash
make clean
```

## Output Files

After a successful build, you'll have:

- **42.wasm**: The WebAssembly binary module
- **42.js**: JavaScript glue code to load and interface with the WASM module
- **42.wasm.map**: Source map for debugging (optional)

## Running the WebAssembly Build

### Using the HTML Template

1. Copy the generated files to a web directory:
   ```bash
   cp 42.wasm 42.js 42.html /path/to/web/directory/
   ```

2. Serve the files with a local web server:
   ```bash
   # Python 3
   python3 -m http.server 8000

   # Python 2
   python -m SimpleHTTPServer 8000

   # Node.js (with http-server)
   npx http-server
   ```

3. Open your browser to `http://localhost:8000/42.html`

### Important Notes

**File System Access**: The WASM build uses Emscripten's virtual file system. You'll need to:
- Pre-load input files using `Module.FS.writeFile()` in JavaScript
- Mount the virtual filesystem with IDBFS for persistence (optional)

**Network Communication**: Traditional BSD sockets are not available in WebAssembly. For network features:
- Use WebSockets via JavaScript interop
- Implement JavaScript callbacks for IPC operations
- Consider using Emscripten's Fetch API for HTTP operations

**Performance**: WASM builds run near-native speed in modern browsers, but:
- First load may be slower due to compilation
- Browser security restrictions apply
- Memory is limited by browser constraints

## Limitations

The WebAssembly build has the following limitations:

1. **No GUI**: OpenGL/GLUT graphics are disabled
2. **No Network Sockets**: BSD sockets replaced with stubs (use WebSockets instead)
3. **Virtual File System**: All file I/O goes through Emscripten's virtual FS
4. **No Threading**: Multi-threading requires SharedArrayBuffer (browser support varies)

## Customization

### Emscripten Flags

Edit the `EMFLAGS` in the Makefile to customize:

```makefile
EMFLAGS = -s WASM=1 \
          -s ALLOW_MEMORY_GROWTH=1 \
          -s MODULARIZE=1 \
          -s EXPORT_NAME="Module42" \
          -s EXPORTED_FUNCTIONS='["_main"]' \
          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
          -s ENVIRONMENT=web \
          -s FORCE_FILESYSTEM=1 \
          -s TOTAL_MEMORY=256MB
```

Common customizations:
- Increase `TOTAL_MEMORY` for larger simulations
- Add `-O3` for optimized builds
- Add `--preload-file InOut@/InOut` to bundle input files
- Add `-s EXPORT_ALL=1` to export all C functions

### Memory Configuration

For larger simulations, increase memory:

```makefile
EMFLAGS += -s INITIAL_MEMORY=512MB -s MAXIMUM_MEMORY=1GB
```

## Debugging

### Enable Debug Mode

```bash
make wasm CFLAGS="-g4 -O0 -s ASSERTIONS=1 -s SAFE_HEAP=1"
```

### Browser Console

Check the browser console for:
- Compilation warnings
- Runtime errors
- Module loading issues

### Source Maps

Source maps are generated automatically. Enable them in browser DevTools to debug C code directly.

## Troubleshooting

**Problem**: `emcc: command not found`
- **Solution**: Source the Emscripten environment: `source /path/to/emsdk/emsdk_env.sh`

**Problem**: Out of memory errors
- **Solution**: Increase `TOTAL_MEMORY` in the Makefile

**Problem**: Files not found
- **Solution**: Pre-load files using `FS.writeFile()` or `--preload-file` flag

**Problem**: Slow compilation
- **Solution**: Use `-O0` for development, `-O3` for production

## Further Reading

- [Emscripten Documentation](https://emscripten.org/docs/)
- [WebAssembly.org](https://webassembly.org/)
- [Emscripten File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html)
