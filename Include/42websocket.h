/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#ifndef __42WEBSOCKET_H__
#define __42WEBSOCKET_H__

#ifdef __WASM__

#include <emscripten.h>
#include <emscripten/websocket.h>

/*
** WebSocket adapter for 42
** Provides BSD socket-like API over WebSockets for browser compatibility
*/

/* WebSocket handle type - compatible with SOCKET type */
typedef EMSCRIPTEN_WEBSOCKET_T WS_SOCKET;

/* WebSocket connection states */
typedef enum {
    WS_CONNECTING = 0,
    WS_OPEN = 1,
    WS_CLOSING = 2,
    WS_CLOSED = 3
} WebSocketState;

/* WebSocket connection info */
typedef struct {
    WS_SOCKET socket;
    WebSocketState state;
    char url[256];
    char *recv_buffer;
    int recv_buffer_size;
    int recv_buffer_used;
    int is_blocking;
} WebSocketConnection;

/* Initialize WebSocket system */
void InitWebSocketSystem(void);

/* Create WebSocket connection (client mode) */
WS_SOCKET InitWebSocketClient(const char *hostname, int port, int allow_blocking);

/* Create WebSocket server (not directly supported in browser, returns error) */
WS_SOCKET InitWebSocketServer(int port, int allow_blocking);

/* Send data over WebSocket */
int WebSocketSend(WS_SOCKET ws, const void *buffer, int length);

/* Receive data from WebSocket */
int WebSocketRecv(WS_SOCKET ws, void *buffer, int length);

/* Close WebSocket connection */
void WebSocketClose(WS_SOCKET ws);

/* Check if WebSocket is ready for I/O */
int WebSocketIsReady(WS_SOCKET ws);

/* WebSocket event callbacks */
EM_BOOL WebSocket_OnOpen(int eventType, const EmscriptenWebSocketOpenEvent *event, void *userData);
EM_BOOL WebSocket_OnClose(int eventType, const EmscriptenWebSocketCloseEvent *event, void *userData);
EM_BOOL WebSocket_OnError(int eventType, const EmscriptenWebSocketErrorEvent *event, void *userData);
EM_BOOL WebSocket_OnMessage(int eventType, const EmscriptenWebSocketMessageEvent *event, void *userData);

/* Utility functions */
WebSocketConnection* GetWebSocketConnection(WS_SOCKET ws);
void CleanupWebSocketSystem(void);

#endif /* __WASM__ */

#endif /* __42WEBSOCKET_H__ */
