/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#ifdef __WASM__

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "42websocket.h"

/* Maximum number of concurrent WebSocket connections */
#define MAX_WEBSOCKETS 16

/* Global WebSocket connection pool */
static WebSocketConnection ws_connections[MAX_WEBSOCKETS];
static int ws_initialized = 0;

/*********************************************************************/
void InitWebSocketSystem(void)
{
    if (ws_initialized) return;

    memset(ws_connections, 0, sizeof(ws_connections));
    for (int i = 0; i < MAX_WEBSOCKETS; i++) {
        ws_connections[i].socket = -1;
        ws_connections[i].state = WS_CLOSED;
    }
    ws_initialized = 1;
    printf("WebSocket system initialized\n");
}

/*********************************************************************/
WebSocketConnection* GetWebSocketConnection(WS_SOCKET ws)
{
    if (!ws_initialized) InitWebSocketSystem();

    for (int i = 0; i < MAX_WEBSOCKETS; i++) {
        if (ws_connections[i].socket == ws) {
            return &ws_connections[i];
        }
    }
    return NULL;
}

/*********************************************************************/
static WebSocketConnection* AllocateWebSocketConnection(void)
{
    if (!ws_initialized) InitWebSocketSystem();

    for (int i = 0; i < MAX_WEBSOCKETS; i++) {
        if (ws_connections[i].socket == -1) {
            ws_connections[i].recv_buffer_size = 65536;
            ws_connections[i].recv_buffer = (char*)malloc(ws_connections[i].recv_buffer_size);
            ws_connections[i].recv_buffer_used = 0;
            return &ws_connections[i];
        }
    }
    return NULL;
}

/*********************************************************************/
WS_SOCKET InitWebSocketClient(const char *hostname, int port, int allow_blocking)
{
    WebSocketConnection *conn = AllocateWebSocketConnection();
    if (!conn) {
        printf("Error: Maximum WebSocket connections reached\n");
        return -1;
    }

    /* Construct WebSocket URL */
    /* Note: In production, should detect ws:// vs wss:// based on page protocol */
    snprintf(conn->url, sizeof(conn->url), "ws://%s:%d", hostname, port);

    /* Create WebSocket attributes */
    EmscriptenWebSocketCreateAttributes attrs;
    emscripten_websocket_init_create_attributes(&attrs);
    attrs.url = conn->url;

    /* Create WebSocket */
    WS_SOCKET ws = emscripten_websocket_new(&attrs);
    if (ws < 0) {
        printf("Failed to create WebSocket to %s\n", conn->url);
        free(conn->recv_buffer);
        conn->socket = -1;
        return -1;
    }

    conn->socket = ws;
    conn->state = WS_CONNECTING;
    conn->is_blocking = allow_blocking;

    /* Set up event handlers */
    emscripten_websocket_set_onopen_callback(ws, conn, WebSocket_OnOpen);
    emscripten_websocket_set_onclose_callback(ws, conn, WebSocket_OnClose);
    emscripten_websocket_set_onerror_callback(ws, conn, WebSocket_OnError);
    emscripten_websocket_set_onmessage_callback(ws, conn, WebSocket_OnMessage);

    printf("WebSocket client connecting to %s\n", conn->url);
    return ws;
}

/*********************************************************************/
WS_SOCKET InitWebSocketServer(int port, int allow_blocking)
{
    /* WebSocket servers cannot be created in browser context */
    /* This would require a separate WebSocket server running outside the browser */
    printf("Error: WebSocket server mode not supported in browser\n");
    printf("Please use a Node.js or native WebSocket server instead\n");
    return -1;
}

