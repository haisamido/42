# Non-Blocking, Order-Insensitive IPC Implementation

This document describes the hybrid threading + select() approach implemented to make port connections non-blocking and order-insensitive in the 42 spacecraft simulation.

## Problem Statement

The original IPC implementation had two limitations:

1. **Blocking Connections**: Socket initialization (especially server `accept()`) would block the entire simulation until a client connected
2. **Order Sensitivity**: IPC connections were initialized and processed sequentially in array order, meaning:
   - Connection N+1 couldn't start until connection N completed
   - A slow or unavailable connection would block all subsequent connections

## Solution: Hybrid Approach

The implementation combines two techniques:

| Phase | Technique | Purpose |
|-------|-----------|---------|
| Initialization | **pthreads** | Parallel, non-blocking socket setup |
| I/O Operations | **select()** | Non-blocking, order-insensitive read/write |

## Files Modified

### 1. Kit/Include/iokit.h

Added includes and new function declarations:

```c
/* New includes */
#include <sys/select.h>  /* For select() */
#include <pthread.h>     /* For threading (Unix/Mac) */

/* Connection status codes */
#define CONN_STATUS_PENDING    0
#define CONN_STATUS_CONNECTED  1
#define CONN_STATUS_FAILED    -1

/* New function declarations */
SOCKET InitSocketServerNonBlocking(int Port, int *ListenSocket);
int AcceptClientNonBlocking(SOCKET ListenSocket, SOCKET *ClientSocket);
SOCKET InitSocketClientNonBlocking(const char *hostname, int Port);
int CheckConnectComplete(SOCKET sockfd);
void SetSocketNonBlocking(SOCKET sockfd);
```

### 2. Kit/Source/iokit.c

Added new non-blocking socket functions:

| Function | Description |
|----------|-------------|
| `SetSocketNonBlocking()` | Sets socket to non-blocking mode using `fcntl()` (Unix) or `ioctlsocket()` (Windows) |
| `InitSocketServerNonBlocking()` | Creates listening socket without blocking on `accept()` |
| `AcceptClientNonBlocking()` | Checks for pending client connections without blocking |
| `InitSocketClientNonBlocking()` | Initiates `connect()` without waiting for completion |
| `CheckConnectComplete()` | Uses `select()` to check if async `connect()` finished |

### 3. Include/42types.h

Extended `IpcType` structure with new fields:

```c
struct IpcType {
   /* ... existing fields ... */
   SOCKET ListenSocket;    /* For servers: stores listening socket while waiting */
   long ConnStatus;        /* CONN_STATUS_PENDING, CONNECTED, or FAILED */
   /* ... existing fields ... */
};
```

### 4. Source/42ipc.c

Rewrote `InitInterProcessComm()` and `InterProcessComm()`:

#### InitInterProcessComm() - Threaded Initialization

```
Phase 1: Parse config, launch one pthread per IPC connection
         Each thread calls InitSocketServerNonBlocking() or
         InitSocketClientNonBlocking()

Phase 2: pthread_join() all threads (quick, just setup)

Phase 3: Poll CheckPendingConnections() until all sockets
         report CONN_STATUS_CONNECTED
```

#### InterProcessComm() - select()-based I/O

```
Phase 1: Build fd_sets for all connected sockets
         - Add TX/TXRX sockets to writefds
         - Add RX/TXRX sockets to readfds

Phase 2: Call select() with timeout=0 (non-blocking)

Phase 3: Process only sockets that are ready
         - WriteToSocket() if FD_ISSET(writefds)
         - ReadFromSocket() if FD_ISSET(readfds)
```

## Architecture Diagram

