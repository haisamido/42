/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#ifndef __IOKIT_H__
#define __IOKIT_H__

/*
** #ifdef __cplusplus
** namespace Kit {
** #endif
*/

#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#ifdef _WIN32
   #include <winsock2.h>
   #include <ws2tcpip.h>
   #include <windows.h>
#else
   #include <sys/socket.h>
   #include <sys/select.h>
   #include <netinet/in.h>
   #include <netinet/tcp.h>
   #include <netdb.h>
   #include <pthread.h>
   /* Finesse winsock SOCKET datatype */
   #define SOCKET int
#endif
/* #include <sys/un.h> */

FILE *FileOpen(const char *Path, const char *File, const char *CtrlCode);
void ByteSwapDouble(double *A);
int FileToString(const char *file_name, char **result_string,
                 size_t *string_len);
double *PpmToPsf(const char *path, const char *filename, 
   long *width, long *height, long *BytesPerPixel);

SOCKET InitSocketServer(int Port, int AllowBlocking);
SOCKET InitSocketClient(const char *hostname, int Port, int AllowBlocking);

/* Non-blocking socket initialization for hybrid approach */
/* Connection status codes */
#define CONN_STATUS_PENDING    0
#define CONN_STATUS_CONNECTED  1
#define CONN_STATUS_FAILED    -1

/* Non-blocking server: creates listening socket, returns immediately */
SOCKET InitSocketServerNonBlocking(int Port, int *ListenSocket);
/* Check if a client has connected to server (non-blocking accept) */
int AcceptClientNonBlocking(SOCKET ListenSocket, SOCKET *ClientSocket);
/* Non-blocking client: initiates connection, returns immediately */
SOCKET InitSocketClientNonBlocking(const char *hostname, int Port);
/* Check if client connection completed */
int CheckConnectComplete(SOCKET sockfd);
/* Set socket to non-blocking mode */
void SetSocketNonBlocking(SOCKET sockfd);

/*
** #ifdef __cplusplus
** }
** #endif
*/

#endif /* __IOKIT_H__ */
