/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#include "42.h"
#include <time.h>
#include <unistd.h>

#ifndef _WIN32
#include <pthread.h>
#include <sys/select.h>
#endif

#include "iokit.h"  /* For CONN_STATUS_* constants and non-blocking socket functions */

#ifdef _ENABLE_GMSEC_
   #include "gmseckit.h"
   GMSEC_Config cfg;
   GMSEC_ConnectionMgr ConnMgr;
   GMSEC_Status status;
   void WriteToGmsec(GMSEC_ConnectionMgr ConnMgr,GMSEC_Status status);
   void ReadFromGmsec(GMSEC_ConnectionMgr ConnMgr,GMSEC_Status status);
#endif

/* #ifdef __cplusplus
** namespace _42 {
** using namespace Kit;
** #endif
*/

void WriteToFile(FILE *StateFile, char **Prefix, long Nprefix, long EchoEnabled);
void WriteToSocket(SOCKET Socket,  char **Prefix, long Nprefix, long EchoEnabled);
void ReadFromFile(FILE *StateFile, long EchoEnabled);
void ReadFromSocket(SOCKET Socket, long EchoEnabled);

/**********************************************************************/
/* Thread argument structure for parallel socket initialization       */
/**********************************************************************/
struct IpcInitArg {
   struct IpcType *I;
   long Iipc;
   char FileName[80];
};

#ifndef _WIN32
/**********************************************************************/
/* Thread function for initializing a single IPC connection           */
/**********************************************************************/
void *InitSingleIPC(void *arg)
{
      struct IpcInitArg *A = (struct IpcInitArg *)arg;
      struct IpcType *I = A->I;
      long Iipc = A->Iipc;

      if (I->Mode == IPC_TX || I->Mode == IPC_RX || I->Mode == IPC_TXRX) {
         const char *ModeStr = (I->Mode == IPC_TX) ? "TX" :
                               (I->Mode == IPC_RX) ? "RX" : "TXRX";
         if (I->SocketRole == IPC_SERVER) {
            /* Non-blocking server setup - creates listening socket */
            int ListenSock;
            if (InitSocketServerNonBlocking(I->Port, &ListenSock) == 0) {
               I->ListenSocket = ListenSock;
               I->ConnStatus = CONN_STATUS_PENDING;
               printf("IPC[%ld] Mode is %s, server waiting for client (%s:%ld)\n",
                      Iipc, ModeStr, I->HostName, I->Port);
            } else {
               I->ConnStatus = CONN_STATUS_FAILED;
               printf("IPC[%ld] Mode is %s, server setup FAILED (%s:%ld)\n",
                      Iipc, ModeStr, I->HostName, I->Port);
            }
         }
         else if (I->SocketRole == IPC_CLIENT) {
            /* Non-blocking client setup - initiates connection */
            I->Socket = InitSocketClientNonBlocking(I->HostName, I->Port);
            if (I->Socket >= 0) {
               I->ConnStatus = CONN_STATUS_PENDING;
               printf("IPC[%ld] Mode is %s, client connecting to server (%s:%ld)\n",
                      Iipc, ModeStr, I->HostName, I->Port);
            } else {
               I->ConnStatus = CONN_STATUS_FAILED;
               printf("IPC[%ld] Mode is %s, client connection FAILED (%s:%ld)\n",
                      Iipc, ModeStr, I->HostName, I->Port);
            }
         }
         #ifdef _ENABLE_GMSEC_
         else if (I->SocketRole == IPC_GMSEC_CLIENT) {
            /* GMSEC connections remain synchronous */
            status = statusCreate();
            cfg = configCreate();
            ConnMgr = ConnectToMBServer(I->HostName, I->Port, status, cfg);
            if (I->Mode == IPC_TX)
               connectionManagerSubscribe(ConnMgr, "GMSEC.42.RX.>", status);
            else if (I->Mode == IPC_RX)
               connectionManagerSubscribe(ConnMgr, "GMSEC.42.TX.>", status);
            else
               connectionManagerSubscribe(ConnMgr, "GMSEC.42.TXRX.>", status);
            CheckGmsecStatus(status);
            I->ConnStatus = CONN_STATUS_CONNECTED;
         }
         #endif
         else {
            printf("Unknown SocketRole %ld for IPC[%ld]\n", I->SocketRole, Iipc);
            I->ConnStatus = CONN_STATUS_FAILED;
         }
      }
      else if (I->Mode == IPC_WRITEFILE) {
         I->File = FileOpen(InOutPath, A->FileName, "wt");
         I->ConnStatus = CONN_STATUS_CONNECTED;
         printf("IPC[%ld] Mode is WRITEFILE, opened %s for writing\n", Iipc, A->FileName);
      }
      else if (I->Mode == IPC_READFILE) {
         I->File = FileOpen(InOutPath, A->FileName, "rt");
         I->ConnStatus = CONN_STATUS_CONNECTED;
         printf("IPC[%ld] Mode is READFILE, opened %s for reading\n", Iipc, A->FileName);
      }
      else if (I->Mode == IPC_FFTB) {
         I->SocketRole = IPC_CLIENT;
         I->Socket = InitSocketClientNonBlocking(I->HostName, I->Port);
         if (I->Socket >= 0) {
            I->ConnStatus = CONN_STATUS_PENDING;
            printf("IPC[%ld] Mode is FFTB, client connecting to server (%s:%ld)\n",
                   Iipc, I->HostName, I->Port);
         } else {
            I->ConnStatus = CONN_STATUS_FAILED;
            printf("IPC[%ld] Mode is FFTB, client connection FAILED (%s:%ld)\n",
                   Iipc, I->HostName, I->Port);
         }
      }
      else {
         /* Mode is OFF or unknown - skip this IPC entry */
         printf("IPC[%ld] Mode is OFF, skipping (%s:%ld)\n", Iipc, I->HostName, I->Port);
         I->ConnStatus = CONN_STATUS_CONNECTED; /* Mark as "done" so it doesn't block */
      }

      I->Init = 1;
      return NULL;
}
#endif /* !_WIN32 */

