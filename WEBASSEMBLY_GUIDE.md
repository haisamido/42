# 42 WebAssembly Build Guide

## WebGL and WebSocket Support

This guide covers the WebAssembly build of 42 with WebGL graphics and WebSocket networking support.

## Features

### WebGL Graphics
- **OpenGL ES 3.0 compatibility** - Full WebGL 2.0 support via Emscripten
- **Hardware acceleration** - Runs in the browser with GPU acceleration
- **GLUT-compatible API** - Seamless integration with existing 42 graphics code
- **Canvas-based rendering** - Renders to HTML5 canvas element

### WebSocket Networking
- **BSD socket compatibility layer** - Wrapper over WebSockets for IPC
- **Asynchronous communication** - Non-blocking network operations
- **Binary and text support** - Handles both data types
- **Browser-safe** - Works within browser security constraints

## Building for WebAssembly

### Prerequisites
```bash
# Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Build Commands

#### Build with WebGL support:
```bash
make wasm
```

This command:
1. Cleans the project
2. Builds with `42PLATFORM=__WASM__`
3. Enables GUI flag for WebGL
4. Enables shader support

#### Complete workflow (build and serve):
```bash
make web-all
```

This command:
1. Cleans the project
2. Builds WebAssembly with WebGL
3. Stops any running web server
4. Starts a new web server on port 8000

#### Server management:
```bash
make web-up    # Start HTTP server
make web-down  # Stop HTTP server
```

## File Structure

### New Files Added

**WebGL Support:**
- `Include/42webgl.h` - WebGL compatibility header
- `Source/42webgl.c` - WebGL adapter implementation
- Updated `Kit/Include/glkit.h` - Added WASM support

**WebSocket Support:**
- `Include/42websocket.h` - WebSocket wrapper header
- `Source/42websocket.c` - WebSocket implementation
- Updated `Kit/Source/iokit.c` - Integrated WebSocket support

**Web Interface:**
- `42.html` - Enhanced HTML interface with WebGL canvas

## Architecture

### WebGL Adapter

The WebGL adapter provides a compatibility layer between OpenGL/GLUT and WebGL:

```c
// GLUT functions are mapped to WebGL equivalents
#define glutSwapBuffers()     webgl_glutSwapBuffers()
#define glutPostRedisplay()   webgl_glutPostRedisplay()
#define gluPerspective(...)   webgl_gluPerspective(...)
```

**Key features:**
- Event handling (mouse, keyboard, resize)
- Canvas management
- WebGL context creation
- Render loop management

### WebSocket Wrapper

The WebSocket wrapper provides BSD socket-like API over WebSockets:

```c
// Socket functions work transparently
SOCKET InitSocketClient(hostname, port, blocking)
SOCKET InitSocketServer(port, blocking)  // Requires external server
int WebSocketSend(socket, buffer, length)
int WebSocketRecv(socket, buffer, length)
```

**Limitations:**
- Server mode not supported in browser (requires separate WebSocket server)
- Asynchronous by nature (blocking mode simulated)
- Subject to browser security policies (CORS, mixed content)

## HTML Interface

The enhanced `42.html` provides:

### Layout
- **Left Panel** - Controls and output
- **Right Panel** - WebGL canvas for 3D visualization

### Features
- File upload for input files (InOut/ directory)
- Real-time simulation output
- WebGL canvas with overlay info
- Modern dark theme UI

### Canvas
```html
<canvas id="canvas" width="800" height="600"></canvas>
```

The canvas element is automatically bound to Emscripten's WebGL context.

## Emscripten Configuration

### Build Flags
```makefile
EMFLAGS = -s WASM=1 \
          -s ALLOW_MEMORY_GROWTH=1 \
          -s MODULARIZE=1 \
          -s EXPORT_NAME="Module42" \
          -s EXPORTED_FUNCTIONS='["_main"]' \
          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS"]' \
          -s FORCE_FILESYSTEM=1 \
          -s INITIAL_MEMORY=256MB \
          -s INVOKE_RUN=0 \
          -s USE_WEBGL2=1 \
          -s FULL_ES3=1 \
          --preload-file Model@/Model