```
                    INITIALIZATION PHASE
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │   Thread 0 ──► InitSocketServerNonBlocking(10001)  │
    │   Thread 1 ──► InitSocketClientNonBlocking(10002)  │
    │   Thread 2 ──► InitSocketServerNonBlocking(10003)  │
    │   ...          (all running in parallel)            │
    │                                                     │
    ├─────────────────────────────────────────────────────┤
    │   Polling Loop: CheckPendingConnections()          │
    │   - AcceptClientNonBlocking() for servers          │
    │   - CheckConnectComplete() for clients             │
    │   Until all ConnStatus == CONNECTED                │
    └─────────────────────────────────────────────────────┘

                    I/O PHASE (per simulation step)
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │   select(readfds, writefds, timeout=0)             │
    │           │                                         │
    │           ▼                                         │
    │   ┌───────────────────────────────────┐            │
    │   │ Socket 0: ready for write ──► TX  │            │
    │   │ Socket 1: not ready ──► skip      │            │
    │   │ Socket 2: ready for read ──► RX   │            │
    │   │ Socket 3: ready for both ──► TXRX │            │
    │   └───────────────────────────────────┘            │
    │                                                     │
    └─────────────────────────────────────────────────────┘
```

## Platform Support

| Platform | Initialization | I/O |
|----------|---------------|-----|
| Linux | pthreads + non-blocking sockets | select() |
| macOS | pthreads + non-blocking sockets | select() |
| Windows | Sequential fallback (original behavior) | select() |

Windows falls back to sequential initialization because pthreads are not natively available. The `select()`-based I/O still works on Windows.

## Benefits

1. **No Blocking**: Server sockets don't block waiting for clients
2. **Order Independence**: Connection N doesn't need to wait for N-1
3. **Fault Tolerance**: Failed connections don't block others
4. **Responsive I/O**: Only processes sockets that have data ready
5. **Backward Compatible**: Windows falls back to original behavior; GMSEC connections unchanged

## Mode=OFF Handling

IPC entries with `Mode = OFF` in `Inp_IPC.txt` are gracefully skipped during initialization. The system:

