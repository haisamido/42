/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */


#include "iokit.h"

/* #ifdef __cplusplus
** namespace Kit {
** #endif
*/

/**********************************************************************/
FILE *FileOpen(const char *Path, const char *File, const char *CtrlCode)
{
      FILE *FilePtr;
      char FileName[1024];

      strcpy(FileName,Path);
      strcat(FileName,File);
      FilePtr=fopen(FileName,CtrlCode);
      if(FilePtr == NULL) {
         printf("Error opening %s: %s\n",FileName, strerror(errno));
         exit(1);
      }
      return(FilePtr);
}
/**********************************************************************/
void ByteSwapDouble(double *A)
{
      char fwd[8],bak[8];
      long i;

      memcpy(fwd,A,sizeof(double));
      for(i=0;i<8;i++) bak[i] = fwd[7-i];
      memcpy(A,bak,sizeof(double));
}
/**********************************************************************/
/*  This function cribbed from an OpenCL example                      */
/*  on the Apple developer site                                       */
int FileToString(const char *file_name, char **result_string,
                 size_t *string_len)
{
      int fd;
      size_t file_len;
      struct stat file_status;
      int ret;

      *string_len = 0;
      fd = open(file_name, O_RDONLY);
      if (fd == -1) {
          printf("Error opening file %s\n", file_name);
          return -1;
      }
      ret = fstat(fd, &file_status);
      if (ret) {
          printf("Error reading status for file %s\n", file_name);
          return -1;
      }
      file_len = file_status.st_size;

      *result_string = (char *) calloc(file_len + 1, sizeof(char));
      ret = read(fd, *result_string, file_len);
      if (!ret) {
          printf("Error reading from file %s\n", file_name);
          return -1;
      }
      if (ret > file_len) {
         printf("Error: Number of characters read (%d) exceeds expected file size (%d) for file %s\n",
                 ret,(int) file_len,file_name);
         return -1;
      }
      (*result_string)[ret]  = '\0';

      close(fd);

      *string_len = file_len;
      return 0;
}
/**********************************************************************/
double *PpmToPsf(const char *path, const char *filename, 
   long *width, long *height, long *BytesPerPixel)
{
      FILE *infile;
      long N,i;
      long Nh,Nw,Nb,junk;
      char format[20],comment[80];
      double *PSF;

      infile = FileOpen(path,filename,"rb");
      fscanf(infile,"%s\n%[^\n]\n",format,comment);
      if (!strcmp(format,"P6")) Nb = 3;
      else if (!strcmp(format,"P5")) Nb = 1;
      else {
         printf("Unknown format in PpmToImage.\n");
         exit(1);
      }
      fscanf(infile,"%ld %ld\n%ld\n",&Nw,&Nh,&junk);
      N = Nw*Nh*Nb;
      PSF = (double *) calloc(N,sizeof(double));
      if (PSF==NULL) {
         printf("Allocation failed in %s:%d\n",__FILE__,__LINE__);
         exit(1);
      }
      for(i=0;i<N;i++) {
         PSF[i] = ((double) fgetc(infile))/255.0;
      }
      fclose(infile);
      *width = Nw;
      *height = Nh;
      *BytesPerPixel = Nb;
      
      return(PSF);
}
/**********************************************************************/
SOCKET InitSocketServer(int Port, int AllowBlocking)
{
#if defined(_WIN32)

      WSADATA wsa;
      SOCKET init_sockfd,sockfd;
      u_long Blocking = 1;

      int clilen;
      struct sockaddr_in Server, Client;

      /* Initialize winsock */
      if (WSAStartup(MAKEWORD(2,2),&wsa) != 0) {
         printf("Error initializing winsock in InitSocketClient.\n");
         exit(1);
      }

      init_sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (init_sockfd < 0) {
         printf("Error opening server socket.\n");
         exit(1);
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      Server.sin_addr.s_addr = INADDR_ANY;
      Server.sin_port = htons(Port);
      if (bind(init_sockfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Error on binding server socket.\n");
         exit(1);
      }
      printf("Server is listening on port %i\n",Port);
      listen(init_sockfd,5);
      clilen = sizeof(Client);
      sockfd = accept(init_sockfd,(struct sockaddr *) &Client,&clilen);
      if (sockfd < 0) {
         printf("Error on accepting client socket.\n");
         exit(1);
      }
      printf("Server side of socket established.\n");
      closesocket(init_sockfd);

      /* Keep read() from waiting for message to come */
      if (!AllowBlocking) {
         /*flags = fcntl(sockfd, F_GETFL, 0);*/
         /*fcntl(sockfd,F_SETFL, flags|O_NONBLOCK);*/
         ioctlsocket(sockfd,FIONBIO,&Blocking);
      }
      
      /* Allow TCP to send small packets (look up Nagle's algorithm) */
      /* Depending on your message sizes, this may or may not improve performance */
      //setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,&DisableNagle,sizeof(DisableNagle));
      
      return(sockfd);
#else

      SOCKET init_sockfd,sockfd;
      int flags;
      socklen_t clilen;
      struct sockaddr_in Server, Client;
      int opt = 1;
      int DisableNagle = 1;

      init_sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (init_sockfd < 0) {
         printf("Error opening server socket.\n");
         exit(1);
      }
      
      /* Allowing reuse while in TIME_WAIT might make port available */
      /* more quickly after a socket has been broken */
      if (setsockopt(init_sockfd,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt)) == -1) {
        printf("Error setting socket option.\n");
        exit(1);
      }
      
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      Server.sin_addr.s_addr = INADDR_ANY;
      Server.sin_port = htons(Port);
      if (bind(init_sockfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Error on binding server socket.\n");
         exit(1);
      }
      printf("Server is listening on port %i\n",Port);
      listen(init_sockfd,5);
      clilen = sizeof(Client);
      sockfd = accept(init_sockfd,(struct sockaddr *) &Client,&clilen);
      if (sockfd < 0) {
         printf("Error on accepting client socket.\n");
         exit(1);
      }
      printf("Server side of socket established.\n");
      close(init_sockfd);

      /* Keep read() from waiting for message to come */
      if (!AllowBlocking) {
         flags = fcntl(sockfd, F_GETFL, 0);
         fcntl(sockfd,F_SETFL, flags|O_NONBLOCK);
      }

      /* Allow TCP to send small packets (look up Nagle's algorithm) */
      /* Depending on your message sizes, this may or may not improve performance */
      setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,&DisableNagle,sizeof(DisableNagle));

      return(sockfd);
#endif
}
/**********************************************************************/
SOCKET InitSocketClient(const char *hostname, int Port,int AllowBlocking)
{
#if defined(_WIN32)

      WSADATA wsa; /* winsock */
      SOCKET sockfd;
      u_long Blocking = 1;

      struct sockaddr_in Server;
      struct hostent *Host;

      /* Initialize winsock */
      if (WSAStartup(MAKEWORD(2,2),&wsa) != 0) {
         printf("Error initializing winsock in InitSocketClient.\n");
         exit(1);
      }
      sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (sockfd < 0) {
         printf("Error opening client socket.\n");
         exit(1);
      }
      Host = gethostbyname(hostname);
      if (Host == NULL) {
         printf("Server not found by client socket.\n");
         exit(1);
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      memcpy((char *)&Server.sin_addr.s_addr,(char *)Host->h_addr_list[0],
         Host->h_length);
      Server.sin_port = htons(Port);
      printf("Client connecting to Server on Port %i\n",Port);
      if (connect(sockfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Error connecting client socket: %s.\n",strerror(errno));
         exit(1);
      }
      printf("Client side of socket established.\n");

      /* Keep read() from waiting for message to come */
      if (!AllowBlocking) {
         /*flags = fcntl(sockfd, F_GETFL, 0);*/
         /*fcntl(sockfd,F_SETFL, flags|O_NONBLOCK);*/
         ioctlsocket(sockfd,FIONBIO,&Blocking);
      }

      return(sockfd);
#else
      SOCKET sockfd;
      int flags;
      struct sockaddr_in Server;
      struct hostent *Host;
      int DisableNagle = 1;

      sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (sockfd < 0) {
         printf("Error opening client socket.\n");
         exit(1);
      }
      Host = gethostbyname(hostname);
      if (Host == NULL) {
         printf("Server not found by client socket.\n");
         exit(1);
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      memcpy((char *)&Server.sin_addr.s_addr,(char *)Host->h_addr_list[0],
         Host->h_length);
      Server.sin_port = htons(Port);
      printf("Client connecting to Server on Port %i\n",Port);
      if (connect(sockfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Error connecting client socket: %s.\n",strerror(errno));
         exit(1);
      }
      printf("Client side of socket established.\n");

      /* Keep read() from waiting for message to come */
      if (!AllowBlocking) {
         flags = fcntl(sockfd, F_GETFL, 0);
         fcntl(sockfd,F_SETFL, flags|O_NONBLOCK);
      }

      /* Allow TCP to send small packets (look up Nagle's algorithm) */
      /* Depending on your message sizes, this may or may not improve performance */
      setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,&DisableNagle,sizeof(DisableNagle));

      return(sockfd);
#endif /* _WIN32 */
}
/**********************************************************************/
void CloseSocket(SOCKET *sockfd)
{
#if defined(_WIN32)
      if (*sockfd != INVALID_SOCKET) {
         closesocket(*sockfd);
         *sockfd = INVALID_SOCKET;
      }
#else
      if (*sockfd >= 0) {
         close(*sockfd);
         *sockfd = -1;
      }
#endif
}
/**********************************************************************/
SOCKET InitSocketServerNonBlocking(int Port)
{
#if defined(_WIN32)
      WSADATA wsa;
      SOCKET listenfd;
      u_long NonBlock = 1;
      struct sockaddr_in Server;
      int opt = 1;

      if (WSAStartup(MAKEWORD(2,2),&wsa) != 0) {
         printf("Warning: WSAStartup failed in InitSocketServerNonBlocking.\n");
         return INVALID_SOCKET;
      }
      listenfd = socket(AF_INET,SOCK_STREAM,0);
      if (listenfd == INVALID_SOCKET) {
         printf("Warning: socket() failed in InitSocketServerNonBlocking.\n");
         return INVALID_SOCKET;
      }
      setsockopt(listenfd,SOL_SOCKET,SO_REUSEADDR,(const char *)&opt,sizeof(opt));
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      Server.sin_addr.s_addr = INADDR_ANY;
      Server.sin_port = htons(Port);
      if (bind(listenfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Warning: bind() failed on port %d in InitSocketServerNonBlocking.\n",Port);
         closesocket(listenfd);
         return INVALID_SOCKET;
      }
      listen(listenfd,5);
      ioctlsocket(listenfd,FIONBIO,&NonBlock);
      printf("Server listening (non-blocking) on port %d\n",Port);
      return listenfd;
#else
      SOCKET listenfd;
      int flags;
      struct sockaddr_in Server;
      int opt = 1;

      listenfd = socket(AF_INET,SOCK_STREAM,0);
      if (listenfd < 0) {
         printf("Warning: socket() failed in InitSocketServerNonBlocking.\n");
         return -1;
      }
      if (setsockopt(listenfd,SOL_SOCKET,SO_REUSEADDR,&opt,sizeof(opt)) == -1) {
         printf("Warning: setsockopt() failed in InitSocketServerNonBlocking.\n");
         close(listenfd);
         return -1;
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      Server.sin_addr.s_addr = INADDR_ANY;
      Server.sin_port = htons(Port);
      if (bind(listenfd,(struct sockaddr *) &Server,sizeof(Server)) < 0) {
         printf("Warning: bind() failed on port %d in InitSocketServerNonBlocking.\n",Port);
         close(listenfd);
         return -1;
      }
      listen(listenfd,5);
      flags = fcntl(listenfd, F_GETFL, 0);
      fcntl(listenfd, F_SETFL, flags | O_NONBLOCK);
      printf("Server listening (non-blocking) on port %d\n",Port);
      return listenfd;
#endif
}
/**********************************************************************/
SOCKET AcceptSocketNonBlocking(SOCKET ListenSocket, int AllowBlocking)
{
#if defined(_WIN32)
      SOCKET sockfd;
      u_long Blocking = 1;
      int clilen;
      struct sockaddr_in Client;
      int DisableNagle = 1;

      clilen = sizeof(Client);
      sockfd = accept(ListenSocket,(struct sockaddr *) &Client,&clilen);
      if (sockfd == INVALID_SOCKET) {
         return INVALID_SOCKET;
      }
      /* Set blocking mode for data socket per config */
      if (!AllowBlocking) {
         ioctlsocket(sockfd,FIONBIO,&Blocking);
      }
      setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,
                 (const char *)&DisableNagle,sizeof(DisableNagle));
      return sockfd;
#else
      SOCKET sockfd;
      int flags;
      socklen_t clilen;
      struct sockaddr_in Client;
      int DisableNagle = 1;

      clilen = sizeof(Client);
      sockfd = accept(ListenSocket,(struct sockaddr *) &Client,&clilen);
      if (sockfd < 0) {
         return -1;
      }
      /* Set blocking mode for data socket per config */
      if (!AllowBlocking) {
         flags = fcntl(sockfd, F_GETFL, 0);
         fcntl(sockfd, F_SETFL, flags | O_NONBLOCK);
      }
      setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,&DisableNagle,sizeof(DisableNagle));
      return sockfd;
#endif
}
/**********************************************************************/
SOCKET InitSocketClientNonBlocking(const char *hostname, int Port,
                                   int AllowBlocking)
{
#if defined(_WIN32)
      WSADATA wsa;
      SOCKET sockfd;
      u_long NonBlock = 1;
      u_long Blocking = 1;
      struct sockaddr_in Server;
      struct hostent *Host;
      int err;
      int DisableNagle = 1;

      if (WSAStartup(MAKEWORD(2,2),&wsa) != 0) {
         return INVALID_SOCKET;
      }
      sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (sockfd == INVALID_SOCKET) {
         return INVALID_SOCKET;
      }
      Host = gethostbyname(hostname);
      if (Host == NULL) {
         closesocket(sockfd);
         return INVALID_SOCKET;
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      memcpy((char *)&Server.sin_addr.s_addr,(char *)Host->h_addr_list[0],
         Host->h_length);
      Server.sin_port = htons(Port);
      /* Set non-blocking for connect attempt */
      ioctlsocket(sockfd,FIONBIO,&NonBlock);
      if (connect(sockfd,(struct sockaddr *) &Server,sizeof(Server)) == 0) {
         /* Immediate success */
         if (AllowBlocking) {
            NonBlock = 0;
            ioctlsocket(sockfd,FIONBIO,&NonBlock);
         }
         setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,
                    (const char *)&DisableNagle,sizeof(DisableNagle));
         return sockfd;
      }
      err = WSAGetLastError();
      if (err == WSAEWOULDBLOCK) {
         /* Connection in progress — return fd for later completion check */
         return sockfd;
      }
      closesocket(sockfd);
      return INVALID_SOCKET;
#else
      SOCKET sockfd;
      int flags;
      struct sockaddr_in Server;
      struct hostent *Host;
      int DisableNagle = 1;

      sockfd = socket(AF_INET,SOCK_STREAM,0);
      if (sockfd < 0) {
         return -1;
      }
      Host = gethostbyname(hostname);
      if (Host == NULL) {
         close(sockfd);
         return -1;
      }
      memset((char *) &Server,0,sizeof(Server));
      Server.sin_family = AF_INET;
      memcpy((char *)&Server.sin_addr.s_addr,(char *)Host->h_addr_list[0],
         Host->h_length);
      Server.sin_port = htons(Port);
      /* Set non-blocking for connect attempt */
      flags = fcntl(sockfd, F_GETFL, 0);
      fcntl(sockfd, F_SETFL, flags | O_NONBLOCK);
      if (connect(sockfd,(struct sockaddr *) &Server,sizeof(Server)) == 0) {
         /* Immediate success — adjust blocking mode */
         if (AllowBlocking) {
            fcntl(sockfd, F_SETFL, flags); /* Restore blocking */
         }
         setsockopt(sockfd,IPPROTO_TCP,TCP_NODELAY,&DisableNagle,sizeof(DisableNagle));
         return sockfd;
      }
      if (errno == EINPROGRESS) {
         /* Connection in progress — return fd for later completion check */
         return sockfd;
      }
      close(sockfd);
      return -1;
#endif
}

/**********************************************************************/
int CheckSocketConnected(SOCKET sockfd, int AllowBlocking)
{
#if defined(_WIN32)
      fd_set writefds, exceptfds;
      struct timeval tv = {0, 0};
      int err;
      int len = sizeof(err);
      u_long NonBlock;
      int DisableNagle = 1;
      int rc;

      FD_ZERO(&writefds);
      FD_SET(sockfd, &writefds);
      FD_ZERO(&exceptfds);
      FD_SET(sockfd, &exceptfds);

      rc = select(0, NULL, &writefds, &exceptfds, &tv);
      if (rc == 0) return 0;  /* Still in progress */
      if (rc < 0) return -1;  /* select() failed */

      if (FD_ISSET(sockfd, &exceptfds)) return -1;

      if (FD_ISSET(sockfd, &writefds)) {
         getsockopt(sockfd, SOL_SOCKET, SO_ERROR, (char *)&err, &len);
         if (err != 0) return -1;
         if (AllowBlocking) {
            NonBlock = 0;
            ioctlsocket(sockfd, FIONBIO, &NonBlock);
         }
         setsockopt(sockfd, IPPROTO_TCP, TCP_NODELAY,
                    (const char *)&DisableNagle, sizeof(DisableNagle));
         return 1;  /* Connected */
      }
      return 0;
#else
      fd_set writefds;
      struct timeval tv = {0, 0};
      int err = 0;
      socklen_t len = sizeof(err);
      int DisableNagle = 1;
      int rc;

      FD_ZERO(&writefds);
      FD_SET(sockfd, &writefds);

      rc = select(sockfd + 1, NULL, &writefds, NULL, &tv);
      if (rc == 0) return 0;  /* Still in progress */
      if (rc < 0) return -1;  /* select() failed */

      if (FD_ISSET(sockfd, &writefds)) {
         getsockopt(sockfd, SOL_SOCKET, SO_ERROR, (char *)&err, &len);
         if (err != 0) return -1;
         if (AllowBlocking) {
            int flags = fcntl(sockfd, F_GETFL, 0);
            fcntl(sockfd, F_SETFL, flags & ~O_NONBLOCK);
         }
         setsockopt(sockfd, IPPROTO_TCP, TCP_NODELAY,
                    &DisableNagle, sizeof(DisableNagle));
         return 1;  /* Connected */
      }
      return 0;
#endif
}

/* #ifdef __cplusplus
** }
** #endif
*/