/*********************************************************************/
/* Check and complete pending connections (non-blocking)             */
/*********************************************************************/
int CheckPendingConnections(void)
{
      struct IpcType *I;
      long Iipc;
      int AllConnected = 1;
      int status;

      for (Iipc = 0; Iipc < Nipc; Iipc++) {
         I = &IPC[Iipc];

         if (I->ConnStatus == CONN_STATUS_PENDING) {
            AllConnected = 0;

            if (I->SocketRole == IPC_SERVER) {
               /* Check for incoming client connection */
               SOCKET ClientSock;
               status = AcceptClientNonBlocking(I->ListenSocket, &ClientSock);
               if (status == CONN_STATUS_CONNECTED) {
                  I->Socket = ClientSock;
                  I->ConnStatus = CONN_STATUS_CONNECTED;
                  printf("IPC[%ld] server connection established on port %ld\n", Iipc, I->Port);
               } else if (status == CONN_STATUS_FAILED) {
                  I->ConnStatus = CONN_STATUS_FAILED;
                  printf("IPC[%ld] server connection failed on port %ld\n", Iipc, I->Port);
               }
            }
            else if (I->SocketRole == IPC_CLIENT) {
               /* Check if client connect() completed */
               status = CheckConnectComplete(I->Socket);
               if (status == CONN_STATUS_CONNECTED) {
                  I->ConnStatus = CONN_STATUS_CONNECTED;
                  printf("IPC[%ld] client connection established to %s:%ld\n", Iipc, I->HostName, I->Port);
               } else if (status == CONN_STATUS_FAILED) {
                  I->ConnStatus = CONN_STATUS_FAILED;
                  printf("IPC[%ld] client connection failed to %s:%ld\n", Iipc, I->HostName, I->Port);
               }
            }
         }
      }

      return AllConnected;
}