1. Detects the OFF mode during thread initialization
2. Marks the entry as "connected" internally (so it doesn't block other connections)
3. Prints an informative message showing which entry was skipped with its configured host and port

This allows configurations to define placeholder IPC entries that can be enabled later without blocking the simulation startup.

## Usage

No changes required to `Inp_IPC.txt` configuration. The new behavior is automatic on Unix/Mac platforms.

To verify the non-blocking behavior, observe the startup messages:

```
Server listening (non-blocking) on port 10001
Client initiating connection to localhost:10002 (non-blocking)
Server listening (non-blocking) on port 10003
Waiting for all connections to establish...
IPC[0] server connection established on port 10001
IPC[1] client connection established to localhost:10002
IPC[2] server connection established on port 10003
All IPC connections established.
```

When IPC entries have `Mode = OFF`, the output will show:

```text
IPC[0] Mode is OFF, skipping (localhost:10001)
IPC[1] Mode is OFF, skipping (localhost:10002)
IPC[2] Mode is OFF, skipping (localhost:10003)
IPC[3] Mode is OFF, skipping (localhost:10004)
Waiting for all connections to establish...
All IPC connections established.
```

## Bug Fixes

### Buffer Overflow Fix (TxRxIPC.c)

The original `WriteToSocket()` function used a 16KB message buffer which was insufficient when transmitting data with multiple prefixes (SC, Orb, World). With 65 worlds, 12 spacecraft, and multiple orbits, messages can exceed 30KB, causing a buffer overflow and SIGBUS crash.

**Fix**: Increased `IPC_MSG_BUFSIZE` from 16384 to 262144 (256KB) in `Source/AutoCode/TxRxIPC.c`.

### SIGPIPE Handling (42exec.c)

Added `signal(SIGPIPE, SIG_IGN)` in `exec()` to prevent crashes when writing to closed sockets. This allows socket operations to fail gracefully with errno=EPIPE instead of terminating the process.

## Test Client

A Python test client is provided in `Demo/ipc_client.py` for testing TX mode IPC connections:

```bash
# Start 42 simulation first, then run:
python3 Demo/ipc_client.py
```

The client connects to localhost:10001, receives telemetry data, and sends the required "Ack" response after each message.

## Message Buffer Size Analysis

### Background

The original `WriteToSocket()` function used a 16KB (16384 bytes) stack-allocated message buffer. This proved insufficient when transmitting telemetry with multiple prefixes (SC, Orb, World). Testing showed messages can reach 33KB+ with 65 worlds, 12 spacecraft, and multiple orbits, causing buffer overflow and SIGBUS crashes.

The buffer was increased to 256KB (262144 bytes) to accommodate large telemetry payloads.

### Pros

| Benefit | Description |
|---------|-------------|
| **Crash Prevention** | Eliminated SIGBUS (signal 10) crashes caused by buffer overflow |
| **Full Telemetry Support** | Supports all prefix combinations (SC, Orb, World) simultaneously |
| **Headroom** | 256KB provides ~7x margin over observed 33KB messages |
| **No API Changes** | Fix is internal; no changes to calling code or configuration |
| **Fast Allocation** | Stack allocation is faster than heap allocation |

### Cons

| Drawback | Description |
|----------|-------------|
| **Increased Stack Usage** | Each `WriteToSocket()` call consumes 256KB of stack space |
| **Memory Overhead** | Most messages use <50KB, leaving >200KB unused |
| **Platform Variability** | Default stack sizes vary by OS (typically 1-8MB) |
| **Recursive Risk** | Deep call stacks combined with large buffers may exhaust stack |

### Risks

| Risk | Severity | Likelihood |
|------|----------|------------|
| **Stack Overflow** | High | Low-Medium |
| Systems with limited stack size (embedded, threads with small stacks) may overflow | | |
| **AutoCode Overwrite** | Medium | Medium |
| `TxRxIPC.c` is in `Source/AutoCode/` and may be regenerated, reverting the fix | | |
| **Silent Truncation** | Medium | Low |
| Messages exceeding 256KB would still overflow (though unlikely with current data) | | |
| **Thread Stack Exhaustion** | Medium | Low |
| Threads often have smaller default stacks (512KB-1MB) than main thread | | |

### Mitigations

| Risk | Mitigation Strategy |
|------|---------------------|
| **Stack Overflow** | **Option A**: Convert to heap allocation using `malloc()`/`free()` |
| | **Option B**: Increase thread/process stack size via `ulimit -s` or `pthread_attr_setstacksize()` |
| | **Option C**: Use static buffer with mutex for thread safety |
| **AutoCode Overwrite** | Document the change prominently; add post-generation script to patch buffer size; consider moving `WriteToSocket()` to non-generated file |
| **Silent Truncation** | Add runtime check: `if (MsgLen > IPC_MSG_BUFSIZE) { log_error(); }` |
| **Thread Stack Exhaustion** | Explicitly set thread stack size to ≥2MB when creating IPC threads |

### Recommended Long-Term Fix

For production systems, consider replacing the stack buffer with heap allocation:

```c
void WriteToSocket(SOCKET Socket, char **Prefix, long Nprefix, long EchoEnabled)
{
    char *Msg = (char *)malloc(IPC_MSG_BUFSIZE);
    if (Msg == NULL) {
        fprintf(stderr, "WriteToSocket: Failed to allocate message buffer\n");
        return;
    }

    /* ... existing code using Msg ... */

    free(Msg);
}
```

This eliminates stack size concerns at the cost of slightly slower allocation.

## Known Risks

1. **Stack Memory**: Buffer increased to 256KB on stack in `WriteToSocket()`. Systems with limited stack size may need heap allocation instead.

2. **AutoCode Directory**: `TxRxIPC.c` is in `Source/AutoCode/` - if this file is auto-generated, the buffer fix may be overwritten on regeneration.

3. **Silent Socket Failures**: With SIGPIPE ignored, socket write failures return -1 instead of crashing. Code should check return values.

## Limitations

- Windows uses sequential initialization (no pthreads)
- GMSEC connections remain synchronous
- File-based IPC (WRITEFILE/READFILE) modes unchanged
