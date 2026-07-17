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

/*********************************************************************/
static void IpcDisconnect(struct IpcType *I, long Iipc)
{
      printf("IPC[%ld]: Disconnected (port %ld). ",Iipc,I->Port);
      CloseSocket(&I->Socket);
      I->Connected = FALSE;
      if (I->PollingEnabled)
         printf("Will attempt reconnection.\n");
      else
         printf("Channel disabled.\n");
}
/*********************************************************************/
static int IpcWriteToSocket(struct IpcType *I, long Iipc)
{
      int err = 0;
      socklen_t len = sizeof(err);

      if (getsockopt(I->Socket,SOL_SOCKET,SO_ERROR,(char *)&err,&len) < 0
          || err != 0) {
         IpcDisconnect(I,Iipc);
         return -1;
      }
      printf("IPC[%ld] TX %s:%ld\n",Iipc,I->HostName,I->Port);
      WriteToSocket(I->Socket,I->Prefix,I->Nprefix,I->EchoEnabled);
      if (getsockopt(I->Socket,SOL_SOCKET,SO_ERROR,(char *)&err,&len) < 0
          || err != 0) {
         IpcDisconnect(I,Iipc);
         return -1;
      }
      return 0;
}
/*********************************************************************/
static int IpcReadFromSocket(struct IpcType *I, long Iipc)
{
      int err = 0;
      socklen_t len = sizeof(err);

      if (getsockopt(I->Socket,SOL_SOCKET,SO_ERROR,(char *)&err,&len) < 0
          || err != 0) {
         IpcDisconnect(I,Iipc);
         return -1;
      }
      printf("IPC[%ld] RX %s:%ld\n",Iipc,I->HostName,I->Port);
      ReadFromSocket(I->Socket,I->EchoEnabled);
      if (getsockopt(I->Socket,SOL_SOCKET,SO_ERROR,(char *)&err,&len) < 0
          || err != 0) {
         IpcDisconnect(I,Iipc);
         return -1;
      }
      return 0;
}
/*********************************************************************/
/* Connect a socket channel (shared by TX, RX, TXRX init paths)     */
static void InitIpcSocket(struct IpcType *I, long Iipc)
{
      if (I->SocketRole == IPC_SERVER) {
         if (I->PollingEnabled) {
            I->Connected = FALSE;
            I->Socket = -1;
            I->ListenSocket = InitSocketServerNonBlocking(I->Port);
            I->ListenReady = (I->ListenSocket >= 0);
         }
         else {
            I->Socket = InitSocketServer(I->Port,I->AllowBlocking);
            I->Connected = TRUE;
         }
      }
      else if (I->SocketRole == IPC_CLIENT) {
         if (I->PollingEnabled) {
            I->Connected = FALSE;
            I->Socket = -1;
         }
         else {
            I->Socket = InitSocketClient(I->HostName,I->Port,I->AllowBlocking);
            I->Connected = TRUE;
         }
      }
      #ifdef _ENABLE_GMSEC_
      else if (I->SocketRole == IPC_GMSEC_CLIENT) {
         /* GMSEC does not support polling mode */
         status = statusCreate();
         cfg = configCreate();
         ConnMgr = ConnectToMBServer(I->HostName,I->Port,status,cfg);
         if (I->Mode == IPC_TX)
            connectionManagerSubscribe(ConnMgr,"GMSEC.42.RX.>",status);
         else if (I->Mode == IPC_RX)
            connectionManagerSubscribe(ConnMgr,"GMSEC.42.TX.>",status);
         else if (I->Mode == IPC_TXRX)
            connectionManagerSubscribe(ConnMgr,"GMSEC.42.TXRX.>",status);
         CheckGmsecStatus(status);
         I->Connected = TRUE;
      }
      #endif
      else {
         printf("Warning: Unknown SocketRole %ld for IPC[%ld]. Channel disabled.\n",
                I->SocketRole,Iipc);
         I->Mode = IPC_OFF;
      }
}
/*********************************************************************/
void InitInterProcessComm(void)
{
      FILE *infile;
      char junk[120],newline[4],response[120];
      struct IpcType *I;
      long Iipc,Ipx;
      char FileName[80],Prefix[80];

      infile = FileOpen(InOutPath,"Inp_IPC.txt","rt");
      fscanf(infile,"%[^\n] %[\n]",junk,newline);
      fscanf(infile,"%ld %[^\n] %[\n]",&Nipc,junk,newline);
      IPC = (struct IpcType *) calloc(Nipc,sizeof(struct IpcType));
      for(Iipc=0;Iipc<Nipc;Iipc++) {
         I = &IPC[Iipc];
         fscanf(infile,"%[^\n] %[\n]",junk,newline);
         fscanf(infile,"%s %[^\n] %[\n]",response,junk,newline);
         I->Mode = DecodeString(response);
         fscanf(infile,"\"%[^\"]\" %[^\n] %[\n]",FileName,junk,newline);
         fscanf(infile,"%s %[^\n] %[\n]",response,junk,newline);
         I->SocketRole = DecodeString(response);
         fscanf(infile,"%s %ld %[^\n] %[\n]",I->HostName,&I->Port,junk,newline);
         fscanf(infile,"%s %[^\n] %[\n]",response,junk,newline);
         I->AllowBlocking = DecodeString(response);
         fscanf(infile,"%s %[^\n] %[\n]",response,junk,newline);
         I->EchoEnabled = DecodeString(response);

         fscanf(infile,"%ld %[^\n] %[\n]",&I->Nprefix,junk,newline);
         I->Prefix = (char **) calloc(I->Nprefix,sizeof(char *));
         for(Ipx=0;Ipx<I->Nprefix;Ipx++) {
            fscanf(infile,"\"%[^\"]\" %[^\n] %[\n]",Prefix,junk,newline);
            I->Prefix[Ipx] = (char *) calloc(strlen(Prefix)+1,sizeof(char));
            strcpy(I->Prefix[Ipx],Prefix);
         }

         /* Peek ahead for optional PollingEnabled field (at end of block) */
         {
            long saved_pos = ftell(infile);
            char peek[120];
            if (fscanf(infile,"%s",peek) == 1) {
               if (!strcmp(peek,"TRUE") || !strcmp(peek,"FALSE")) {
                  I->PollingEnabled = DecodeString(peek);
                  /* Consume rest of line */
                  fscanf(infile,"%[^\n]",junk);
                  fscanf(infile,"%[\n]",newline);
               }
               else {
                  fseek(infile,saved_pos,SEEK_SET);
                  I->PollingEnabled = FALSE;
               }
            }
            else {
               fseek(infile,saved_pos,SEEK_SET);
               I->PollingEnabled = FALSE;
            }
         }

         I->Init = 1;

         if (I->Mode == IPC_TX || I->Mode == IPC_RX || I->Mode == IPC_TXRX) {
            InitIpcSocket(I,Iipc);
         }
         else if (I->Mode == IPC_WRITEFILE) {
            I->File = FileOpen(InOutPath,FileName,"wt");
         }
         else if (I->Mode == IPC_READFILE) {
            I->File = FileOpen(InOutPath,FileName,"rt");
         }
         else if (I->Mode == IPC_FFTB) {
            I->SocketRole = IPC_CLIENT; /* Spirent is Host */
            I->Socket = InitSocketClient(I->HostName,I->Port,I->AllowBlocking);
            I->Connected = TRUE;
         }
      }
      fclose(infile);
}
/*********************************************************************/
void InterProcessComm(void)
{
      struct IpcType *I;
      long Iipc;

      for(Iipc=0;Iipc<Nipc;Iipc++) {
         I = &IPC[Iipc];
         if (I->Mode == IPC_OFF) continue;

         /* Phase 1: Poll pending connections */
         if (I->PollingEnabled && !I->Connected) {
            if (I->SocketRole == IPC_SERVER && I->ListenReady) {
               SOCKET fd = AcceptSocketNonBlocking(I->ListenSocket,
                                                   I->AllowBlocking);
               if (fd >= 0) {
                  I->Socket = fd;
                  I->Connected = TRUE;
                  printf("IPC[%ld] SERVER: client connected on port %ld\n",
                         Iipc,I->Port);
               }
            }
            else if (I->SocketRole == IPC_CLIENT) {
               if (I->Socket < 0) {
                  /* No pending connection — start one */
                  I->Socket = InitSocketClientNonBlocking(I->HostName,I->Port,
                                                          I->AllowBlocking);
               }
               if (I->Socket >= 0) {
                  /* Check if non-blocking connect completed */
                  int rc = CheckSocketConnected(I->Socket,I->AllowBlocking);
                  if (rc == 1) {
                     I->Connected = TRUE;
                     printf("IPC[%ld] CLIENT: connected to %s:%ld\n",
                            Iipc,I->HostName,I->Port);
                  }
                  else if (rc == -1) {
                     CloseSocket(&I->Socket);
                     /* Will retry next step */
                  }
               }
            }
            continue; /* Wait one step before I/O */
         }

         if (!I->Connected) continue;

         /* Phase 2: Normal I/O with disconnect handling */
         if (I->Mode == IPC_TX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               IpcWriteToSocket(I,Iipc);
            }
            #ifdef _ENABLE_GMSEC_
            else {
               WriteToGmsec(ConnMgr,status,I->Prefix,I->Nprefix,I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_RX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               IpcReadFromSocket(I,Iipc);
            }
            #ifdef _ENABLE_GMSEC_
            else {
               ReadFromGmsec(ConnMgr,status,I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_TXRX) {
            if (I->SocketRole != IPC_GMSEC_CLIENT) {
               if (IpcWriteToSocket(I,Iipc) == 0)
                  IpcReadFromSocket(I,Iipc);
            }
            #ifdef _ENABLE_GMSEC_
            else {
               WriteToGmsec(ConnMgr,status,I->Prefix,I->Nprefix,I->EchoEnabled);
               ReadFromGmsec(ConnMgr,status,I->EchoEnabled);
            }
            #endif
         }
         else if (I->Mode == IPC_WRITEFILE) {
            //WriteToFile(I->File,I->Prefix,I->Nprefix,I->EchoEnabled);
         }
         else if (I->Mode == IPC_READFILE) {
            //ReadFromFile(I->File,I->EchoEnabled);
         }
         #ifdef _ENABLE_FFTB_CODE_
         else if (I->Mode == IPC_FFTB) {
            SendStatesToSpirent();
         }
         #endif
      }
}
/*********************************************************************/
void CleanupInterProcessComm(void)
{
      struct IpcType *I;
      long Iipc,Ipx;

      for(Iipc=0;Iipc<Nipc;Iipc++) {
         I = &IPC[Iipc];
         CloseSocket(&I->Socket);
         CloseSocket(&I->ListenSocket);
         if (I->File != NULL) {
            fclose(I->File);
            I->File = NULL;
         }
         for(Ipx=0;Ipx<I->Nprefix;Ipx++) {
            free(I->Prefix[Ipx]);
         }
         free(I->Prefix);
      }
      free(IPC);
      IPC = NULL;
      Nipc = 0;

#if defined(_WIN32)
      WSACleanup();
#endif
}

/* #ifdef __cplusplus
** }
** #endif
*/