/*********************************************************************/
void InitInterProcessComm(void)
{
      FILE *infile;
      char junk[120], newline, response[120];
      struct IpcType *I;
      long Iipc, Ipx;
      char FileName[80], Prefix[80];

#ifndef _WIN32
      pthread_t *threads;
      struct IpcInitArg *Args;
#endif

      infile = FileOpen(InOutPath, "Inp_IPC.txt", "rt");
      fscanf(infile, "%[^\n] %[\n]", junk, &newline);
      fscanf(infile, "%ld %[^\n] %[\n]", &Nipc, junk, &newline);
      IPC = (struct IpcType *) calloc(Nipc, sizeof(struct IpcType));

#ifndef _WIN32
      threads = (pthread_t *) calloc(Nipc, sizeof(pthread_t));
      Args = (struct IpcInitArg *) calloc(Nipc, sizeof(struct IpcInitArg));
#endif

      /* Phase 1: Parse config and launch threads for socket initialization */
      for (Iipc = 0; Iipc < Nipc; Iipc++) {
         I = &IPC[Iipc];
         fscanf(infile, "%[^\n] %[\n]", junk, &newline);
         fscanf(infile, "%s %[^\n] %[\n]", response, junk, &newline);
         I->Mode = DecodeString(response);
         fscanf(infile, "\"%[^\"]\" %[^\n] %[\n]", FileName, junk, &newline);
         fscanf(infile, "%s %[^\n] %[\n]", response, junk, &newline);
         I->SocketRole = DecodeString(response);
         fscanf(infile, "%s %ld %[^\n] %[\n]", I->HostName, &I->Port, junk, &newline);
         fscanf(infile, "%s %[^\n] %[\n]", response, junk, &newline);
         I->AllowBlocking = DecodeString(response);
         fscanf(infile, "%s %[^\n] %[\n]", response, junk, &newline);
         I->EchoEnabled = DecodeString(response);
         fscanf(infile, "%ld %[^\n] %[\n]", &I->Nprefix, junk, &newline);
         I->Prefix = (char **) calloc(I->Nprefix, sizeof(char *));
         for (Ipx = 0; Ipx < I->Nprefix; Ipx++) {
            fscanf(infile, "\"%[^\"]\" %[^\n] %[\n]", Prefix, junk, &newline);
            I->Prefix[Ipx] = (char *) calloc(strlen(Prefix)+1, sizeof(char));
            strcpy(I->Prefix[Ipx], Prefix);
         }

         I->ConnStatus = CONN_STATUS_PENDING;
         I->ListenSocket = -1;
         I->Socket = -1;

#ifndef _WIN32
         /* Set up thread argument and launch thread */
         Args[Iipc].I = I;
         Args[Iipc].Iipc = Iipc;
         strcpy(Args[Iipc].FileName, FileName);
         pthread_create(&threads[Iipc], NULL, InitSingleIPC, &Args[Iipc]);
#else
         /* Windows: fall back to sequential initialization */
         I->Init = 1;
         if (I->Mode == IPC_TX || I->Mode == IPC_RX || I->Mode == IPC_TXRX) {
            if (I->SocketRole == IPC_SERVER) {
               I->Socket = InitSocketServer(I->Port, I->AllowBlocking);
               I->ConnStatus = CONN_STATUS_CONNECTED;
            }
            else if (I->SocketRole == IPC_CLIENT) {
               I->Socket = InitSocketClient(I->HostName, I->Port, I->AllowBlocking);
               I->ConnStatus = CONN_STATUS_CONNECTED;
            }
         }
         else if (I->Mode == IPC_WRITEFILE) {
            I->File = FileOpen(InOutPath, FileName, "wt");
            I->ConnStatus = CONN_STATUS_CONNECTED;
         }
         else if (I->Mode == IPC_READFILE) {
            I->File = FileOpen(InOutPath, FileName, "rt");
            I->ConnStatus = CONN_STATUS_CONNECTED;
         }
         else if (I->Mode == IPC_FFTB) {
            I->SocketRole = IPC_CLIENT;
            I->Socket = InitSocketClient(I->HostName, I->Port, I->AllowBlocking);
            I->ConnStatus = CONN_STATUS_CONNECTED;
         }
         else {
            /* Mode is OFF or unknown - skip this IPC entry */
            printf("IPC[%ld] Mode is OFF, skipping (%s:%ld)\n", Iipc, I->HostName, I->Port);
            I->ConnStatus = CONN_STATUS_CONNECTED; /* Mark as "done" so it doesn't block */
         }
#endif
      }
      fclose(infile);

#ifndef _WIN32
      /* Phase 2: Wait for all threads to complete initial setup */
      for (Iipc = 0; Iipc < Nipc; Iipc++) {
         pthread_join(threads[Iipc], NULL);
      }
      free(threads);
      free(Args);

      /* Phase 3: Poll for pending connections to complete */
      printf("Waiting for all connections to establish...\n");
      while (!CheckPendingConnections()) {
         usleep(10000); /* 10ms polling interval */
      }
      printf("All IPC connections established.\n");
#endif
}
/*********************************************************************/
/* Use select() for non-blocking, order-insensitive I/O               */
/*********************************************************************/
void InterProcessComm(void)
{
      struct IpcType *I;
      long Iipc;
      fd_set readfds, writefds;
      int maxfd = -1;
      struct timeval tv;
      int result;

      /* Skip if no IPC connections */
      if (Nipc == 0) return;

      FD_ZERO(&readfds);
      FD_ZERO(&writefds);

      /* Phase 1: Build fd_sets for all sockets that need I/O */
      for (Iipc = 0; Iipc < Nipc; Iipc++) {
         I = &IPC[Iipc];

         /* Skip if not connected or not a socket mode */
         if (I->ConnStatus != CONN_STATUS_CONNECTED) continue;
         if (I->SocketRole == IPC_GMSEC_CLIENT) continue;
         if (I->Mode == IPC_WRITEFILE || I->Mode == IPC_READFILE) continue;
         if (I->Mode == IPC_OFF) continue;  /* Skip OFF entries */
         if (I->Socket < 0) continue;  /* Skip invalid sockets */

         if (I->Mode == IPC_TX || I->Mode == IPC_TXRX) {
            FD_SET(I->Socket, &writefds);
            if (I->Socket > maxfd) maxfd = I->Socket;
         }
         if (I->Mode == IPC_RX || I->Mode == IPC_TXRX) {
            FD_SET(I->Socket, &readfds);
            if (I->Socket > maxfd) maxfd = I->Socket;
         }
         if (I->Mode == IPC_FFTB) {
            FD_SET(I->Socket, &writefds);
            if (I->Socket > maxfd) maxfd = I->Socket;
         }
      }

      /* Non-blocking check: timeout = 0 */
      tv.tv_sec = 0;
      tv.tv_usec = 0;

      if (maxfd >= 0) {
         result = select(maxfd + 1, &readfds, &writefds, NULL, &tv);
         if (result < 0) {
            printf("Error in select(): %s\n", strerror(errno));
            return;
         }
      }

      /* Phase 2: Process ready sockets (order-insensitive) */
      for (Iipc = 0; Iipc < Nipc; Iipc++) {
         I = &IPC[Iipc];

         if (I->ConnStatus != CONN_STATUS_CONNECTED) continue;
         if (I->Mode == IPC_OFF) continue;  /* Skip OFF entries */
         if (I->Socket < 0) continue;  /* Skip invalid sockets */

         if (I->Mode == IPC_TX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               if (FD_ISSET(I->Socket, &writefds)) {
                  WriteToSocket(I->Socket, I->Prefix, I->Nprefix, I->EchoEnabled);
               }
            }
            #ifdef _ENABLE_GMSEC_
            else {
               WriteToGmsec(ConnMgr, status, I->Prefix, I->Nprefix, I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_RX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               if (FD_ISSET(I->Socket, &readfds)) {
                  ReadFromSocket(I->Socket, I->EchoEnabled);
               }
            }
            #ifdef _ENABLE_GMSEC_
            else {
               ReadFromGmsec(ConnMgr, status, I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_TXRX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               if (FD_ISSET(I->Socket, &writefds)) {
                  WriteToSocket(I->Socket, I->Prefix, I->Nprefix, I->EchoEnabled);
               }
               if (FD_ISSET(I->Socket, &readfds)) {
                  ReadFromSocket(I->Socket, I->EchoEnabled);
               }
            }
            #ifdef _ENABLE_GMSEC_
            else {
               WriteToGmsec(ConnMgr, status, I->Prefix, I->Nprefix, I->EchoEnabled);
               ReadFromGmsec(ConnMgr, status, I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_WRITEFILE) {
            //WriteToFile(I->File, I->Prefix, I->Nprefix, I->EchoEnabled);
         }
         else if (I->Mode == IPC_READFILE) {
            //ReadFromFile(I->File, I->EchoEnabled);
         }
         #ifdef _ENABLE_FFTB_CODE_
         else if (I->Mode == IPC_FFTB) {
            if (FD_ISSET(I->Socket, &writefds)) {
               SendStatesToSpirent();
            }
         }
         #endif
      }
}

/* #ifdef __cplusplus
** }
** #endif
*/
