/*    This file is distributed with 42,                               */
/*    the (mostly harmless) spacecraft dynamics simulation            */
/*    created by Eric Stoneking of NASA Goddard Space Flight Center   */

/*    Copyright 2010 United States Government                         */
/*    as represented by the Administrator                             */
/*    of the National Aeronautics and Space Administration.           */

/*    No copyright is claimed in the United States                    */
/*    under Title 17, U.S. Code.                                      */

/*    All Other Rights Reserved.                                      */

/* Redis Subscribe Module for 42 Spacecraft Simulator                */

extern "C" {
#include "42.h"
}

#include <string>
#include <vector>
#include <cstring>
#include <cerrno>
#include <sys/select.h>
#include <hiredis/hiredis.h>

static redisContext *subscribeCtx = NULL;
static redisContext *dataCtx = NULL;
static bool subscribed = false;
static std::vector<std::string> subscriptionPatterns;

/* Storage for config data retrieved from Redis */
static std::string storedInpSim;

/* Message handler callback */
void HandleSubscriptionMessage(redisReply *reply) {
    if (reply->type == REDIS_REPLY_ARRAY && reply->elements >= 3) {
        std::string messageType(reply->element[0]->str, reply->element[0]->len);

        std::string channel;
        std::string payload;

        if (messageType == "pmessage" && reply->elements >= 4) {
            /* Pattern-based subscription */
            channel = std::string(reply->element[2]->str, reply->element[2]->len);
            payload = std::string(reply->element[3]->str, reply->element[3]->len);
        } else if (messageType == "message" && reply->elements >= 3) {
            /* Direct channel subscription */
            channel = std::string(reply->element[1]->str, reply->element[1]->len);
            payload = std::string(reply->element[2]->str, reply->element[2]->len);
        } else {
            /* Subscription confirmation messages */
            return;
        }

        /* Print received message to console */
        fprintf(stdout, "\n========================================\n");
        fprintf(stdout, "[REDIS SUB] Message received\n");
        fprintf(stdout, "[REDIS SUB] Channel: %s\n", channel.c_str());
        fprintf(stdout, "========================================\n");
        fprintf(stdout, "Content (%zu bytes):\n%s\n", payload.length(), payload.c_str());
        fprintf(stdout, "========================================\n\n");
        fflush(stdout);
    }
}

/* Fetch config data from Redis for initialization */
void FetchConfigFromRedis(const char* redisHost, int redisPort) {
    /* Create a separate connection for data fetching */
    if (!dataCtx) {
        dataCtx = redisConnect(redisHost, redisPort);
        if (dataCtx == NULL || dataCtx->err) {
            if (dataCtx) {
                fprintf(stderr, "Redis data connection error: %s\n", dataCtx->errstr);
                redisFree(dataCtx);
                dataCtx = NULL;
            }
            return;
        }
    }

    /* Fetch Inp_Sim config if it exists */
    redisReply *reply = (redisReply*)redisCommand(dataCtx, "GET fortytwo:config:Inp_Sim");
    if (reply && reply->type == REDIS_REPLY_STRING) {
        storedInpSim = std::string(reply->str, reply->len);
        printf("[REDIS] Fetched Inp_Sim config from Redis (%zu bytes)\n", storedInpSim.length());
    }
    if (reply) freeReplyObject(reply);
}