```

### Key Settings
- `USE_WEBGL2=1` - Enable WebGL 2.0 support
- `FULL_ES3=1` - Full OpenGL ES 3.0 features
- `MODULARIZE=1` - Export as Module factory function
- `INVOKE_RUN=0` - Don't auto-run main()
- `--preload-file` - Package Model directory (384 MB)

## Usage

### Running the Simulation

1. **Build the project:**
   ```bash
   make web-all
   ```

2. **Open in browser:**
   ```
   http://localhost:8000/42.html
   ```

3. **Upload input files (optional):**
   - Click "Upload Input Files"
   - Select files from your `InOut/` directory
   - Files are uploaded to virtual filesystem at `/InOut/`

4. **Run simulation:**
   - Click "🚀 Run Simulation"
   - Watch output in the terminal panel
   - See 3D visualization in the WebGL canvas

### Input File Configuration

The default `Inp_Sim.txt` has graphics enabled:
```
TRUE                       ! Graphics Front-End?
```

You can upload custom input files to override defaults.

## WebSocket Networking

### Client Mode

To connect to a WebSocket server:

```javascript
// JavaScript WebSocket server needed
const ws = new WebSocket('ws://localhost:8080');
```

In 42 code:
```c
SOCKET sock = InitSocketClient("localhost", 8080, 0);
// Automatically uses WebSockets in WASM build
```

### Server Mode

Browser cannot create WebSocket servers. Options:

1. **Node.js WebSocket server:**
```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
```

2. **External WebSocket-to-TCP bridge**
3. **Use client mode only**

## Debugging

### Browser Console

Check browser developer console for:
- WebGL initialization messages
- WebSocket connection status
- JavaScript errors
- Performance metrics

### Common Issues

**WebGL not initializing:**
- Check browser WebGL support: https://get.webgl.org/
- Verify canvas element exists
- Check console for GL errors

**Files not loading:**
- Ensure Model directory is packaged: `42.Model` file exists
- Check virtual filesystem in console: `FS.readdir('/')`
- Verify file paths use forward slashes

**WebSocket connection fails:**
- Check CORS headers on WebSocket server
- Use `ws://` not `wss://` for localhost (unless using HTTPS)
- Verify server is running and reachable

**Memory errors:**
- Increase `INITIAL_MEMORY` in Makefile
- Enable `ALLOW_MEMORY_GROWTH`
- Check for memory leaks in C code

## Performance

### Optimization Tips

1. **Reduce Model size** - Preload only needed files
2. **Optimize graphics** - Reduce poly count, texture sizes
3. **Use SharedArrayBuffer** - For multithreading (requires secure context)
4. **Enable compression** - Server gzip/brotli compression

### Expected Performance

- **Load time:** 5-15 seconds (384 MB Model data)
- **Frame rate:** 30-60 FPS (depends on scene complexity)
- **Memory usage:** 300-500 MB
- **Network:** WebSockets add ~10-20ms latency vs raw TCP

## Limitations

### Browser Constraints
- No direct socket access (WebSockets only)
- CORS restrictions for cross-origin requests
- File system is virtual (MEMFS)
- No multi-threading without SharedArrayBuffer

### WebGL Constraints
- OpenGL ES 3.0 subset (not full OpenGL)
- Some extensions may not be available
- Performance varies by browser/GPU

### Emscripten Constraints
- Single-threaded by default
- Asynchronous I/O model
- 32-bit addressing (4 GB limit)

## Advanced Topics

### Custom WebGL Shaders

Shaders work the same as native OpenGL:
```c
#ifdef _USE_SHADERS_
GLuint shader = TextToShader(code, GL_VERTEX_SHADER, "MyShader");
#endif
```

### Virtual Filesystem

Access Emscripten's virtual filesystem:
```javascript
// JavaScript
FS.writeFile('/InOut/custom.txt', data);
let content = FS.readFile('/InOut/output.txt', {encoding: 'utf8'});
```

### WebWorkers

For background processing (requires PTHREAD support):
```makefile
EMFLAGS += -pthread -s USE_PTHREADS=1
```

## References

- [Emscripten Documentation](https://emscripten.org/docs/)
- [WebGL 2.0 Specification](https://www.khronos.org/registry/webgl/specs/latest/2.0/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [42 Spacecraft Simulator](https://github.com/ericstoneking/42)

## Troubleshooting

### Build Errors

**"emcc: command not found"**
```bash
source /path/to/emsdk/emsdk_env.sh
```

**"cannot find -lGLESv2"**
- Emscripten provides this automatically, check EMFLAGS

**Undefined reference to WebGL functions**
- Ensure `__WASM__` is defined
- Check includes in glkit.h

### Runtime Errors

**"Cannot enlarge memory arrays"**
- Add `-s ALLOW_MEMORY_GROWTH=1`
- Or increase `-s INITIAL_MEMORY=`

**"GL_INVALID_OPERATION"**
- Check WebGL state machine
- Verify context is current
- Check shader compilation

**WebSocket "Connection refused"**
- Verify server is running
- Check port number matches
- Test with browser dev tools Network tab

## Support

For issues specific to WebAssembly build:
1. Check browser console for errors
2. Verify Emscripten version compatibility
3. Test with minimal example
4. Report issues with full error messages

## License

Same as 42: Public Domain (US Government Work)