/*********************************************************************/
EM_BOOL WebSocket_OnOpen(int eventType, const EmscriptenWebSocketOpenEvent *event, void *userData)
{
    WebSocketConnection *conn = (WebSocketConnection*)userData;
    conn->state = WS_OPEN;
    printf("WebSocket connected to %s\n", conn->url);
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebSocket_OnClose(int eventType, const EmscriptenWebSocketCloseEvent *event, void *userData)
{
    WebSocketConnection *conn = (WebSocketConnection*)userData;
    conn->state = WS_CLOSED;
    printf("WebSocket closed (code=%d, reason=%s)\n", event->code, event->reason);
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebSocket_OnError(int eventType, const EmscriptenWebSocketErrorEvent *event, void *userData)
{
    WebSocketConnection *conn = (WebSocketConnection*)userData;
    printf("WebSocket error on connection to %s\n", conn->url);
    conn->state = WS_CLOSED;
    return EM_TRUE;
}

/*********************************************************************/
EM_BOOL WebSocket_OnMessage(int eventType, const EmscriptenWebSocketMessageEvent *event, void *userData)
{
    WebSocketConnection *conn = (WebSocketConnection*)userData;

    if (event->isText) {
        /* Handle text message */
        int bytes_to_copy = event->numBytes;
        if (conn->recv_buffer_used + bytes_to_copy > conn->recv_buffer_size) {
            /* Buffer full, expand or drop */
            int new_size = conn->recv_buffer_size * 2;
            char *new_buffer = (char*)realloc(conn->recv_buffer, new_size);
            if (new_buffer) {
                conn->recv_buffer = new_buffer;
                conn->recv_buffer_size = new_size;
            } else {
                printf("Warning: WebSocket receive buffer full, dropping data\n");
                return EM_TRUE;
            }
        }

        memcpy(conn->recv_buffer + conn->recv_buffer_used, event->data, bytes_to_copy);
        conn->recv_buffer_used += bytes_to_copy;
    } else {
        /* Handle binary message */
        int bytes_to_copy = event->numBytes;
        if (conn->recv_buffer_used + bytes_to_copy > conn->recv_buffer_size) {
            int new_size = conn->recv_buffer_size * 2;
            char *new_buffer = (char*)realloc(conn->recv_buffer, new_size);
            if (new_buffer) {
                conn->recv_buffer = new_buffer;
                conn->recv_buffer_size = new_size;
            } else {
                printf("Warning: WebSocket receive buffer full, dropping data\n");
                return EM_TRUE;
            }
        }

        memcpy(conn->recv_buffer + conn->recv_buffer_used, event->data, bytes_to_copy);
        conn->recv_buffer_used += bytes_to_copy;
    }

    return EM_TRUE;
}

/*********************************************************************/
int WebSocketSend(WS_SOCKET ws, const void *buffer, int length)
{
    WebSocketConnection *conn = GetWebSocketConnection(ws);
    if (!conn || conn->state != WS_OPEN) {
        printf("Error: WebSocket not connected\n");
        return -1;
    }

    /* Send as binary data */
    EMSCRIPTEN_RESULT result = emscripten_websocket_send_binary(ws, (void*)buffer, length);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        printf("Error: WebSocket send failed (%d)\n", result);
        return -1;
    }

    return length;
}

/*********************************************************************/
int WebSocketRecv(WS_SOCKET ws, void *buffer, int length)
{
    WebSocketConnection *conn = GetWebSocketConnection(ws);
    if (!conn) {
        return -1;
    }

    if (conn->state != WS_OPEN) {
        return 0;
    }

    /* Return data from receive buffer */
    if (conn->recv_buffer_used == 0) {
        /* No data available */
        if (conn->is_blocking) {
            /* In blocking mode, we would wait, but WebSockets are async */
            /* Return 0 to indicate no data yet */
            return 0;
        }
        return 0;
    }

    int bytes_to_copy = (length < conn->recv_buffer_used) ? length : conn->recv_buffer_used;
    memcpy(buffer, conn->recv_buffer, bytes_to_copy);

    /* Remove copied data from buffer */
    if (bytes_to_copy < conn->recv_buffer_used) {
        memmove(conn->recv_buffer, conn->recv_buffer + bytes_to_copy,
                conn->recv_buffer_used - bytes_to_copy);
    }
    conn->recv_buffer_used -= bytes_to_copy;

    return bytes_to_copy;
}

/*********************************************************************/
void WebSocketClose(WS_SOCKET ws)
{
    WebSocketConnection *conn = GetWebSocketConnection(ws);
    if (!conn) return;

    if (conn->state == WS_OPEN || conn->state == WS_CONNECTING) {
        emscripten_websocket_close(ws, 1000, "Normal closure");
        conn->state = WS_CLOSING;
    }

    if (conn->recv_buffer) {
        free(conn->recv_buffer);
        conn->recv_buffer = NULL;
    }

    emscripten_websocket_delete(ws);
    conn->socket = -1;
    conn->state = WS_CLOSED;
}

/*********************************************************************/
int WebSocketIsReady(WS_SOCKET ws)
{
    WebSocketConnection *conn = GetWebSocketConnection(ws);
    if (!conn) return 0;
    return (conn->state == WS_OPEN) ? 1 : 0;
}

/*********************************************************************/
void CleanupWebSocketSystem(void)
{
    for (int i = 0; i < MAX_WEBSOCKETS; i++) {
        if (ws_connections[i].socket != -1) {
            WebSocketClose(ws_connections[i].socket);
        }
    }
    ws_initialized = 0;
}

#endif /* __WASM__ */