/* Initialize Redis subscription - subscribes once to config channels */
void InitializeSubscription(void) {
    if (subscribed) return;

    /* Get Redis connection info from environment or use defaults */
    const char* redisHost = getenv("FORTYTWO_REDIS_HOST");
    if (redisHost == NULL) redisHost = "localhost";

    const char* redisPortStr = getenv("FORTYTWO_REDIS_PORT");
    int redisPort = (redisPortStr != NULL) ? atoi(redisPortStr) : 6379;

    /* If PublisherIp is already set (from Inp_Sim), use that instead */
    if (strlen(PublisherIp) > 0) {
        redisHost = PublisherIp;
        redisPort = (int)PublisherPort;
    }

    printf("Connecting to Redis at %s:%d\n", redisHost, redisPort);

    /* Fetch config data from Redis */
    FetchConfigFromRedis(redisHost, redisPort);

    if (!subscribeCtx) {
        subscribeCtx = redisConnect(redisHost, redisPort);
        if (subscribeCtx == NULL || subscribeCtx->err) {
            if (subscribeCtx) {
                fprintf(stderr, "Redis subscription connection error: %s\n",
                        subscribeCtx->errstr);
                redisFree(subscribeCtx);
                subscribeCtx = NULL;
            } else {
                fprintf(stderr, "Redis subscription connection error: can't allocate redis context\n");
            }
            return;
        }
    }

    /* Subscribe only to config channels */
    subscriptionPatterns.clear();
    subscriptionPatterns.push_back("fortytwo:config:*");

    /* Execute pattern subscription */
    redisReply *reply = (redisReply*)redisCommand(subscribeCtx,
                                                  "PSUBSCRIBE %s",
                                                  subscriptionPatterns[0].c_str());
    if (reply == NULL) {
        fprintf(stderr, "Failed to subscribe to pattern: %s\n",
                subscriptionPatterns[0].c_str());
        fprintf(stderr, "Error: %s\n", subscribeCtx->errstr);
        redisFree(subscribeCtx);
        subscribeCtx = NULL;
        return;
    }

    printf("Subscribed to Redis pattern: %s\n", subscriptionPatterns[0].c_str());
    freeReplyObject(reply);

    subscribed = true;
}

/* Check for subscription messages (non-blocking) */
void CheckSubscriptionMessages(void) {
    if (!subscribeCtx || !subscribed) return;

    /* Check if data is available to read without blocking */
    fd_set readfds;
    struct timeval timeout;
    int fd = subscribeCtx->fd;

    if (fd < 0) return;

    FD_ZERO(&readfds);
    FD_SET(fd, &readfds);
    timeout.tv_sec = 0;
    timeout.tv_usec = 0;

    int ready = select(fd + 1, &readfds, NULL, NULL, &timeout);

    if (ready > 0 && FD_ISSET(fd, &readfds)) {
        /* Data is available - read it */
        redisReply *reply = NULL;

        /* Use redisBufferRead then redisGetReply to avoid blocking */
        if (redisBufferRead(subscribeCtx) == REDIS_OK) {
            if (redisGetReply(subscribeCtx, (void**)&reply) == REDIS_OK && reply != NULL) {
                HandleSubscriptionMessage(reply);
                freeReplyObject(reply);
            }
        }
    }
}

/* Main subscription function called from 42exec */
extern "C" void Subscribe(void) {
    if (strcmp(PublisherType, "Redis") == 0) {
        if (!subscribed) {
            /* Initialize subscription once at startup */
            InitializeSubscription();
        } else {
            /* Check for messages during simulation loop */
            CheckSubscriptionMessages();
        }
    }
}

/* Check if Inp_Sim config is available from Redis */
extern "C" int HasInpSimFromRedis(void) {
    return !storedInpSim.empty();
}

/* Get Inp_Sim config from Redis as FILE* */
extern "C" FILE* GetInpSimFromRedis(void) {
    if (storedInpSim.empty()) {
        return NULL;
    }

    /* Create a FILE* from the in-memory string */
    FILE *fp = fmemopen((void*)storedInpSim.c_str(), storedInpSim.length(), "r");
    if (fp == NULL) {
        fprintf(stderr, "Failed to create memory stream for Inp_Sim: %s\n", strerror(errno));
        return NULL;
    }

    printf("[REDIS] Providing Inp_Sim from Redis memory (%zu bytes)\n", storedInpSim.length());
    return fp;
}

/* Cleanup Redis subscription connection on exit */
extern "C" void CleanupRedisSubscription(void) {
    if (subscribeCtx) {
        /* Unsubscribe from all patterns */
        redisReply *reply = (redisReply*)redisCommand(subscribeCtx, "PUNSUBSCRIBE");
        if (reply) freeReplyObject(reply);

        redisFree(subscribeCtx);
        subscribeCtx = NULL;
    }

    if (dataCtx) {
        redisFree(dataCtx);
        dataCtx = NULL;
    }

    subscribed = false;
    storedInpSim.clear();
}
