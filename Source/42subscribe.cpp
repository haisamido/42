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
#include <map>
#include <cstring>
#include <cerrno>
#include <sys/select.h>
#include <hiredis/hiredis.h>
#include <jansson.h>

static redisContext *subscribeCtx = NULL;
static redisContext *dataCtx = NULL;
static bool subscribed = false;
static std::vector<std::string> subscriptionPatterns;

/* Storage for config data retrieved from Redis */
static std::map<std::string, std::string> configCache;

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

        /* Parse JSON payload */
        json_error_t error;
        json_t *root = json_loads(payload.c_str(), 0, &error);
        if (!root) {
            fprintf(stderr, "[REDIS SUB] JSON parse error: %s\n", error.text);
            /* Fallback: print raw payload */
            fprintf(stdout, "\n========================================\n");
            fprintf(stdout, "[REDIS SUB] Message received (raw)\n");
            fprintf(stdout, "[REDIS SUB] Channel: %s\n", channel.c_str());
            fprintf(stdout, "========================================\n");
            fprintf(stdout, "Content (%zu bytes):\n%s\n", payload.length(), payload.c_str());
            fprintf(stdout, "========================================\n\n");
            fflush(stdout);
            return;
        }

        /* Extract content and metadata */
        json_t *content = json_object_get(root, "content");
        json_t *metadata = json_object_get(root, "metadata");

        if (!content || !json_is_string(content)) {
            fprintf(stderr, "[REDIS SUB] Invalid JSON structure: missing 'content' field\n");
            json_decref(root);
            return;
        }

        const char *contentStr = json_string_value(content);

        /* Print received message to console */
        fprintf(stdout, "\n========================================\n");
        fprintf(stdout, "[REDIS SUB] Message received\n");
        fprintf(stdout, "[REDIS SUB] Channel: %s\n", channel.c_str());
        fprintf(stdout, "========================================\n");

        /* Print metadata if available */
        if (metadata && json_is_object(metadata)) {
            fprintf(stdout, "Metadata:\n");
            json_t *mtime = json_object_get(metadata, "mtime");
            json_t *ctime = json_object_get(metadata, "ctime");
            json_t *atime = json_object_get(metadata, "atime");
            json_t *inserted_time = json_object_get(metadata, "inserted_time");

            if (mtime && json_is_string(mtime))
                fprintf(stdout, "  mtime: %s\n", json_string_value(mtime));
            if (ctime && json_is_string(ctime))
                fprintf(stdout, "  ctime: %s\n", json_string_value(ctime));
            if (atime && json_is_string(atime))
                fprintf(stdout, "  atime: %s\n", json_string_value(atime));
            if (inserted_time && json_is_string(inserted_time))
                fprintf(stdout, "  inserted_time: %s\n", json_string_value(inserted_time));
            fprintf(stdout, "========================================\n");
        }

        fprintf(stdout, "Content (%zu bytes):\n%s\n", strlen(contentStr), contentStr);
        fprintf(stdout, "========================================\n\n");
        fflush(stdout);

        json_decref(root);
    }
}

/* Helper function to fetch a single config file from Redis */
static bool FetchSingleConfig(const char* configName) {
    if (!dataCtx) return false;

    /* Build channel name */
    std::string channel = std::string(RedisPrefix) + ":config:" + std::string(configName);

    /* Fetch config if it exists */
    redisReply *reply = (redisReply*)redisCommand(dataCtx, "GET %s", channel.c_str());
    if (reply && reply->type == REDIS_REPLY_STRING) {
        /* Parse JSON to extract content */
        json_error_t error;
        json_t *root = json_loads(reply->str, 0, &error);
        if (root) {
            json_t *content = json_object_get(root, "content");
            if (content && json_is_string(content)) {
                configCache[configName] = json_string_value(content);
                printf("[REDIS] Fetched %s config from Redis (%zu bytes)\n",
                       configName, configCache[configName].length());
                json_decref(root);
                freeReplyObject(reply);
                return true;
            } else {
                fprintf(stderr, "[REDIS] Invalid JSON structure in %s: missing 'content' field\n", configName);
            }
            json_decref(root);
        } else {
            fprintf(stderr, "[REDIS] JSON parse error for %s: %s\n", configName, error.text);
        }
    }
    if (reply) freeReplyObject(reply);
    return false;
}

/* Fetch all config data from Redis for initialization */
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

    /* Fetch all known config files */
    FetchSingleConfig("Inp_Sim");
    FetchSingleConfig("InOutPath");

    /* We'll fetch orbit and spacecraft configs dynamically as they are requested */
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
    subscriptionPatterns.push_back(std::string(RedisPrefix) + ":config:*");

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

/* Generic function to check if a config file is available from Redis */
extern "C" int HasConfigFromRedis(const char* configName) {
    /* Try to fetch if not in cache yet */
    if (configCache.find(configName) == configCache.end() && dataCtx) {
        FetchSingleConfig(configName);
    }
    return configCache.find(configName) != configCache.end();
}

/* Generic function to get config from Redis as FILE* */
extern "C" FILE* GetConfigFromRedis(const char* configName) {
    /* Try to fetch if not in cache yet */
    if (configCache.find(configName) == configCache.end() && dataCtx) {
        if (!FetchSingleConfig(configName)) {
            return NULL;
        }
    }

    /* Check if we have the config */
    if (configCache.find(configName) == configCache.end()) {
        return NULL;
    }

    const std::string& content = configCache[configName];

    /* Create a FILE* from the in-memory string */
    FILE *fp = fmemopen((void*)content.c_str(), content.length(), "r");
    if (fp == NULL) {
        fprintf(stderr, "Failed to create memory stream for %s: %s\n", configName, strerror(errno));
        return NULL;
    }

    printf("[REDIS] Providing %s from Redis memory (%zu bytes)\n", configName, content.length());
    return fp;
}

/* Backwards compatibility wrappers for Inp_Sim */
extern "C" int HasInpSimFromRedis(void) {
    return HasConfigFromRedis("Inp_Sim");
}

extern "C" FILE* GetInpSimFromRedis(void) {
    return GetConfigFromRedis("Inp_Sim");
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
    configCache.clear();
}
